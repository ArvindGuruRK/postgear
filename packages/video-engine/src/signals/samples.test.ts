/**
 * The generated samples' recorded tracks (`npm run clips:signals:record`,
 * measured with the real producers) against the moments planned into them.
 */
import { decodeSignalsFile } from './file';
import stream from './fixtures/stream.signals.json';
import talk from './fixtures/talk.signals.json';
import { findHighlights } from './score';

interface Fixture {
  moments: Array<{ startSec: number; endSec: number }>;
  signals: unknown;
}

function load(fixture: Fixture) {
  return decodeSignalsFile(JSON.stringify(fixture.signals));
}

describe('the recorded samples', () => {
  it("the stream sample's recorded tracks give its known moments, best first, the same every run", () => {
    const file = load(stream as Fixture);
    const result = findHighlights(file.tracks, { durationMs: file.durationMs });
    expect(result.used).toEqual(['loudness', 'scene', 'chat']);

    const moments = (stream as Fixture).moments;
    expect(result.ranges).toHaveLength(moments.length);
    for (const moment of moments) {
      const hit = result.ranges.filter(
        (range) => range.fromMs <= moment.startSec * 1000 && range.toMs >= moment.endSec * 1000,
      );
      expect(hit).toHaveLength(1);
    }
    for (const range of result.ranges) {
      expect(range.toMs - range.fromMs).toBeGreaterThanOrEqual(15_000);
      expect(range.toMs - range.fromMs).toBeLessThanOrEqual(60_000);
      expect(range.reasons.length).toBeGreaterThan(0);
      expect(range.reasons.length).toBeLessThanOrEqual(3);
    }
    const scores = result.ranges.map((range) => range.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(findHighlights(file.tracks, { durationMs: file.durationMs })).toEqual(result);
  });

  it('the talk sample gives few clips, each on a planned moment', () => {
    const file = load(talk as Fixture);
    const result = findHighlights(file.tracks, { durationMs: file.durationMs });
    expect(result.ranges.length).toBeLessThanOrEqual(3);
    const moments = (talk as Fixture).moments;
    for (const range of result.ranges) {
      expect(
        moments.some(
          (moment) =>
            range.fromMs <= moment.startSec * 1000 && range.toMs >= moment.startSec * 1000,
        ),
      ).toBe(true);
    }
  });
});
