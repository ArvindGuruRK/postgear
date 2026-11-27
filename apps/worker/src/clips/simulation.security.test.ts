/**
 * Security sweep, Simulation (Sprint 12, Module 20), the worker's half:
 *
 * - `CLIPS_SIMULATION=true` stops the worker at boot when NODE_ENV=production;
 * - with simulation off, the simulation links and the simulated channel are
 *   never answered from fixtures: they go to the real yt-dlp binding (a fake
 *   runner here, nothing is fetched) and come back as the platform's refusal.
 *
 * The forcing markers (`[simulate:highlights-fail]` and friends) are only
 * read under simulation: `highlights/highlights.run.test.ts` proves it.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  ChannelListerError,
  DownloaderError,
  type RunTool,
  simulationLinks,
  ToolError,
  type ToolPaths,
} from '@postgear/media-tools';
import { type LinkRef, recogniseLink, siteById } from '@postgear/video-engine';
import { loadWorkerEnv, type WorkerEnv } from '../config/env';
import { clipsSimulated } from './config';
import { createClipProviders } from './providers';

const base = {
  DATABASE_URL: 'postgresql://localhost/db',
  ENCRYPTION_KEY_AES256: 'cd'.repeat(32),
  AUTOMATION_INTERNAL_TOKEN: 'ab'.repeat(32),
};
const PRODUCTION = { NODE_ENV: 'production', CLIPS_URL_SECRET: 'u'.repeat(40) };
const REFUSAL = 'CLIPS_SIMULATION cannot be enabled in production';
const PATHS: ToolPaths = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytDlp: 'yt-dlp', jsRuntime: null };

function bootMessage(raw: Record<string, string>): string {
  try {
    loadWorkerEnv({ ...base, ...raw });
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('CLIPS_SIMULATION at boot', () => {
  it('stops the worker in production', () => {
    expect(bootMessage({ ...PRODUCTION, CLIPS_SIMULATION: 'true' })).toContain(REFUSAL);
  });

  it('boots production with simulation off, and development with it on', () => {
    expect(bootMessage({ ...PRODUCTION, CLIPS_SIMULATION: 'false' })).toBe('');
    expect(clipsSimulated(loadWorkerEnv({ ...base, ...PRODUCTION }))).toBe(false);
    expect(clipsSimulated(loadWorkerEnv({ ...base, CLIPS_SIMULATION: 'true' }))).toBe(true);
    // A blank value (how .env.example ships it) is off.
    expect(clipsSimulated(loadWorkerEnv({ ...base, CLIPS_SIMULATION: '' }))).toBe(false);
  });
});

describe('simulation links with simulation off', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), 'clips-sim-sweep-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  /** A runner that records each call and answers like the platform would for a made-up id. */
  function refusingRunner(stderrTail: string) {
    const calls: Array<{ tool: string; args: readonly string[] }> = [];
    const runTool: RunTool = async (tool, args) => {
      calls.push({ tool, args });
      throw new ToolError({ tool, exitCode: 1, stderrTail });
    };
    return { runTool, calls };
  }

  function providers(env: WorkerEnv, runTool: RunTool) {
    return createClipProviders({ env, runTool, paths: PATHS, scratchRoot: scratch });
  }

  function links(): LinkRef[] {
    return simulationLinks().map((entry) => {
      const ref = recogniseLink(entry.url);
      if (!('platform' in ref)) throw new Error(`${entry.url} is not a link Clips reads`);
      return ref;
    });
  }

  it('sends every one to the real binding, which refuses it, and never to the fixtures', async () => {
    const { runTool, calls } = refusingRunner('ERROR: [generic] Video unavailable');
    const live = providers(loadWorkerEnv({ ...base, ...PRODUCTION }), runTool);
    expect(live.simulated).toBe(false);
    expect(live.downloader.simulated).toBe(false);

    const every = links();
    expect(every.length).toBeGreaterThanOrEqual(18);
    // Module 12: a site with no yt-dlp reader (Threads) is refused before any tool starts.
    const unreadable = every.filter(
      (link) => (siteById(link.platform)?.extractors.length ?? 0) === 0,
    );
    for (const link of unreadable) {
      await expect(live.downloader.probe(link, new AbortController().signal)).rejects.toMatchObject(
        {
          code: 'tool_failed',
        },
      );
    }
    const all = every.filter((link) => !unreadable.includes(link));
    for (const link of all) {
      const outcome = await live.downloader.probe(link, new AbortController().signal).then(
        () => 'answered',
        (error: unknown) => error,
      );
      expect(outcome).toBeInstanceOf(DownloaderError);
      expect((outcome as DownloaderError).code).toBe('link_not_found');
    }
    // One yt-dlp call per link, each for that link's canonical address after `--`.
    expect(calls.map((call) => call.tool)).toEqual(all.map(() => 'yt-dlp'));
    expect(calls.map((call) => call.args.at(-1))).toEqual(all.map((link) => link.canonicalUrl));
  });

  it('answers the same links from the fixtures only under simulation, with no tool started', async () => {
    const { runTool, calls } = refusingRunner('');
    const simulated = providers(loadWorkerEnv({ ...base, CLIPS_SIMULATION: 'true' }), runTool);
    expect(simulated.downloader.simulated).toBe(true);
    const talk = links().find((link) => link.externalId === 'simtalk0001') as LinkRef;
    const info = await simulated.downloader.probe(talk, new AbortController().signal);
    expect(info.title).toMatch(/PostGear Sample/);
    expect(calls).toEqual([]);
  });

  it('asks the real lister for the simulated channel, which the platform does not know', async () => {
    const { runTool, calls } = refusingRunner('ERROR: [twitch:videos] simstreamer: does not exist');
    const live = providers(loadWorkerEnv({ ...base, ...PRODUCTION }), runTool);
    await expect(live.channelLister('twitch').resolve('simstreamer')).rejects.toBeInstanceOf(
      ChannelListerError,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool).toBe('yt-dlp');

    const simulated = providers(loadWorkerEnv({ ...base, CLIPS_SIMULATION: 'true' }), runTool);
    await expect(simulated.channelLister('twitch').resolve('simstreamer')).resolves.toMatchObject({
      platform: 'twitch',
    });
    expect(calls).toHaveLength(1);
  });
});
