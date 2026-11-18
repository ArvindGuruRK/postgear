import {
  nextHandover,
  outputAt,
  partAt,
  previewParts,
  runEnd,
  seekTargetAt,
  sourceAt,
} from './parts';
import { clipOf, part } from './testing';

describe('previewParts', () => {
  const parts = previewParts(
    clipOf([
      part('a', 10_000, 12_000),
      part('b', 12_000, 16_000, 2),
      part('c', 40_000, 42_000),
      part('d', 42_000, 43_000, 0.5),
      part('e', 90_000, 91_000),
    ]),
  );

  it('places each part and marks the ones that play on from the one before', () => {
    expect(parts.map((p) => [p.id, p.outStart, p.outEnd, p.continuesPrevious])).toEqual([
      ['a', 0, 2000, false],
      ['b', 2000, 4000, true],
      ['c', 4000, 6000, false],
      ['d', 6000, 8000, true],
      ['e', 8000, 9000, false],
    ]);
  });

  it('finds the run on one element and the next hand-over', () => {
    expect(runEnd(parts, 0)).toBe(1);
    expect(runEnd(parts, 1)).toBe(1);
    expect(nextHandover(parts, 0)).toBe(2);
    expect(nextHandover(parts, 2)).toBe(4);
    expect(nextHandover(parts, 4)).toBeNull();
  });

  it('maps both ways without rounding, held inside the part', () => {
    const b = parts[1];
    if (!b) throw new Error('no part b');
    expect(sourceAt(b, 3000)).toBe(14_000);
    expect(outputAt(b, 14_000)).toBe(3000);
    expect(outputAt(b, 13_001)).toBeCloseTo(2500.5, 6);
    expect(sourceAt(b, 99_999)).toBe(16_000);
    expect(outputAt(b, 5)).toBe(2000);
  });

  it('gives a cut to the part that starts there and the very end to the last part', () => {
    expect(partAt(parts, 1999)?.id).toBe('a');
    expect(partAt(parts, 2000)?.id).toBe('b');
    expect(partAt(parts, 9000)?.id).toBe('e');
    expect(partAt(parts, -5)?.id).toBe('a');
    expect(partAt([], 0)).toBeNull();
  });

  it('seeks one millisecond short of a part end, to show its last frame', () => {
    const e = parts[4];
    if (!e) throw new Error('no part e');
    expect(seekTargetAt(e, 9000)).toBe(90_999);
    expect(seekTargetAt(e, 8500)).toBe(90_500);
  });
});
