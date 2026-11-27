/**
 * An export of a branded clip (Sprint 13, Module 10): every source of the
 * document gets its own file (the brand intro from its own video's light
 * copy), the kit's logo is fetched once like any own sticker (the clip's
 * logo and the card's), the card's font goes into the fonts folder, and a
 * removed intro video fails the export.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { FontsFolder } from '@postgear/media-tools';
import {
  applyBrandKit,
  brandSourceId,
  type ClipBrandKit,
  createClipDocument,
  FONT_MANIFEST,
  type RenderInput,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import type { StickerAssetRow } from '../stickers/check';
import type { LibraryStickerFile, StickerFileRows } from '../stickers/rows';
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
import { type RenderRun, renderPrepare } from './render.run';

const PROXY_KEY = 'clips/seed-demo-org/videos/proxy.mp4';
const INTRO_ID = '3d4e5f60-7182-493a-9c4d-5e6f708192a3';
const INTRO_KEY = 'clips/seed-demo-org/videos/intro-proxy.mp4';
const LOGO_ID = '7b2e1d4f-3c5e-4f60-9bac-1d2e3f4a5b6c';
const LOGO_KEY = 'clips/seed-demo-org/library/0123456789abcdef.png';

const KIT: ClipBrandKit = {
  id: '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081',
  name: 'Acme',
  logo: { assetId: LOGO_ID, width: 256, height: 128 },
  logoPosition: 'top-right',
  captionStyleId: null,
  intro: { videoId: INTRO_ID, durationMs: 3_000, width: 1280, height: 720 },
  outro: { kind: 'card', text: 'Thanks for watching', background: '#101820', colour: '#FFD43B' },
};

class FakeStickerRows implements StickerFileRows {
  assets = new Map<string, StickerAssetRow>();
  async librarySticker(): Promise<LibraryStickerFile | null> {
    return null;
  }
  async stickerAsset(organizationId: string, id: string) {
    const row = this.assets.get(id);
    return row && row.organizationId === organizationId ? row : null;
  }
}

function brandedInput(): RenderInput {
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
    document: applyBrandKit(document, KIT),
    quality: '720p',
    proof: false,
    watermark: false,
    name: 'Best Moment',
  };
}

describe('renderPrepare for a branded clip', () => {
  let dir: string;
  let fontsDir: string;
  let fonts: FontsFolder;
  let storage: FakePrivateStorage;
  let rows: FakeRows;
  let stickerRows: FakeStickerRows;
  let probed: string[];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'render-brand-'));
    fontsDir = await mkdtemp(path.join(tmpdir(), 'render-brand-fonts-'));
    await writeFile(path.join(fontsDir, 'manifest.json'), JSON.stringify(FONT_MANIFEST));
    await writeFile(path.join(fontsDir, 'inter-700.ttf'), 'twin bytes');
    fonts = { dir: fontsDir, manifest: FONT_MANIFEST };
    storage = new FakePrivateStorage();
    storage.objects.set(PROXY_KEY, Buffer.from('video bytes'));
    storage.objects.set(INTRO_KEY, Buffer.from('intro bytes'));
    storage.objects.set(LOGO_KEY, Buffer.from('logo png'));
    rows = new FakeRows();
    rows.videos.set(VIDEO_ID, videoRow({ status: 'READY' }));
    rows.videos.set(INTRO_ID, videoRow({ id: INTRO_ID, status: 'READY', durationMs: 3_000 }));
    for (const [id, videoId, key] of [
      ['asset-proxy', VIDEO_ID, PROXY_KEY],
      ['asset-intro', INTRO_ID, INTRO_KEY],
    ] as const) {
      rows.assets.push({
        id,
        kind: 'PROXY',
        key,
        bytes: 11,
        videoId,
        clipId: null,
        meta: {},
        createdAt: new Date('2026-11-18T10:00:00Z'),
      });
    }
    stickerRows = new FakeStickerRows();
    stickerRows.assets.set(LOGO_ID, {
      id: LOGO_ID,
      organizationId: 'seed-demo-org',
      key: LOGO_KEY,
      meta: {
        status: 'ready',
        name: 'Acme Logo',
        animated: false,
        width: 256,
        height: 128,
        fps: null,
        frames: null,
        durationMs: null,
        previewKey: 'clips/seed-demo-org/library/fedcba9876543210.webp',
      },
    });
    probed = [];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(fontsDir, { recursive: true, force: true });
  });

  function run(renderInput: RenderInput): RenderRun {
    return {
      job: jobRow({ kind: 'RENDER', clipId: CLIP_ID }),
      input: renderInput,
      dir,
      signal: new AbortController().signal,
      tools: {
        probe: async (file: string) => {
          probed.push(path.basename(file));
          return path.basename(file) === 'source-0.mp4'
            ? sampleFacts({ durationMs: 3_000, width: 1280, height: 720, fps: 25 })
            : sampleFacts({ durationMs: 180_000 });
        },
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
      stickerRows,
      progress: { ...fakeProgress().progress, done: async () => true },
      fonts,
      heartbeat: () => undefined,
    };
  }

  it('fetches the intro video as its own input, and the logo once for the clip and the card', async () => {
    const plan = await renderPrepare(run(brandedInput()));
    expect(plan.inputs.map((input) => [input.sourceId, input.file])).toEqual([
      [brandSourceId(INTRO_ID), 'source-0.mp4'],
      [plan.inputs[1]?.sourceId, 'source-1.mp4'],
    ]);
    // The files are numbered in play order: the intro plays first.
    expect(probed).toEqual(['source-0.mp4', 'source-1.mp4']);
    expect(await readFile(path.join(dir, 'source-0.mp4'), 'utf8')).toBe('intro bytes');
    expect(await readFile(path.join(dir, 'source-1.mp4'), 'utf8')).toBe('video bytes');
    expect(plan.stickers.map((sticker) => sticker.file)).toEqual(['sticker-0.png']);
    expect(plan.cards?.closing?.logo?.file).toBe('sticker-0.png');
    expect(await readFile(path.join(dir, 'sticker-0.png'), 'utf8')).toBe('logo png');
    // 3 s intro, 10 s clip, 2 s card.
    expect(plan.output.durationMs).toBe(15_000);
    expect(plan.fonts.files).toEqual(['inter-700.ttf']);
    expect(await readFile(path.join(dir, 'fonts', 'inter-700.ttf'), 'utf8')).toBe('twin bytes');
  });

  it('fails the export when the intro video was removed', async () => {
    rows.videos.set(
      INTRO_ID,
      videoRow({ id: INTRO_ID, status: 'READY', deletedAt: new Date('2026-11-20T10:00:00Z') }),
    );
    const error = await renderPrepare(run(brandedInput())).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClipStepError);
    expect((error as ClipStepError).code).toBe('export_failed');
  });
});
