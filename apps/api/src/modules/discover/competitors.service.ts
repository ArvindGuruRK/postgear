/**
 * The competitors a workspace follows, and what each of them published lately
 * (Module 07, stories DC-7.1 to DC-7.3).
 *
 * This is the part of Discover that fetches addresses a person typed, so the
 * rules here are about that before they are about anything else.
 *
 * ## Every address passes the guard, before anything else happens to it
 *
 * A website, each feed address and the instance of a Mastodon account are
 * checked against the private-network guard when they are saved, and a refusal
 * is answered with the sentence the stories ask for, with no row written and no
 * request made. They are checked again on every fetch: the fetch is the guarded
 * one, which re-checks each redirect hop, so a public address that later starts
 * pointing inwards is refused then. `WEBHOOK_ALLOW_PRIVATE_URLS` cannot reach
 * this path (`competitors.engine.ts`).
 *
 * The guard judges a port before it judges an address literal, so
 * `http://127.0.0.1:3000` would be refused for its port. That is the wrong
 * sentence for someone pointing at their own machine, so a port refusal is
 * looked at once more without the port, and a private host says private.
 *
 * ## Items live in Redis, per competitor, and nowhere else
 *
 * `items` fans out over the competitor's feeds, channel, accounts and a news
 * search, each through the gate, and keeps the answer for 30 minutes (24 hours
 * as a fallback copy). The key carries a hash of what is read, so an edit never
 * meets an old copy. A source that fails keeps its last items and adds one
 * sentence to `notes`; the others are untouched. Nothing a source said is
 * written to Postgres: the row gets when it was checked and one sentence of ours.
 *
 * ## A host that keeps failing rests
 *
 * Three failures in a row from one host and it is left alone for ten minutes,
 * the same breaker the place sources have, kept per host. Only real trouble
 * counts (a 429, a 5xx, no answer): a feed that is not there, or is not a feed,
 * says nothing about the host.
 */
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  buildBrief,
  type ComposedItem,
  type DiscoveredFeed,
  type DiscoverFetch,
  type DiscoverItem,
  discoverFeeds,
  itemId,
  type Locality,
  mastodonAccount,
  type SourceResult,
  WORLDWIDE,
} from '@postgear/discover-engine';
import { decrypt } from '@postgear/db';
import type { UrlRejectReason, UrlSafetyResult } from '@postgear/seo-engine';
import { securityLogger } from '../../common/logging/security-logger';
import { RedisService } from '../redis/redis.service';
import { COMPETITOR_ENGINE, COMPETITOR_GATE, type CompetitorEngine } from './competitors.engine';
import {
  type CompetitorRow,
  CompetitorsRepository,
  type CompetitorWrite,
} from './competitors.repository';
import {
  addressOf,
  countRefusal,
  hopRefusal,
  isPrivate,
  judgeAddress,
  refusalsSpent,
} from './discover.addresses';
import { type CacheEntry, DiscoverCache, LOCK_SECONDS } from './discover.cache';
import { DiscoverGate } from './discover.gate';
import { type DiscoverKeys, discoverKeys, workspaceKeys } from './discover.keys';
import { COMPETITOR_KIND_NAMES, DISCOVER_MESSAGES } from './discover.messages';
import {
  type CreateCompetitorInput,
  MAX_COMPETITORS,
  type UpdateCompetitorInput,
} from './dto/competitors.schema';
import { DiscoverSettingsService } from './settings.service';

const MINUTE_MS = 60_000;

/** How long a competitor's items are simply the answer. */
export const COMPETITOR_FRESH_MS = 30 * MINUTE_MS;
/** How long a failed source's last items may still be shown. */
export const COMPETITOR_KEEP_SECONDS = 24 * 60 * 60;

/** A chatty account must not push the blog off the list. */
export const ITEMS_PER_SOURCE = 5;
export const ITEMS_PER_COMPETITOR = 15;

/** New reads one workspace may cause in a minute. A competitor with a copy is free. */
export const COMPETITOR_READS_PER_MINUTE = 30;
const COMPETITOR_READS_WINDOW_SECONDS = 60;

export const FEED_DISCOVERY_PER_MINUTE = 5;
const FEED_DISCOVERY_WINDOW_SECONDS = 60;
/** The page and every probe together. */
const FEED_DISCOVERY_DEADLINE_MS = 10_000;
const PAGE_MAX_BYTES = 1024 * 1024;
const PAGE_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5';

/** Well inside the lock's 20 seconds, gate wait included. */
const SOURCE_DEADLINE_MS = 12_000;

const RETRY_AFTER_TROUBLE_MS = MINUTE_MS;
/** A feed that is not there will not be there in a minute either. */
const RETRY_AFTER_MISSING_MS = 10 * MINUTE_MS;
const RETRY_AFTER_BUSY_MS = LOCK_SECONDS * 1000;

const BREAKER_THRESHOLD = 3;
const BREAKER_SECONDS = 10 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CompetitorKind = keyof typeof COMPETITOR_KIND_NAMES;

/** In the order the notes read: their own places first, what others say last. */
const KIND_ORDER: readonly CompetitorKind[] = [
  'blog',
  'youtube',
  'instagram',
  'bluesky',
  'mastodon',
  'news',
];

/** Module 10: a competitor is read again by the worker when nobody has looked for this long. */
export const DAILY_REFRESH_AFTER_MS = 20 * 60 * MINUTE_MS;

/** Module 10: what simulation reads Instagram as. The fixtures answer whatever the account. */
const SIMULATED_INSTAGRAM = { id: '17841400000000000', token: 'simulation' } as const;

/** What every competitor of one workspace is read with: its place and its Instagram account. */
interface PlanContext {
  locality: Locality;
  language: string;
  /** Opened for the request, never stored. Null without a connected business account. */
  instagram: { id: string; token: string } | null;
}

/** Module 10: what a person has not seen yet, per competitor. */
export interface UnseenAnswer {
  total: number;
  competitors: Record<string, number>;
}

export interface CompetitorView {
  id: string;
  name: string;
  websiteUrl: string | null;
  feedUrls: string[];
  youtubeChannelId: string | null;
  blueskyHandle: string | null;
  mastodonAcct: string | null;
  newsQuery: string | null;
  instagramUsername: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorItemsAnswer {
  items: DiscoverItem[];
  /** The kinds that could not be read this time. */
  unavailable: CompetitorKind[];
  /** One sentence for each of those, with the age of what is still shown. */
  notes: string[];
  fetchedAt: string;
  stale: boolean;
  /**
   * Nothing is known yet for at least one of the competitor's places: someone
   * else is reading them right now, or there was no free slot to ask in. The
   * page keeps waiting and asks again, and never says "nothing new" for it.
   */
  pending: boolean;
  /**
   * Module 10: when the person asking last looked at this competitor, so the
   * page can mark what is new since. Null the first time.
   */
  lastSeenAt: string | null;
}

/** Reached, or read: the two sentences a failed source can get. */
type Trouble = 'unreachable' | 'unreadable' | 'reconnect';

interface CachedPart {
  kind: CompetitorKind;
  /** Which of the competitor's places this is: a feed address, a channel id, a handle, a phrase. */
  ref: string;
  items: ComposedItem[];
  /** When these items were really fetched, which a kept copy does not change. */
  fetchedAt: string;
  trouble?: Trouble;
  /** Never asked, and no copy to show: the gate was full the only time it came up. */
  pending?: boolean;
}

interface CachedCompetitor extends CacheEntry {
  parts: CachedPart[];
  /** Set when this entry is worth asking for again sooner than its window says. */
  retryAfterMs: number | null;
}

interface ReadTask {
  kind: CompetitorKind;
  ref: string;
  /** Whose trouble a failure is counted against. */
  host: string;
  read: (signal: AbortSignal) => Promise<SourceResult>;
}

type TaskOutcome =
  | { state: 'answered'; result: SourceResult }
  | { state: 'trouble'; trouble: Trouble; retryAfterMs: number }
  /** The gate was full: nothing is known, and the copy stays without a note. */
  | { state: 'busy' };

function toView(row: CompetitorRow): CompetitorView {
  return {
    id: row.id,
    name: row.name,
    websiteUrl: row.websiteUrl,
    feedUrls: row.feedUrls,
    youtubeChannelId: row.youtubeChannelId,
    blueskyHandle: row.blueskyHandle,
    mastodonAcct: row.mastodonAcct,
    newsQuery: row.newsQuery,
    instagramUsername: row.instagramUsername,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

function timeOf(item: ComposedItem): number {
  const time = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function newestFirst(a: ComposedItem, b: ComposedItem): number {
  const [left, right] = [timeOf(a), timeOf(b)];
  if (left === right) return 0;
  return right > left ? 1 : -1;
}

@Injectable()
export class CompetitorsService {
  private readonly logger = new Logger(CompetitorsService.name);
  private readonly keys: DiscoverKeys;

  constructor(
    @Inject(COMPETITOR_ENGINE) private readonly engine: CompetitorEngine,
    private readonly repository: CompetitorsRepository,
    private readonly cache: DiscoverCache,
    @Inject(COMPETITOR_GATE) private readonly gate: DiscoverGate,
    private readonly redis: RedisService,
    private readonly settings: DiscoverSettingsService,
  ) {
    this.keys = discoverKeys(engine.simulation);
  }

  // ---------------------------------------------------------------------------
  // The list
  // ---------------------------------------------------------------------------

  async list(orgId: string): Promise<CompetitorView[]> {
    return (await this.repository.list(orgId)).map(toView);
  }

  /** One competitor of the workspace, or a 404. */
  async view(orgId: string, id: string): Promise<CompetitorView> {
    return toView(await this.require(orgId, id));
  }

  async create(
    orgId: string,
    userId: string | null,
    input: CreateCompetitorInput,
  ): Promise<CompetitorView> {
    // The cheap refusal first: a full workspace should not cost a look at every address.
    if ((await this.repository.count(orgId)) >= MAX_COMPETITORS) throw this.limitReached();

    const checked = await this.checked(orgId, input);
    const created = await this.repository.create(
      orgId,
      userId,
      {
        name: input.name,
        websiteUrl: checked.websiteUrl ?? null,
        feedUrls: checked.feedUrls ?? [],
        youtubeChannelId: input.youtubeChannelId ?? null,
        blueskyHandle: input.blueskyHandle ?? null,
        mastodonAcct: input.mastodonAcct ?? null,
        newsQuery: input.newsQuery ?? null,
        instagramUsername: input.instagramUsername ?? null,
      },
      MAX_COMPETITORS,
    );
    // Someone else took the last place between the count above and the insert.
    if (created.outcome === 'limit') throw this.limitReached();

    return toView(created.row);
  }

  async update(orgId: string, id: string, input: UpdateCompetitorInput): Promise<CompetitorView> {
    // Before any address is looked at: another workspace's id learns nothing.
    await this.require(orgId, id);

    const checked = await this.checked(orgId, input);
    const write: Partial<CompetitorWrite> = { ...checked };
    if (input.name !== undefined) write.name = input.name;
    if (input.youtubeChannelId !== undefined) write.youtubeChannelId = input.youtubeChannelId;
    if (input.blueskyHandle !== undefined) write.blueskyHandle = input.blueskyHandle;
    if (input.mastodonAcct !== undefined) write.mastodonAcct = input.mastodonAcct;
    if (input.newsQuery !== undefined) write.newsQuery = input.newsQuery;
    if (input.instagramUsername !== undefined) write.instagramUsername = input.instagramUsername;

    const row = await this.repository.update(orgId, id, write);
    if (!row) throw this.notFound();

    return toView(row);
  }

  /** A soft delete. The id answers 404 from here on; its items simply expire. */
  async remove(orgId: string, id: string): Promise<void> {
    if (!UUID_PATTERN.test(id) || !(await this.repository.softDelete(orgId, id))) {
      throw this.notFound();
    }
  }

  // ---------------------------------------------------------------------------
  // Finding a website's feeds
  // ---------------------------------------------------------------------------

  /**
   * The feeds a website offers, at most five, each one checked against the guard
   * before it is answered. A site that cannot be read, or has no feed, answers an
   * empty list: the dialog then offers a field to paste an address into.
   */
  async discoverFeeds(orgId: string, input: string): Promise<DiscoveredFeed[]> {
    const url = addressOf(input);
    if (!url) throw this.invalidAddress();

    await this.throttle(orgId);
    const website = await this.safeAddress(orgId, url);

    // One deadline for the page and every address tried after it.
    const signal = AbortSignal.timeout(FEED_DISCOVERY_DEADLINE_MS);
    const fetchThroughGate = this.gated();

    let found: DiscoveredFeed[];
    try {
      const page = await fetchThroughGate(website, {
        accept: PAGE_ACCEPT,
        signal,
        maxBytes: PAGE_MAX_BYTES,
      });
      if (page.status !== 200) return [];

      found = await discoverFeeds(page.body, page.finalUrl || website, {
        fetch: fetchThroughGate,
        signal,
      });
    } catch (error) {
      // A redirect into a private network is the same refusal as typing one.
      const reason = hopRefusal(error);
      if (reason && isPrivate(reason)) throw this.refusal(orgId, reason);

      this.logger.warn(
        JSON.stringify({
          event: 'discover.competitor.feeds_failed',
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
      return [];
    }

    // A page can link anything. Only what the guard passes is ever shown.
    const feeds: DiscoveredFeed[] = [];
    for (const feed of found) {
      const verdict = await this.judge(feed.url);
      if (verdict.ok) feeds.push({ ...feed, url: verdict.url.toString() });
    }
    return feeds;
  }

  // ---------------------------------------------------------------------------
  // What a competitor published
  // ---------------------------------------------------------------------------

  async items(orgId: string, id: string, userId?: string): Promise<CompetitorItemsAnswer> {
    const row = await this.require(orgId, id);
    const context = await this.planContext(orgId);
    const { tasks, sources } = this.plan(row, context);
    const lastSeenAt = userId
      ? ((await this.repository.lastSeen(userId, [row.id])).get(row.id)?.toISOString() ?? null)
      : null;

    const { entry } = await this.cache.load<CachedCompetitor>(
      this.keys.competitor(row.id, sources),
      {
        keepSeconds: COMPETITOR_KEEP_SECONDS,
        freshMs: (cached) => cached.retryAfterMs ?? COMPETITOR_FRESH_MS,
        // Counts reads, not looks: a competitor with a copy costs nobody anything.
        beforeMiss: () => this.countRead(orgId),
        refresh: (previous) => this.refresh(orgId, row, tasks, previous),
      },
    );

    // No entry: someone else is fetching and did not finish in time. Nothing is known.
    if (!entry) {
      return {
        items: [],
        unavailable: [],
        notes: [],
        fetchedAt: new Date().toISOString(),
        stale: false,
        pending: true,
        lastSeenAt,
      };
    }

    const answer = this.present(row, entry);
    // An Instagram account named with nothing to read it through: the one note that is not trouble.
    if (row.instagramUsername && !context.instagram) {
      answer.notes.push(DISCOVER_MESSAGES.instagramNeedsChannel);
    }
    return { ...answer, lastSeenAt };
  }

  // ---------------------------------------------------------------------------
  // New since you last looked (Module 10)
  // ---------------------------------------------------------------------------

  /**
   * How many items each competitor has that this person has not seen: newer
   * than their last look, or than the day the competitor was added when they
   * never looked. Read from the copies only: counting never fetches.
   */
  async unseen(orgId: string, userId: string): Promise<UnseenAnswer> {
    const rows = await this.repository.list(orgId);
    if (rows.length === 0) return { total: 0, competitors: {} };

    const [seen, context] = await Promise.all([
      this.repository.lastSeen(
        userId,
        rows.map((row) => row.id),
      ),
      this.planContext(orgId),
    ]);

    const competitors: Record<string, number> = {};
    for (const row of rows) {
      const { sources } = this.plan(row, context);
      const entry = await this.cache.peek<CachedCompetitor>(this.keys.competitor(row.id, sources));
      const since = (seen.get(row.id) ?? row.createdAt).getTime();
      competitors[row.id] = entry
        ? this.itemsOf(entry).filter((item) => timeOf(item) > since).length
        : 0;
    }

    const total = Object.values(competitors).reduce((sum, count) => sum + count, 0);
    return { total, competitors };
  }

  /** This person has now seen these competitors (all of the workspace's when `ids` is absent). */
  async markSeen(orgId: string, userId: string, ids?: readonly string[]): Promise<void> {
    const owned = (await this.repository.list(orgId)).map((row) => row.id);
    const chosen = ids ? owned.filter((id) => ids.includes(id)) : owned;
    await this.repository.markSeen(userId, chosen, new Date());
  }

  /**
   * Module 10, the worker's daily refresh: reads up to `limit` competitors that
   * nobody has looked at for a day, oldest first, one after the other, so a
   * morning's "3 New" is already there. The gate, the host breakers and the
   * guard hold as they do for a person; the workspace's read limit does not,
   * since nobody is asking. Answers how many were read.
   */
  async refreshDue(limit: number, deadline = Number.POSITIVE_INFINITY): Promise<number> {
    const due = await this.repository.due(new Date(Date.now() - DAILY_REFRESH_AFTER_MS), limit);
    const contexts = new Map<string, PlanContext>();
    let read = 0;

    for (const row of due) {
      if (Date.now() > deadline) break;
      const orgId = row.organizationId;
      try {
        let context = contexts.get(orgId);
        if (!context) {
          context = await this.planContext(orgId);
          contexts.set(orgId, context);
        }

        const { tasks, sources } = this.plan(row, context);
        const warmed = await this.cache.warm<CachedCompetitor>(
          this.keys.competitor(row.id, sources),
          {
            keepSeconds: COMPETITOR_KEEP_SECONDS,
            olderThanMs: 0,
            refresh: (previous) => this.refresh(orgId, row, tasks, previous),
          },
        );
        if (warmed) read += 1;
      } catch (error) {
        // One competitor's trouble is the next look's note; the others still get read.
        this.logger.warn(
          JSON.stringify({
            event: 'discover.competitor.refresh_due_failed',
            reason: error instanceof Error ? error.name : 'unknown',
          }),
        );
      }
    }
    return read;
  }

  /**
   * What every competitor of a workspace is read with: the place and first
   * language its news search follows, and its Instagram account, opened here
   * for this request only.
   */
  private async planContext(orgId: string): Promise<PlanContext> {
    const [saved, account] = await Promise.all([
      this.settings.get(orgId),
      this.engine.simulation ? Promise.resolve(null) : this.repository.instagramAccount(orgId),
    ]);
    const locality: Locality = saved.place ?? WORLDWIDE;
    const language = saved.languages[0] ?? locality.languages[0] ?? 'en';

    let instagram: PlanContext['instagram'] = this.engine.simulation ? SIMULATED_INSTAGRAM : null;
    if (account) {
      try {
        instagram = { id: account.id, token: decrypt(account.token) };
      } catch {
        // A token that will not open is a channel to reconnect, never an error page here.
        this.logger.warn(JSON.stringify({ event: 'discover.competitor.instagram_token_unreadable' }));
      }
    }
    return { locality, language, instagram };
  }

  /**
   * What is read for a competitor, and a text that changes whenever that does.
   * The news search follows the workspace's own place and first language, so
   * stories arrive in the edition its members read.
   */
  private plan(row: CompetitorRow, context: PlanContext): { tasks: ReadTask[]; sources: string } {
    const { engine } = this;
    const tasks: ReadTask[] = [];

    for (const feed of row.feedUrls) {
      tasks.push({
        kind: 'blog',
        ref: feed,
        host: hostOf(feed),
        read: (signal) => engine.feeds.read(feed, signal),
      });
    }
    if (row.youtubeChannelId) {
      const channel = row.youtubeChannelId;
      tasks.push({
        kind: 'youtube',
        ref: channel,
        host: 'www.youtube.com',
        read: (signal) => engine.youtube.read(channel, signal),
      });
    }
    if (row.blueskyHandle) {
      const handle = row.blueskyHandle;
      tasks.push({
        kind: 'bluesky',
        ref: handle,
        host: 'public.api.bsky.app',
        read: (signal) => engine.bluesky.read(handle, signal),
      });
    }
    if (row.mastodonAcct) {
      const acct = row.mastodonAcct;
      tasks.push({
        kind: 'mastodon',
        ref: acct,
        host: mastodonAccount(acct)?.instance ?? 'unknown',
        read: (signal) => engine.mastodon.read(acct, signal),
      });
    }

    const { instagram } = context;
    if (row.instagramUsername && instagram) {
      const username = row.instagramUsername;
      tasks.push({
        kind: 'instagram',
        ref: username,
        host: 'graph.facebook.com',
        read: (signal) =>
          engine.instagram.read(
            { username, igUserId: instagram.id, accessToken: instagram.token },
            signal,
          ),
      });
    }

    const { locality, language } = context;
    const phrase = row.newsQuery ?? row.name;
    tasks.push({
      kind: 'news',
      ref: phrase,
      host: 'news.google.com',
      read: (signal) => engine.news.search(phrase, { locality, language, signal }),
    });

    // The account Instagram is read through is in it (its id, never its token):
    // connecting one moves the key, so the first look after it reads at once.
    const sources = JSON.stringify([
      tasks.map((task) => [task.kind, task.ref]),
      locality.countryCode,
      language,
      ...(row.instagramUsername ? [instagram?.id ?? null] : []),
    ]);
    return { tasks, sources };
  }

  private async refresh(
    orgId: string,
    row: CompetitorRow,
    tasks: ReadTask[],
    previous: CachedCompetitor | null,
  ): Promise<CachedCompetitor> {
    const started = Date.now();
    const settled = await Promise.allSettled(tasks.map((task) => this.run(task)));
    const now = new Date();

    const keptCopy = (task: ReadTask): CachedPart | null => {
      const copy = previous?.parts.find((part) => part.kind === task.kind && part.ref === task.ref);
      if (!copy) return null;
      const age = now.getTime() - Date.parse(copy.fetchedAt);
      return age <= COMPETITOR_KEEP_SECONDS * 1000 ? copy : null;
    };

    const retries: number[] = [];
    const parts = tasks.map((task, index): CachedPart => {
      const result = settled[index];
      let outcome: TaskOutcome;
      if (result.status === 'fulfilled') {
        outcome = result.value;
      } else {
        // A source never throws, so this is a bug. The name only: a message can quote an address.
        this.logger.error(
          JSON.stringify({
            event: 'discover.competitor.source_threw',
            kind: task.kind,
            reason: result.reason instanceof Error ? result.reason.name : 'unknown',
          }),
        );
        outcome = {
          state: 'trouble',
          trouble: 'unreachable',
          retryAfterMs: RETRY_AFTER_TROUBLE_MS,
        };
      }

      if (outcome.state === 'answered') {
        return {
          kind: task.kind,
          ref: task.ref,
          items: this.composed(outcome.result),
          fetchedAt: now.toISOString(),
        };
      }

      const copy = keptCopy(task);
      const kept = {
        kind: task.kind,
        ref: task.ref,
        items: copy?.items ?? [],
        fetchedAt: copy?.fetchedAt ?? now.toISOString(),
      };

      if (outcome.state === 'busy') {
        retries.push(RETRY_AFTER_BUSY_MS);
        // Whatever the copy said about itself still holds: nothing new is known.
        if (!copy) return { ...kept, pending: true };
        return { ...kept, ...(copy.trouble ? { trouble: copy.trouble } : {}) };
      }

      retries.push(outcome.retryAfterMs);
      return { ...kept, trouble: outcome.trouble };
    });

    const unavailable = this.troubled(parts);
    this.logger.log(
      JSON.stringify({
        event: 'discover.competitor.refresh',
        competitor: row.id,
        ms: Date.now() - started,
        unavailable,
      }),
    );

    // Bookkeeping: failing to note the check never fails the answer.
    const first = parts.find((part) => part.trouble);
    await this.repository
      .noteCheck(orgId, row.id, {
        lastCheckedAt: now,
        lastError: first ? this.troubleSentence(first.kind, first.trouble as Trouble) : null,
      })
      .catch((error: unknown) => {
        this.logger.warn(
          JSON.stringify({
            event: 'discover.competitor.note_failed',
            reason: error instanceof Error ? error.name : 'unknown',
          }),
        );
      });

    return {
      fetchedAt: now.toISOString(),
      parts,
      // The longest wait wins: a refresh asks every source again.
      retryAfterMs: retries.length > 0 ? Math.max(...retries) : null,
    };
  }

  private async run(task: ReadTask): Promise<TaskOutcome> {
    if (await this.isResting(task.host)) {
      return { state: 'trouble', trouble: 'unreachable', retryAfterMs: RETRY_AFTER_TROUBLE_MS };
    }

    const release = await this.gate.acquire();
    if (!release) return { state: 'busy' };

    try {
      const result = await task.read(AbortSignal.timeout(SOURCE_DEADLINE_MS));
      // Module 10: Instagram's "reconnect" (an expired token, a missing permission)
      // is this workspace's own trouble, so it never counts against a host every
      // workspace shares.
      if (!result.reconnect) await this.recordHealth(task.host, result);

      if (result.failed === undefined) return { state: 'answered', result };
      return {
        state: 'trouble',
        trouble: result.reconnect ? 'reconnect' : result.unreadable ? 'unreadable' : 'unreachable',
        retryAfterMs:
          result.failed === 'upstream' ? RETRY_AFTER_TROUBLE_MS : RETRY_AFTER_MISSING_MS,
      };
    } finally {
      release();
    }
  }

  /** A source's newest few, each with an id, and none of them twice. */
  private composed(result: SourceResult): ComposedItem[] {
    const seen = new Set<string>();
    const items: ComposedItem[] = [];

    for (const item of result.items) {
      const id = itemId(item.source.id, item.url ?? item.opaqueUrl ?? item.title);
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({ ...item, id });
    }
    return items.sort(newestFirst).slice(0, ITEMS_PER_SOURCE);
  }

  private troubled(parts: CachedPart[]): CompetitorKind[] {
    return KIND_ORDER.filter((kind) => parts.some((part) => part.kind === kind && part.trouble));
  }

  private troubleSentence(kind: CompetitorKind, trouble: Trouble): string {
    if (trouble === 'reconnect') return DISCOVER_MESSAGES.instagramReconnect;
    return DISCOVER_MESSAGES.competitorTrouble(
      COMPETITOR_KIND_NAMES[kind],
      trouble === 'unreadable',
    );
  }

  /** A copy's items as the group shows them: each once, newest first, fifteen at most. */
  private itemsOf(entry: CachedCompetitor): ComposedItem[] {
    // Two feeds of one site can carry the same post.
    const unique = new Map<string, ComposedItem>();
    for (const item of entry.parts.flatMap((part) => part.items)) {
      if (!unique.has(item.id)) unique.set(item.id, item);
    }
    return [...unique.values()].sort(newestFirst).slice(0, ITEMS_PER_COMPETITOR);
  }

  private present(
    row: CompetitorRow,
    entry: CachedCompetitor,
  ): Omit<CompetitorItemsAnswer, 'lastSeenAt'> {
    const now = Date.now();
    const items = this.itemsOf(entry)
      // Per request and never stored: it carries the name the workspace gave them.
      .map((item) => ({
        ...item,
        brief: buildBrief(item, WORLDWIDE, 'en', { competitor: row.name }),
      }));

    const unavailable = this.troubled(entry.parts);
    const notes = unavailable.map((kind) => {
      const failed = entry.parts.filter((part) => part.kind === kind && part.trouble);
      // "could not be read" only when that is all that went wrong with this kind.
      const trouble: Trouble = failed.some((part) => part.trouble === 'reconnect')
        ? 'reconnect'
        : failed.every((part) => part.trouble === 'unreadable')
          ? 'unreadable'
          : 'unreachable';
      const sentence = this.troubleSentence(kind, trouble);

      const kept = failed.filter((part) => part.items.length > 0);
      if (kept.length === 0) return sentence;

      const oldest = Math.min(...kept.map((part) => Date.parse(part.fetchedAt)));
      return `${sentence} ${DISCOVER_MESSAGES.staleNote(Math.floor((now - oldest) / MINUTE_MS))}`;
    });

    return {
      items,
      unavailable,
      notes,
      fetchedAt: entry.fetchedAt,
      stale: now - Date.parse(entry.fetchedAt) >= COMPETITOR_FRESH_MS,
      pending: entry.parts.some((part) => part.pending === true),
    };
  }

  // ---------------------------------------------------------------------------
  // Hosts that keep failing
  // ---------------------------------------------------------------------------

  private async isResting(host: string): Promise<boolean> {
    const failures = Number((await this.redis.get(this.keys.hostBreaker(host))) ?? 0);
    return failures >= BREAKER_THRESHOLD;
  }

  private async recordHealth(host: string, result: SourceResult): Promise<void> {
    const key = this.keys.hostBreaker(host);

    if (result.failed !== 'upstream') {
      await this.redis.delete(key);
      return;
    }

    const failures = await this.redis.incrementWithTtl(key, BREAKER_SECONDS);
    if (failures >= BREAKER_THRESHOLD) {
      // Resting is ten minutes from the last failure, not from the first.
      await this.redis.set(key, String(failures), BREAKER_SECONDS);
      // No host in the line: it is something a person typed.
      this.logger.warn(JSON.stringify({ event: 'discover.competitor.breaker_open' }));
    }
  }

  // ---------------------------------------------------------------------------
  // Addresses
  // ---------------------------------------------------------------------------

  /**
   * The addresses in a body, each made real and passed by the guard, in the keys
   * the body sent. A Mastodon account's instance is checked the same way, since
   * it is the host of two requests.
   */
  private async checked(
    orgId: string,
    input: Pick<UpdateCompetitorInput, 'websiteUrl' | 'feedUrls' | 'mastodonAcct'>,
  ): Promise<Pick<Partial<CompetitorWrite>, 'websiteUrl' | 'feedUrls'>> {
    const checked: Pick<Partial<CompetitorWrite>, 'websiteUrl' | 'feedUrls'> = {};

    if (input.websiteUrl !== undefined) {
      checked.websiteUrl =
        input.websiteUrl === null ? null : await this.safeAddress(orgId, input.websiteUrl);
    }

    if (input.feedUrls !== undefined) {
      const feeds: string[] = [];
      for (const feed of input.feedUrls) {
        const url = await this.safeAddress(orgId, feed);
        if (!feeds.includes(url)) feeds.push(url);
      }
      checked.feedUrls = feeds;
    }

    const instance = input.mastodonAcct ? mastodonAccount(input.mastodonAcct)?.instance : null;
    if (instance) await this.safeAddress(orgId, `https://${instance}/`);

    return checked;
  }

  /** What a person typed, as the address that is stored and fetched. Throws the refusal otherwise. */
  private async safeAddress(orgId: string, input: string): Promise<string> {
    const url = addressOf(input);
    if (!url) throw this.invalidAddress();

    // The guard looks names up, and that is the one thing a refusal costs. A
    // workspace with a run of refusals behind it is not judged again just now.
    if (await refusalsSpent(this.redis, orgId)) throw this.throttled(orgId);

    const verdict = await this.judge(url);
    if (!verdict.ok) {
      await countRefusal(this.redis, orgId);
      throw this.refusal(orgId, verdict.reason);
    }

    return verdict.url.toString();
  }

  /** The guard's verdict on an address, with the second look a port refusal gets (`discover.addresses.ts`). */
  private judge(url: string): Promise<UrlSafetyResult> {
    return judgeAddress(this.engine.guard, url);
  }

  /** The fetch for a website and its feed addresses, one gate slot per request. */
  private gated(): DiscoverFetch {
    return async (url, init) => {
      const release = await this.gate.acquire();
      if (!release) throw new Error('Discover is busy.');

      try {
        return await this.engine.fetch(url, init);
      } finally {
        release();
      }
    };
  }

  /**
   * Limits reads, not looks. Every edit moves a competitor's key, so without
   * this a member could make the server fetch addresses of their choosing, and
   * search Google News, as fast as they could save. Twenty competitors opened
   * at once fit inside it.
   */
  private async countRead(orgId: string): Promise<void> {
    const count = await this.redis.incrementWithTtl(
      workspaceKeys.competitorReads(orgId),
      COMPETITOR_READS_WINDOW_SECONDS,
    );
    if (count <= COMPETITOR_READS_PER_MINUTE) return;

    throw this.throttled(orgId);
  }

  private async throttle(orgId: string): Promise<void> {
    const count = await this.redis.incrementWithTtl(
      workspaceKeys.feedDiscovery(orgId),
      FEED_DISCOVERY_WINDOW_SECONDS,
    );
    if (count <= FEED_DISCOVERY_PER_MINUTE) return;

    throw this.throttled(orgId);
  }

  private throttled(orgId: string): HttpException {
    securityLogger.warn('discover.competitor_throttled', { orgId });
    return new HttpException(
      { message: DISCOVER_MESSAGES.competitorThrottled, code: 'competitor_throttled' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // ---------------------------------------------------------------------------
  // Refusals
  // ---------------------------------------------------------------------------

  private async require(orgId: string, id: string): Promise<CompetitorRow> {
    // A malformed id is not found, without a query.
    const row = UUID_PATTERN.test(id) ? await this.repository.find(orgId, id) : null;
    if (!row) throw this.notFound();
    return row;
  }

  private notFound(): NotFoundException {
    return new NotFoundException(DISCOVER_MESSAGES.competitorNotFound);
  }

  private limitReached(): HttpException {
    return new UnprocessableEntityException({
      message: DISCOVER_MESSAGES.competitorLimit(MAX_COMPETITORS),
      code: 'competitor_limit',
    });
  }

  private invalidAddress(): HttpException {
    return new BadRequestException({
      message: DISCOVER_MESSAGES.competitorAddressInvalid,
      code: 'competitor_invalid',
    });
  }

  /** The answer for an address the guard refused, by why it refused it. Never the address. */
  private refusal(orgId: string, reason: UrlRejectReason): HttpException {
    if (isPrivate(reason)) {
      securityLogger.warn('discover.competitor_unsafe_url', { orgId, reason });
      return new UnprocessableEntityException({
        message: DISCOVER_MESSAGES.competitorPrivate,
        code: 'competitor_private',
      });
    }

    // A name that does not resolve is a typo or a site that is gone, not an attack.
    if (reason === 'unresolvable') {
      return new UnprocessableEntityException({
        message: DISCOVER_MESSAGES.competitorUnreachable,
        code: 'competitor_unreachable',
      });
    }

    return this.invalidAddress();
  }
}
