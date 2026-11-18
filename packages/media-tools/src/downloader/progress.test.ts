import {
  createFfmpegProgressHandler,
  createSpanReporter,
  createYtDlpProgressHandler,
  parseYtDlpProgressLine,
  ytDlpLinePercent,
} from './progress';
import type { FetchProgress } from './types';

describe('parseYtDlpProgressLine', () => {
  it('reads our template, with NA as unknown', () => {
    expect(parseYtDlpProgressLine('PG|downloading|1048576|4194304|NA|NA|NA|12')).toEqual({
      status: 'downloading',
      downloadedBytes: 1048576,
      totalBytes: 4194304,
      totalBytesEstimate: null,
      fragmentIndex: null,
      fragmentCount: null,
      etaSec: 12,
    });
    expect(parseYtDlpProgressLine('[download] Destination: media.mp4')).toBeNull();
    expect(parseYtDlpProgressLine('PG|bad status!|1|2|3|4|5|6')).toBeNull();
    expect(parseYtDlpProgressLine('PG|downloading|1')).toBeNull();
  });

  it('uses bytes, then the estimate, then fragments', () => {
    const line = (text: string) => ytDlpLinePercent(parseYtDlpProgressLine(text) ?? ({} as never));
    expect(line('PG|downloading|50|200|NA|NA|NA|NA')).toBe(25);
    expect(line('PG|downloading|50|NA|100.0|NA|NA|NA')).toBe(50);
    expect(line('PG|downloading|NA|NA|NA|30|120|NA')).toBe(25);
    expect(line('PG|downloading|NA|NA|NA|NA|NA|NA')).toBeNull();
    expect(line('PG|finished|NA|NA|NA|NA|NA|NA')).toBe(100);
  });
});

describe('createYtDlpProgressHandler', () => {
  it('fills the bar over two parts and never goes back', () => {
    const seen: FetchProgress[] = [];
    const handler = createYtDlpProgressHandler(
      2,
      createSpanReporter((p) => seen.push(p), { from: 0, to: 100 }),
    );
    handler('PG|downloading|50|100|NA|NA|NA|NA');
    handler('PG|finished|100|100|NA|NA|NA|NA');
    handler('PG|downloading|10|100|NA|NA|NA|NA');
    handler('PG|downloading|5|100|NA|NA|NA|NA');
    handler('PG|finished|100|100|NA|NA|NA|NA');
    expect(seen.map((p) => p.percent)).toEqual([25, 50, 55, 100]);
    expect(seen[0]?.bytes).toBe(50);
  });

  it('reports busy with no number only once and only before any number', () => {
    const seen: FetchProgress[] = [];
    const report = createSpanReporter((p) => seen.push(p), { from: 0, to: 80 });
    report(null);
    report(null);
    report(50);
    report(null);
    expect(seen).toEqual([{ percent: null }, { percent: 40 }]);
  });

  it('survives a progress callback that throws', () => {
    const report = createSpanReporter(
      () => {
        throw new Error('db down');
      },
      { from: 0, to: 100 },
    );
    expect(() => report(10)).not.toThrow();
  });
});

describe('createFfmpegProgressHandler', () => {
  it('reads out_time against the expected length', () => {
    const seen: Array<number | null> = [];
    const handler = createFfmpegProgressHandler(20_000, (p) => seen.push(p));
    handler('frame=10');
    handler('out_time_us=5000000');
    handler('out_time_ms=10000000');
    handler('progress=end');
    expect(seen).toEqual([25, 50, 100]);
  });
});
