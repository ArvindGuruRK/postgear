/**
 * Every Redis key Discover uses, in one place, because two rules live in them.
 *
 * ## Simulated and real answers never share a key
 *
 * The flag can change between two runs against the same Redis. Without its own
 * namespace, simulation would read a real copy, and worse, the real thing would
 * serve recorded headlines as today's for up to six hours.
 *
 * ## A place someone looked up is hashed
 *
 * The rule is that coordinates are never stored. A rounded position is hashed
 * before it becomes a key, and so is what a person typed, so neither can be read
 * off a key list. The key has no link to the person or the workspace either, which
 * is the part that matters most: the space of two-decimal positions is small enough
 * to walk, so the hash alone is pseudonymity, not secrecy.
 *
 * ## A feed key holds only what changes the outside answer
 *
 * Rising searches belong to a region, a Wikipedia list to an edition, the social
 * lists to nobody, videos to a country and festivals to a country and its region.
 * Nothing a person can make up (a language no place speaks, a city for a list that
 * has none) reaches a key, so it cannot be used to force a fetch.
 */
import { createHash } from 'node:crypto';
import type { SourceId } from '@postgear/discover-engine';

function hashed(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export interface FeedKeyParts {
  kind: string;
  country: string | null;
  region: string | null;
  city: string | null;
  language: string | null;
  topic: string | null;
}

/** The per-workspace counters. They hold no answer, so simulation has no reason to differ. */
export const workspaceKeys = {
  localityThrottle: (orgId: string) => `discover:locality:${orgId}`,
  feedMisses: (orgId: string) => `discover:feedmiss:${orgId}`,
  /** How often a workspace asks a stranger's website for its feeds (Module 07). */
  feedDiscovery: (orgId: string) => `discover:feedfind:${orgId}`,
  /** How often a workspace makes the server read a competitor it has no copy of (Module 07). */
  competitorReads: (orgId: string) => `discover:competitorread:${orgId}`,
};

export function discoverKeys(simulation: boolean) {
  const root = simulation ? 'discover:sim' : 'discover';

  return {
    /** A city is free text: lower-cased so spellings share a copy, encoded so it cannot add a field. */
    feed: ({ kind, country, region, city, language, topic }: FeedKeyParts) =>
      [
        `${root}:feed:v1:${kind}`,
        country ?? '-',
        region ?? '-',
        city ? encodeURIComponent(city.toLowerCase()) : '-',
        language ?? '-',
        topic ?? '-',
      ].join(':'),
    /** By edition and nothing else: not the place, and not the day, which the copy holds. */
    wikipedia: (project: string) => `${root}:feed:v1:wiki:${project}`,
    /** One copy for the whole world, per network. */
    social: (source: SourceId) => `${root}:feed:v1:social:${source}`,
    videos: (country: string) => `${root}:feed:v1:videos:${country}`,
    /** The region too: a state can have days off of its own. */
    festivals: (country: string, region: string | null) =>
      `${root}:feed:v1:festivals:${country}:${region ?? '-'}`,
    breaker: (source: SourceId) => `${root}:breaker:${source}`,
    /**
     * One competitor's items (Module 07). The id is a row's, so the copy is one
     * workspace's. `sources` is a hash of everything the items are read from:
     * edit a feed and the key moves, so an old copy can never answer for the new
     * list, and the new one has a lock of its own.
     */
    competitor: (id: string, sources: string) =>
      `${root}:competitor:${id}:${hashed(sources).slice(0, 16)}`,
    /**
     * A competitor's host that keeps failing rests like any source. Hashed: a
     * host is something a person typed, and a key list should not read as a
     * list of who follows whom.
     */
    hostBreaker: (host: string) => `${root}:breaker:host:${hashed(host).slice(0, 32)}`,
    geoReverse: (lat: number, lng: number) => `${root}:geo:rev:${hashed(`${lat}:${lng}`)}`,
    geoSearch: (normalisedQuery: string) => `${root}:geo:q:${hashed(normalisedQuery)}`,
    nominatimBudget: `${root}:budget:nominatim`,
    /** `day` is the date in the zone the quota resets in. The key that pays for the calls is never part of it. */
    youtubeBudget: (day: string) => `${root}:budget:youtube:${day}`,
  };
}

export type DiscoverKeys = ReturnType<typeof discoverKeys>;
