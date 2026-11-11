/**
 * Module 09, the timing check: how long a tab takes to answer, cold and cached.
 *
 * The real engine runs under simulation (every source reads its recorded file,
 * so nothing here reaches a network) with the real service, the real cache and
 * the real gate over a Redis stand-in. What is measured is our own work: the
 * parsing, the grouping and the cache. A live source's answer time is not ours
 * to promise and is not in these numbers.
 *
 * The limits are the sprint's: a cold tab under 3 seconds, a cached one under
 * 50 milliseconds. The numbers are printed, so a run says how much room is left.
 */
import { CHENNAI } from '@postgear/discover-engine';
import { DiscoverCache } from './discover.cache';
import { createDiscoverEngine } from './discover.engine';
import { DiscoverGate } from './discover.gate';
import { DiscoverService } from './discover.service';
import type { DiscoverSettingsRepository } from './settings.repository';
import { DiscoverSettingsService } from './settings.service';
import { FakeRedis } from './testing/fake-redis';

jest.setTimeout(120_000);

const ORG = 'org-timing';
const COLD_LIMIT_MS = 3_000;
const CACHED_LIMIT_MS = 50;
const CACHED_ROUNDS = 20;

function build() {
  const redis = new FakeRedis();
  const engine = createDiscoverEngine({
    DISCOVER_SIMULATION: 'true',
    DISCOVER_GEOCODER: 'off',
    DISCOVER_GEOCODER_USER_AGENT: 'PostGear/1.0 (test)',
    YOUTUBE_API_KEY: undefined,
  });
  const settings = { find: jest.fn(async () => null), upsert: jest.fn() };
  const service = new DiscoverService(
    engine,
    new DiscoverCache(redis.asService()),
    new DiscoverGate(4, 4_000),
    redis.asService(),
    new DiscoverSettingsService(settings as unknown as DiscoverSettingsRepository),
  );
  return { service, engine };
}

async function timed<T>(work: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = performance.now();
  const value = await work();
  return { ms: performance.now() - started, value };
}

describe('Discover timing, under simulation', () => {
  it('runs on the recorded feeds', () => {
    expect(build().engine.simulation).toBe(true);
  });

  it.each(['trending', 'news'] as const)(
    'answers %s for Chennai cold in under 3 s, and cached in under 50 ms',
    async (kind) => {
      // A first, throwaway service pays for loading the parsers, so "cold" below
      // means a cold cache and not a cold process.
      await build().service.feed('org-warm-up', { kind, locality: CHENNAI, language: 'ta' });

      const { service } = build();
      const request = { kind, locality: CHENNAI, language: 'ta' };

      const cold = await timed(() => service.feed(ORG, request));

      const cached: number[] = [];
      for (let round = 0; round < CACHED_ROUNDS; round += 1) {
        const again = await timed(() => service.feed(ORG, request));
        cached.push(again.ms);
        expect(JSON.stringify(again.value.groups)).toBe(JSON.stringify(cold.value.groups));
      }
      const slowest = Math.max(...cached);
      const middle = [...cached].sort((a, b) => a - b)[Math.floor(cached.length / 2)];

      console.info(
        `Discover timing, ${kind}, Chennai: cold ${cold.ms.toFixed(1)} ms, ` +
          `cached median ${middle.toFixed(2)} ms, cached slowest ${slowest.toFixed(2)} ms ` +
          `(${cold.value.groups.length} groups)`,
      );

      expect(cold.value.groups.length).toBeGreaterThan(0);
      expect(cold.ms).toBeLessThan(COLD_LIMIT_MS);
      expect(middle).toBeLessThan(CACHED_LIMIT_MS);
    },
  );
});
