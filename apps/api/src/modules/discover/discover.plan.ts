/**
 * What each tab asks for, under which key, and how long the answer is good for.
 *
 * A tab is not one fetch. Trending is three things that age at very different
 * speeds and belong to different things: rising searches change in minutes and
 * belong to a region, a Wikipedia edition's list changes once a day and belongs to
 * a language, and the social networks' lists are the same for the whole world. One
 * entry for the tab would either ask Wikipedia every twenty minutes for every
 * region, or show day-old searches.
 *
 * So the unit is a **load**: the sources that share a key and a window, kept as
 * one cache entry. This file only says what the loads of a request are. The
 * service runs every one of them the same way (lock, gate, breaker, kept copy) and
 * never asks which tab it is serving.
 *
 * ## Nothing a person can make up reaches a key
 *
 * Only what changes the outside answer is in a key, and each part of it is
 * something that exists. News is keyed by the edition really read. Wikipedia is
 * keyed by an edition the place has a use for: the language asked for when the
 * place speaks it (or it is English), the place's own first language otherwise. So
 * `lang=xx` reads the copy everyone else in that place reads, and costs no call.
 */
import {
  type DiscoverSource,
  editionFor,
  holidayRegion,
  languagesWithEdition,
  MASTODON_INSTANCE,
  type Locality,
  type NewsTopic,
  type SourceAttribution,
  type SourceId,
  type SourceInput,
  type SourceResult,
  todayIn,
  wikipediaProject,
} from '@postgear/discover-engine';
import type { DiscoverEngine } from './discover.engine';
import type { DiscoverKeys } from './discover.keys';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;

export type FeedKind = 'trending' | 'news' | 'videos' | 'festivals';

export interface FeedRequest {
  kind: FeedKind;
  locality: Locality;
  language: string;
  topic?: NewsTopic;
}

export type FeedGroupId =
  | 'trends'
  | 'wikipedia'
  | 'social'
  | 'place'
  | 'top'
  | 'world'
  | 'topic'
  | 'videos'
  | 'festivals';

/**
 * Two windows per load. Inside `freshMs` the copy is simply the answer. Past it
 * the copy is answered at once and fetched again behind the scenes, and a source
 * that fails keeps showing it, marked stale, for `keepSeconds` at most.
 */
export interface Windows {
  freshMs: number;
  keepSeconds: number;
}

export const WINDOWS = {
  trends: { freshMs: 20 * MINUTE_MS, keepSeconds: 6 * HOUR_SECONDS },
  news: { freshMs: 15 * MINUTE_MS, keepSeconds: 6 * HOUR_SECONDS },
  // The list changes once a day, and one request a day per edition is polite.
  wikipedia: { freshMs: 24 * HOUR_MS, keepSeconds: 48 * HOUR_SECONDS },
  social: { freshMs: 10 * MINUTE_MS, keepSeconds: 2 * HOUR_SECONDS },
  // Every call costs a unit, so an hour. YouTube's terms allow a copy 30 days; six hours is plenty.
  videos: { freshMs: HOUR_MS, keepSeconds: 6 * HOUR_SECONDS },
  // The source hands over more than a year of dates, so a month-old copy still covers the tab.
  festivals: { freshMs: 7 * 24 * HOUR_MS, keepSeconds: 30 * DAY_SECONDS },
} as const satisfies Record<string, Windows>;

/** Google gives a project 10,000 units a day and a call costs one. The rest is room for a mistake. */
export const YOUTUBE_DAILY_UNITS = 8_000;

/**
 * The quota resets at midnight Pacific, so that is the day the budget is counted
 * in. A UTC day straddles two of them: two UTC budgets could be spent inside one
 * quota day, which is 16,000 units against a limit of 10,000.
 */
const YOUTUBE_QUOTA_ZONE = 'America/Los_Angeles';

/** Something a source spends per call and that runs out: a count under a dated key. */
export interface Budget {
  key: string;
  limit: number;
}

export interface GroupPlan {
  id: FeedGroupId;
  source: SourceId;
  attribution: SourceAttribution;
  /** Use what the source says about itself instead, when it has answered: only it knows which calendar it read. */
  ownAttribution?: boolean;
  fetch: (signal: AbortSignal) => Promise<SourceResult>;
  /** Set when every call costs something. Past the limit the source is not asked at all. */
  budget?: Budget;
}

export interface LoadPlan {
  key: string;
  windows: Windows;
  /**
   * Whether a miss counts towards the workspace's limit on new places. An edition
   * or a network is not a place: there are few of them and everyone shares them.
   */
  placeBound: boolean;
  /**
   * Whether the items go through the composer, which drops a title it has seen.
   * Festivals must not: the list holds the same festival in two different years.
   */
  compose: boolean;
  groups: GroupPlan[];
}

const TRENDS_ATTRIBUTION = { name: 'Google Trends', url: 'https://trends.google.com/trending' };
const NEWS_ATTRIBUTION = { name: 'Google News', url: 'https://news.google.com' };
const BLUESKY_ATTRIBUTION = { name: 'Bluesky', url: 'https://bsky.app' };
const MASTODON_ATTRIBUTION = { name: 'Mastodon', url: `https://${MASTODON_INSTANCE}` };
const YOUTUBE_ATTRIBUTION = { name: 'YouTube', url: 'https://www.youtube.com' };
const HOLIDAYS_ATTRIBUTION = { name: 'Public holiday calendars and date-holidays' };

/** News answers in an edition that exists. Nothing else has a language of its own to report. */
export function answerLanguage({ kind, locality, language }: FeedRequest): string {
  return kind === 'news' ? editionFor(locality.countryCode, language).language : language;
}

/** `en` for `en-GB`. */
function primarySubtag(tag: string): string {
  return tag.toLowerCase().split('-')[0];
}

/**
 * The language whose Wikipedia a request reads. What was asked for only when the
 * place speaks it, or it is English, which every place can read. Anything else
 * (a typo, a made-up tag, a language from the other side of the world) reads the
 * place's own first language, so it lands on a copy that is already there.
 */
export function wikipediaLanguage({ locality, language }: FeedRequest): string {
  const asked = primarySubtag(language);
  const offered = asked === 'en' || locality.languages.some((tag) => primarySubtag(tag) === asked);
  return offered ? language : (locality.languages[0] ?? 'en');
}

/** `ta` for a request that reads `ta.wikipedia.org`. */
export function wikipediaEdition(request: FeedRequest): string {
  return wikipediaProject(wikipediaLanguage(request)).split('.')[0];
}

interface PlanContext {
  engine: DiscoverEngine;
  keys: DiscoverKeys;
  request: FeedRequest;
}

function trendsLoad({ engine, keys, request }: PlanContext): LoadPlan {
  const { locality, language } = request;
  return {
    // Google Trends has no language and no city, so neither is in the key.
    key: keys.feed({
      kind: 'trending',
      country: locality.countryCode,
      region: locality.regionCode,
      city: null,
      language: null,
      topic: null,
    }),
    windows: WINDOWS.trends,
    placeBound: true,
    compose: true,
    groups: [
      {
        id: 'trends',
        source: 'google-trends',
        attribution: TRENDS_ATTRIBUTION,
        fetch: (signal) => engine.trends.fetch({ locality, language, signal }),
      },
    ],
  };
}

function wikipediaLoad({ engine, keys, request }: PlanContext): LoadPlan {
  const { locality } = request;
  const language = wikipediaLanguage(request);
  const edition = wikipediaEdition(request);
  return {
    key: keys.wikipedia(wikipediaProject(language)),
    windows: WINDOWS.wikipedia,
    placeBound: false,
    compose: true,
    groups: [
      {
        id: 'wikipedia',
        source: 'wikipedia',
        attribution: { name: 'Wikipedia', url: `https://${edition}.wikipedia.org` },
        fetch: (signal) => engine.wikipedia.fetch({ locality, language, signal }),
      },
    ],
  };
}

/** Each network is a load of its own, so one being down or slow costs the other nothing. */
function socialLoad(
  { keys, request }: PlanContext,
  source: DiscoverSource,
  attribution: SourceAttribution,
): LoadPlan {
  const { locality, language } = request;
  return {
    key: keys.social(source.id),
    windows: WINDOWS.social,
    placeBound: false,
    compose: true,
    groups: [
      {
        id: 'social',
        source: source.id,
        attribution,
        fetch: (signal) => source.fetch({ locality, language, signal }),
      },
    ],
  };
}

function newsLoad({ engine, keys, request }: PlanContext): LoadPlan {
  const { locality, language, topic } = request;
  const { news } = engine;
  const input = (signal: AbortSignal): SourceInput => ({ locality, language, signal });
  const plan = (id: FeedGroupId, fetch: GroupPlan['fetch']): GroupPlan => ({
    id,
    source: 'google-news',
    attribution: NEWS_ATTRIBUTION,
    fetch,
  });

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

  return {
    // The edition really read, not the language asked for, and no region: Google News has none.
    key: keys.feed({
      kind: 'news',
      country: locality.countryCode,
      region: null,
      city: locality.city,
      language: answerLanguage(request),
      topic: topic ?? null,
    }),
    windows: WINDOWS.news,
    placeBound: true,
    compose: true,
    groups,
  };
}

function videosLoad(
  { keys, request }: PlanContext,
  videos: DiscoverSource,
  country: string,
): LoadPlan {
  const { locality, language } = request;
  return {
    key: keys.videos(country),
    windows: WINDOWS.videos,
    placeBound: true,
    compose: true,
    groups: [
      {
        id: 'videos',
        source: 'youtube',
        attribution: YOUTUBE_ATTRIBUTION,
        fetch: (signal) => videos.fetch({ locality, language, signal }),
        budget: {
          key: keys.youtubeBudget(todayIn(YOUTUBE_QUOTA_ZONE)),
          limit: YOUTUBE_DAILY_UNITS,
        },
      },
    ],
  };
}

function festivalsLoad({ engine, keys, request }: PlanContext, country: string): LoadPlan {
  const { locality, language } = request;
  return {
    // Only a region the holiday rules know. A made-up one reads the country's copy,
    // or each would cost a fetch and a month-long copy of the same calendar.
    key: keys.festivals(country, holidayRegion(country, locality.regionCode)),
    windows: WINDOWS.festivals,
    placeBound: true,
    compose: false,
    groups: [
      {
        id: 'festivals',
        source: 'holidays',
        attribution: HOLIDAYS_ATTRIBUTION,
        ownAttribution: true,
        fetch: (signal) => engine.holidays.fetch({ locality, language, signal }),
      },
    ],
  };
}

/**
 * The loads behind a request, in the order their groups are shown. None at all
 * means there is nothing to ask: videos with no key or no country, festivals with
 * no country, and a kind nobody knows.
 */
export function planLoads(
  engine: DiscoverEngine,
  keys: DiscoverKeys,
  request: FeedRequest,
): LoadPlan[] {
  const context: PlanContext = { engine, keys, request };
  const country = request.locality.countryCode;

  switch (request.kind) {
    case 'trending':
      return [
        // Worldwide has no rising searches: Google Trends needs a country.
        ...(country ? [trendsLoad(context)] : []),
        wikipediaLoad(context),
        socialLoad(context, engine.bluesky, BLUESKY_ATTRIBUTION),
        socialLoad(context, engine.mastodon, MASTODON_ATTRIBUTION),
      ];
    case 'news':
      return [newsLoad(context)];
    case 'videos':
      return engine.videos && country ? [videosLoad(context, engine.videos, country)] : [];
    case 'festivals':
      return country ? [festivalsLoad(context, country)] : [];
    default:
      return [];
  }
}
