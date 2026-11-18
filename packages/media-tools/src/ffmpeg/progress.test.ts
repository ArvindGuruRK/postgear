import { type FfmpegProgress, FfmpegProgressParser, mapPercent } from './progress';

/** A block as FFmpeg 9.0.2 prints it with `-progress pipe:1` (research 09, section 11). */
function block(
  outTimeUs: string,
  opts: { frame?: string; speed?: string; end?: boolean } = {},
): string[] {
  return [
    `frame=${opts.frame ?? '10'}`,
    'fps=30.00',
    'stream_0_0_q=28.0',
    'bitrate=N/A',
    'total_size=48',
    `out_time_us=${outTimeUs}`,
    // Holds microseconds too, despite its name: it must be ignored.
    `out_time_ms=${outTimeUs}`,
    'out_time=00:00:00.000000',
    'dup_frames=0',
    'drop_frames=0',
    `speed=${opts.speed ?? '1.28x'}`,
    `progress=${opts.end ? 'end' : 'continue'}`,
  ];
}

function feed(parser: FfmpegProgressParser, lines: string[]): FfmpegProgress[] {
  const out: FfmpegProgress[] = [];
  for (const line of lines) {
    const progress = parser.push(line);
    if (progress) out.push(progress);
  }
  return out;
}

describe('FfmpegProgressParser', () => {
  it('turns blocks into a percent of the known length', () => {
    const parser = new FfmpegProgressParser(20_000);
    const blocks = feed(parser, [...block('5000000'), ...block('10000000')]);
    expect(blocks.map((b) => b.percent)).toEqual([25, 50]);
    expect(blocks[1]).toMatchObject({ outTimeMs: 10_000, frame: 10, speed: 1.28, done: false });
  });

  it('never goes backwards when out_time_us does (the 96, 90, 93, 100 case)', () => {
    const parser = new FfmpegProgressParser(20_000);
    const percents = feed(parser, [
      ...block('19200000'),
      ...block('18000000'),
      ...block('18600000'),
      ...block('20000000', { end: true }),
    ]).map((b) => b.percent);
    expect(percents).toEqual([96, 96, 96, 100]);
  });

  it('ignores N/A and negative times and clamps to 0..100', () => {
    const parser = new FfmpegProgressParser(10_000);
    const blocks = feed(parser, [
      ...block('N/A', { speed: 'N/A', frame: 'N/A' }),
      ...block('-9223372036854775807'),
      ...block('99000000'),
    ]);
    expect(blocks[0]).toMatchObject({ percent: 0, speed: null, frame: null, etaSeconds: null });
    expect(blocks[1].percent).toBe(0);
    expect(blocks[2].percent).toBe(100);
  });

  it('reads speed with spaces and works out the time left', () => {
    const parser = new FfmpegProgressParser(20_000);
    const [progress] = feed(parser, block('10000000', { speed: '  2x' }));
    expect(progress.speed).toBe(2);
    expect(progress.etaSeconds).toBe(5);
  });

  it('marks the end and reports 100 even when the last time is a little short', () => {
    const progressSeen: number[] = [];
    const parser = new FfmpegProgressParser(20_000, (p) => progressSeen.push(p.percent));
    feed(parser, block('19984000', { end: true }));
    expect(parser.ended).toBe(true);
    expect(progressSeen).toEqual([100]);
    expect(parser.snapshot()).toMatchObject({ done: true, etaSeconds: 0 });
  });

  it('ignores lines that are not key=value', () => {
    const parser = new FfmpegProgressParser(1_000);
    expect(parser.push('')).toBeNull();
    expect(parser.push('garbage')).toBeNull();
    expect(parser.push('=x')).toBeNull();
  });

  it('answers 0 for an unknown length instead of dividing by zero', () => {
    const parser = new FfmpegProgressParser(0);
    const [progress] = feed(parser, block('5000000'));
    expect(progress.percent).toBe(0);
  });
});

describe('mapPercent', () => {
  it('maps into a stage window', () => {
    expect(mapPercent(0, 10, 90)).toBe(10);
    expect(mapPercent(50, 10, 90)).toBe(50);
    expect(mapPercent(100, 10, 90)).toBe(90);
    expect(mapPercent(150, 10, 90)).toBe(90);
  });
});
