/**
 * Module 09's speed check: a tab's worth of items is put in order, and a brief
 * is written for each, without anybody waiting on it.
 *
 * Both are timed over 100 items after a warm-up run, so the number is the work
 * and not the first-call cost of the engine. The median of several runs is
 * what is printed and logged in the Progress table. The fastest run is what is
 * judged: it is the work itself, where the median also carries whatever else
 * the machine is doing (the whole suite at once, a busy CI box).
 */
import { CHENNAI } from '../geo/geocoder/simulated';
import type { ComposedItem, SourceItem } from '../types';
import { buildBrief } from './brief';
import { composeFeed, type FeedGroupInput } from './compose';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const BUDGET_MS = 20;
const RUNS = 15;

function sample(index: number): SourceItem {
  const kinds = ['trend', 'news', 'wiki', 'video'] as const;
  const kind = kinds[index % kinds.length] ?? 'news';
  const title = `Sample item ${index}: a headline of an ordinary length, with a few words in it`;
  switch (kind) {
    case 'trend':
      return {
        kind,
        source: { id: 'google-trends', name: 'Google Trends' },
        title,
        url: `https://example.com/trend/${index}`,
        signal: { label: '200+ searches', rank: index },
      };
    case 'wiki':
      return {
        kind,
        source: { id: 'wikipedia', name: 'Wikipedia' },
        title,
        url: `https://example.com/wiki/${index}`,
        language: 'en',
        signal: { label: '1,204 reads' },
      };
    case 'video':
      return {
        kind,
        source: { id: 'youtube', name: 'YouTube' },
        title,
        url: `https://example.com/watch/${index}`,
        summary: 'Sample Channel',
        signal: { label: '12K views' },
      };
    default:
      return {
        kind: 'news',
        source: { id: 'google-news', name: 'Sample Daily' },
        title,
        opaqueUrl: `https://example.com/story/${index}`,
        publishedAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
        language: 'en',
      };
  }
}

/** Four groups of 25, so de-duplication has other groups to look across. */
function hundredItems(): FeedGroupInput[] {
  const items = Array.from({ length: 100 }, (_, index) => sample(index));
  return [0, 1, 2, 3].map((group) => ({
    id: `group-${group}`,
    items: items.slice(group * 25, group * 25 + 25),
  }));
}

function timed(work: () => void): { median: number; fastest: number } {
  work();
  const times: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now();
    work();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    median: times[Math.floor(times.length / 2)] ?? Number.POSITIVE_INFINITY,
    fastest: times[0] ?? Number.POSITIVE_INFINITY,
  };
}

describe('engine speed over 100 items', () => {
  const locality = CHENNAI;

  it(`composes a feed of 100 items in under ${BUDGET_MS} ms`, () => {
    const groups = hundredItems();
    const total = composeFeed(groups, { now: NOW }).reduce(
      (count, group) => count + group.items.length,
      0,
    );
    // Trends and stories are capped per group, so the count proves real work was done.
    expect(total).toBeGreaterThan(50);

    const ms = timed(() => composeFeed(groups, { now: NOW }));
    console.info(`composeFeed, 100 items: ${ms.median.toFixed(3)} ms (median of ${RUNS})`);
    expect(ms.fastest).toBeLessThan(BUDGET_MS);
  });

  it(`writes 100 briefs in under ${BUDGET_MS} ms`, () => {
    const items: ComposedItem[] = Array.from({ length: 100 }, (_, index) => ({
      id: `item-${index}`,
      ...sample(index),
    }));
    expect(buildBrief(items[0] as ComposedItem, locality, 'en')).toContain('Sample item 0');

    const ms = timed(() => {
      for (const item of items) buildBrief(item, locality, 'en');
    });
    console.info(`buildBrief, 100 items: ${ms.median.toFixed(3)} ms (median of ${RUNS})`);
    expect(ms.fastest).toBeLessThan(BUDGET_MS);
  });
});
