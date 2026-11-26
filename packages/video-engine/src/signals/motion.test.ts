import {
  actionWindow,
  burstStillMoments,
  isCurrentMotionTrack,
  MOTION_TUNING,
  mergeMotion,
  motionBursts,
  motionTrack,
  unmeasuredMotion,
} from './motion';
import type { SignalTrack } from './types';

const DURATION = 120_000;
const COUNT = 240;

/** A calm motion track with a little steady wobble, and `spans` (seconds) at `level`. */
function motion(spans: Array<[number, number, number]>, base = 3): SignalTrack {
  const values = Array.from({ length: COUNT }, (_, i) => base + ((i * 7) % 5) / 10);
  for (const [from, to, level] of spans) {
    for (let i = from * 2; i < to * 2; i += 1) values[i] = level;
  }
  return motionTrack(values);
}

/** A scene track: low, held above the cut score for 2 s after each cut. */
function scene(cuts: number[]): SignalTrack {
  const values = new Array<number>(COUNT).fill(0.3);
  for (const cut of cuts) for (let i = cut * 2; i < cut * 2 + 4; i += 1) values[i] = 31;
  return { name: 'scene', version: 1, sampleRateHz: 2, startSec: 0, unit: 'scene_score', values };
}

/** A loudness track at -40 LUFS, `-20` inside `spans` (seconds). */
function loudness(spans: Array<[number, number]>): SignalTrack {
  const values = new Array<number>(COUNT).fill(-40);
  for (const [from, to] of spans) for (let i = from * 2; i < to * 2; i += 1) values[i] = -20;
  return { name: 'loudness', version: 1, sampleRateHz: 2, startSec: 0, unit: 'lufs', values };
}

describe('motionBursts', () => {
  it('finds a burst of movement and gives it a window around its peak', () => {
    const bursts = motionBursts(motion([[50, 53, 35]]), scene([]), null, { durationMs: DURATION });
    expect(bursts).toHaveLength(1);
    expect(bursts[0]).toMatchObject({ fromMs: 50_000, toMs: 53_000, withSound: false });
    expect(bursts[0]?.score).toBeGreaterThan(MOTION_TUNING.keepFrom);
  });

  it('does not call a hard cut a burst', () => {
    // A one-sample spike where the scene track says cut.
    const track = motion([[40, 40.5, 72]]);
    expect(motionBursts(track, scene([40]), null, { durationMs: DURATION })).toEqual([]);
    // The same spike with no scene track would be too short to count either.
    expect(motionBursts(track, null, null, { durationMs: DURATION })).toEqual([]);
  });

  it('keeps the action after a cut, without the cut itself', () => {
    const bursts = motionBursts(
      motion([
        [62, 62.5, 72],
        [62.5, 66, 36],
      ]),
      scene([62]),
      null,
      {
        durationMs: DURATION,
      },
    );
    expect(bursts).toHaveLength(1);
    expect(bursts[0]?.fromMs).toBe(64_500);
  });

  it('scores a burst with rising sound above the same burst in silence', () => {
    const track = motion([[50, 53, 35]]);
    const quiet = motionBursts(track, scene([]), loudness([]), { durationMs: DURATION })[0];
    const loud = motionBursts(track, scene([]), loudness([[50, 54]]), { durationMs: DURATION })[0];
    expect(quiet?.withSound).toBe(false);
    expect(loud?.withSound).toBe(true);
    expect(loud?.score ?? 0).toBeGreaterThan(quiet?.score ?? 0);
  });

  it('keeps bursts apart, strongest first, and only inside the chosen stretch', () => {
    const track = motion([
      [20, 22, 12],
      [30, 32, 20],
      [80, 83, 16],
    ]);
    const all = motionBursts(track, scene([]), null, { durationMs: DURATION });
    expect(all.map((b) => b.fromMs)).toEqual([30_000, 80_000]);
    const inside = motionBursts(track, scene([]), null, {
      durationMs: DURATION,
      range: { fromMs: 60_000, toMs: 120_000 },
    });
    expect(inside.map((b) => b.fromMs)).toEqual([80_000]);
  });

  it('answers nothing with no motion track or an old one', () => {
    expect(motionBursts(null, scene([]), null, { durationMs: DURATION })).toEqual([]);
    const old = { ...motion([[50, 53, 35]]), version: 99 };
    expect(isCurrentMotionTrack(old)).toBe(false);
    expect(motionBursts(old, null, null, { durationMs: DURATION })).toEqual([]);
  });
});

describe('the motion track on file', () => {
  it('lays new values over the old ones and says what is still unmeasured', () => {
    const first = mergeMotion(
      null,
      [...new Array(40).fill(2), ...new Array(200).fill(null)],
      DURATION,
    );
    expect(unmeasuredMotion(first, { fromMs: 0, toMs: 20_000 }, DURATION)).toEqual([]);
    expect(unmeasuredMotion(first, { fromMs: 10_000, toMs: 40_000 }, DURATION)).toEqual([
      { fromMs: 20_000, toMs: 40_000 },
    ]);
    const second = mergeMotion(
      first,
      [...new Array(40).fill(null), ...new Array(40).fill(5)],
      DURATION,
    );
    expect(second.values[0]).toBe(2);
    expect(second.values[50]).toBe(5);
    expect(unmeasuredMotion(second, { fromMs: 0, toMs: 40_000 }, DURATION)).toEqual([]);
    expect(unmeasuredMotion(null, { fromMs: 0, toMs: 5_000 }, DURATION)).toEqual([
      { fromMs: 0, toMs: 5_000 },
    ]);
  });
});

describe('stills and windows for a burst', () => {
  const burst = {
    fromMs: 50_000,
    toMs: 53_000,
    peakMs: 51_000,
    strength: 6,
    withSound: false,
    score: 70,
  };

  it('picks four moments: before, the peak, after, two seconds after', () => {
    expect(burstStillMoments(burst, DURATION)).toEqual([49_500, 51_000, 53_500, 55_000]);
    expect(burstStillMoments({ ...burst, toMs: 119_000 }, DURATION).at(-1)).toBe(119_999);
  });

  it('builds a window with a lead-in, inside the stretch and the asked length', () => {
    expect(
      actionWindow(burst, { minMs: 15_000, maxMs: 60_000 }, { fromMs: 0, toMs: DURATION }),
    ).toEqual({ fromMs: 42_000, toMs: 59_000 });
    expect(
      actionWindow(burst, { minMs: 30_000, maxMs: 60_000 }, { fromMs: 0, toMs: DURATION }),
    ).toEqual({ fromMs: 42_000, toMs: 72_000 });
    expect(
      actionWindow(burst, { minMs: 8_000, maxMs: 10_000 }, { fromMs: 0, toMs: DURATION }),
    ).toEqual({ fromMs: 43_000, toMs: 53_000 });
    expect(
      actionWindow(burst, { minMs: 15_000, maxMs: 60_000 }, { fromMs: 45_000, toMs: 56_000 }),
    ).toEqual({ fromMs: 45_000, toMs: 56_000 });
  });
});
