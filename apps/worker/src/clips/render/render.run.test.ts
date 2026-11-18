import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { FontsFolder } from '@postgear/media-tools';
import {
  copyTextStyle,
  createClipDocument,
  defaultStickerItem,
  FONT_MANIFEST,
  type RenderInput,
  type StickerItem,
  type TextItem,
  textStylePreset,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import {
  CLIP_ID,
  FakePrivateStorage,
  FakeRows,
  fakeProgress,
  jobRow,
  sampleFacts,
  VIDEO_ID,
  videoRow,
} from '../testing/fakes';
import type { StickerAssetRow } from '../stickers/check';
import type { LibraryStickerFile, StickerFileRows } from '../stickers/rows';
import { type RenderRun, renderExecute, renderPrepare } from './render.run';

const PROXY_KEY = 'clips/seed-demo-org/videos/proxy.mp4';

function text(overrides: Partial<TextItem> = {}): TextItem {
  return {
    id: 'txt_a',
    type: 'text',
    start: 0,
    duration: 2_000,
    anchor: 'moment',
    text: 'Hello there',
    style: copyTextStyle(textStylePreset('bold-outline').style),
    transform: { x: 0.5, y: 0.2, scale: 1, rotation: 0, opacity: 1 },
    widthPx: 864,
    fadeInMs: 0,
    fadeOutMs: 0,
    ...overrides,
  };
}

const LIBRARY_ID = '6a1f0c3e-2b4d-4e5f-8a9b-0c1d2e3f4a5b';
const UPLOAD_ID = '7b2e1d4f-3c5e-4f60-9bac-1d2e3f4a5b6c';
const LIBRARY_KEY = 'library/stickers/ab/abc.png';
const UPLOAD_KEY = 'clips/seed-demo-org/library/0123456789abcdef.apng';

/** The library rows and upload assets a test's stickers come from. */
class FakeStickerRows implements StickerFileRows {
  library = new Map<string, LibraryStickerFile>();
  assets = new Map<string, StickerAssetRow>();
  async librarySticker(id: string) {
    return this.library.get(id) ?? null;
  }
  async stickerAsset(organizationId: string, id: string) {
    const row = this.assets.get(id);
    return row && row.organizationId === organizationId ? row : null;
  }
}

function input(texts: Array<TextItem | StickerItem>): RenderInput {
  const document = createClipDocument({
    videoId: VIDEO_ID,
    fromMs: 0,
    toMs: 10_000,
    ratio: '9:16',
  });
  return {
    clipId: CLIP_ID,
    videoId: VIDEO_ID,
    revision: 1,
    document: texts.length
      ? { ...document, tracks: [{ id: 'trk_text', kind: 'overlay', items: texts }] }
      : document,
    quality: '720p',
    proof: false,
    watermark: false,
    name: 'Best Moment',
  };
}

describe('renderPrepare with text', () => {
  let dir: string;
  let fontsDir: string;
  let fonts: FontsFolder;
  let storage: FakePrivateStorage;
  let rows: FakeRows;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'render-run-'));
    fontsDir = await mkdtemp(path.join(tmpdir(), 'render-fonts-'));
    await writeFile(path.join(fontsDir, 'manifest.json'), JSON.stringify(FONT_MANIFEST));
    await writeFile(path.join(fontsDir, 'montserrat-800.ttf'), 'twin bytes');
    fonts = { dir: fontsDir, manifest: FONT_MANIFEST };
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

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(fontsDir, { recursive: true, force: true });
  });

  function run(renderInput: RenderInput, folder: FontsFolder | null): RenderRun {
    return {
      job: jobRow({ kind: 'RENDER', clipId: CLIP_ID }),
      input: renderInput,
      dir,
      signal: new AbortController().signal,
      tools: {
        probe: async () => sampleFacts({ durationMs: 180_000 }),
        render: async () => {
          throw new Error('not used');
        },
        poster: async () => {
          throw new Error('not used');
        },
      },
      privateStorage: storage as unknown as RenderRun['privateStorage'],
      storage: {
        put: async () => undefined,
        delete: async () => undefined,
        read: async () => null,
      } as unknown as RenderRun['storage'],
      internal: {} as RenderRun['internal'],
      rows,
      stickerRows: new FakeStickerRows(),
      progress: { ...fakeProgress().progress, done: async () => true },
      fonts: folder,
      heartbeat: () => undefined,
    };
  }

  it('copies only the twins the text uses into the job fonts folder', async () => {
    const plan = await renderPrepare(run(input([text()]), fonts));
    expect(plan.texts).toHaveLength(1);
    expect(plan.fonts).toMatchObject({ dir: 'fonts', files: ['montserrat-800.ttf'] });
    expect(await readFile(path.join(dir, 'fonts', 'montserrat-800.ttf'), 'utf8')).toBe(
      'twin bytes',
    );
  });

  it('fails font_missing before downloading anything when the fonts folder was never built', async () => {
    const error = await renderPrepare(run(input([text()]), null)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClipStepError);
    expect((error as ClipStepError).code).toBe('font_missing');
    expect(existsSync(path.join(dir, 'source-0.mp4'))).toBe(false);
  });

  it('fails font_missing when a twin the plan names is not in the folder', async () => {
    const anton = text({ style: { ...text().style, font: 'Anton', weight: 400 } });
    const error = await renderPrepare(run(input([anton]), fonts)).catch((e: unknown) => e);
    expect((error as ClipStepError).code).toBe('font_missing');
  });

  it('needs no fonts folder for a clip without text', async () => {
    const plan = await renderPrepare(run(input([]), null));
    expect(plan.texts).toEqual([]);
    expect(existsSync(path.join(dir, 'fonts'))).toBe(false);
  });
});

describe('renderPrepare with stickers', () => {
  let dir: string;
  let storage: FakePrivateStorage;
  let rows: FakeRows;
  let stickerRows: FakeStickerRows;
  let publicFiles: Map<string, Buffer>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'render-stickers-'));
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
    stickerRows = new FakeStickerRows();
    publicFiles = new Map();
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  function run(renderInput: RenderInput): RenderRun {
    return {
      job: jobRow({ kind: 'RENDER', clipId: CLIP_ID }),
      input: renderInput,
      dir,
      signal: new AbortController().signal,
      tools: {
        probe: async () => sampleFacts({ durationMs: 180_000 }),
        render: async () => {
          throw new Error('not used');
        },
        poster: async () => {
          throw new Error('not used');
        },
      },
      privateStorage: storage as unknown as RenderRun['privateStorage'],
      storage: {
        put: async () => undefined,
        delete: async () => undefined,
        read: async (key: string) => publicFiles.get(key) ?? null,
      } as unknown as RenderRun['storage'],
      internal: {} as RenderRun['internal'],
      rows,
      stickerRows,
      progress: { ...fakeProgress().progress, done: async () => true },
      fonts: null,
      heartbeat: () => undefined,
    };
  }

  const doc = () => input([]).document;
  const librarySticker = (id: string, atMs = 0) =>
    defaultStickerItem(doc(), atMs, { library: 'sticker', id: LIBRARY_ID }, { width: 200, height: 100 }, id);
  const uploadSticker = (id: string, atMs = 0) =>
    defaultStickerItem(doc(), atMs, { asset: UPLOAD_ID }, { width: 100, height: 100 }, id);

  function readyUpload(organizationId = 'seed-demo-org'): StickerAssetRow {
    return {
      id: UPLOAD_ID,
      organizationId,
      key: UPLOAD_KEY,
      meta: {
        status: 'ready',
        name: 'Wave',
        animated: true,
        width: 100,
        height: 100,
        fps: 12,
        frames: 18,
        durationMs: 1_500,
        previewKey: 'clips/seed-demo-org/library/fedcba9876543210.webp',
      },
    };
  }

  it('fetches each library sticker and ready upload once, and plans them with their facts', async () => {
    stickerRows.library.set(LIBRARY_ID, {
      fileKey: LIBRARY_KEY,
      animated: false,
      width: 200,
      height: 100,
      fps: null,
      frames: null,
    });
    publicFiles.set(LIBRARY_KEY, Buffer.from('still png'));
    stickerRows.assets.set(UPLOAD_ID, readyUpload());
    storage.objects.set(UPLOAD_KEY, Buffer.from('moving apng'));

    const plan = await renderPrepare(
      run(input([librarySticker('stk_lib'), uploadSticker('stk_up', 1_000), librarySticker('stk_lib2', 4_000)])),
    );
    expect(plan.stickers.map((s) => [s.id, s.file, s.animated, s.fps, s.frames])).toEqual([
      ['stk_lib', 'sticker-0.png', false, null, null],
      ['stk_up', 'sticker-1.apng', true, 12, 18],
      ['stk_lib2', 'sticker-0.png', false, null, null],
    ]);
    expect(await readFile(path.join(dir, 'sticker-0.png'), 'utf8')).toBe('still png');
    expect(await readFile(path.join(dir, 'sticker-1.apng'), 'utf8')).toBe('moving apng');
  });

  it('stops with sticker_missing for a sticker removed from the library', async () => {
    const error = await renderPrepare(run(input([librarySticker('stk_gone')]))).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'sticker_missing' });
  });

  it('stops with sticker_missing for an upload still being checked, or one from another workspace', async () => {
    stickerRows.assets.set(UPLOAD_ID, { ...readyUpload(), meta: { status: 'checking', name: 'Wave' } });
    expect(await renderPrepare(run(input([uploadSticker('stk_up')]))).catch((e: unknown) => e)).toMatchObject({
      code: 'sticker_missing',
    });
    stickerRows.assets.set(UPLOAD_ID, readyUpload('someone-else'));
    storage.objects.set(UPLOAD_KEY, Buffer.from('moving apng'));
    expect(await renderPrepare(run(input([uploadSticker('stk_up')]))).catch((e: unknown) => e)).toMatchObject({
      code: 'sticker_missing',
    });
  });
});

describe('renderExecute and the loudness passes (Module 14)', () => {
  let dir: string;
  let storage: FakePrivateStorage;
  let rows: FakeRows;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'render-loudness-'));
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

  const LOUD = { inputI: -20, inputTp: -10, inputLra: 5, inputThresh: -30, targetOffset: 0.2 };
  const FINAL = { inputI: -14.1, inputTp: -4.1, inputLra: 5, inputThresh: -24, targetOffset: 0 };

  function run(measure: (() => Promise<typeof LOUD | null>) | null, seen: string[]): RenderRun {
    return {
      job: jobRow({ kind: 'RENDER', clipId: CLIP_ID }),
      input: input([]),
      dir,
      signal: new AbortController().signal,
      tools: {
        probe: async () => sampleFacts({ durationMs: 180_000 }),
        render: async ({ compiled }) => {
          seen.push(`render ${JSON.stringify(compiled)}`);
          await writeFile(path.join(dir, 'render.mp4'), 'mp4');
          return { file: path.join(dir, 'render.mp4'), bytes: 3, elapsedMs: 10, stderrTail: '' };
        },
        poster: async () => {
          throw new Error('not used');
        },
        ...(measure
          ? {
              measure: async ({ compiled }) => {
                seen.push(`measure ${JSON.stringify(compiled)}`);
                return measure();
              },
              measureFile: async ({ file }) => {
                seen.push(`file ${file}`);
                return FINAL;
              },
            }
          : {}),
      },
      privateStorage: storage as unknown as RenderRun['privateStorage'],
      storage: {
        put: async () => undefined,
        delete: async () => undefined,
        read: async () => null,
      } as unknown as RenderRun['storage'],
      internal: {} as RenderRun['internal'],
      rows,
      stickerRows: { librarySticker: async () => null, stickerAsset: async () => null },
      progress: { ...fakeProgress().progress, done: async () => true },
      fonts: null,
      heartbeat: () => undefined,
    };
  }

  it('measures, renders with the correction, then measures the finished file', async () => {
    const seen: string[] = [];
    const runNow = run(async () => LOUD, seen);
    const rendered = await renderExecute(runNow, await renderPrepare(runNow));
    expect(seen.map((line) => line.split(' ')[0])).toEqual(['measure', 'render', 'file']);
    expect(seen[0]).toContain('print_format=json');
    expect(seen[1]).toContain('measured_I=-20');
    expect(seen[1]).toContain('linear=true');
    expect(seen[2]).toBe('file render.mp4');
    expect(rendered.loudness).toEqual({ inputLufs: -20, inputTp: -10, finalLufs: -14.1, mode: 'linear' });
  });

  it('leaves a silent clip alone, and records it as skipped', async () => {
    const seen: string[] = [];
    const runNow = run(async () => null, seen);
    const rendered = await renderExecute(runNow, await renderPrepare(runNow));
    expect(seen.map((line) => line.split(' ')[0])).toEqual(['measure', 'render']);
    expect(seen[1]).not.toContain('loudnorm');
    expect(rendered.loudness.mode).toBe('skipped');
  });

  it('renders without the passes when no measuring tool is given', async () => {
    const seen: string[] = [];
    const runNow = run(null, seen);
    const rendered = await renderExecute(runNow, await renderPrepare(runNow));
    expect(seen.map((line) => line.split(' ')[0])).toEqual(['render']);
    expect(rendered.loudness).toEqual({ inputLufs: null, inputTp: null, finalLufs: null, mode: 'skipped' });
  });
});
