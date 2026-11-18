import { FIXTURE_CHANNEL, fixtureStream } from '../clips-fixtures';
import {
  canonicalLinkOf,
  countLine,
  expiryLine,
  importable,
  listName,
  listsOf,
  streamFacts,
  updatedLine,
} from './channels-model';

const NOW = new Date('2026-11-18T10:00:00.000Z');
const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe('listName', () => {
  it("names each platform's lists", () => {
    expect(listName('youtube', 'uploads')).toBe('Videos');
    expect(listName('youtube', 'streams')).toBe('Streams');
    expect(listName('youtube', 'shorts')).toBe('Shorts');
    expect(listName('twitch', 'streams')).toBe('Streams');
    expect(listName('twitch', 'clips')).toBe('Clips');
    expect(listName('kick', 'clips')).toBe('Clips');
  });
});

describe('listsOf', () => {
  it("keeps the platform's order and only what the API offers", () => {
    expect(listsOf(FIXTURE_CHANNEL)).toEqual(['streams', 'clips']);
    expect(
      listsOf({
        platform: 'youtube',
        lists: [
          { kind: 'shorts', sorts: [], periods: [] },
          { kind: 'uploads', sorts: [], periods: [] },
        ],
      }),
    ).toEqual(['uploads', 'shorts']);
  });

  it("falls back on the engine's table when the API lists nothing", () => {
    expect(listsOf({ platform: 'youtube', lists: [] })).toEqual(['uploads', 'streams', 'shorts']);
  });
});

describe('streamFacts', () => {
  it('writes the date, the length and the views', () => {
    expect(streamFacts(fixtureStream())).toBe('14 Nov, 3 h 42 min, 12,408 views');
  });

  it('handles one view, short and missing lengths, and missing views', () => {
    const base = fixtureStream();
    expect(streamFacts({ ...base, durationSec: 3_600, viewCount: 1 })).toBe('14 Nov, 1 h, 1 view');
    expect(streamFacts({ ...base, durationSec: 45, viewCount: 0 })).toBe('14 Nov, 45 s, 0 views');
    expect(streamFacts({ ...base, durationSec: 600, viewCount: null })).toBe('14 Nov, 10 min');
    expect(streamFacts({ ...base, durationSec: null, viewCount: null })).toBe('14 Nov');
    expect(streamFacts({ ...base, publishedAt: 'never', durationSec: null, viewCount: 3 })).toBe(
      '3 views',
    );
  });
});

describe('expiryLine', () => {
  it('is nothing without a date', () => {
    expect(expiryLine(undefined, NOW)).toBeNull();
    expect(expiryLine('not a date', NOW)).toBeNull();
  });

  it('says soon once the time has passed', () => {
    expect(expiryLine(at(-HOUR), NOW)).toBe('Expires soon');
  });

  it('counts hours under a day and days after', () => {
    expect(expiryLine(at(20 * 60_000), NOW)).toBe('Expires in about an hour');
    expect(expiryLine(at(HOUR), NOW)).toBe('Expires in about an hour');
    expect(expiryLine(at(5 * HOUR), NOW)).toBe('Expires in about 5 hours');
    expect(expiryLine(at(30 * HOUR), NOW)).toBe('Expires in about a day');
    expect(expiryLine(at(3 * 24 * HOUR), NOW)).toBe('Expires in about 3 days');
  });
});

describe('updatedLine', () => {
  it('reads how old the list is', () => {
    expect(updatedLine(null, NOW)).toBeNull();
    expect(updatedLine('nope', NOW)).toBeNull();
    expect(updatedLine(at(-20_000), NOW)).toBe('Updated just now');
    expect(updatedLine(at(30_000), NOW)).toBe('Updated just now');
    expect(updatedLine(at(-60_000), NOW)).toBe('Updated 1 minute ago');
    expect(updatedLine(at(-4 * 60_000), NOW)).toBe('Updated 4 minutes ago');
    expect(updatedLine(at(-HOUR), NOW)).toBe('Updated 1 hour ago');
    expect(updatedLine(at(-3 * HOUR), NOW)).toBe('Updated 3 hours ago');
    expect(updatedLine(at(-24 * HOUR), NOW)).toBe('Updated 1 day ago');
    expect(updatedLine(at(-72 * HOUR), NOW)).toBe('Updated 3 days ago');
  });
});

describe('countLine', () => {
  it('is singular for one and plural otherwise', () => {
    expect(countLine(1, 'twitch', 'streams')).toBe('1 stream');
    expect(countLine(38, 'twitch', 'streams')).toBe('38 streams');
    expect(countLine(0, 'twitch', 'streams')).toBe('0 streams');
    expect(countLine(1, 'kick', 'clips')).toBe('1 clip');
    expect(countLine(1, 'youtube', 'uploads')).toBe('1 video');
    expect(countLine(12, 'youtube', 'uploads')).toBe('12 videos');
    expect(countLine(1, 'youtube', 'shorts')).toBe('1 short');
    expect(countLine(1_200, 'twitch', 'clips')).toBe('1,200 clips');
  });
});

describe('importable', () => {
  it('only a ready row can be imported', () => {
    expect(importable({ state: 'ready' })).toBe(true);
    expect(importable({ state: 'live' })).toBe(false);
    expect(importable({ state: 'processing' })).toBe(false);
    expect(importable({ state: 'upcoming' })).toBe(false);
  });
});

describe('canonicalLinkOf', () => {
  it("builds the row's canonical link for the probe", () => {
    expect(canonicalLinkOf('twitch', fixtureStream())).toBe(
      'https://www.twitch.tv/videos/1000000001',
    );
  });
});
