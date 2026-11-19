import {
  isFlat,
  median,
  normalise,
  prepareLoudness,
  rollingBaseline,
  shiftEarlier,
  smooth,
} from './normalise';
import { TUNING } from './tuning';

const of = (values: number[]) => Float64Array.from(values);

describe('median', () => {
  it('ignores no data', () => {
    expect(median([3, 1, Number.NaN, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([Number.NaN])).toBeNaN();
  });
});

describe('prepareLoudness', () => {
  it('clamps at the floor and turns a long silence into no data', () => {
    const floor = TUNING.loudnessFloorLufs;
    const long = TUNING.silenceGapSec * TUNING.rateHz;
    const values = of([-20, -120, -20, ...new Array(long).fill(-120), -20]);
    const out = prepareLoudness(values);
    expect(out[1]).toBe(floor); // a short silence stays, at the floor
    expect(out.slice(3, 3 + long).every((value) => Number.isNaN(value))).toBe(true);
    expect(out[out.length - 1]).toBe(-20);
  });
});

describe('smooth and shift', () => {
  it('averages around each sample, keeping no data as no data', () => {
    const out = smooth(of([0, 0, 6, 0, 0, Number.NaN]), 1);
    expect(Array.from(out.slice(0, 5))).toEqual([0, 2, 2, 2, 0]);
    expect(out[5]).toBeNaN();
  });

  it('moves a track earlier and leaves the end without data', () => {
    const out = shiftEarlier(of([1, 2, 3, 4, 5]), 1);
    expect(Array.from(out.slice(0, 3))).toEqual([3, 4, 5]);
    expect(out[3]).toBeNaN();
  });
});

describe('isFlat', () => {
  it('is flat when nothing moves past the floor, or there is no data', () => {
    expect(isFlat(of([-20, -20.5, -20.2]), 'loudness')).toBe(true);
    expect(isFlat(of([-20, -8]), 'loudness')).toBe(false);
    expect(isFlat(of([Number.NaN, Number.NaN]), 'scene')).toBe(true);
  });
});

describe('normalise', () => {
  it('scores a spike against the usual level and clamps', () => {
    const values = of([...new Array(40).fill(-20), -8, ...new Array(40).fill(-20)]);
    const { z, median: usual } = normalise(values, 'loudness');
    expect(usual[0]).toBe(-20);
    expect(z[0]).toBe(0);
    // (−8 − −20) / (1.4826 x 0 + 1 LU floor) = 12, clamped to 6.
    expect(z[40]).toBe(TUNING.zMax);
  });

  it('only counts rises', () => {
    const values = of([...new Array(20).fill(-20), -40, ...new Array(20).fill(-20)]);
    expect(normalise(values, 'loudness').z[20]).toBe(0);
  });

  it('follows a level that drifts on a long video', () => {
    const count = 30 * 60 * TUNING.rateHz;
    // Quiet for the first half, loud for the second.
    const values = of(Array.from({ length: count }, (_, i) => (i < count / 2 ? -30 : -10)));
    const { median: usual } = rollingBaseline(values);
    expect(usual[100]).toBeCloseTo(-30);
    expect(usual[count - 100]).toBeCloseTo(-10);
    // So the loud half is not "unusual" all the way through.
    expect(normalise(values, 'loudness').z[count - 100]).toBe(0);
  });
});
