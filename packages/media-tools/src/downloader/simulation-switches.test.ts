/**
 * Module 20's forcing links (Sprint 12, section 2): links whose probe answers
 * like any sample, then one kind of fetch fails with a recorded yt-dlp line,
 * so a hand check can reach a state the samples never show.
 *
 * | Link                                  | Forces                                 |
 * |---------------------------------------|----------------------------------------|
 * | `https://www.twitch.tv/videos/900000009` | the sharp range is gone (`link_not_found`) |
 * | `https://www.twitch.tv/videos/900000010` | the import stops half way (`tool_failed`)  |
 * | `https://www.twitch.tv/videos/900000011` | a download's quality is gone (`format_gone`) |
 *
 * Only the fixture binding (bound under `CLIPS_SIMULATION=true`) reads the
 * links file; the worker's `simulation.security.test.ts` sends every link,
 * these included, to the real binding when simulation is off.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LinkRef } from '@postgear/video-engine';
import type { RunTool } from '../run/types';
import { recordedChatSource } from '../signals/chat';
import { createFixtureDownloader } from './fixture.downloader';
import { resolveSimulationLink, simulationLinks } from './simulation';
import { DownloaderError, type FetchProgress } from './types';

const twitch = (externalId: string): LinkRef => ({
  platform: 'twitch',
  kind: 'video',
  externalId,
  canonicalUrl: `https://www.twitch.tv/videos/${externalId}`,
});

const SHARP_GONE = twitch('900000009');
const HALF_WAY = twitch('900000010');
const QUALITY_GONE = twitch('900000011');
const ORDINARY = twitch('900000001');

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(DownloaderError);
  expect((error as DownloaderError).retryable).toBe(false);
  return (error as DownloaderError).code;
}

describe('the forcing links (CLIPS_SIMULATION)', () => {
  let dir: string;
  let samples: string;
  let tools: string[];
  const signal = new AbortController().signal;

  const runTool: RunTool = async (tool, args) => {
    tools.push(tool);
    await writeFile(args[args.length - 1] as string, Buffer.alloc(64, 1));
    return { exitCode: 0, stdout: '', stderrTail: '', durationMs: 1 };
  };
  const downloader = () =>
    createFixtureDownloader({ samplesDir: samples, runTool, stepDelayMs: 0 });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pg-switches-'));
    samples = path.join(dir, 'samples');
    await mkdir(samples);
    await writeFile(path.join(samples, 'talk.mp4'), Buffer.alloc(1000, 7));
    await writeFile(path.join(samples, 'stream.mp4'), Buffer.alloc(2000, 8));
    tools = [];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('are in the links file, each forcing exactly one kind of fetch', () => {
    const forced = simulationLinks().filter((entry) => entry.fetchErrors);
    expect(forced.map((entry) => [entry.externalId, Object.keys(entry.fetchErrors ?? {})])).toEqual(
      [
        ['900000009', ['range']],
        ['900000010', ['proxy']],
        ['900000011', ['format']],
      ],
    );
    // An ordinary link forces nothing.
    const plain = resolveSimulationLink(ORDINARY);
    expect(plain && plain.type === 'video' && plain.fetchErrors).toBeFalsy();
  });

  it('answer the probe like any sample, so the card and the import start as usual', async () => {
    for (const link of [SHARP_GONE, HALF_WAY, QUALITY_GONE]) {
      const info = await downloader().probe(link, signal);
      expect(info).toMatchObject({ externalId: link.externalId, live: false });
      expect(info.title).toMatch(/^PostGear Sample: /);
    }
  });

  it('900000009: the import works, then the sharp range is gone (the clip exports at 720p from the light copy)', async () => {
    const proxy = await downloader().fetchProxy(
      {
        link: SHARP_GONE,
        maxHeight: 720,
        outFile: path.join(dir, 'proxy.mp4'),
        maxBytes: 10_000,
        maxDurationMs: 3_600_000,
      },
      () => undefined,
      signal,
    );
    expect(proxy.bytes).toBe(2000);

    const range = downloader().fetchRange(
      {
        link: SHARP_GONE,
        fromMs: 10_000,
        toMs: 40_000,
        maxHeight: 1080,
        outFile: path.join(dir, 'range.mp4'),
      },
      () => undefined,
      signal,
    );
    expect(await codeOf(range)).toBe('link_not_found');
    expect(tools).toEqual([]);
  });

  it('900000010: the import gets half way, then stops with one code and no file', async () => {
    const seen: FetchProgress[] = [];
    const out = path.join(dir, 'proxy.mp4');
    const fetch = downloader().fetchProxy(
      { link: HALF_WAY, maxHeight: 720, outFile: out, maxBytes: 10_000, maxDurationMs: 3_600_000 },
      (progress) => seen.push(progress),
      signal,
    );
    expect(await codeOf(fetch)).toBe('tool_failed');
    const percents = seen.map((progress) => progress.percent ?? 0);
    expect(Math.max(...percents)).toBe(45);
    expect(percents.some((percent) => percent > 0 && percent < 45)).toBe(true);
    expect(tools).toEqual([]);
  });

  it('900000011: a quality the menu offered is gone by the time it is fetched', async () => {
    const info = await downloader().probe(QUALITY_GONE, signal);
    const formatId = info.formats[0]?.id as string;
    expect(formatId).toBeTruthy();
    const fetch = downloader().fetchFormat(
      { link: QUALITY_GONE, formatId, outFile: path.join(dir, 'file.mp4'), maxBytes: 10_000 },
      () => undefined,
      signal,
    );
    expect(await codeOf(fetch)).toBe('format_gone');
  });

  it('leave every other fetch of the same links alone', async () => {
    // The sharp-gone link still downloads, and the half-way link still cuts a range.
    const info = await downloader().probe(SHARP_GONE, signal);
    await expect(
      downloader().fetchFormat(
        {
          link: SHARP_GONE,
          formatId: info.formats[0]?.id as string,
          outFile: path.join(dir, 'file.mp4'),
          maxBytes: 10_000,
        },
        () => undefined,
        signal,
      ),
    ).resolves.toMatchObject({ bytes: 2000 });
    await expect(
      downloader().fetchRange(
        {
          link: HALF_WAY,
          fromMs: 10_000,
          toMs: 40_000,
          maxHeight: 1080,
          outFile: path.join(dir, 'r.mp4'),
        },
        () => undefined,
        signal,
      ),
    ).resolves.toMatchObject({ bytes: 64 });
  });
});

describe('"Twitch chat cannot be read" in simulation', () => {
  it('the forcing links are Twitch past streams with no recorded chat', async () => {
    const source = recordedChatSource();
    const request = {
      platform: 'twitch' as const,
      kind: 'past_stream' as const,
      durationMs: 600_000,
    };
    // A past stream with chat: the ordinary sample link.
    expect(
      (await source.messages({ ...request, externalId: ORDINARY.externalId }))?.length,
    ).toBeGreaterThan(0);
    // 900000009 and 900000011 import as usual, and their chat cannot be read,
    // so Find Clips works from sound and picture with no error shown.
    for (const link of [SHARP_GONE, QUALITY_GONE]) {
      expect(await source.messages({ ...request, externalId: link.externalId })).toBeNull();
    }
  });
});
