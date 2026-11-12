/**
 * What is rising, what is news, what is being watched and what is coming up in a
 * place.
 *
 * The answer depends on the place and the language, never on the workspace, so it
 * is cached for everyone: nothing here can tell one tenant's Chennai from another's.
 * The workspace appears in two things only, and neither is shared: the limit on
 * asking for new places, and the groups it has switched off.
 *
 * ## A workspace's switches
 *
 * A request that asks for them (`workspaceSources`) has its workspace's switches
 * read first, and the loads of a group that is off are never planned: no fetch,
 * no lock, no count. The answer names them in `hidden`, and they are never in
 * `unavailable`, because nothing is wrong with them. The switches decide which
 * loads this one request asks for and nothing else. They are in no key, no copy
 * and no log line, so the next workspace reads the same copies as ever.
 *
 * ## One path for every load
 *
 * A tab is made of loads (`discover.plan.ts`): the sources that share a key and a
 * window. Trending is up to four of them side by side, the other tabs one each.
 * Every load goes through the same code here, whatever it reads: the shared cache
 * and its lock, the gate, the breaker, and the copy a failed group keeps. A new
 * source is a new plan, never a new path.
 *
 * ## What goes in the cache, and what never does
 *
 * Only what changes the upstream answer goes in the key. Google Trends has no
 * language, so its load ignores it. News is keyed by the edition really asked for,
 * not the language requested, so `en` and `en-GB` in India share one copy, and a
 * made-up language cannot be used to force a fetch. Wikipedia follows the same
 * rule with its editions.
 *
 * Headings and briefs are built per request and never stored, because they name the
 * viewer's own place. Everyone in Chennai shares the items; only the person who
 * typed "Madras" sees that word. Festivals are cut to the window around the
 * place's own today per request too, so one copy serves a whole month.
 *
 * ## When a source is struggling
 *
 * - A group that fails keeps its old copy, marked stale, and its source is listed in
 *   `unavailable`, so the page shows what it had and never has to guess.
 * - A breaker per source: three failures in a row and the source is left alone for
 *   ten minutes. Only real trouble counts. A place Google has nothing for is
 *   `not_found`, so asking about one cannot switch the source off for everyone.
 * - An entry with a failure in it is retried after a minute rather than after the
 *   load's full window, and not before: one attempt a minute per place at most.
 * - YouTube has a daily budget. Past it the source is not asked at all, which is
 *   not a failure: the copy stays, and the page says the source is resting.
 */
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildBrief,
  type ComposedItem,
  composeFeed,
  type DiscoverItem,
  defaultTimeZone,
  type FeedGroupInput,
  festivalsInWindow,
  itemId,
  type Locality,
  NEWS_MAX_AGE_MS,
  type NewsTopic,
  type SourceAttribution,
  type SourceId,
  type SourceItem,
  type SourceResult,
  todayIn,
} from '@postgear/discover-engine';
import { securityLogger } from '../../common/logging/security-logger';
import { RedisService } from '../redis/redis.service';
import { type CacheEntry, DiscoverCache, LOCK_SECONDS } from './discover.cache';
import { DISCOVER_ENGINE, type DiscoverEngine } from './discover.engine';
import { DiscoverGate } from './discover.gate';
import { type DiscoverKeys, discoverKeys, workspaceKeys } from './discover.keys';
import { DISCOVER_MESSAGES, SOCIAL_NETWORKS, TOPIC_TITLES } from './discover.messages';
import {
  answerLanguage,
  type Budget,
  type DiscoverSourceSwitch,
  type FeedGroupId,
  type FeedKind,
  type FeedRequest,
  type GroupPlan,
  type LoadPlan,
  planLoads,
  switchesOf,
  wikipediaEdition,
} from './discover.plan';
import { type LocalityAnswer, withNewsLanguages } from './locality.service';
import { DiscoverSettingsService } from './settings.service';

export type {
  DiscoverSourceSwitch,
  FeedGroupId,
  FeedKind,
  FeedRequest,
} from './discover.plan';
export { YOUTUBE_DAILY_UNITS } from './discover.plan';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Long enough that a struggling source is not hammered, per place. */
const RETRY_AFTER_TROUBLE_MS = MINUTE_MS;
/** A full gate says nothing about the source and clears in moments: as soon as the lock allows. */
const RETRY_AFTER_BUSY_MS = LOCK_SECONDS * 1000;
/** Half an answer, because one of two readers was down: worth asking for the rest soon. */
const RETRY_AFTER_PARTIAL_MS = 10 * MINUTE_MS;
/** Wikipedia had not published yesterday yet. It will within hours, and a day is too long to wait. */
const RETRY_AFTER_EARLY_MS = 60 * MINUTE_MS;
/** A spent budget comes back at midnight in its own zone. Looking costs nothing, so look often. */
const RETRY_AFTER_SPENT_MS = 10 * MINUTE_MS;

export const BREAKER_THRESHOLD = 3;
export const BREAKER_SECONDS = 10 * 60;

/** Well inside the lock's 20 seconds, so a slow fetch cannot outlive its own lock. */
const GROUP_DEADLINE_MS = 12_000;

export const NEW_PLACES_PER_MINUTE = 30;
const NEW_PLACES_WINDOW_SECONDS = 60;

/** A budget's key names its day, so it only has to outlive that day. */
const BUDGET_SECONDS = 2 * 24 * 60 * 60;

export interface FeedGroup {
  id: FeedGroupId;
  title: string;
  subtitle: string;
  attribution: SourceAttribution;
  items: DiscoverItem[];
  stale: boolean;
  fetchedAt: string;
}

/**
 * Why a tab has no groups, when that deserves a sentence of its own: the source
 * needs a key this PostGear does not have, or it has used up its day.
 */
export type FeedEmptyReason = 'not_set_up' | 'resting';

export interface FeedAnswer {
  kind: FeedKind;
  locality: LocalityAnswer;
  /** What the stories are really in, which for News can differ from what was asked for. */
  language: string;
  groups: FeedGroup[];
  unavailable: SourceId[];
  /** Festivals only: today (`YYYY-MM-DD`) in the place's own zone, so "in 3 days" is counted from there. */
  today?: string;
  /** Videos only, and only when there are no groups. */
  reason?: FeedEmptyReason;
  /**
   * Only when the request asked for its workspace's switches: the groups of this
   * tab the workspace has switched off, in the order the tab shows them. Empty
   * when none is.
   */
  hidden?: DiscoverSourceSwitch[];
}

export interface DiscoverStatus {
  simulation: boolean;
  geocoder: 'nominatim' | 'off';
  /**
   * Module 10: whether the city field may search as someone types. Only with the
   * operator's own place finder, or the stand-in: never the public instance.
   */
  typeahead: boolean;
  /** Module 10: which service answers News. */
  newsProvider: 'google' | 'serpapi' | 'newsdata';
  sources: {
    trends: boolean;
    news: boolean;
    wikipedia: boolean;
    videos: boolean;
    holidays: boolean;
    social: boolean;
  };
}

interface GroupOutcome {
  /** Absent when the source was not asked at all. */
  result?: SourceResult;
  retryAfterMs: number | null;
  /** Not asked because its budget for the day is gone. */
  spent?: boolean;
}

interface CachedGroup {
  id: FeedGroupId;
  source: SourceId;
  attribution: SourceAttribution;
  items: ComposedItem[];
  /** When these items were really fetched, which a kept copy does not change. */
  fetchedAt: string;
  answeredGeo?: string;
  /** Wikipedia: the day the list is for, so the heading never calls an older one "yesterday". */
  answeredDay?: string;
  /** Festivals: one of the two readers was down, so a complete copy is worth more than this. */
  partial?: boolean;
  /** The budget ran out, which is why this copy is still the answer. */
  spent?: boolean;
}

interface CachedFeed extends CacheEntry {
  groups: CachedGroup[];
  unavailable: SourceId[];
  /** Set when this entry is worth asking for again sooner than its window says. */
  retryAfterMs: number | null;
}

/** A load and the copy it came back with. No copy means nobody finished fetching in time. */
interface Loaded {
  load: LoadPlan;
  entry: CachedFeed | null;
}

/** A cached group on its way out: what of it this request shows, and how old that is. */
interface ShownGroup {
  group: CachedGroup;
  items: DiscoverItem[];
  ageMs: number;
  stale: boolean;
  /** Module 10: the interest this group stands for, from its load, since the copy is shared. */
  interest?: { index: number; words: string };
}

/**
 * Module 10: a place someone opened Trending or News for, as the pre-warm list
 * keeps it. A place and a language, nothing about who asked.
 */
export interface ActivePlace {
  country: string;
  region: string | null;
  regionName: string | null;
  city: string | null;
  tz: string | null;
  lang: string;
}

/** How long a looked-at place stays on the pre-warm list, and how many it holds. */
const ACTIVE_PLACE_SECONDS = 2 * 24 * 60 * 60;
export const ACTIVE_PLACES_KEPT = 300;

/** The order of the News tab's groups: what was asked for, then the place, then the wider world. */
function newsRank(id: FeedGroupId): number {
  if (id === 'topic') return 0;
  if (id === 'place') return 1;
  if (id.startsWith('interest-')) return 2;
  if (id === 'top' || id === 'world') return 3;
  return 4;
}

/** A headline as two groups would both carry it: case, spaces and punctuation set aside. */
function headlineKey(title: string): string {
  return title
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
}

const TROUBLE: GroupOutcome = { retryAfterMs: RETRY_AFTER_TROUBLE_MS };

/** The answer of a source that had one. A failure, or a source nobody asked, has none. */
function answerOf(outcome: GroupOutcome): SourceResult | undefined {
  return outcome.result?.failed === undefined ? outcome.result : undefined;
}

/** How soon an answer is worth asking for again, when that is sooner than its window. */
function askAgainAfter(result: SourceResult): number | null {
  if (result.failed === 'upstream') return RETRY_AFTER_TROUBLE_MS;
  if (result.partial) return RETRY_AFTER_PARTIAL_MS;
  if (result.answeredDay && result.answeredDay !== utcYesterday()) return RETRY_AFTER_EARLY_MS;
  return null;
}

function utcYesterday(): string {
  return new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
}

/**
 * A festival's id. Not the composer's, which is made from the title alone: the
 * list holds the same festival in two different years, and both are rows.
 */
function withFestivalId(item: SourceItem): ComposedItem {
  return { ...item, id: itemId(item.source.id, `${item.date ?? ''}|${item.title}`) };
}

/** "Tamil" for `ta`. Null when `Intl` has no name for the tag, or cannot read it. */
function languageName(tag: string): string | null {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag);
    return name && name !== tag ? name : null;
  } catch {
    return null;
  }
}

const DAY_AND_MONTH = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** "8 November" from `2026-11-08`, joined from parts so the wording cannot move with the ICU version. */
function dayAndMonth(day: string): string | null {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(time)) return null;

  const parts = new Map(
    DAY_AND_MONTH.formatToParts(new Date(time)).map((part) => [part.type, part.value]),
  );
  const words = [parts.get('day'), parts.get('month')];
  return words.every(Boolean) ? words.join(' ') : null;
}

/** Yesterday's list is called that only while it still is yesterday's. */
function wikipediaSubtitle(answeredDay: string | undefined): string {
  if (answeredDay === utcYesterday()) return DISCOVER_MESSAGES.wikipediaYesterday;
  const day = answeredDay ? dayAndMonth(answeredDay) : null;
  return day ? DISCOVER_MESSAGES.wikipediaOlder(day) : DISCOVER_MESSAGES.wikipediaUndated;
}

@Injectable()
export class DiscoverService {
  private readonly logger = new Logger(DiscoverService.name);
  private readonly keys: DiscoverKeys;

  constructor(
    @Inject(DISCOVER_ENGINE) private readonly engine: DiscoverEngine,
    private readonly cache: DiscoverCache,
    private readonly gate: DiscoverGate,
    private readonly redis: RedisService,
    private readonly settings: DiscoverSettingsService,
  ) {
    this.keys = discoverKeys(engine.simulation);
  }

  status(): DiscoverStatus {
    return {
      simulation: this.engine.simulation,
      geocoder: this.engine.geocoder ? 'nominatim' : 'off',
      typeahead:
        this.engine.geocoder !== null && (this.engine.geocoderSelfHosted || this.engine.simulation),
      newsProvider: this.engine.newsProvider,
      sources: {
        trends: true,
        news: true,
        wikipedia: true,
        // The one source that needs a key. Whether there is one, never the key.
        videos: this.engine.videos !== null,
        holidays: true,
        social: true,
      },
    };
  }

  async feed(orgId: string | null, request: FeedRequest): Promise<FeedAnswer> {
    const language = answerLanguage(request);
    // Read before anything is planned, so a group that is off is never asked for.
    // News also brings the workspace's interests along, from the same row.
    const preferences =
      request.workspaceSources && orgId ? await this.preferencesFor(orgId, request.kind) : undefined;
    const hidden = preferences?.hidden;
    const planned: FeedRequest = preferences?.interests.length
      ? { ...request, interests: preferences.interests }
      : request;
    // No loads means nothing to fetch, so nothing to cache either.
    const loads = planLoads(this.engine, this.keys, planned, hidden);

    // Side by side: each has its own copy, its own lock and its own age. All of
    // them are waited for, so a refusal leaves no fetch running behind the answer.
    const settled = await Promise.allSettled(loads.map((load) => this.load(orgId, load)));
    const loaded = settled.map((result, index): Loaded => {
      // Only the limit on new places refuses, and it refuses the whole request.
      if (result.status === 'rejected') throw result.reason;
      return { load: loads[index], entry: result.value };
    });

    const isWarmable = request.kind === 'trending' || request.kind === 'news';
    if (orgId && request.locality.countryCode && isWarmable) {
      // Never in the way of the answer: a list that cannot be written is only a colder morning.
      void this.rememberPlace(request).catch(() => undefined);
    }

    return this.present(request, language, loaded, hidden);
  }

  /**
   * Of the groups this tab shows, the ones the workspace has switched off, in the
   * tab's own order, and for News the workspace's interests (Module 10). A tab
   * with no switch and no interests has nothing to read.
   */
  private async preferencesFor(
    orgId: string,
    kind: FeedKind,
  ): Promise<{ hidden: DiscoverSourceSwitch[]; interests: string[] }> {
    const switches = switchesOf(kind);
    if (switches.length === 0 && kind !== 'news') return { hidden: [], interests: [] };

    const { off, interests } = await this.settings.feedPreferences(orgId);
    return {
      hidden: switches.filter((id) => off.includes(id)),
      interests: kind === 'news' ? interests : [],
    };
  }

  /**
   * Module 10: puts the place on the list the worker warms before the morning.
   * The place and the language only, scored by now; the list keeps the most
   * recent few hundred and is gone after two quiet days.
   */
  private async rememberPlace({ locality, language }: FeedRequest): Promise<void> {
    const place: ActivePlace = {
      country: locality.countryCode as string,
      region: locality.regionCode,
      regionName: locality.regionName,
      city: locality.city,
      tz: locality.timeZone,
      lang: language,
    };
    await this.redis.rememberMember(
      this.keys.activePlaces,
      JSON.stringify(place),
      Date.now(),
      ACTIVE_PLACE_SECONDS,
      ACTIVE_PLACES_KEPT,
    );
  }

  /** Module 10: the places looked at since `since`, newest first, for the pre-warm. */
  async activePlaces(since: number, limit: number): Promise<ActivePlace[]> {
    const members = await this.redis.membersSince(this.keys.activePlaces, since, limit);
    return members.flatMap((member) => {
      try {
        const place = JSON.parse(member) as ActivePlace;
        return typeof place.country === 'string' && typeof place.lang === 'string' ? [place] : [];
      } catch {
        return [];
      }
    });
  }

  /**
   * Module 10: makes sure the shared copies a tab reads exist and are not older
   * than `olderThanMs`, waiting for each fetch. For the worker's pre-warm only:
   * no workspace, no throttle, every load one after the other so the gate, the
   * breakers and the budgets hold as they do for a person. Answers how many
   * loads it fetched.
   */
  async warm(request: FeedRequest, olderThanMs: number): Promise<number> {
    let fetched = 0;
    for (const load of planLoads(this.engine, this.keys, request)) {
      const warmed = await this.cache.warm<CachedFeed>(load.key, {
        keepSeconds: load.windows.keepSeconds,
        olderThanMs: Math.max(olderThanMs, load.windows.freshMs),
        refresh: (previous) => this.fetchGroups(load, previous),
      });
      if (warmed) fetched += 1;
    }
    return fetched;
  }

  private async load(orgId: string | null, load: LoadPlan): Promise<CachedFeed | null> {
    const { entry } = await this.cache.load<CachedFeed>(load.key, {
      keepSeconds: load.windows.keepSeconds,
      freshMs: (cached) => cached.retryAfterMs ?? this.freshFor(load, cached),
      beforeMiss: load.placeBound && orgId ? () => this.countNewPlace(orgId) : undefined,
      refresh: (previous) => this.fetchGroups(load, previous),
    });
    return entry;
  }

  /**
   * How long a good copy is the answer. Its load's window, except for a Wikipedia
   * list that has since stopped being yesterday's: one fetched late in the evening
   * would otherwise hide the next day's list for most of that day.
   */
  private freshFor(load: LoadPlan, cached: CachedFeed): number {
    const yesterday = utcYesterday();
    const isOlder = cached.groups.some(
      (group) => group.answeredDay !== undefined && group.answeredDay !== yesterday,
    );
    return isOlder ? Math.min(load.windows.freshMs, RETRY_AFTER_EARLY_MS) : load.windows.freshMs;
  }

  /** Limits fetches, not reads: a place that is already cached costs Google nothing. */
  private async countNewPlace(orgId: string): Promise<void> {
    const count = await this.redis.incrementWithTtl(
      workspaceKeys.feedMisses(orgId),
      NEW_PLACES_WINDOW_SECONDS,
    );
    if (count <= NEW_PLACES_PER_MINUTE) return;

    securityLogger.warn('discover.feed_throttled', { orgId });
    throw new HttpException(
      { message: DISCOVER_MESSAGES.feedThrottled, code: 'feed_throttled' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async fetchGroups(load: LoadPlan, previous: CachedFeed | null): Promise<CachedFeed> {
    const { key, groups: plans, windows } = load;
    const started = Date.now();
    const settled = await Promise.allSettled(plans.map((plan) => this.runGroup(plan)));
    const outcomes = settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;

      // A source never throws, so this is a bug. The name only: a message can quote
      // the address, and the address can say which place someone was asking about.
      this.logger.error(
        JSON.stringify({
          event: 'discover.feed.group_threw',
          group: plans[index].id,
          reason: result.reason instanceof Error ? result.reason.name : 'unknown',
        }),
      );
      return TROUBLE;
    });

    const now = new Date();
    const keptCopy = (plan: GroupPlan): CachedGroup | null => {
      const copy = previous?.groups.find((group) => group.id === plan.id);
      if (!copy) return null;
      return now.getTime() - Date.parse(copy.fetchedAt) <= windows.keepSeconds * 1000 ? copy : null;
    };

    // What each group goes on with: the new answer, or failing that what it had.
    const taken = plans.map((plan, index) => {
      const outcome = outcomes[index];
      const copy = keptCopy(plan);
      const answer = answerOf(outcome);
      // Half an answer never replaces a whole one.
      const isWhole = copy !== null && !copy.partial && copy.items.length > 0;
      const isWorse = answer?.partial === true && isWhole;
      return { plan, outcome, copy, fresh: isWorse ? undefined : answer };
    });

    const lists = taken.map(
      ({ plan, copy, fresh }): FeedGroupInput => ({
        id: plan.id,
        items: fresh ? fresh.items : (copy?.items ?? []),
      }),
    );
    // A kept copy goes through the composer too, so it cannot repeat a fresh story.
    const composed = load.compose
      ? composeFeed(lists, {
          now,
          // Recordings all pass 48 hours two days after they were made.
          maxNewsAgeMs: this.engine.simulation ? null : NEWS_MAX_AGE_MS,
        })
      : lists.map((list) => ({ id: list.id, items: list.items.map(withFestivalId) }));

    const groups = taken.map(({ plan, outcome, copy, fresh }, index): CachedGroup => {
      // What the source said about its own answer travels with the items it is about.
      const said = fresh ?? copy;
      return {
        id: plan.id,
        source: plan.source,
        attribution: (plan.ownAttribution ? said?.attribution : undefined) ?? plan.attribution,
        items: composed[index].items,
        fetchedAt: fresh || !copy ? now.toISOString() : copy.fetchedAt,
        answeredGeo: said?.answeredGeo,
        answeredDay: said?.answeredDay,
        partial: said?.partial,
        spent: outcome.spent,
      };
    });

    const unavailable = [
      ...new Set(plans.filter((_, index) => !answerOf(outcomes[index])).map((plan) => plan.source)),
    ];
    const retries = outcomes.flatMap((outcome) => outcome.retryAfterMs ?? []);

    this.logger.log(
      JSON.stringify({
        event: 'discover.feed.refresh',
        key,
        ms: Date.now() - started,
        unavailable,
      }),
    );

    return {
      fetchedAt: now.toISOString(),
      groups,
      unavailable,
      // The longest wait wins: a refresh asks every group again.
      retryAfterMs: retries.length > 0 ? Math.max(...retries) : null,
    };
  }

  private async runGroup(plan: GroupPlan): Promise<GroupOutcome> {
    if (await this.isResting(plan.source)) return TROUBLE;

    const release = await this.gate.acquire();
    if (!release) return { retryAfterMs: RETRY_AFTER_BUSY_MS };

    try {
      // Inside the gate, so a unit is only ever taken for a call that is about to be made.
      if (plan.budget && !(await this.reserve(plan.budget))) {
        return { spent: true, retryAfterMs: RETRY_AFTER_SPENT_MS };
      }
      // A source with its own pace for the whole deployment (GDELT): a held key is a
      // full gate, not trouble, so the copy stays and nothing counts for the breaker.
      if (
        plan.spacing &&
        !(await this.redis.setIfAbsent(plan.spacing.key, '1', plan.spacing.seconds))
      ) {
        return { retryAfterMs: RETRY_AFTER_BUSY_MS };
      }

      const result = await plan.fetch(AbortSignal.timeout(GROUP_DEADLINE_MS));
      if (plan.budget) await this.settle(plan.budget, result);
      await this.recordHealth(plan.source, result);
      return { result, retryAfterMs: askAgainAfter(result) };
    } finally {
      release();
    }
  }

  /**
   * Takes one call's worth from a budget before the call is made, and says whether
   * there was any left. Before, not after, so a call that fails or never comes
   * back is counted too.
   *
   * The increment decides. It is one atomic step, so however many requests race,
   * only as many as the limit ever see a count within it. The read in front of it
   * only stops a spent budget's counter from climbing all day.
   */
  private async reserve(budget: Budget): Promise<boolean> {
    if (Number((await this.redis.get(budget.key)) ?? 0) >= budget.limit) return false;
    return (await this.redis.incrementWithTtl(budget.key, BUDGET_SECONDS)) <= budget.limit;
  }

  /**
   * A source says what its answer really cost. Whatever is beyond the unit already
   * taken is added, up to the whole day: past the limit one more changes nothing,
   * so a source that says nonsense cannot keep this counting for ever.
   */
  private async settle(budget: Budget, result: SourceResult): Promise<void> {
    const beyond = Math.min((result.unitsUsed ?? 1) - 1, budget.limit);
    for (let extra = beyond; extra > 0; extra -= 1) {
      await this.redis.incrementWithTtl(budget.key, BUDGET_SECONDS);
    }
  }

  private async isResting(source: SourceId): Promise<boolean> {
    return Number((await this.redis.get(this.keys.breaker(source))) ?? 0) >= BREAKER_THRESHOLD;
  }

  private async recordHealth(source: SourceId, result: SourceResult): Promise<void> {
    // Half an answer says one reader is down and one is fine: no verdict either way.
    if (result.partial) return;

    const key = this.keys.breaker(source);

    if (result.failed !== 'upstream') {
      await this.redis.delete(key);
      return;
    }

    const failures = await this.redis.incrementWithTtl(key, BREAKER_SECONDS);
    if (failures >= BREAKER_THRESHOLD) {
      // The counter's window started at the first failure. Resting is ten minutes
      // from the last one, or a source could be back in moments.
      await this.redis.set(key, String(failures), BREAKER_SECONDS);
      this.logger.warn(JSON.stringify({ event: 'discover.breaker_open', source }));
    }
  }

  private present(
    request: FeedRequest,
    language: string,
    loaded: Loaded[],
    hidden: DiscoverSourceSwitch[] | undefined,
  ): FeedAnswer {
    const { kind, locality } = request;
    const now = Date.now();
    const today = kind === 'festivals' ? this.todayAt(locality) : undefined;

    const shown = loaded
      .flatMap(({ load, entry }) =>
        (entry?.groups ?? []).map((group): ShownGroup => {
          const ageMs = now - Date.parse(group.fetchedAt);
          // The copy holds more than a year of festivals. The tab shows the weeks around today.
          const items = today === undefined ? group.items : festivalsInWindow(group.items, today);
          return {
            group,
            items: items.map((item) => ({ ...item, brief: buildBrief(item, locality, language) })),
            ageMs,
            // Each group against its own load's window. A spent budget is why a copy
            // is still the answer, however young it is.
            stale: ageMs >= load.windows.freshMs || group.spent === true,
            ...(load.interest ? { interest: load.interest } : {}),
          };
        }),
      )
      // An empty group has nothing to say: the page just does not show it.
      .filter((part) => part.items.length > 0);

    if (kind === 'news') {
      // Several loads answer News (Module 10), and each composes only its own
      // groups. In the tab's order, a headline already shown above is left out
      // below, so an interest and the top stories never show the same story twice.
      shown.sort((a, b) => newsRank(this.idOf(a)) - newsRank(this.idOf(b)));
      const seen = new Set<string>();
      for (const part of shown) {
        part.items = part.items.filter((item) => {
          const key = headlineKey(item.title);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
    }

    // The two networks are fetched and kept apart, and shown as one group.
    const networks = shown.filter((part) => part.group.id === 'social');
    const groups = shown
      .filter((part) => part.group.id !== 'social' && part.items.length > 0)
      .map((part) => this.groupOf(part, request));
    if (networks.length > 0) groups.push(this.socialGroup(networks, request));

    // Switched off is the whole explanation: whether there is a key is beside the point.
    const reason = hidden?.includes('videos') ? undefined : this.emptyReason(kind, groups, loaded);

    return {
      kind,
      locality: withNewsLanguages(locality),
      language,
      groups,
      unavailable: [
        ...new Set(
          loaded.flatMap(({ load, entry }) =>
            // No entry means nobody finished fetching in time, so nothing is known.
            entry ? entry.unavailable : load.groups.map((plan) => plan.source),
          ),
        ),
      ],
      ...(today === undefined ? {} : { today }),
      ...(reason ? { reason } : {}),
      ...(hidden ? { hidden } : {}),
    };
  }

  /**
   * Today where the place is, which is what a festival is "in 3 days" from. The
   * zone arrives from a query string checked for shape only, and `todayIn` is
   * where a zone `Intl` does not know reads UTC instead of throwing.
   */
  private todayAt({ timeZone, countryCode }: Locality): string {
    return todayIn(timeZone ?? (countryCode ? defaultTimeZone(countryCode) : null));
  }

  private emptyReason(
    kind: FeedKind,
    groups: FeedGroup[],
    loaded: Loaded[],
  ): FeedEmptyReason | undefined {
    if (kind !== 'videos') return undefined;
    if (!this.engine.videos) return 'not_set_up';

    const isSpent = loaded.some(({ entry }) => entry?.groups.some((group) => group.spent));
    return groups.length === 0 && isSpent ? 'resting' : undefined;
  }

  /** A group's id in this answer: an interest's comes from its place in this workspace's list. */
  private idOf(part: ShownGroup): FeedGroupId {
    return part.interest ? `interest-${part.interest.index}` : part.group.id;
  }

  private groupOf(part: ShownGroup, request: FeedRequest): FeedGroup {
    const { group, items, stale } = part;
    return {
      id: this.idOf(part),
      title: part.interest
        ? DISCOVER_MESSAGES.interestTitle(part.interest.words)
        : this.titleOf(group, request),
      subtitle: this.subtitleOf(part),
      attribution: group.attribution,
      items,
      stale,
      fetchedAt: group.fetchedAt,
    };
  }

  /**
   * Bluesky's trends and then Mastodon's, as one group. It is as old as its older
   * half and stale when either half is. A network with nothing to show is simply
   * not named: its chips are missing, and `unavailable` says why.
   */
  private socialGroup(networks: ShownGroup[], request: FeedRequest): FeedGroup {
    const oldest = networks.reduce((a, b) => (b.ageMs > a.ageMs ? b : a));
    if (networks.length === 1) return this.groupOf(oldest, request);

    const names = networks.map(({ group }) => this.networkName(group));
    const stale = networks.some((part) => part.stale);
    return {
      id: 'social',
      title: DISCOVER_MESSAGES.socialTitle(names),
      subtitle: this.subtitleOf({ ...oldest, stale }),
      attribution: { name: DISCOVER_MESSAGES.socialAttribution(names) },
      items: networks.flatMap((part) => part.items),
      stale,
      fetchedAt: oldest.group.fetchedAt,
    };
  }

  private networkName(group: CachedGroup): string {
    return group.source in SOCIAL_NETWORKS
      ? SOCIAL_NETWORKS[group.source as keyof typeof SOCIAL_NETWORKS]
      : group.attribution.name;
  }

  private subtitleOf({ group, ageMs, stale }: ShownGroup): string {
    if (group.spent) return DISCOVER_MESSAGES.videosResting;

    const via = this.viaOf(group);
    return stale ? `${via} ${DISCOVER_MESSAGES.staleNote(Math.floor(ageMs / MINUTE_MS))}` : via;
  }

  /** The sentence that names where a group comes from. */
  private viaOf(group: CachedGroup): string {
    switch (group.id) {
      case 'trends':
        return DISCOVER_MESSAGES.risingSubtitle;
      case 'wikipedia':
        return wikipediaSubtitle(group.answeredDay);
      case 'social':
        return DISCOVER_MESSAGES.socialSubtitle;
      case 'videos':
        return DISCOVER_MESSAGES.videosSubtitle;
      case 'festivals':
        return DISCOVER_MESSAGES.festivalsSubtitle;
      case 'gdelt':
        return DISCOVER_MESSAGES.gdeltSubtitle;
      default:
        // A keyed service answering News says so (Module 10); Google's line is as it was.
        return this.engine.newsProvider === 'google'
          ? DISCOVER_MESSAGES.newsSubtitle
          : DISCOVER_MESSAGES.newsVia(group.attribution.name);
    }
  }

  private titleOf(group: CachedGroup, request: FeedRequest): string {
    const { locality, topic } = request;
    const country = locality.countryName ?? locality.countryCode ?? '';

    switch (group.id) {
      case 'trends': {
        // Honest after a fallback: if the country answered, the heading says the country.
        const isRegion = group.answeredGeo === locality.regionCode && locality.regionName;
        return DISCOVER_MESSAGES.risingTitle(isRegion ? (locality.regionName as string) : country);
      }
      case 'wikipedia':
        // An edition is a language's readers everywhere, so the heading names it and not the place.
        return DISCOVER_MESSAGES.wikipediaTitle(languageName(wikipediaEdition(request)));
      case 'social':
        return DISCOVER_MESSAGES.socialTitle([this.networkName(group)]);
      case 'place':
        return DISCOVER_MESSAGES.placeTitle(locality.city as string);
      case 'top':
        return DISCOVER_MESSAGES.topTitle(country);
      case 'world':
        return DISCOVER_MESSAGES.worldTitle;
      case 'topic':
        return TOPIC_TITLES[topic as NewsTopic];
      case 'videos':
        return DISCOVER_MESSAGES.videosTitle(country);
      case 'festivals':
        return DISCOVER_MESSAGES.festivalsTitle(country);
      case 'gdelt':
        return DISCOVER_MESSAGES.gdeltTitle(locality.city ?? locality.regionName ?? country);
      default:
        // An interest's group is named in `groupOf`, which knows the words.
        return group.attribution.name;
    }
  }
}
