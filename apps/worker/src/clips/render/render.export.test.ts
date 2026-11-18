/**
 * Module 15 in the render run: the mark, the check every file passes before
 * it is stored, a proof's low priority and its 24 hour PROOF row, and what
 * the job's output and the finish route carry.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { defaultWatermarkFile, loadWatermark, type WatermarkFile } from '@postgear/media-tools';
import { clipKeys } from '@postgear/storage';
import {
  createClipDocument,
  type RenderedFileFacts,
  type RenderInput,
  WATERMARK_WIDTH_FRACTION,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import {
  CLIP_ID,
  FakePrivateStorage,
  FakeRows,
  fakeProgress,
  JOB_ID,
  jobRow,
  ORG,
  sampleFacts,
  VIDEO_ID,
  videoRow,
} from '../testing/fakes';
import {
  PROOF_KEEP_MS,
  type RenderRun,
  renderExecute,
  renderFinish,
  renderPrepare,
  runRender,
} from './render.run';

const PROXY_KEY = 'clips/seed-demo-org/videos/proxy.mp4';
const NOW = new Date('2026-11-19T09:00:00Z');
const FINGERPRINT = 'f'.repeat(64);
const MEDIA_ID = '0d9c8b7a-6f5e-4d3c-8b2a-190817263544';

function input(overrides: Partial<RenderInput> = {}): RenderInput {
  return {
    clipId: CLIP_ID,
    videoId: VIDEO_ID,
    revision: 3,
    document: createClipDocument({ videoId: VIDEO_ID, fromMs: 0, toMs: 10_000, ratio: '9:16' }),
    quality: '720p',
    proof: false,
    watermark: false,
    name: 'Best Moment',
    fingerprint: FINGERPRINT,
    ...overrides,
  };
}

/** What a good 720p export of the 10 s document is. */
function goodFacts(overrides: Partial<RenderedFileFacts> = {}): RenderedFileFacts {
  return {
    durationMs: 10_000,
    width: 720,
    height: 1280,
    fps: 30,
    codec: 'h264',
    profile: 'High',
    pixFmt: 'yuv420p',
    keyframesMs: [0, 2_000, 4_000, 6_000, 8_000],
    moovFirst: true,
    bytes: 3,
    ...overrides,
  };
}

let dir: string;
let storage: FakePrivateStorage;
let rows: FakeRows;
let mark: WatermarkFile;

beforeAll(async () => {
  const file = defaultWatermarkFile();
  const loaded = file ? await loadWatermark(file) : null;
  if (!loaded) throw new Error('packages/media-tools/assets/watermark.png is missing');
  mark = loaded;
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'render-export-'));
  storage = new FakePrivateStorage();
  storage.objects.set(PROXY_KEY, Buffer.from('video bytes'));
  rows = new FakeRows();
  rows.videos.set(VIDEO_ID, videoRow({ status: 'READY' }));
  rows.assets.push({
    id: 'asset-proxy',
    kind: 'PROXY',
    key: PROXY_KEY,
    bytes: 11,
    videoId: VIDEO_ID,
    clipId: null,
    meta: {},
    createdAt: new Date('2026-11-18T10:00:00Z'),
  });
});

afterEach(() => rm(dir, { recursive: true, force: true }));

interface Seen {
  priorities: Array<[string, string | undefined]>;
  finishBodies: unknown[];
  outputs: unknown[];
  stored: string[];
  steps: string[];
}

function run(
  renderInput: RenderInput,
  options: { watermark?: WatermarkFile | null; facts?: RenderedFileFacts | null } = {},
): { run: RenderRun; seen: Seen } {
  const seen: Seen = { priorities: [], finishBodies: [], outputs: [], stored: [], steps: [] };
  const facts = options.facts === undefined ? goodFacts() : options.facts;
  const value: RenderRun = {
    job: jobRow({ kind: 'RENDER', clipId: CLIP_ID }),
    input: renderInput,
    dir,
    signal: new AbortController().signal,
    tools: {
      probe: async () => sampleFacts({ durationMs: 180_000 }),
      render: async ({ priority }) => {
        seen.priorities.push(['render', priority]);
        seen.steps.push('render');
        await writeFile(path.join(dir, 'render.mp4'), 'mp4');
        return { file: path.join(dir, 'render.mp4'), bytes: 3, elapsedMs: 10, stderrTail: '' };
      },
      poster: async ({ output }) => {
        await writeFile(output, 'jpg');
        return { file: output, bytes: 3 } as never;
      },
      measure: async ({ priority }) => {
        seen.priorities.push(['measure', priority]);
        return { inputI: -20, inputTp: -10, inputLra: 5, inputThresh: -30, targetOffset: 0.2 };
      },
      measureFile: async ({ priority }) => {
        seen.priorities.push(['measureFile', priority]);
        seen.steps.push('measureFile');
        return { inputI: -14.1, inputTp: -4.1, inputLra: 5, inputThresh: -24, targetOffset: 0 };
      },
      ...(facts
        ? {
            facts: async (_file: string, opts: { priority?: 'normal' | 'low' }) => {
              seen.priorities.push(['facts', opts.priority]);
              seen.steps.push('facts');
              return facts;
            },
          }
        : {}),
    },
    privateStorage: {
      getToFile: storage.getToFile.bind(storage),
      putFile: async (key: string, file: string) => {
        seen.stored.push(key);
        return storage.putFile(key, file);
      },
    } as unknown as RenderRun['privateStorage'],
    storage: {
      put: async (key: string) => {
        seen.stored.push(key);
      },
      delete: async () => undefined,
      read: async () => null,
    } as unknown as RenderRun['storage'],
    internal: {
      finishExport: async (_jobId: string, body: unknown) => {
        seen.finishBodies.push(body);
        return { mediaId: MEDIA_ID };
      },
    },
    rows,
    stickerRows: { librarySticker: async () => null, stickerAsset: async () => null },
    progress: {
      ...fakeProgress().progress,
      done: async (output: unknown) => {
        seen.outputs.push(output);
        return true;
      },
    },
    fonts: null,
    watermark: options.watermark === undefined ? mark : options.watermark,
    now: () => NOW,
    heartbeat: () => undefined,
  };
  return { run: value, seen };
}

describe('the mark (Module 15)', () => {
  it('plans the mark for a watermark: true job, copied in with its real size', async () => {
    const { run: job } = run(input({ watermark: true }));
    const plan = await renderPrepare(job);
    expect(plan.watermark).not.toBeNull();
    expect(plan.watermark).toMatchObject({ file: 'watermark.png', opacity: expect.any(Number) });
    // 18 percent of the 720 px frame, at the PNG's own aspect.
    expect(plan.watermark?.width).toBe(Math.round((WATERMARK_WIDTH_FRACTION * 720) / 2) * 2);
    const expectedHeight = ((plan.watermark?.width ?? 0) * mark.height) / mark.width;
    expect(Math.abs((plan.watermark?.height ?? 0) - expectedHeight)).toBeLessThanOrEqual(2);
    expect(existsSync(path.join(dir, 'watermark.png'))).toBe(true);
  });

  it('leaves the mark out, and copies nothing, when the plan does not ask for it', async () => {
    const plan = await renderPrepare(run(input({ watermark: false })).run);
    expect(plan.watermark).toBeNull();
    expect(existsSync(path.join(dir, 'watermark.png'))).toBe(false);
  });

  it('fails as the plan says when the worker has no mark to hand in', async () => {
    const error = await renderPrepare(
      run(input({ watermark: true }), { watermark: null }).run,
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'input_missing' });
  });
});

describe('the check before anything is stored', () => {
  it('passes a file that is what the plan asked for, then measures it', async () => {
    const { run: job, seen } = run(input());
    await renderExecute(job, await renderPrepare(job));
    expect(seen.steps).toEqual(['render', 'facts', 'measureFile']);
  });

  it('fails render_output_invalid, for good, and stores nothing when the file is wrong', async () => {
    const { run: job, seen } = run(input(), { facts: goodFacts({ moovFirst: false, width: 360 }) });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = await runRender(job).catch((e: unknown) => e);
    warn.mockRestore();
    expect(error).toBeInstanceOf(ClipStepError);
    expect((error as ClipStepError).code).toBe('render_output_invalid');
    expect((error as ClipStepError).retryable).toBe(false);
    expect(seen.steps).toEqual(['render', 'facts']);
    expect(seen.stored).toEqual([]);
    expect(seen.finishBodies).toEqual([]);
    expect(seen.outputs).toEqual([]);
  });
});

describe('a proof (Preview Export)', () => {
  it('runs every program below normal priority, and an export at normal', async () => {
    const proof = run(input({ proof: true }), { facts: goodFacts({ width: 360, height: 640 }) });
    await renderExecute(proof.run, await renderPrepare(proof.run));
    expect(proof.seen.priorities).toEqual([
      ['measure', 'low'],
      ['render', 'low'],
      ['facts', 'low'],
      ['measureFile', 'low'],
    ]);

    await rm(path.join(dir, 'render.mp4'), { force: true });
    const exported = run(input());
    await renderExecute(exported.run, await renderPrepare(exported.run));
    expect(exported.seen.priorities.every(([, priority]) => priority === undefined)).toBe(true);
  });

  it('is stored privately with a PROOF row kept 24 hours, and no Media row', async () => {
    const { run: job, seen } = run(input({ proof: true }), {
      facts: goodFacts({ width: 360, height: 640, profile: 'Constrained Baseline' }),
    });
    const outcome = await runRender(job);
    const proofKey = clipKeys.proofFile(ORG, JOB_ID, 'proof', 'mp4');
    expect(outcome).toMatchObject({ finished: true, mediaId: null, proofKey });
    expect(seen.stored).toEqual([proofKey]);
    expect(seen.finishBodies).toEqual([]);
    const proofRows = rows.assets.filter((asset) => asset.kind === 'PROOF');
    expect(proofRows).toHaveLength(1);
    expect(proofRows[0]).toMatchObject({
      key: proofKey,
      videoId: VIDEO_ID,
      clipId: CLIP_ID,
      bytes: 3,
      meta: {
        jobId: JOB_ID,
        expiresAt: new Date(NOW.getTime() + PROOF_KEEP_MS).toISOString(),
        width: 360,
        height: 640,
      },
    });
    expect(seen.outputs[0]).toMatchObject({
      mediaId: null,
      proofKey,
      durationMs: 10_000,
      width: 360,
      height: 640,
      fps: 30,
      bytes: 3,
    });
  });

  it('keeps one PROOF row when a retried job stores its file again', async () => {
    const first = run(input({ proof: true }), {
      facts: goodFacts({ width: 360, height: 640, profile: 'Main' }),
    });
    await runRender(first.run);
    const again = run(input({ proof: true }), {
      facts: goodFacts({ width: 360, height: 640, profile: 'Main' }),
    });
    await runRender(again.run);
    expect(rows.assets.filter((asset) => asset.kind === 'PROOF')).toHaveLength(1);
  });
});

describe('an export', () => {
  it('sends the fingerprint to the finish route and records the file in the output', async () => {
    const { run: job, seen } = run(input());
    const plan = await renderPrepare(job);
    const rendered = await renderExecute(job, plan);
    const outcome = await renderFinish(job, plan, rendered);
    expect(outcome).toMatchObject({ finished: true, mediaId: MEDIA_ID, proofKey: null });
    expect(seen.finishBodies[0]).toMatchObject({
      organizationId: ORG,
      clipId: CLIP_ID,
      revision: 3,
      width: 720,
      height: 1280,
      fps: 30,
      bytes: 3,
      fingerprint: FINGERPRINT,
    });
    expect(seen.outputs[0]).toMatchObject({
      mediaId: MEDIA_ID,
      proofKey: null,
      durationMs: 10_000,
      width: 720,
      height: 1280,
      fps: 30,
      bytes: 3,
      loudness: { mode: 'linear' },
    });
    expect(rows.assets.some((asset) => asset.kind === 'PROOF')).toBe(false);
  });

  it('sends a null fingerprint for a job started before fingerprints existed', async () => {
    const { run: job, seen } = run(input({ fingerprint: undefined }));
    await runRender(job);
    expect(seen.finishBodies[0]).toMatchObject({ fingerprint: null });
  });
});
