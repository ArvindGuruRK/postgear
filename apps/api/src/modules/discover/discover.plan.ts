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
 *
 * ## A group a workspace switched off is never planned
 *
 * A workspace can turn five groups off (`TAB_PARTS` says which loads each switch
 * stands in front of). A load that is switched off is left out here, before the
 * service sees it: no fetch, no lock, no count of new places. The switches never
 * reach a key or a copy, which stay everyone's.
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
  /**
   * Set when the asker wants the groups its workspace switched off left out.
   * Says only that the switches apply: what they are is read per request, and
   * neither this nor they are ever part of a key.
   */
  workspaceSources?: boolean;
  /**
   * Module 10: the workspace's interests, read with its switches. Each is a News
   * group of its own. Only the request that asked for its workspace's settings
   * has any, and the words reach a key only as a shared search copy.
   */
  interests?: readonly string[];
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
  | 'festivals'
  | 'gdelt'
  | `interest-${number}`;

/**
 * The groups a workspace can switch off, each by the id of the group it hides.
 * News has no switch.
 */
export const SOURCE_SWITCHES = [
  'trends',
  'wikipedia',
  'social',
  'videos',
  'festivals',
  'gdelt',
] as const satisfies readonly FeedGroupId[];

export type DiscoverSourceSwitch = (typeof SOURCE_SWITCHES)[number];

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
  // Module 10: GDELT asks for a light touch, so one call per place an hour, kept half a day.
  gdelt: { freshMs: HOUR_MS, keepSeconds: 12 * HOUR_SECONDS },
} as const satisfies Record<string, Windows>;

/** GDELT answers about one request every five seconds from one address; six leaves room. */
export const GDELT_SPACING_SECONDS = 6;

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
  /**
   * Module 10: a source that allows one call every few seconds for the whole
   * deployment (GDELT). The key is held that long; a call that finds it held is
   * not made, which counts as a full gate, not as trouble.
   */
  spacing?: { key: string; seconds: number };
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
  /**
   * Module 10: an interest's load is shared by everyone who follows the same
   * words, so the copy cannot know which of this workspace's interests it is.
   * The answer names it from here instead: its place in the list and the words.
   */
  interest?: { index: number; words: string };
}

const TRENDS_ATTRIBUTION = { name: 'Google Trends', url: 'https://trends.google.com/trending' };
const NEWS_ATTRIBUTION = { name: 'Google News', url: 'https://news.google.com' };
const BLUESKY_ATTRIBUTION = { name: 'Bluesky', url: 'https://bsky.app' };
const MASTODON_ATTRIBUTION = { name: 'Mastodon', url: `https://${MASTODON_INSTANCE}` };
const YOUTUBE_ATTRIBUTION = { name: 'YouTube', url: 'https://www.youtube.com' };
const HOLIDAYS_ATTRIBUTION = { name: 'Public holiday calendars and date-holidays' };
const GDELT_ATTRIBUTION = { name: 'GDELT Project', url: 'https://www.gdeltproject.org' };

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

/**
 * Module 10: one Google News search per interest, in the edition the News tab
 * reads. Shared by every workspace that follows the same words in that edition,
 * so the key holds the words and the edition, never the workspace.
 */
function interestLoads({ engine, keys, request }: PlanContext): LoadPlan[] {
  const { locality, language } = request;
  const edition = answerLanguage(request);

  return (request.interests ?? []).map((words, index) => ({
    key: keys.interest(locality.countryCode, edition, words),
    windows: WINDOWS.news,
    placeBound: true,
    compose: true,
    interest: { index, words },
    groups: [
      {
        id: `interest-${index}`,
        source: 'google-news',
        attribution: NEWS_ATTRIBUTION,
        fetch: (signal) => engine.news.search(words, { locality, language, signal }),
      },
    ],
  }));
}

/**
 * Module 10: GDELT, a place's coverage in the world's press without Google.
 * Keyed by what its query is made of (country, region, city, language). Its
 * spacing key keeps the whole deployment to one call every six seconds, and its
 * window to one call per place an hour.
 */
function gdeltLoad(
  { keys, request }: PlanContext,
  gdelt: DiscoverSource,
  country: string,
): LoadPlan {
  const { locality } = request;
  const language = primarySubtag(answerLanguage(request));
  return {
    key: keys.gdelt(country, locality.regionCode, locality.city, language),
    windows: WINDOWS.gdelt,
    placeBound: true,
    compose: true,
    groups: [
      {
        id: 'gdelt',
        source: 'gdelt',
        attribution: GDELT_ATTRIBUTION,
        fetch: (signal) => gdelt.fetch({ locality, language, signal }),
        spacing: { key: keys.gdeltSpacing, seconds: GDELT_SPACING_SECONDS },
      },
    ],
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

/** One thing a tab asks for: its loads, and the switch that stands in front of them. */
interface TabPart {
  /** The switch a workspace turns these loads off with. A part without one is always asked. */
  offSwitch?: DiscoverSourceSwitch;
  loads: (context: PlanContext) => LoadPlan[];
}

/**
 * What each tab is made of, in the order its groups are shown, and which switch
 * hides which loads. This table is the whole mapping: the loads a switch leaves
 * out and the switches a tab answers to are both read from it.
 */
const TAB_PARTS: Record<FeedKind, readonly TabPart[]> = {
  trending: [
    {
      offSwitch: 'trends',
      // Worldwide has no rising searches: Google Trends needs a country.
      loads: (context) => (context.request.locality.countryCode ? [trendsLoad(context)] : []),
    },
    { offSwitch: 'wikipedia', loads: (context) => [wikipediaLoad(context)] },
    {
      // One switch for both networks: the page shows them as one group.
      offSwitch: 'social',
      loads: (context) => [
        socialLoad(context, context.engine.bluesky, BLUESKY_ATTRIBUTION),
        socialLoad(context, context.engine.mastodon, MASTODON_ATTRIBUTION),
      ],
    },
  ],
  news: [
    { loads: (context) => [newsLoad(context)] },
    // Module 10: the workspace's interests. No switch: an admin removes an interest instead.
    { loads: (context) => interestLoads(context) },
    {
      offSwitch: 'gdelt',
      loads: (context) => {
        const { gdelt } = context.engine;
        const country = context.request.locality.countryCode;
        return gdelt && country ? [gdeltLoad(context, gdelt, country)] : [];
      },
    },
  ],
  videos: [
    {
      offSwitch: 'videos',
      loads: (context) => {
        const { videos } = context.engine;
        const country = context.request.locality.countryCode;
        return videos && country ? [videosLoad(context, videos, country)] : [];
      },
    },
  ],
  festivals: [
    {
      offSwitch: 'festivals',
      loads: (context) => {
        const country = context.request.locality.countryCode;
        return country ? [festivalsLoad(context, country)] : [];
      },
    },
  ],
};

/** A kind nobody knows is made of nothing. */
function partsOf(kind: FeedKind): readonly TabPart[] {
  return TAB_PARTS[kind] ?? [];
}

/** The switches a tab answers to, in the order its groups are shown. News has only GDELT's. */
export function switchesOf(kind: FeedKind): DiscoverSourceSwitch[] {
  return partsOf(kind).flatMap((part) => part.offSwitch ?? []);
}

/**
 * The loads behind a request, in the order their groups are shown. None at all
 * means there is nothing to ask: videos with no key or no country, festivals with
 * no country, and a kind nobody knows.
 *
 * `hidden` names the switches that are off for whoever is asking. Their loads
 * are not planned at all, so nothing downstream can fetch, lock or count them.
 */
export function planLoads(
  engine: DiscoverEngine,
  keys: DiscoverKeys,
  request: FeedRequest,
  hidden: readonly DiscoverSourceSwitch[] = [],
): LoadPlan[] {
  const context: PlanContext = { engine, keys, request };

  return partsOf(request.kind)
    .filter((part) => !part.offSwitch || !hidden.includes(part.offSwitch))
    .flatMap((part) => part.loads(context));
}
