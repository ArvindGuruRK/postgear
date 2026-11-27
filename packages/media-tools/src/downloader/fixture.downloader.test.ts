import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LinkRef } from '@postgear/video-engine';
import type { RunTool, RunToolOptions, ToolName } from '../run/types';
import { createFixtureDownloader } from './fixture.downloader';
import { simulationLinks } from './simulation';
import { DownloaderError, type FetchProgress } from './types';

interface Call {
  tool: ToolName;
  args: readonly string[];
  options: RunToolOptions;
}

/** A fake FFmpeg: writes a small file at the output path and prints progress. Never runs anything. */
function fakeRunTool(calls: Call[]): RunTool {
  return async (tool, args, options) => {
    calls.push({ tool, args, options });
    if (options.signal?.aborted) throw new Error('aborted');
    options.onStdoutLine?.('out_time_us=1000000');
    options.onStdoutLine?.('progress=end');
    await writeFile(args[args.length - 1] as string, Buffer.alloc(64, 1));
    return { exitCode: 0, stdout: '', stderrTail: '', durationMs: 1 };
  };
}

const link = (
  platform: LinkRef['platform'],
  externalId: string,
  kind: LinkRef['kind'] = 'video',
): LinkRef => ({
  platform,
  kind,
  externalId,
  canonicalUrl:
    platform === 'youtube'
      ? `https://www.youtube.com/watch?v=${externalId}`
      : platform === 'twitch'
        ? `https://www.twitch.tv/videos/${externalId}`
        : `https://kick.com/simstreamer/videos/${externalId}`,
});

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DownloaderError);
  await promise.catch((error: DownloaderError) => expect(error.code).toBe(code));
}

describe('createFixtureDownloader', () => {
  let dir: string;
  let samples: string;
  let calls: Call[];
  const signal = new AbortController().signal;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pg-fixture-'));
    samples = path.join(dir, 'samples');
    await mkdir(samples);
    await writeFile(path.join(samples, 'talk.mp4'), Buffer.alloc(1000, 7));
    await writeFile(path.join(samples, 'stream.mp4'), Buffer.alloc(2000, 8));
    calls = [];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const downloader = () =>
    createFixtureDownloader({ samplesDir: samples, runTool: fakeRunTool(calls), stepDelayMs: 0 });

  it('is marked simulated', () => {
    expect(downloader().simulated).toBe(true);
  });

  it('probes each sample link through the real mapper', async () => {
    const talk = await downloader().probe(link('youtube', 'simtalk0001'), signal);
    expect(talk).toMatchObject({
      title: 'PostGear Sample: A Three Minute Talk',
      durationMs: 180_000,
      live: false,
    });
    const twitch = await downloader().probe(link('twitch', '900000001', 'past_stream'), signal);
    expect(twitch.durationMs).toBe(600_000);
    expect(twitch.formats.filter((f) => !f.audioOnly)).toHaveLength(3);
    expect(twitch.formats.some((f) => f.audioOnly)).toBe(true);
    const kick = await downloader().probe(
      link('kick', '00000000-0000-4000-8000-000000000001', 'past_stream'),
      signal,
    );
    expect(kick.durationMs).toBe(600_000);
    expect(calls).toHaveLength(0);
  });

  it('answers the refusal links with their codes, and anything else as not found', async () => {
    const d = downloader();
    for (const [platform, ids] of [
      [
        'youtube',
        {
          private: 'simprivate1',
          missing: 'simmissing1',
          resting: 'simresting1',
          live: 'simlivenow1',
          long: 'simtoolong1',
        },
      ],
      [
        'twitch',
        {
          private: '900000002',
          missing: '900000004',
          resting: '900000005',
          live: '900000003',
          long: '900000006',
        },
      ],
      [
        'kick',
        {
          private: '00000000-0000-4000-8000-000000000002',
          missing: '00000000-0000-4000-8000-000000000004',
          resting: '00000000-0000-4000-8000-000000000005',
          live: '00000000-0000-4000-8000-000000000003',
          long: '00000000-0000-4000-8000-000000000006',
        },
      ],
    ] as const) {
      await expectCode(d.probe(link(platform, ids.private), signal), 'link_private');
      await expectCode(d.probe(link(platform, ids.missing), signal), 'link_not_found');
      await expectCode(d.probe(link(platform, ids.resting), signal), 'platform_resting');
      expect((await d.probe(link(platform, ids.live), signal)).live).toBe(true);
      expect((await d.probe(link(platform, ids.long), signal)).durationMs).toBe(108_000_000);
    }
    await expectCode(d.probe(link('youtube', 'zzzzzzzzzzz'), signal), 'link_not_found');
  });

  it('every link in the links file has a known platform and answers', async () => {
    for (const entry of simulationLinks()) {
      const result = downloader().probe(link(entry.platform, entry.externalId), signal);
      if (entry.stderr) await expect(result).rejects.toBeInstanceOf(DownloaderError);
      else if (entry.refuses) await expect(result).rejects.toMatchObject({ code: entry.refuses });
      else await expect(result).resolves.toMatchObject({ externalId: entry.externalId });
    }
  });

  it('copies the whole sample for a proxy, with rising progress', async () => {
    const seen: FetchProgress[] = [];
    const out = path.join(dir, 'proxy.mp4');
    const file = await downloader().fetchProxy(
      {
        link: link('youtube', 'simtalk0001'),
        maxHeight: 720,
        outFile: out,
        maxBytes: 10_000,
        maxDurationMs: 600_000,
      },
      (p) => seen.push(p),
      signal,
    );
    expect(file).toEqual({ path: out, bytes: 1000 });
    expect(await readFile(out)).toEqual(Buffer.alloc(1000, 7));
    const numbers = seen.map((p) => p.percent ?? -1);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(numbers.at(-1)).toBe(100);
    expect(calls).toHaveLength(0);
  });

  it('refuses a proxy that is too long, live or too big, and leaves no file', async () => {
    const out = path.join(dir, 'proxy.mp4');
    const base = {
      maxHeight: 720 as const,
      outFile: out,
      maxBytes: 10_000,
      maxDurationMs: 6 * 3600_000,
    };
    await expectCode(
      downloader().fetchProxy(
        { ...base, link: link('youtube', 'simtoolong1') },
        () => undefined,
        signal,
      ),
      'clips_video_too_long',
    );
    await expectCode(
      downloader().fetchProxy(
        { ...base, link: link('twitch', '900000003') },
        () => undefined,
        signal,
      ),
      'link_live',
    );
    await expectCode(
      downloader().fetchProxy(
        { ...base, maxBytes: 10, link: link('youtube', 'simtalk0001') },
        () => undefined,
        signal,
      ),
      'too_big',
    );
    await expect(readFile(out)).rejects.toThrow();
  });

  it('cuts and normalises a range with FFmpeg through the RunTool', async () => {
    const out = path.join(dir, 'range.mp4');
    const file = await downloader().fetchRange(
      {
        link: link('twitch', '900000001'),
        fromMs: 50_000,
        toMs: 90_000,
        maxHeight: 1080,
        outFile: out,
      },
      () => undefined,
      signal,
    );
    expect(file.path).toBe(out);
    expect(calls).toHaveLength(1);
    const args = calls[0]?.args ?? [];
    expect(calls[0]?.tool).toBe('ffmpeg');
    expect(args[args.indexOf('-ss') + 1]).toBe('50.000000');
    expect(args[args.indexOf('-t') + 1]).toBe('40.000000');
    expect(args[args.indexOf('-i') + 1]).toBe(path.join(samples, 'stream.mp4'));
    expect(args).toEqual(
      expect.arrayContaining([
        '-fps_mode',
        'cfr',
        '-sc_threshold',
        '0',
        '-flags',
        '+cgop',
        '-r',
        '60',
        '-g',
        '120',
      ]),
    );
  });

  it('cuts a listed clip from the opening of the sample', async () => {
    const out = path.join(dir, 'clip.mp4');
    await downloader().fetchProxy(
      {
        link: {
          platform: 'twitch',
          kind: 'clip',
          externalId: 'SimAcmeClip01',
          canonicalUrl: 'https://clips.twitch.tv/SimAcmeClip01',
        },
        maxHeight: 720,
        outFile: out,
        maxBytes: 10_000,
        maxDurationMs: 3600_000,
      },
      () => undefined,
      signal,
    );
    const args = calls[0]?.args ?? [];
    expect(args[args.indexOf('-t') + 1]).toBe('28.000000');
    expect(args).toEqual(expect.arrayContaining(['-c', 'copy']));
  });

  it('fetches a format: audio through FFmpeg, an unknown id as format_gone', async () => {
    const out = path.join(dir, 'audio.m4a');
    await downloader().fetchFormat(
      { link: link('youtube', 'simtalk0001'), formatId: 'audio', outFile: out, maxBytes: 10_000 },
      () => undefined,
      signal,
    );
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['-vn', '-c:a', 'copy']));
    await expectCode(
      downloader().fetchFormat(
        { link: link('youtube', 'simtalk0001'), formatId: 'h4320', outFile: out, maxBytes: 10_000 },
        () => undefined,
        signal,
      ),
      'format_gone',
    );
  });

  it('says tool_failed (never a path) when the samples are missing', async () => {
    await rm(samples, { recursive: true, force: true });
    await expectCode(
      downloader().fetchProxy(
        {
          link: link('youtube', 'simtalk0001'),
          maxHeight: 720,
          outFile: path.join(dir, 'p.mp4'),
          maxBytes: 1e9,
          maxDurationMs: 1e9,
        },
        () => undefined,
        signal,
      ),
      'tool_failed',
    );
  });

  it('stops on abort', async () => {
    const controller = new AbortController();
    const slow = createFixtureDownloader({
      samplesDir: samples,
      runTool: fakeRunTool(calls),
      stepDelayMs: 50,
    });
    const promise = slow.fetchProxy(
      {
        link: link('youtube', 'simtalk0001'),
        maxHeight: 720,
        outFile: path.join(dir, 'p.mp4'),
        maxBytes: 1e9,
        maxDurationMs: 1e9,
      },
      () => undefined,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 60);
    await expectCode(promise, 'cancelled');
    await expect(readFile(path.join(dir, 'p.mp4'))).rejects.toThrow();
  });
});
