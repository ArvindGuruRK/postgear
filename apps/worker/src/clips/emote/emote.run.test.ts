/**
 * The Emote Maker's activity (Sprint 13, Module 14) with real FFmpeg on the
 * local samples and on pictures drawn by lavfi. Nothing is fetched: the
 * private space is in memory and the files are on this machine.
 *
 * - Twitch: three GIFs under 512 KB and 60 frames, three stills under 25 KB,
 *   a zip of all six, stored under the job's exports folder.
 * - 7TV: the GIF, the WebP and the APNG, each read back and looping for ever.
 * - A green background removed: the corner is see-through, the middle is not.
 * - The crop lands where it was drawn, scaled from the light copy's frame to
 *   a sharp range that starts 10 seconds in, and Flip mirrors it.
 * - `[simulate:emote-too-big]` fails the job with the site-named sentence,
 *   keeps nothing and gives the download back (no FFmpeg needed).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  createRunTool,
  type MediaFacts,
  probeFile,
  type RunTool,
  type ToolPaths,
  toolPaths,
} from '@postgear/media-tools';
import { clipKeys } from '@postgear/storage';
import { type EmoteJobInput, emoteOutputSchema } from '@postgear/video-engine';
import { unzipSync } from 'fflate';
import { ClipStepError } from '../failures';
import { failJob, type OutcomeDeps } from '../job-outcomes';
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
import { readEmoteFacts } from './emote-facts';
import { EMOTE_TOO_BIG_MARKER, type EmoteRun, runEmote } from './emote.run';

const SAMPLES = path.resolve(__dirname, '../../../../../packages/media-tools/samples');
const PROXY_KEY = clipKeys.videoFile(ORG, VIDEO_ID, 'proxy', 'mp4');
const SEGMENT_KEY = clipKeys.videoFile(ORG, VIDEO_ID, 'segment-golden', 'mp4');

function findTool(program: string): boolean {
  if (path.isAbsolute(program)) return existsSync(program);
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return dirs.some((folder) => existsSync(path.join(folder, program)));
}

function safeToolPaths(): ToolPaths | null {
  try {
    const paths = toolPaths(process.env);
    return findTool(paths.ffmpeg) && findTool(paths.ffprobe) ? paths : null;
  } catch {
    return null;
  }
}

const PATHS = safeToolPaths();
const describeWithFfmpeg = PATHS ? describe : describe.skip;
if (!PATHS)
  console.warn('Emote tests with FFmpeg skipped: ffmpeg and ffprobe are not on the PATH.');

function emoteInput(overrides: Partial<EmoteJobInput> = {}): EmoteJobInput {
  return {
    videoId: VIDEO_ID,
    platform: 'twitch',
    startMs: 20_000,
    endMs: 23_000,
    crop: { x: 420, y: 0, size: 1080 },
    frame: { width: 1920, height: 1080 },
    key: null,
    flip: false,
    still: false,
    stillAtMs: null,
    ...overrides,
  };
}

function asset(kind: 'PROXY' | 'SEGMENT', key: string, meta: unknown = {}): AssetRow {
  return {
    id: `${kind === 'PROXY' ? 'a' : 'b'}0000000-0000-4000-8000-000000000000`,
    kind,
    key,
    bytes: 1,
    videoId: VIDEO_ID,
    clipId: null,
    meta,
    createdAt: new Date('2026-11-28T10:00:00Z'),
  };
}

function progress() {
  const stages: string[] = [];
  return {
    stages,
    progress: {
      async report(update: { stage: string; progress: number }) {
        if (stages.at(-1) !== update.stage) stages.push(update.stage);
      },
      async flush() {},
      done: jest.fn(async () => true),
    },
  };
}

const QUIET = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'];

describeWithFfmpeg('the emote export (real FFmpeg)', () => {
  jest.setTimeout(900_000);
  let root: string;
  let runTool: RunTool;
  let probe: EmoteRun['probe'];
  let verideck: Buffer;

  /** One RGBA pixel of a GIF's first frame. */
  async function pixel(file: Buffer, size: number, x: number, y: number) {
    const dir = mkdtempSync(path.join(root, 'px-'));
    writeFileSync(path.join(dir, 'in.gif'), file);
    await runTool(
      'ffmpeg',
      [
        ...QUIET,
        '-i',
        'in.gif',
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        'out.rgba',
      ],
      {
        cwd: dir,
        timeoutMs: 120_000,
      },
    );
    const raw = readFileSync(path.join(dir, 'out.rgba'));
    const at = (y * size + x) * 4;
    return {
      r: raw[at] as number,
      g: raw[at + 1] as number,
      b: raw[at + 2] as number,
      a: raw[at + 3] as number,
    };
  }

  async function ffprobeFrames(file: Buffer, name: string): Promise<number> {
    const dir = mkdtempSync(path.join(root, 'probe-'));
    writeFileSync(path.join(dir, name), file);
    const result = await runTool(
      'ffprobe',
      [
        '-v',
        'error',
        '-count_frames',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=nb_read_frames',
        '-of',
        'csv=p=0',
        name,
      ],
      { cwd: dir, timeoutMs: 120_000 },
    );
    return Number(result.stdout.trim());
  }

  async function lavfi(name: string, graph: string): Promise<Buffer> {
    await runTool(
      'ffmpeg',
      [
        ...QUIET,
        '-filter_complex',
        graph,
        '-t',
        '4',
        '-r',
        '30',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        name,
      ],
      { cwd: root, timeoutMs: 120_000 },
    );
    return readFileSync(path.join(root, name));
  }

  function setup(input: EmoteJobInput, assets: AssetRow[], objects: Record<string, Buffer>) {
    const rows = new FakeRows();
    rows.videos.set(VIDEO_ID, videoRow({ status: 'READY', durationMs: 60_000 }));
    rows.assets = assets;
    const storage = new FakePrivateStorage();
    for (const [key, body] of Object.entries(objects)) storage.objects.set(key, body);
    const dir = mkdtempSync(path.join(root, 'job-'));
    const made = progress();
    const run: EmoteRun = {
      job: jobRow({ kind: 'EMOTE', input }),
      input,
      dir,
      signal: new AbortController().signal,
      runTool,
      probe,
      privateStorage: storage,
      rows,
      progress: made.progress,
      heartbeat: () => undefined,
      simulated: true,
      attempt: 1,
    };
    return { run, storage, stages: made.stages, done: made.progress.done };
  }

  const stored = (storage: FakePrivateStorage, name: string, ext: string) =>
    storage.objects.get(clipKeys.exportFile(ORG, JOB_ID, name, ext as 'gif')) as Buffer;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'pg-emote-'));
    runTool = createRunTool(PATHS as ToolPaths);
    probe = (file, opts) => probeFile(runTool, file, opts);
    verideck = readFileSync(path.join(SAMPLES, 'verideck.mp4'));
  });
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('makes three Twitch GIFs under 512 KB and 60 frames, three stills under 25 KB, and a zip', async () => {
    const input = emoteInput({ still: true, stillAtMs: 21_000 });
    const { run, storage, stages, done } = setup(input, [asset('PROXY', PROXY_KEY)], {
      [PROXY_KEY]: verideck,
    });
    const outcome = await runEmote(run);
    expect(outcome.finished).toBe(true);
    const output = emoteOutputSchema.parse(outcome.output);
    expect(done).toHaveBeenCalledWith(output);
    expect(stages).toEqual(['fetching', 'encoding', 'finishing']);
    expect(output.sharp).toBe(false);
    expect(output.files.map((file) => file.name)).toEqual([
      'emote-twitch-112.gif',
      'emote-twitch-56.gif',
      'emote-twitch-28.gif',
      'emote-twitch-112.png',
      'emote-twitch-56.png',
      'emote-twitch-28.png',
    ]);
    for (const file of output.files) {
      expect(file.fits).toBe(true);
      const body = stored(storage, file.name.replace(/\.\w+$/, ''), file.format);
      expect(body.length).toBe(file.bytes);
      const facts = readEmoteFacts(body, file.format);
      expect(facts).toMatchObject({ width: file.size, height: file.size, frames: file.frames });
      if (file.format === 'gif') {
        expect(file.bytes).toBeLessThan(512_000);
        expect(file.frames).toBeLessThanOrEqual(60);
        expect(facts?.loops).toBe(0);
      } else {
        expect(file.bytes).toBeLessThan(25_000);
        expect(file.frames).toBe(1);
      }
    }
    // ffprobe counts the same frames our reader does.
    const gif112 = stored(storage, 'emote-twitch-112', 'gif');
    expect(await ffprobeFrames(gif112, 'emote.gif')).toBe(output.files[0]?.frames);
    console.log(
      JSON.stringify({
        emote: 'twitch',
        files: output.files.map((f) => [f.name, f.bytes, f.rung, f.frames]),
      }),
    );

    const zip = unzipSync(new Uint8Array(stored(storage, 'emote-twitch', 'zip')));
    expect(Object.keys(zip).sort()).toEqual(output.files.map((file) => file.name).sort());
    expect(Buffer.from(zip['emote-twitch-112.gif'] as Uint8Array).equals(gif112)).toBe(true);
    // Nothing outside the job's own exports folder.
    for (const key of storage.objects.keys()) {
      if (key === PROXY_KEY) continue;
      expect(key.startsWith(clipKeys.exportPrefix(ORG, JOB_ID))).toBe(true);
    }
  });

  it('makes the 7TV GIF, WebP and APNG, each read back and looping for ever', async () => {
    const input = emoteInput({ platform: 'sevenTv' });
    const { run, storage } = setup(input, [asset('PROXY', PROXY_KEY)], { [PROXY_KEY]: verideck });
    const outcome = await runEmote(run);
    const output = emoteOutputSchema.parse(outcome.output);
    expect(output.files.map((file) => [file.name, file.extra])).toEqual([
      ['emote-seventv-256.gif', false],
      ['emote-seventv-256.webp', true],
      ['emote-seventv-256.apng', true],
    ]);
    for (const file of output.files) {
      expect(file.fits).toBe(true);
      expect(file.bytes).toBeLessThan(7_000_000);
      expect(file.frames).toBeLessThanOrEqual(1_000);
      const facts = readEmoteFacts(
        stored(storage, file.name.replace(/\.\w+$/, ''), file.format),
        file.format,
      );
      expect(facts).toMatchObject({ width: 256, height: 256, loops: 0 });
      expect(facts?.frames).toBeGreaterThan(1);
    }
    const apng = stored(storage, 'emote-seventv-256', 'apng');
    expect(await ffprobeFrames(apng, 'emote.apng')).toBe(output.files[2]?.frames);
    console.log(
      JSON.stringify({
        emote: 'sevenTv',
        files: output.files.map((f) => [f.name, f.bytes, f.rung, f.frames]),
      }),
    );
  });

  it('removes a green background: the corner is see-through, the middle is not', async () => {
    const green = await lavfi(
      'green.mp4',
      'color=c=0x00b140:s=640x360:d=4[bg];testsrc2=s=120x120:d=4[fg];[bg][fg]overlay=260:120',
    );
    const input = emoteInput({
      startMs: 500,
      endMs: 3_500,
      frame: { width: 1280, height: 720 },
      crop: { x: 400, y: 120, size: 480 },
      key: { color: '#00b140', similarity: 0.3 },
    });
    const { run, storage } = setup(input, [asset('PROXY', PROXY_KEY)], { [PROXY_KEY]: green });
    const outcome = await runEmote(run);
    const output = emoteOutputSchema.parse(outcome.output);
    expect(output.files.every((file) => file.fits && file.frames <= 60)).toBe(true);
    const gif = stored(storage, 'emote-twitch-112', 'gif');
    expect((await pixel(gif, 112, 0, 0)).a).toBe(0);
    expect((await pixel(gif, 112, 56, 56)).a).toBe(255);
  });

  it('crops where it was drawn, scaled to a sharp range 10 seconds in, and Flip mirrors it', async () => {
    // Red on the left half, blue on the right, as a sharp range from 10 s to 14 s.
    const halves = await lavfi(
      'halves.mp4',
      'color=c=red:s=320x360:d=4[l];color=c=blue:s=320x360:d=4[r];[l][r]hstack=inputs=2',
    );
    // In the light copy's 1280 wide frame the split is at 640; the crop straddles it.
    const input = emoteInput({
      platform: 'bttv',
      startMs: 11_000,
      endMs: 12_000,
      frame: { width: 1280, height: 720 },
      crop: { x: 480, y: 200, size: 320 },
      flip: true,
    });
    const segment = asset('SEGMENT', SEGMENT_KEY, {
      fromMs: 10_000,
      toMs: 14_000,
      height: 360,
      fps: 30,
    });
    // The light copy is not in storage: picking it instead of the range would fail the run.
    const { run, storage } = setup(input, [asset('PROXY', PROXY_KEY), segment], {
      [SEGMENT_KEY]: halves,
    });
    const outcome = await runEmote(run);
    const output = emoteOutputSchema.parse(outcome.output);
    expect(output.sharp).toBe(true);
    // One second at 20 frames a second.
    expect(output.files[0]?.frames).toBe(20);
    const gif = stored(storage, 'emote-bttv-112', 'gif');
    const left = await pixel(gif, 112, 4, 56);
    const right = await pixel(gif, 112, 107, 56);
    // Flipped: blue on the left, red on the right.
    expect(left.b).toBeGreaterThan(180);
    expect(left.r).toBeLessThan(80);
    expect(right.r).toBeGreaterThan(180);
    expect(right.b).toBeLessThan(80);
  });
});

describe('the emote export (simulation and failure)', () => {
  it('[simulate:emote-too-big] fails with the site-named sentence, keeps nothing and gives the download back', async () => {
    const rows = new FakeRows();
    rows.videos.set(
      VIDEO_ID,
      videoRow({ status: 'READY', durationMs: 60_000, title: `Stream ${EMOTE_TOO_BIG_MARKER}` }),
    );
    rows.assets = [asset('PROXY', PROXY_KEY)];
    const input = emoteInput();
    rows.jobs.set(JOB_ID, jobRow({ kind: 'EMOTE', input, status: 'RUNNING' }));
    const storage = new FakePrivateStorage();
    storage.objects.set(PROXY_KEY, Buffer.from('a stand-in video'));
    const runTool = jest.fn();
    const dir = mkdtempSync(path.join(tmpdir(), 'pg-emote-sim-'));
    try {
      const made = progress();
      const run: EmoteRun = {
        job: jobRow({ kind: 'EMOTE', input }),
        input,
        dir,
        signal: new AbortController().signal,
        runTool: runTool as unknown as RunTool,
        probe: async () => ({ width: 1920, height: 1080 }) as MediaFacts,
        privateStorage: storage,
        rows,
        progress: made.progress,
        heartbeat: () => undefined,
        simulated: true,
        attempt: 1,
      };
      const failure = await runEmote(run).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ClipStepError);
      expect(failure).toMatchObject({ code: 'emote_too_big', retryable: false });
      // The ladder ran out without one encode, and nothing was stored.
      expect(runTool).not.toHaveBeenCalled();
      expect(made.progress.done).not.toHaveBeenCalled();
      expect([...storage.objects.keys()]).toEqual([PROXY_KEY]);

      const reverseCharges = jest.fn(async () => ({ reversed: 1 }));
      const deps: OutcomeDeps = {
        rows,
        privateStorage: storage,
        storage: { delete: async () => undefined },
        internal: { reverseCharges },
        now: () => new Date('2026-11-28T12:00:00Z'),
      };
      expect(
        await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'emote_too_big' }),
      ).toBe(true);
      expect(rows.closed[0]).toMatchObject({
        status: 'FAILED',
        error: {
          code: 'emote_too_big',
          message:
            'This emote is too big for Twitch at 112 px. Try a shorter stretch or a smaller crop.',
        },
      });
      expect(reverseCharges).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG });
      expect(storage.deleted).toContain(clipKeys.exportPrefix(ORG, JOB_ID));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads any other failure as emote_failed and still gives the download back', async () => {
    const rows = new FakeRows();
    rows.jobs.set(JOB_ID, jobRow({ kind: 'EMOTE', input: emoteInput(), status: 'RUNNING' }));
    const reverseCharges = jest.fn(async () => ({ reversed: 1 }));
    const deps: OutcomeDeps = {
      rows,
      privateStorage: new FakePrivateStorage(),
      storage: { delete: async () => undefined },
      internal: { reverseCharges },
    };
    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'tool_failed' });
    expect(rows.closed[0]?.error).toEqual({
      code: 'emote_failed',
      message: 'We could not make this emote. It was not counted. Try again.',
    });
    expect(reverseCharges).toHaveBeenCalledTimes(1);
  });

  it('reads nothing from a file that is not the format it claims', () => {
    expect(readEmoteFacts(Buffer.from('GIF89a not really'), 'gif')).toBeNull();
    expect(readEmoteFacts(Buffer.from('RIFF....WEBPVP8 '), 'webp')).toBeNull();
    expect(readEmoteFacts(Buffer.alloc(40), 'apng')).toBeNull();
  });
});
