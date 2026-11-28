/**
 * Security sweep, Sprint 13 Module 16: the Emote Maker on the worker.
 *
 * What must hold:
 * - FFmpeg runs as an argument array in the job's scratch folder, with the
 *   graph written to a file there and passed by name, never as a shell string;
 * - the source video is read only from the job's own workspace: a job whose
 *   input names another workspace's video fetches nothing and runs nothing;
 * - the scratch folder is gone after the job, on success and on failure;
 * - no watermark: the graph never draws the "Made with PostGear" mark.
 *
 * Existing tests this builds on: `emote.run.test.ts` "reads any other failure
 * as emote_failed and still gives the download back" (the reversal on
 * failure) and `packages/video-engine/src/emotes/emotes.test.ts` "seeks
 * inside a sharp range from its own start and passes the graph as a file".
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { MediaFacts, RunTool } from '@postgear/media-tools';
import { clipKeys } from '@postgear/storage';
import { EMOTE_GRAPH_FILE, type EmoteJobInput } from '@postgear/video-engine';
import { MockActivityEnvironment } from '@temporalio/testing';
import { createJobActivities } from '../activities/jobs.activities';
import type { ClipActivityDeps } from '../deps';
import { ClipStepError } from '../failures';
import type { AssetRow } from '../rows';
import {
  FakePrivateStorage,
  FakeRows,
  JOB_ID,
  jobRow,
  ORG,
  VIDEO_ID,
  videoRow,
} from '../testing/fakes';
import type { EmoteRun } from './emote.run';

// The activity's progress writes to the database; here it only says "running".
jest.mock('../job-progress', () => {
  const actual = jest.requireActual('../job-progress');
  return {
    ...actual,
    jobProgress: () => ({
      running: async () => undefined,
      report: async () => undefined,
      flush: async () => undefined,
      done: async () => true,
    }),
  };
});

// The activity's own step, so a test can make it pass or fail; the rest of this file runs the real one.
const mockEmote: { impl: ((run: EmoteRun) => Promise<unknown>) | null } = { impl: null };
jest.mock('./emote.run', () => {
  const actual = jest.requireActual('./emote.run');
  return {
    ...actual,
    runEmote: (run: EmoteRun) => (mockEmote.impl ?? actual.runEmote)(run),
  };
});

const { runEmote } = jest.requireActual('./emote.run') as typeof import('./emote.run');

const OTHER_ORG = 'other-org';

function emoteInput(overrides: Partial<EmoteJobInput> = {}): EmoteJobInput {
  return {
    videoId: VIDEO_ID,
    platform: 'twitch',
    startMs: 20_000,
    endMs: 23_000,
    crop: { x: 420, y: 0, size: 1080 },
    frame: { width: 1920, height: 1080 },
    key: { color: '#00ff00', similarity: 0.3 },
    flip: true,
    still: false,
    stillAtMs: null,
    ...overrides,
  };
}

function proxy(org = ORG): AssetRow {
  return {
    id: 'a0000000-0000-4000-8000-000000000000',
    kind: 'PROXY',
    key: clipKeys.videoFile(org, VIDEO_ID, 'proxy', 'mp4'),
    bytes: 1,
    videoId: VIDEO_ID,
    clipId: null,
    meta: {},
    createdAt: new Date('2026-11-28T10:00:00Z'),
  };
}

let root: string;
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'pg-emote-security-'));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
afterEach(() => {
  mockEmote.impl = null;
});

function runFor(
  rows: FakeRows,
  storage: FakePrivateStorage,
  runTool: RunTool,
  input: EmoteJobInput,
) {
  const dir = mkdtempSync(path.join(root, 'job-'));
  const run: EmoteRun = {
    job: jobRow({ kind: 'EMOTE', input }),
    input,
    dir,
    signal: new AbortController().signal,
    runTool,
    probe: async () => ({ width: 1920, height: 1080 }) as MediaFacts,
    privateStorage: storage,
    rows,
    progress: {
      report: async () => undefined,
      flush: async () => undefined,
      done: async () => true,
    },
    heartbeat: () => undefined,
    simulated: false,
    attempt: 1,
  };
  return { run, dir };
}

describe('the encoder', () => {
  it('runs FFmpeg as an argument array in the scratch folder, with the graph as a file there', async () => {
    const rows = new FakeRows();
    rows.videos.set(VIDEO_ID, videoRow({ status: 'READY', durationMs: 60_000 }));
    const ours = proxy();
    rows.assets = [ours];
    const storage = new FakePrivateStorage();
    storage.objects.set(ours.key, Buffer.from('a stand-in video'));
    const calls: Array<{ program: string; args: unknown; options: Record<string, unknown> }> = [];
    let graphAtRun = '';
    const runTool = jest.fn(
      async (program: string, args: unknown, options: Record<string, unknown>) => {
        calls.push({ program, args, options });
        graphAtRun = readFileSync(path.join(String(options.cwd), EMOTE_GRAPH_FILE), 'utf8');
        throw new Error('stop after the first encode');
      },
    );
    const { run, dir } = runFor(rows, storage, runTool as unknown as RunTool, emoteInput());

    const thrown = await runEmote(run).catch((error: unknown) => error);
    expect(thrown).toMatchObject({ code: 'emote_failed' });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.program).toBe('ffmpeg');
    // An array of plain strings, never one command line.
    expect(Array.isArray(call?.args)).toBe(true);
    const args = call?.args as string[];
    for (const arg of args) expect(typeof arg).toBe('string');
    // The graph is a file in the scratch folder, passed by its fixed name.
    expect(args[args.indexOf('-/filter_complex') + 1]).toBe(EMOTE_GRAPH_FILE);
    expect(args).not.toContain('-filter_complex');
    expect(args).not.toContain('-vf');
    expect(graphAtRun.length).toBeGreaterThan(0);
    expect(args.join(' ')).not.toContain(graphAtRun.trim().slice(0, 30));
    // Every file it names is a plain name in the scratch folder.
    expect(call?.options.cwd).toBe(dir);
    expect(call?.options.shell).toBeUndefined();
    for (const arg of args.filter((value) => /\.(?:mp4|gif|webp|apng|png|txt)$/.test(value))) {
      expect(path.basename(arg)).toBe(arg);
    }
    // No mark: an emote never carries the watermark.
    expect(graphAtRun).not.toMatch(/watermark|movie=/i);
    expect(args.join(' ')).not.toMatch(/watermark/i);
  });

  it("reads only the job's own workspace: another workspace's video is never fetched or encoded", async () => {
    const rows = new FakeRows();
    // The same id, but the video belongs to another workspace.
    rows.videos.set(
      VIDEO_ID,
      videoRow({ status: 'READY', durationMs: 60_000, organizationId: OTHER_ORG }),
    );
    const theirs = proxy(OTHER_ORG);
    rows.assets = [theirs];
    const storage = new FakePrivateStorage();
    storage.objects.set(theirs.key, Buffer.from('their video'));
    const fetched = jest.spyOn(storage, 'getToFile');
    const runTool = jest.fn();
    const { run, dir } = runFor(rows, storage, runTool as unknown as RunTool, emoteInput());

    const failure = await runEmote(run).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ClipStepError);
    expect(failure).toMatchObject({ code: 'emote_failed' });
    expect(fetched).not.toHaveBeenCalled();
    expect(runTool).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('the scratch folder', () => {
  function activities() {
    const rows = new FakeRows();
    rows.videos.set(VIDEO_ID, videoRow({ status: 'READY', durationMs: 60_000 }));
    rows.jobs.set(JOB_ID, jobRow({ kind: 'EMOTE', input: emoteInput(), status: 'QUEUED' }));
    const scratchRoot = mkdtempSync(path.join(root, 'scratch-'));
    const deps = {
      scratchRoot,
      runTool: jest.fn(),
      privateStorage: new FakePrivateStorage(),
      storage: { delete: async () => undefined },
      internal: { reverseCharges: async () => ({ reversed: 0 }) },
      providers: { simulated: true },
    } as unknown as ClipActivityDeps;
    return { scratchRoot, made: createJobActivities(deps, { rows }) };
  }

  /** The job's folder, while the step runs: it exists, under the scratch root, and gets a file. */
  function seeFolder(scratchRoot: string, seen: string[]) {
    return async (run: EmoteRun) => {
      seen.push(run.dir);
      expect(path.dirname(run.dir)).toBe(scratchRoot);
      expect(path.basename(run.dir)).toBe(`${JOB_ID}_1`);
      writeFileSync(path.join(run.dir, EMOTE_GRAPH_FILE), 'a graph');
      writeFileSync(path.join(run.dir, 'source.mp4'), 'a video');
    };
  }

  it('is removed after an export that worked', async () => {
    const { scratchRoot, made } = activities();
    const seen: string[] = [];
    mockEmote.impl = async (run) => {
      await seeFolder(scratchRoot, seen)(run);
      return { finished: true, output: null };
    };
    await expect(
      new MockActivityEnvironment().run(made.emoteExport, { jobId: JOB_ID, organizationId: ORG }),
    ).resolves.toEqual({ status: 'done' });
    expect(seen).toHaveLength(1);
    expect(existsSync(seen[0] as string)).toBe(false);
    expect(readdirSync(scratchRoot)).toEqual([]);
  });

  it('is removed after an export that failed', async () => {
    const { scratchRoot, made } = activities();
    const seen: string[] = [];
    mockEmote.impl = async (run) => {
      await seeFolder(scratchRoot, seen)(run);
      throw new ClipStepError('emote_failed', { retryable: true });
    };
    await expect(
      new MockActivityEnvironment().run(made.emoteExport, { jobId: JOB_ID, organizationId: ORG }),
    ).rejects.toBeDefined();
    expect(seen).toHaveLength(1);
    expect(existsSync(seen[0] as string)).toBe(false);
    expect(readdirSync(scratchRoot)).toEqual([]);
  });
});
