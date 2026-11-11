/**
 * The reader (Module 08, stories DC-8.1 to DC-8.3): a story's page, fetched when
 * a person presses Read, with the article pulled out of it as plain text.
 *
 * ## The order of things, and why
 *
 * 1. **The guard.** The address is made real and judged before anything else, so
 *    a private one is answered with its sentence and costs nothing: no count, no
 *    lookup of a link, no request.
 * 2. **The throttle.** Ten reads a minute per workspace. It counts a person
 *    asking, so it comes before the cache: a script walking addresses stops the
 *    same way whether or not they happen to be cached.
 * 3. **A Google News link is resolved** to the publisher's own address, when
 *    `DISCOVER_LINK_DECODE` allows (best effort, on a budget, kept seven days).
 *    What comes out is a stranger's address too, so it meets the guard like any
 *    other.
 * 4. **The copy.** A page read in the last 24 hours answers from Redis.
 * 5. **The fetch**, through the reader's own gate, with the guarded fetch: HTML
 *    only, 1 MiB at most, ten seconds in all, every redirect hop judged.
 * 6. **The article**, found off this thread (`reader.extractor.ts`): a worker
 *    that is killed if a page takes more than two seconds.
 *
 * ## Nothing is stored but a copy in Redis
 *
 * There is no table and no repository in this file. The article is answered and
 * kept in Redis for a day, keyed by a hash of its address and shared by
 * everyone, since the page is public. A page that has no article, or is too
 * complex to look for one in, is remembered for ten minutes, so asking for it
 * again does not parse it again.
 *
 * ## What one workspace can take from the others
 *
 * A page a person names is fetched and parsed on shared machinery, so each
 * workspace is held to its share of it:
 *
 * - two pages in flight at once (the fetch and the parse together), so one
 *   workspace cannot fill the gate's slots or the worker's line;
 * - a budget of parsing time a minute ({@link ParseBudget}), checked before the
 *   fetch and again before the parse, and charged with what the worker really
 *   spent, so a page built to be slow is that workspace's one page for a while;
 * - a share of the Google News links resolved through Google, so one workspace
 *   cannot spend the whole deployment's budget, and a link that would not open
 *   is remembered for a few minutes instead of being asked again.
 *
 * ## One sentence per failure
 *
 * Private, could not be read, not an article, a link that would not open, and
 * "try again in a moment". No address, no host and nothing a server said is in
 * any of them, or in a log line.
 */
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type Article,
  decodeGoogleNewsLink,
  decodeLocally,
  googleNewsArticleId,
  LinkUnresolvedError,
} from '@postgear/discover-engine';
import { securityLogger } from '../../common/logging/security-logger';
import { RedisService } from '../redis/redis.service';
import { addressOf, hopRefusal, isPrivate, judgeAddress } from './discover.addresses';
import { DiscoverGate } from './discover.gate';
import { type DiscoverKeys, discoverKeys, workspaceKeys } from './discover.keys';
import { DISCOVER_MESSAGES } from './discover.messages';
import { READER_ENGINE, READER_GATE, type ReaderEngine } from './reader.engine';
import { ARTICLE_EXTRACTOR, type ArticleExtractor } from './reader.extractor';

export const READS_PER_MINUTE = 10;
const READ_WINDOW_SECONDS = 60;
/** Pages one workspace may have being fetched or parsed at the same moment. */
export const READS_IN_FLIGHT = 2;

export const READ_CACHE_SECONDS = 24 * 60 * 60;
/** How long a page with no article in it is remembered as that. */
export const READ_REFUSAL_SECONDS = 10 * 60;
export const LINK_CACHE_SECONDS = 7 * 24 * 60 * 60;
/** How long a Google News link that would not open is not asked about again. */
export const LINK_REFUSAL_SECONDS = 5 * 60;

/** Google News links resolved through Google in one minute, across the deployment. */
export const DECODES_PER_MINUTE = 20;
/** And by one workspace, so no single one can spend what everyone shares. */
export const DECODES_PER_WORKSPACE = 5;
const DECODE_BUDGET_SECONDS = 120;
const DECODE_SHARE_SECONDS = 60;

const PAGE_MAX_BYTES = 1024 * 1024;
const PAGE_ACCEPT = 'text/html,application/xhtml+xml;q=0.9';
/** The page and every redirect before it. One request gets 8 seconds of that. */
const READ_DEADLINE_MS = 10_000;
const DECODE_DEADLINE_MS = 8_000;

/** What `keys.link` holds for an id that would not open. Never a valid address. */
const UNRESOLVED_MARK = '!';

/** How far into a page a `meta` tag naming its encoding can sit. */
const CHARSET_SNIFF_CHARS = 2_048;
const READABLE_CHARSETS = new Set(['utf-8', 'utf8', 'us-ascii', 'ascii']);

export interface ReaderArticle extends Article {
  /** The address that was asked for. */
  url: string;
  /** Where the page really was: after redirects, or the publisher behind a Google News link. */
  finalUrl: string;
}

/**
 * How much of the article worker one workspace's pages may take in a minute.
 * An ordinary article takes a few hundredths of a second, so this is dozens of
 * them; a page built to be slow is stopped at two seconds, so this is one.
 */
export const PARSE_MS_PER_MINUTE = 1_500;
/** More workspaces than this reading in one minute, and the oldest notes are dropped. */
const PARSE_BUDGET_MAX_WORKSPACES = 10_000;

/**
 * The time spent finding articles, per workspace, in the current minute.
 *
 * The worker reads one page at a time, so a page built to be slow makes every
 * other read wait for up to two seconds. The time each workspace's pages really
 * took is added up here, and a workspace past its budget waits for the next
 * minute, like any other "try again in a moment".
 *
 * It is kept in this process, not in Redis, on purpose: what it protects is
 * this process's own worker.
 */
export class ParseBudget {
  private readonly spent = new Map<string, { minute: number; ms: number }>();

  constructor(private readonly limitMs: number) {}

  isSpent(orgId: string, now: number = Date.now()): boolean {
    const entry = this.spent.get(orgId);
    return entry !== undefined && entry.minute === minuteOf(now) && entry.ms >= this.limitMs;
  }

  spend(orgId: string, ms: number, now: number = Date.now()): void {
    const minute = minuteOf(now);
    const entry = this.spent.get(orgId);
    const before = entry?.minute === minute ? entry.ms : 0;

    // Re-set, so the map stays in the order workspaces last read.
    this.spent.delete(orgId);
    this.spent.set(orgId, { minute, ms: before + Math.max(0, ms) });

    if (this.spent.size > PARSE_BUDGET_MAX_WORKSPACES) {
      const oldest = this.spent.keys().next().value;
      if (oldest !== undefined) this.spent.delete(oldest);
    }
  }
}

function minuteOf(time: number): number {
  return Math.floor(time / 60_000);
}

/**
 * The encoding a page says it is in, lower-cased, or null when it says nothing.
 * The header first, then a `meta` tag near the top.
 */
export function declaredCharset(
  contentType: string | null | undefined,
  body: string,
): string | null {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? '')?.[1];
  if (fromHeader) return fromHeader.toLowerCase();

  const head = body.slice(0, CHARSET_SNIFF_CHARS);
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1];
  return fromMeta ? fromMeta.toLowerCase() : null;
}

type ReadRefusal = 'read_failed' | 'read_not_article';

/** What Redis holds for an address: the article, or why there is none. */
type StoredRead = { article: Article; finalUrl: string } | { refusal: ReadRefusal };

@Injectable()
export class ReaderService {
  private readonly logger = new Logger(ReaderService.name);
  private readonly keys: DiscoverKeys;
  private readonly parseTime = new ParseBudget(PARSE_MS_PER_MINUTE);
  /** Pages being fetched or parsed right now, by workspace. */
  private readonly inFlight = new Map<string, number>();

  constructor(
    @Inject(READER_ENGINE) private readonly engine: ReaderEngine,
    @Inject(READER_GATE) private readonly gate: DiscoverGate,
    private readonly redis: RedisService,
    @Inject(ARTICLE_EXTRACTOR) private readonly extractor: ArticleExtractor,
  ) {
    this.keys = discoverKeys(engine.simulation);
  }

  async read(orgId: string, input: string): Promise<ReaderArticle> {
    const asked = await this.safeAddress(orgId, input, () => this.failed());
    await this.throttle(orgId);

    const target = googleNewsArticleId(asked) ? await this.resolve(orgId, asked) : asked;

    const key = this.keys.read(target);
    const stored = await this.stored(key);
    if (stored) return this.answer(asked, stored);

    const read = await this.inTurn(orgId, async () => {
      // Before the page is asked for: a workspace whose pages have cost the
      // worker too much this minute waits, whatever it asks for next.
      if (this.parseTime.isSpent(orgId)) throw this.throttled(orgId);

      const page = await this.fetchPage(orgId, target);

      // And again, now that the fetch is behind us: another of this workspace's
      // pages may have been parsed, and charged, while this one was on its way.
      if (this.parseTime.isSpent(orgId)) throw this.throttled(orgId);

      return this.extract(orgId, page.body, page.finalUrl);
    });

    await this.redis.set(
      key,
      JSON.stringify(read),
      'refusal' in read ? READ_REFUSAL_SECONDS : READ_CACHE_SECONDS,
    );

    return this.answer(asked, read);
  }

  /** The publisher's address behind a Google News link, and nothing read. */
  async resolveLink(orgId: string, input: string): Promise<string> {
    const asked = addressOf(input);
    if (!asked || !googleNewsArticleId(asked)) throw this.unresolved();

    await this.throttle(orgId);
    return this.resolve(orgId, asked);
  }

  // ---------------------------------------------------------------------------
  // Google News links
  // ---------------------------------------------------------------------------

  private async resolve(orgId: string, link: string): Promise<string> {
    if (!this.engine.linkDecode) throw this.unresolved();

    const id = googleNewsArticleId(link);
    if (!id) throw this.unresolved();

    const key = this.keys.link(id);
    const known = await this.redis.get(key);
    if (known === UNRESOLVED_MARK) throw this.unresolved();
    if (known) return known;

    // Older ids hold the address itself: no request, so no budget.
    const resolved = decodeLocally(id) ?? (await this.decodeThroughGoogle(orgId, id, key));

    // A stranger's address, wherever it came from. Private is not said aloud here:
    // the person asked for a story, and a story that leads inside simply does not open.
    const url = addressOf(resolved);
    const verdict = url ? await judgeAddress(this.engine.guard, url) : null;
    if (!url || !verdict?.ok) {
      if (verdict && !verdict.ok && isPrivate(verdict.reason)) {
        securityLogger.warn('discover.read_private', {
          orgId,
          reason: verdict.reason,
          via: 'link',
        });
      }
      throw this.unresolved();
    }

    const safe = verdict.url.toString();
    await this.redis.set(key, safe, LINK_CACHE_SECONDS);
    return safe;
  }

  private async decodeThroughGoogle(orgId: string, id: string, key: string): Promise<string> {
    // This workspace's share first, so no single one can use up what everyone shares.
    const own = await this.redis.incrementWithTtl(
      workspaceKeys.decodeShare(orgId),
      DECODE_SHARE_SECONDS,
    );
    if (own > DECODES_PER_WORKSPACE) throw this.unresolved();

    const release = await this.gate.acquire();
    if (!release) throw this.unresolved();

    try {
      // One counter a minute for everyone, taken only for a request that is about
      // to be made: this endpoint is not ours to lean on.
      const minute = Math.floor(Date.now() / 60_000);
      const spent = await this.redis.incrementWithTtl(
        this.keys.decodeBudget(minute),
        DECODE_BUDGET_SECONDS,
      );
      if (spent > DECODES_PER_MINUTE) {
        this.logger.warn(JSON.stringify({ event: 'discover.link_budget_spent' }));
        throw this.unresolved();
      }

      return await decodeGoogleNewsLink(id, {
        fetch: this.engine.fetch,
        signal: AbortSignal.timeout(DECODE_DEADLINE_MS),
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;

      // The reason only. The id is a pointer to what someone chose to read.
      this.logger.warn(
        JSON.stringify({
          event: 'discover.link_unresolved',
          reason: error instanceof LinkUnresolvedError ? error.reason : 'unknown',
        }),
      );
      // Remembered for a few minutes: the same dead link is not asked about on every press.
      await this.redis.set(key, UNRESOLVED_MARK, LINK_REFUSAL_SECONDS);
      throw this.unresolved();
    } finally {
      release();
    }
  }

  // ---------------------------------------------------------------------------
  // The page
  // ---------------------------------------------------------------------------

  /** Runs one page's fetch and parse, as long as the workspace has a place free for it. */
  private async inTurn<T>(orgId: string, work: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(orgId) ?? 0;
    if (running >= READS_IN_FLIGHT) throw this.throttled(orgId);

    this.inFlight.set(orgId, running + 1);
    try {
      return await work();
    } finally {
      const left = (this.inFlight.get(orgId) ?? 1) - 1;
      if (left > 0) this.inFlight.set(orgId, left);
      else this.inFlight.delete(orgId);
    }
  }

  private async fetchPage(orgId: string, url: string): Promise<{ body: string; finalUrl: string }> {
    const release = await this.gate.acquire();
    if (!release) throw this.busy('gate');

    try {
      const page = await this.engine.fetch(url, {
        accept: PAGE_ACCEPT,
        signal: AbortSignal.timeout(READ_DEADLINE_MS),
        maxBytes: PAGE_MAX_BYTES,
        requireHtml: true,
      });
      // A 404, a login wall that answers 401 or 403, a server in trouble: all unreadable.
      if (page.status !== 200) {
        // The number only. It says whether sites are refusing us (403) or pages are gone (404).
        this.unreadable('status', { status: page.status });
        throw this.failed();
      }

      // The body was decoded as UTF-8. A page that says it is anything else would
      // be shown, and kept for a day, as garbage.
      const charset = declaredCharset(page.contentType, page.body);
      if (charset && !READABLE_CHARSETS.has(charset)) {
        this.unreadable('charset');
        throw this.failed();
      }

      return { body: page.body, finalUrl: page.finalUrl || url };
    } catch (error) {
      if (error instanceof HttpException) throw error;

      // A redirect into a private network is the same refusal as pasting one.
      const reason = hopRefusal(error);
      if (reason && isPrivate(reason)) throw this.privateAddress(orgId, reason);

      this.unreadable(error instanceof Error ? error.name : 'unknown');
      throw this.failed();
    } finally {
      release();
    }
  }

  /**
   * The article, or which of the two sentences this page gets, from the worker.
   * What the page really cost is charged to the workspace that asked for it.
   */
  private async extract(orgId: string, html: string, url: string): Promise<StoredRead> {
    const result = await this.extractor.extract(html, url);
    if (result.outcome === 'busy') throw this.busy('worker');

    this.parseTime.spend(orgId, result.ms);

    switch (result.outcome) {
      case 'article':
        return { article: result.article, finalUrl: url };
      case 'not_article':
        return { refusal: 'read_not_article' };
      case 'too_complex':
        this.unreadable('too_complex');
        return { refusal: 'read_failed' };
      default:
        // The worker itself failed. That says nothing about the page, so it is not remembered.
        this.unreadable('worker');
        throw this.failed();
    }
  }

  private answer(asked: string, stored: StoredRead): ReaderArticle {
    if ('refusal' in stored) {
      throw stored.refusal === 'read_not_article' ? this.notArticle() : this.failed();
    }
    return { ...stored.article, url: asked, finalUrl: stored.finalUrl };
  }

  /** A copy that cannot be read is the same as no copy. */
  private async stored(key: string): Promise<StoredRead | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;

    try {
      const value = JSON.parse(raw) as Partial<{
        article: Article;
        finalUrl: string;
        refusal: ReadRefusal;
      }>;
      if (value.refusal === 'read_failed' || value.refusal === 'read_not_article') {
        return { refusal: value.refusal };
      }
      return value.article && typeof value.finalUrl === 'string'
        ? { article: value.article, finalUrl: value.finalUrl }
        : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Addresses, limits and refusals
  // ---------------------------------------------------------------------------

  /** What was pasted, as an address the guard passed. `otherwise` is the refusal for anything that is not one. */
  private async safeAddress(
    orgId: string,
    input: string,
    otherwise: () => HttpException,
  ): Promise<string> {
    const url = addressOf(input);
    if (!url) throw otherwise();

    const verdict = await judgeAddress(this.engine.guard, url);
    if (verdict.ok) return verdict.url.toString();

    throw isPrivate(verdict.reason) ? this.privateAddress(orgId, verdict.reason) : otherwise();
  }

  private async throttle(orgId: string): Promise<void> {
    const count = await this.redis.incrementWithTtl(
      workspaceKeys.readThrottle(orgId),
      READ_WINDOW_SECONDS,
    );
    if (count > READS_PER_MINUTE) throw this.throttled(orgId);
  }

  /** Why a page could not be read, for the log: a reason and nothing about the page. */
  private unreadable(reason: string, extra: Record<string, number> = {}): void {
    this.logger.warn(JSON.stringify({ event: 'discover.read_failed', reason, ...extra }));
  }

  /** This workspace is asking for more than its share. */
  private throttled(orgId: string): HttpException {
    securityLogger.warn('discover.read_throttled', { orgId });
    return this.tryAgain();
  }

  /**
   * Everyone together has the gate or the worker full. The same sentence, and a
   * different record: it is not this workspace's doing, so it is not held against it.
   */
  private busy(what: 'gate' | 'worker'): HttpException {
    this.logger.warn(JSON.stringify({ event: 'discover.read_busy', what }));
    return this.tryAgain();
  }

  private tryAgain(): HttpException {
    return new HttpException(
      { message: DISCOVER_MESSAGES.readThrottled, code: 'read_throttled' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Recorded by workspace and reason, never by the address or its host. */
  private privateAddress(orgId: string, reason: string): HttpException {
    securityLogger.warn('discover.read_private', { orgId, reason });
    return new UnprocessableEntityException({
      message: DISCOVER_MESSAGES.readPrivate,
      code: 'read_private',
    });
  }

  private failed(): HttpException {
    return new UnprocessableEntityException({
      message: DISCOVER_MESSAGES.readFailed,
      code: 'read_failed',
    });
  }

  private notArticle(): HttpException {
    return new UnprocessableEntityException({
      message: DISCOVER_MESSAGES.readNotArticle,
      code: 'read_not_article',
    });
  }

  private unresolved(): HttpException {
    return new UnprocessableEntityException({
      message: DISCOVER_MESSAGES.linkUnresolved,
      code: 'link_unresolved',
    });
  }
}
