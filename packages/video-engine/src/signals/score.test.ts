import { clipCap, findHighlights, highlightScore, MIN_HIGHLIGHT_SCORE } from './score';
import { binTrack, chatTrack, replayedTrack, TRACKS, trackSampleCount } from './tracks';
import { TUNING } from './tuning';
import type { SignalTrack, SignalTrackName } from './types';

/** A track on the grid from a function of the second. */
function track(
  name: SignalTrackName,
  durationSec: number,
  at: (sec: number) => number | null,
): SignalTrack {
  const count = trackSampleCount(durationSec * 1000);
  return {
    name,
    version: TRACKS[name].version,
    sampleRateHz: 2,
    startSec: 0,
    unit: TRACKS[name].unit,
    values: Array.from({ length: count }, (_, i) => at(i / 2)),
  };
}

/** A small, fixed ripple so nothing is perfectly flat (never random). */
const ripple = (sec: number) => Math.sin(sec * 1.7) * 0.4;

const inside = (sec: number, spans: ReadonlyArray<readonly [number, number]>) =>
  spans.some(([from, to]) => sec >= from && sec < to);

const LENGTH = 600;
const LOUD: ReadonlyArray<readonly [number, number]> = [
  [62, 66],
  [148, 152],
  [237, 241],
  [305, 309],
];
const CUTS = [40, 62, 100, 148, 190, 237, 270, 305, 350];

function loudness(spans = LOUD, length = LENGTH) {
  return track('loudness', length, (sec) => (inside(sec, spans) ? -8 : -20 + ripple(sec)));
}

function scene(length = LENGTH) {
  // Keyframes every 2 s, held between: a cut scores 60 at its keyframe, calm moments about 3.
  return binTrack(
    'scene',
    Array.from({ length: length / 2 }, (_, k) => {
      const sec = k * 2;
      return { sec, value: CUTS.includes(sec) ? 60 : 3 + ripple(sec) };
    }),
    length * 1000,
    { combine: 'max', empty: 'hold' },
  );
}

function chat(spans = LOUD, lagSec = 8, length = LENGTH) {
  const messages: Array<{ offsetMs: number }> = [];
  for (let ms = 1_000; ms < length * 1000; ms += 3_000) messages.push({ offsetMs: ms });
  for (const [from] of spans) {
    for (let ms = (from + lagSec) * 1000; ms < (from + lagSec + 15) * 1000; ms += 333) {
      messages.push({ offsetMs: ms });
    }
  }
  return chatTrack(messages, length * 1000);
}

const near = (ms: number, sec: number, within = 15) => Math.abs(ms / 1000 - sec) <= within;

describe('findHighlights', () => {
  it('finds the planted moments, best first, each 15 to 60 seconds, with reasons', () => {
    const result = findHighlights([loudness(), scene(), chat()], { durationMs: LENGTH * 1000 });
    expect(result.used).toEqual(['loudness', 'scene', 'chat']);
    expect(result.ranges).toHaveLength(LOUD.length);
    for (const range of result.ranges) {
      const length = range.toMs - range.fromMs;
      expect(length).toBeGreaterThanOrEqual(15_000);
      expect(length).toBeLessThanOrEqual(60_000);
      // Each clip holds one planted moment.
      expect(LOUD.some(([from]) => range.fromMs <= from * 1000 && range.toMs > from * 1000)).toBe(
        true,
      );
      expect(range.reasons).toContain('chat_burst');
      expect(range.reasons).toContain('loud');
      expect(range.reasons.length).toBeLessThanOrEqual(3);
      expect(range.score).toBeGreaterThanOrEqual(80);
    }
    const scores = result.ranges.map((range) => range.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('gives the same clips every time', () => {
    const tracks = [loudness(), scene(), chat()];
    const first = findHighlights(tracks, { durationMs: LENGTH * 1000 });
    const second = findHighlights(
      tracks.map((one) => ({ ...one, values: [...one.values] })),
      {
        durationMs: LENGTH * 1000,
      },
    );
    expect(second).toEqual(first);
  });

  it('lines chat up with the sound by moving it earlier', () => {
    // Chat alone, reacting 8 s after each moment: the peaks land on the moments, not 8 s late.
    const result = findHighlights([chat()], { durationMs: LENGTH * 1000 });
    expect(result.ranges.length).toBe(LOUD.length);
    for (const range of result.ranges) {
      const sec = range.peakMs / 1000;
      expect(LOUD.some(([from]) => sec >= from - 2 && sec < from + TUNING.chatLagSec - 2)).toBe(
        true,
      );
    }
  });

  it('works with any subset of tracks', () => {
    const soundOnly = findHighlights([loudness()], { durationMs: LENGTH * 1000 });
    expect(soundOnly.used).toEqual(['loudness']);
    expect(soundOnly.ranges.length).toBe(LOUD.length);
    expect(soundOnly.skipped).toEqual(
      expect.arrayContaining([
        { name: 'scene', reason: 'missing' },
        { name: 'chat', reason: 'missing' },
      ]),
    );

    // Cuts alone are a weak signal: too weak to pass the floor on their own here.
    const sceneOnly = findHighlights([scene()], { durationMs: LENGTH * 1000 });
    expect(sceneOnly.used).toEqual(['scene']);
    for (const range of sceneOnly.ranges) expect(range.reasons).toEqual(['fast_cuts']);
  });

  it('returns nothing for a flat video, and says why', () => {
    const flat = track('loudness', LENGTH, () => -20);
    const result = findHighlights([flat], { durationMs: LENGTH * 1000 });
    expect(result.ranges).toEqual([]);
    expect(result.used).toEqual([]);
    expect(result.skipped).toContainEqual({ name: 'loudness', reason: 'flat' });
  });

  it('returns nothing with no tracks, or a video shorter than a clip', () => {
    expect(findHighlights([], { durationMs: LENGTH * 1000 }).ranges).toEqual([]);
    expect(findHighlights([loudness([[2, 4]], 10)], { durationMs: 10_000 }).ranges).toEqual([]);
  });

  it('leaves out chat under the message floor', () => {
    const quiet = chatTrack([{ offsetMs: 10_000 }, { offsetMs: 70_000 }], LENGTH * 1000);
    const result = findHighlights([loudness(), quiet], { durationMs: LENGTH * 1000 });
    expect(result.used).toEqual(['loudness']);
    expect(result.skipped).toContainEqual({ name: 'chat', reason: 'too_few_messages' });
  });

  it('skips a track of an old version', () => {
    const old = { ...loudness(), version: TRACKS.loudness.version + 7 };
    const result = findHighlights([old], { durationMs: LENGTH * 1000 });
    expect(result.ranges).toEqual([]);
    expect(result.skipped).toContainEqual({ name: 'loudness', reason: 'unknown_version' });
  });

  it('snaps a start back to a nearby scene cut', () => {
    const result = findHighlights([loudness(), scene(), chat()], { durationMs: LENGTH * 1000 });
    const starts = result.ranges.map((range) => range.fromMs / 1000);
    // Every start is either a cut, or not within the snap distance after one.
    for (const start of starts) {
      const cutJustBefore = CUTS.some(
        (cut) => start - cut > 0 && start - cut <= TUNING.snapCutWithinSec,
      );
      expect(cutJustBefore).toBe(false);
    }
  });

  it('merges moments close enough to overlap into one clip', () => {
    // Two loud moments 10 s apart: one clip, not two.
    const spans: ReadonlyArray<readonly [number, number]> = [
      [200, 202],
      [212, 214],
    ];
    const result = findHighlights([loudness(spans)], { durationMs: LENGTH * 1000 });
    expect(result.ranges).toHaveLength(1);
    const [range] = result.ranges;
    expect(range?.fromMs).toBeLessThanOrEqual(200_000);
    expect(range?.toMs).toBeGreaterThan(212_000);
  });

  it('caps a long run of moments at the length rule and the gap between picks', () => {
    const many: Array<[number, number]> = [];
    for (let sec = 30; sec < LENGTH - 30; sec += 20) many.push([sec, sec + 2]);
    const result = findHighlights([loudness(many)], { durationMs: LENGTH * 1000 });
    expect(result.ranges.length).toBeLessThanOrEqual(clipCap(LENGTH * 1000));
    const peaks = result.ranges.map((range) => range.peakMs).sort((a, b) => a - b);
    for (let i = 1; i < peaks.length; i += 1) {
      expect((peaks[i] as number) - (peaks[i - 1] as number)).toBeGreaterThanOrEqual(
        TUNING.peakMinGapSec * 1000,
      );
    }
  });

  it('names a silence before a loud moment', () => {
    const spans: ReadonlyArray<readonly [number, number]> = [[300, 304]];
    const loudTrack = track('loudness', LENGTH, (sec) =>
      sec >= 296 && sec < 300 ? -45 : inside(sec, spans) ? -8 : -20 + ripple(sec),
    );
    const [range] = findHighlights([loudTrack], { durationMs: LENGTH * 1000 }).ranges;
    expect(range?.reasons).toEqual(expect.arrayContaining(['silence_then_noise', 'loud']));
  });

  it('reads the replayed curve on its own', () => {
    const replayed = replayedTrack(
      [
        { startMs: 0, endMs: 30_000, value: 0.2 },
        { startMs: 30_000, endMs: 36_000, value: 1 },
        { startMs: 36_000, endMs: 180_000, value: 0.25 },
      ],
      180_000,
    );
    const result = findHighlights([replayed as SignalTrack], { durationMs: 180_000 });
    expect(result.ranges).toHaveLength(1);
    expect(result.ranges[0]?.reasons).toEqual(['replayed']);
    expect(near(result.ranges[0]?.peakMs ?? 0, 33, 4)).toBe(true);
  });
});

describe('score and cap', () => {
  it('maps strength to 0 to 100', () => {
    expect(highlightScore(2)).toBe(55);
    expect(highlightScore(3)).toBe(70);
    expect(highlightScore(4)).toBe(80);
    expect(highlightScore(6)).toBe(91);
    expect(highlightScore(0)).toBe(0);
    expect(MIN_HIGHLIGHT_SCORE).toBe(55);
  });

  it('allows a few clips on a short video and at most 20 on a long one', () => {
    expect(clipCap(180_000)).toBe(TUNING.minClipsCap);
    expect(clipCap(600_000)).toBe(7);
    expect(clipCap(6 * 3_600_000)).toBe(20);
    expect(clipCap(6 * 3_600_000, 5)).toBe(5);
  });
});
