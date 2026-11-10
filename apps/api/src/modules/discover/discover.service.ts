/**
 * What is rising and what is news in a place.
 *
 * The answer depends on the place and the language, never on the workspace, so it
 * is cached for everyone: nothing here can tell one tenant's Chennai from another's.
 * The workspace only appears in the limit on asking for new places.
 *
 * ## What goes in the cache, and what never does
 *
 * Only what changes the upstream answer goes in the key. Google Trends has no
 * language, so Trending ignores it. News is keyed by the edition really asked for,
 * not the language requested, so `en` and `en-GB` in India share one copy, and a
 * made-up language cannot be used to force a fetch.
 *
 * Headings and briefs are built per request and never stored, because they name the
 * viewer's own place. Everyone in Chennai shares the items; only the person who
 * typed "Madras" sees that word.
 *
 * ## When a source is struggling
 *
 * - A group that fails keeps its old copy, marked stale, and its source is listed in
 *   `unavailable`, so the page shows what it had and never has to guess.
 * - A breaker per source: three failures in a row and the source is left alone for
 *   ten minutes. Only real trouble counts. A place Google has nothing for is
 *   `not_found`, so asking about one cannot switch the source off for everyone.
 * - An entry with a failure in it is retried after a minute rather than after the
 *   kind's full window, and not before: one attempt a minute per place at most.
 */
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildBrief,
  type ComposedItem,
  composeFeed,
  type DiscoverItem,
  editionFor,
  type Locality,
  languagesWithEdition,
  NEWS_MAX_AGE_MS,
  type NewsTopic,
  type SourceAttribution,
  type SourceId,
  type SourceInput,
  type SourceResult,
} from '@postgear/discover-engine';
import { securityLogger } from '../../common/logging/security-logger';
import { RedisService } from '../redis/redis.service';
import { type CacheEntry, DiscoverCache, LOCK_SECONDS } from './discover.cache';
import { DISCOVER_ENGINE, type DiscoverEngine } from './discover.engine';
import { DiscoverGate } from './discover.gate';
import { type DiscoverKeys, discoverKeys, workspaceKeys } from './discover.keys';
import { DISCOVER_MESSAGES, TOPIC_TITLES } from './discover.messages';
import { type LocalityAnswer, withNewsLanguages } from './locality.service';

const MINUTE_MS = 60_000;

const FRESH_MS: Record<FeedKind, number> = { trending: 20 * MINUTE_MS, news: 15 * MINUTE_MS };
const KEEP_SECONDS = 6 * 60 * 60;

/** Long enough that a struggling source is not hammered, per place. */
const RETRY_AFTER_TROUBLE_MS = MINUTE_MS;
/** A full gate says nothing about the source and clears in moments: as soon as the lock allows. */
const RETRY_AFTER_BUSY_MS = LOCK_SECONDS * 1000;

export const BREAKER_THRESHOLD = 3;
export const BREAKER_SECONDS = 10 * 60;

/** Well inside the lock's 20 seconds, so a slow fetch cannot outlive its own lock. */
const GROUP_DEADLINE_MS = 12_000;

export const NEW_PLACES_PER_MINUTE = 30;
const NEW_PLACES_WINDOW_SECONDS = 60;

export type FeedKind = 'trending' | 'news';

export interface FeedRequest {
  kind: FeedKind;
  locality: Locality;
  language: string;
  topic?: NewsTopic;
}

export type FeedGroupId = 'trends' | 'place' | 'top' | 'world' | 'topic';

export interface FeedGroup {
  id: FeedGroupId;
  title: string;
  subtitle: string;
  attribution: SourceAttribution;
  items: DiscoverItem[];
  stale: boolean;
  fetchedAt: string;
}

export interface FeedAnswer {
  kind: FeedKind;
  locality: LocalityAnswer;
  /** What the stories are really in, which for News can differ from what was asked for. */
  language: string;
  groups: FeedGroup[];
  unavailable: SourceId[];
}

export interface DiscoverStatus {
  simulation: boolean;
  geocoder: 'nominatim' | 'off';
  sources: {
    trends: boolean;
    news: boolean;
    wikipedia: boolean;
    videos: boolean;
    holidays: boolean;
    social: boolean;
  };
}

interface GroupPlan {
  id: FeedGroupId;
  source: SourceId;
  attribution: SourceAttribution;
  fetch: (signal: AbortSignal) => Promise<SourceResult>;
}

interface GroupOutcome {
  /** Absent when the source was not asked at all. */
  result?: SourceResult;
  retryAfterMs: number | null;
}

interface CachedGroup {
  id: FeedGroupId;
  source: SourceId;
  attribution: SourceAttribution;
  items: ComposedItem[];
  /** When these items were really fetched, which a kept copy does not change. */
  fetchedAt: string;
  answeredGeo?: string;
}

interface CachedFeed extends CacheEntry {
  groups: CachedGroup[];
  unavailable: SourceId[];
  /** Set when something went wrong: how soon this entry is worth trying again. */
  retryAfterMs: number | null;
}

const TROUBLE: GroupOutcome = { retryAfterMs: RETRY_AFTER_TROUBLE_MS };

const TRENDS_ATTRIBUTION = { name: 'Google Trends', url: 'https://trends.google.com/trending' };
const NEWS_ATTRIBUTION = { name: 'Google News', url: 'https://news.google.com' };

function answered(outcome: GroupOutcome): boolean {
  return outcome.result !== undefined && outcome.result.failed === undefined;
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
  ) {
    this.keys = discoverKeys(engine.simulation);
  }

  status(): DiscoverStatus {
    return {
      simulation: this.engine.simulation,
      geocoder: this.engine.geocoder ? 'nominatim' : 'off',
      sources: {
        trends: true,
        news: true,
        wikipedia: false,
        videos: false,
        holidays: false,
        social: false,
      },
    };
  }

  async feed(orgId: string, request: FeedRequest): Promise<FeedAnswer> {
    const plans = this.planGroups(request);
    const language = this.answerLanguage(request);

    // Worldwide has no Trending yet: nothing to fetch, so nothing to cache.
    if (plans.length === 0) return this.present(request, language, null, plans);

    const key = this.keys.feed(this.keyParts(request, language));
    const { entry } = await this.cache.load<CachedFeed>(key, {
      keepSeconds: KEEP_SECONDS,
      freshMs: (cached) => cached.retryAfterMs ?? FRESH_MS[request.kind],
      beforeMiss: () => this.countNewPlace(orgId),
      refresh: (previous) => this.fetchGroups(key, plans, previous),
    });

    return this.present(request, language, entry, plans);
  }

  /** News answers in an edition that exists. Trends has no language of its own. */
  private answerLanguage({ kind, locality, language }: FeedRequest): string {
    return kind === 'news' ? editionFor(locality.countryCode, language).language : language;
  }

  private keyParts({ kind, locality, topic }: FeedRequest, language: string) {
    return kind === 'trending'
      ? {
          kind,
          country: locality.countryCode,
          region: locality.regionCode,
          city: null,
          language: null,
          topic: null,
        }
      : {
          kind,
          country: locality.countryCode,
          region: null,
          city: locality.city,
          language,
          topic: topic ?? null,
        };
  }

  private planGroups({ kind, locality, language, topic }: FeedRequest): GroupPlan[] {
    const input = (signal: AbortSignal): SourceInput => ({ locality, language, signal });

    if (kind === 'trending') {
      if (!locality.countryCode) return [];
      return [
        {
          id: 'trends',
          source: 'google-trends',
          attribution: TRENDS_ATTRIBUTION,
          fetch: (signal) => this.engine.trends.fetch(input(signal)),
        },
      ];
    }

    const plan = (id: FeedGroupId, fetch: GroupPlan['fetch']): GroupPlan => ({
      id,
      source: 'google-news',
      attribution: NEWS_ATTRIBUTION,
      fetch,
    });
    const { news } = this.engine;

    // A chosen topic comes first: de-duplicating favours the earlier group, and a
    // story that is both top news and about the topic belongs under what was asked for.
    const groups: GroupPlan[] = [];
    if (topic) groups.push(plan('topic', (signal) => news.topic(input(signal), topic)));
    if (locality.city) groups.push(plan('place', (signal) => news.place(input(signal))));

    // Reading a country with no edition from `US:en`'s top stories would be American
    // news with that country's name on it. World news says what it is.
    if (languagesWithEdition(locality.countryCode).length > 0) {
      groups.push(plan('top', (signal) => news.top(input(signal))));
    } else {
      groups.push(plan('world', (signal) => news.topic(input(signal), 'WORLD')));
    }

    return groups;
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

  private async fetchGroups(
    key: string,
    plans: GroupPlan[],
    previous: CachedFeed | null,
  ): Promise<CachedFeed> {
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
      return now.getTime() - Date.parse(copy.fetchedAt) <= KEEP_SECONDS * 1000 ? copy : null;
    };

    // A kept copy goes through the composer too, so it cannot repeat a fresh story.
    const composed = composeFeed(
      plans.map((plan, index) => ({
        id: plan.id,
        items: answered(outcomes[index])
          ? (outcomes[index].result as SourceResult).items
          : (keptCopy(plan)?.items ?? []),
      })),
      // Recordings all pass 48 hours two days after they were made.
      { now, maxNewsAgeMs: this.engine.simulation ? null : NEWS_MAX_AGE_MS },
    );

    const groups = plans.map((plan, index): CachedGroup => {
      const outcome = outcomes[index];
      const copy = keptCopy(plan);
      const isFresh = answered(outcome);
      return {
        id: plan.id,
        source: plan.source,
        attribution: plan.attribution,
        items: composed[index].items,
        fetchedAt: isFresh || !copy ? now.toISOString() : copy.fetchedAt,
        answeredGeo: isFresh ? outcome.result?.answeredGeo : copy?.answeredGeo,
      };
    });

    const unavailable = [
      ...new Set(plans.filter((_, index) => !answered(outcomes[index])).map((plan) => plan.source)),
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
      const result = await plan.fetch(AbortSignal.timeout(GROUP_DEADLINE_MS));
      await this.recordHealth(plan.source, result);
      return { result, retryAfterMs: result.failed === 'upstream' ? RETRY_AFTER_TROUBLE_MS : null };
    } finally {
      release();
    }
  }

  private async isResting(source: SourceId): Promise<boolean> {
    return Number((await this.redis.get(this.keys.breaker(source))) ?? 0) >= BREAKER_THRESHOLD;
  }

  private async recordHealth(source: SourceId, result: SourceResult): Promise<void> {
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
    entry: CachedFeed | null,
    plans: GroupPlan[],
  ): FeedAnswer {
    const { kind, locality } = request;
    const now = Date.now();

    const groups = (entry?.groups ?? [])
      // An empty group has nothing to say: the page just does not show it.
      .filter((group) => group.items.length > 0)
      .map((group): FeedGroup => {
        const ageMs = now - Date.parse(group.fetchedAt);
        const stale = ageMs >= FRESH_MS[kind];
        const via =
          group.source === 'google-trends'
            ? DISCOVER_MESSAGES.risingSubtitle
            : DISCOVER_MESSAGES.newsSubtitle;

        return {
          id: group.id,
          title: this.titleOf(group, request),
          subtitle: stale
            ? `${via} ${DISCOVER_MESSAGES.staleNote(Math.floor(ageMs / MINUTE_MS))}`
            : via,
          attribution: group.attribution,
          items: group.items.map((item) => ({
            ...item,
            brief: buildBrief(item, locality, language),
          })),
          stale,
          fetchedAt: group.fetchedAt,
        };
      });

    return {
      kind,
      locality: withNewsLanguages(locality),
      language,
      groups,
      // No entry means nobody finished fetching in time, so nothing is known.
      unavailable: entry ? entry.unavailable : [...new Set(plans.map((plan) => plan.source))],
    };
  }

  private titleOf(group: CachedGroup, { locality, topic }: FeedRequest): string {
    const country = locality.countryName ?? locality.countryCode ?? '';

    switch (group.id) {
      case 'trends': {
        // Honest after a fallback: if the country answered, the heading says the country.
        const isRegion = group.answeredGeo === locality.regionCode && locality.regionName;
        return DISCOVER_MESSAGES.risingTitle(isRegion ? (locality.regionName as string) : country);
      }
      case 'place':
        return DISCOVER_MESSAGES.placeTitle(locality.city as string);
      case 'top':
        return DISCOVER_MESSAGES.topTitle(country);
      case 'world':
        return DISCOVER_MESSAGES.worldTitle;
      case 'topic':
        return TOPIC_TITLES[topic as NewsTopic];
    }
  }
}
