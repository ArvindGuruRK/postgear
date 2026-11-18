/**
 * Range parsing and download headers for the files route.
 */
import { contentDispositionFor, parseRangeHeader, resolveRange, safeDownloadName } from './http';

describe('parseRangeHeader', () => {
  it('reads one closed, open or suffix range', () => {
    expect(parseRangeHeader('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRangeHeader('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRangeHeader('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRangeHeader('bytes=990-5000', 1000)).toEqual({ start: 990, end: 999 });
  });

  it('answers unsatisfiable past the end or backwards', () => {
    expect(parseRangeHeader('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=50-10', 1000)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=-0', 1000)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=0-', 0)).toBe('unsatisfiable');
  });

  it('ignores absent, malformed and multi-range headers (send the whole file)', () => {
    expect(parseRangeHeader(undefined, 1000)).toBeNull();
    expect(parseRangeHeader('items=0-1', 1000)).toBeNull();
    expect(parseRangeHeader('bytes=0-1,5-9', 1000)).toBeNull();
    expect(parseRangeHeader('bytes=-', 1000)).toBeNull();
  });
});

describe('resolveRange', () => {
  it('clamps the end and refuses a start outside the object', () => {
    expect(resolveRange({ start: 10 }, 20)).toEqual({ start: 10, end: 19 });
    expect(resolveRange({ start: 20 }, 20)).toBeNull();
    expect(resolveRange({ start: -1 }, 20)).toBeNull();
  });
});

describe('download names', () => {
  it('strip separators, quotes, control characters and leading dots', () => {
    expect(safeDownloadName('../../etc/"passwd"\r\n.mp4')).toBe('etc passwd .mp4');
    expect(safeDownloadName('...')).toBe('download');
    expect(safeDownloadName('a'.repeat(400))).toHaveLength(150);
  });

  it('give an ASCII fallback and the exact UTF-8 name', () => {
    expect(contentDispositionFor('Café Clip.mp4')).toBe(
      `attachment; filename="Caf_ Clip.mp4"; filename*=UTF-8''Caf%C3%A9%20Clip.mp4`,
    );
  });
});
