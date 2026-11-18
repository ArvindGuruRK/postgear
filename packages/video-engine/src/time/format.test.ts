import { formatClipLength, formatTimecode, formatVideoLength } from './format';

const S = 1_000;
const MIN = 60 * S;
const H = 60 * MIN;

describe('formatVideoLength', () => {
  it.each([
    [3 * H + 42 * MIN + 30 * S, '3 h 42 min'],
    [58 * MIN, '58 min'],
    [58 * MIN + 59 * S, '58 min'],
    [2 * H, '2 h'],
    [MIN, '1 min'],
    [42 * S, '42 s'],
    [42 * S + 999, '42 s'],
    [0, '0 s'],
    [-5_000, '0 s'],
    [Number.NaN, '0 s'],
    [Number.POSITIVE_INFINITY, '0 s'],
  ])('%p reads %p', (ms, expected) => {
    expect(formatVideoLength(ms)).toBe(expected);
  });
});

describe('formatClipLength', () => {
  it.each([
    [42 * S, '0:42'],
    [42 * S + 900, '0:42'],
    [12 * MIN + 5 * S, '12:05'],
    [H + 2 * MIN + 5 * S, '1:02:05'],
    [10 * H, '10:00:00'],
    [0, '0:00'],
    [-1, '0:00'],
  ])('%p reads %p', (ms, expected) => {
    expect(formatClipLength(ms)).toBe(expected);
  });
});

describe('formatTimecode', () => {
  it.each([
    [12_400, '0:12.4'],
    [12_499, '0:12.4'],
    [12_999, '0:12.9'],
    [0, '0:00.0'],
    [65_050, '1:05.0'],
    [H + 2 * MIN + 5 * S + 300, '1:02:05.3'],
    [Number.NaN, '0:00.0'],
  ])('%p reads %p', (ms, expected) => {
    expect(formatTimecode(ms)).toBe(expected);
  });
});
