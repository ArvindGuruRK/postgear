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

/** The two per-workspace counters. They hold no answer, so simulation has no reason to differ. */
export const workspaceKeys = {
  localityThrottle: (orgId: string) => `discover:locality:${orgId}`,
  feedMisses: (orgId: string) => `discover:feedmiss:${orgId}`,
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
    breaker: (source: SourceId) => `${root}:breaker:${source}`,
    geoReverse: (lat: number, lng: number) => `${root}:geo:rev:${hashed(`${lat}:${lng}`)}`,
    geoSearch: (normalisedQuery: string) => `${root}:geo:q:${hashed(normalisedQuery)}`,
    nominatimBudget: `${root}:budget:nominatim`,
  };
}

export type DiscoverKeys = ReturnType<typeof discoverKeys>;
