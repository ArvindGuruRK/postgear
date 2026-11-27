/**
 * An export of a montage (Sprint 13, Module 11): parts of two videos, each
 * video read from its own file. The montage has no sharp ranges of its own:
 * its parts are its clips' parts, so the sharp range (SEGMENT asset) of each
 * video is looked for among the montage's clips too, and the one covering
 * the union of that video's parts (the original clip's range plus its
 * handles) is fetched. Each video's captions track reads its own
 * transcript, inside the workspace.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FontsFolder } from '@postgear/media-tools';
import {
  builtInCaptionStyle,
  type ClipDocument,
  CURRENT_SCHEMA_VERSION,
  emptyTranscript,
  encodeTranscript,
  FONT_MANIFEST,
  mergeTranscript,
  type RenderInput,
  transcriptAssetMeta,
} from '@postgear/video-engine';
import type { CaptionRows } from '../captions/files';
import type { AssetRow } from '../rows';
import type { LibraryStickerFile, StickerFileRows } from '../stickers/rows';
import {
  CLIP_ID,
  FakePrivateStorage,
  FakeRows,
  fakeProgress,
  jobRow,
  ORG,
  sampleFacts,
  VIDEO_ID,
  videoRow,
} from '../testing/fakes';
import { type RenderRun, renderPrepare } from './render.run';

const VIDEO_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const CLIP_A = '11111111-2222-4333-8444-555555555555';
const CLIP_B = '22222222-3333-4444-8555-666666666666';
const TRANSCRIPT_A = '33333333-4444-4555-8666-777777777777';
const TRANSCRIPT_B = '55555555-6666-4777-8888-999999999999';
const KEYS = {
  proxyA: `clips/${ORG}/videos/a-proxy.mp4`,
  proxyB: `clips/${ORG}/videos/b-proxy.mp4`,
  sharpA: `clips/${ORG}/clips/a-sharp.mp4`,
  shortA: `clips/${ORG}/clips/a-short.mp4`,
  sharpB: `clips/${ORG}/clips/b-sharp.mp4`,
  transcriptA: `clips/${ORG}/videos/a-transcript.json.gz`,
  transcriptB: `clips/${ORG}/videos/b-transcript.json.gz`,
};

class NoStickers implements StickerFileRows {
  async librarySticker(): Promise<LibraryStickerFile | null> {
    return null;
  }
  async stickerAsset() {
    return null;
  }
}

function fullscreen(id: string, x: number, w: number): ClipDocument['layout'] {
  return {
    kind: 'fullscreen',
    areas: [
      {
        id,
        name: 'Video',
        frame: { x: 0, y: 0, w: 1, h: 1 },
        crop: [{ at: 0, rect: { x, y: 0, w, h: 1 } }],
        fit: 'cover',
      },
    ],
  };
}

/** A's parts at 12 to 14 s and 20 to 22 s, B's at 40 to 43 s, a Fade before each join. */
function montage(captions: boolean): ClipDocument {
  const doc: ClipDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
    sources: [
      { id: 'srcA', videoId: VIDEO_ID },
      { id: 'srcB', videoId: VIDEO_B },
    ],
    segments: [
      { id: 'a1', source: 'srcA', sourceIn: 12_000, sourceOut: 14_000, speed: 1, volume: 1 },
      {
        id: 'b1',
        source: 'srcB',
        sourceIn: 40_000,
        sourceOut: 43_000,
        speed: 1,
        volume: 1,
        layoutOverride: fullscreen('b', 0, 1),
      },
      {
        id: 'a2',
        source: 'srcA',
        sourceIn: 20_000,
        sourceOut: 22_000,
        speed: 1,
        volume: 1,
        layoutOverride: fullscreen('a', 0.3, 0.31640625),
      },
    ],
    layout: fullscreen('main', (1 - 0.31640625) / 2, 0.31640625),
    zooms: [],
    looks: { colour: 'none', strength: 0, vignette: 0 },
    fades: { inMs: 0, outMs: 0 },
    tracks: [],
    bleeps: [],
    joins: [
      { beforeSegment: 'b1', kind: 'fade', ms: 300 },
      { beforeSegment: 'a2', kind: 'fade', ms: 300 },
    ],
    meta: {
      montage: {
        parts: [
          { clipId: CLIP_A, title: 'First', firstSegment: 'a1' },
          { clipId: CLIP_B, title: 'Second', firstSegment: 'b1' },
        ],
      },
    },
  };
  if (captions) {
    const track = (id: string, source: string, transcriptAssetId: string) => ({
      id,
      kind: 'captions' as const,
      transcriptAssetId,
      source,
      language: 'en',
      styleId: 'bold-pop',
      position: { x: 0.5, y: 0.72 },
      sizePx: 86,
      maxWords: 2,
      edits: {},
    });
    doc.tracks = [track('ccA', 'srcA', TRANSCRIPT_A), track('ccB', 'srcB', TRANSCRIPT_B)];
  }
  return doc;
}

function asset(
  id: string,
  kind: AssetRow['kind'],
  key: string,
  videoId: string,
  clipId: string | null,
  meta: unknown,
): AssetRow {
  return {
    id,
    kind,
    key,
    bytes: 11,
    videoId,
    clipId,
    meta,
    createdAt: new Date('2026-11-18T10:00:00Z'),
  };
}

describe('renderPrepare for a montage of two videos', () => {
  let dir: string;
  let fontsDir: string;
  let fonts: FontsFolder;
  let storage: FakePrivateStorage;
  let rows: FakeRows;
  let fetched: string[];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'render-montage-'));
    fontsDir = await mkdtemp(path.join(tmpdir(), 'render-montage-fonts-'));
    await writeFile(path.join(fontsDir, 'manifest.json'), JSON.stringify(FONT_MANIFEST));
    fonts = { dir: fontsDir, manifest: FONT_MANIFEST };
    storage = new FakePrivateStorage();
    for (const [name, key] of Object.entries(KEYS)) storage.objects.set(key, Buffer.from(name));
    fetched = [];
    const original = storage.getToFile.bind(storage);
    storage.getToFile = async (key: string, file: string) => {
      fetched.push(key);
      return original(key, file);
    };
    rows = new FakeRows();
    rows.videos.set(VIDEO_ID, videoRow({ status: 'READY' }));
    rows.videos.set(VIDEO_B, videoRow({ id: VIDEO_B, status: 'READY' }));
    rows.assets.push(
      asset('proxy-a', 'PROXY', KEYS.proxyA, VIDEO_ID, null, {}),
      asset('proxy-b', 'PROXY', KEYS.proxyB, VIDEO_B, null, {}),
      // Clip A's sharp range: its parts (12 to 22 s) with 2 s handles each side.
      asset('sharp-a', 'SEGMENT', KEYS.sharpA, VIDEO_ID, CLIP_A, {
        fromMs: 10_000,
        toMs: 24_000,
        height: 1080,
        fps: 30,
      }),
      // A taller range of A that holds only the first part: it does not cover the union.
      asset('short-a', 'SEGMENT', KEYS.shortA, VIDEO_ID, CLIP_A, {
        fromMs: 10_000,
        toMs: 16_000,
        height: 2160,
        fps: 30,
      }),
      asset('sharp-b', 'SEGMENT', KEYS.sharpB, VIDEO_B, CLIP_B, {
        fromMs: 38_000,
        toMs: 45_000,
        height: 1080,
        fps: 30,
      }),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(fontsDir, { recursive: true, force: true });
  });

  function run(document: ClipDocument, captionRows?: CaptionRows): RenderRun {
    const input: RenderInput = {
      clipId: CLIP_ID,
      videoId: VIDEO_ID,
      revision: 1,
      document,
      quality: '720p',
      proof: false,
      watermark: false,
      name: 'Montage',
    };
    return {
      job: jobRow({ kind: 'RENDER', clipId: CLIP_ID }),
      input,
      dir,
      signal: new AbortController().signal,
      tools: {
        probe: async (file: string) =>
          path.basename(file) === 'source-1.mp4'
            ? sampleFacts({ durationMs: 60_000, width: 720, height: 720 })
            : sampleFacts({ durationMs: 14_000 }),
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
      stickerRows: new NoStickers(),
      ...(captionRows ? { captionRows } : {}),
      progress: { ...fakeProgress().progress, done: async () => true },
      fonts,
      heartbeat: () => undefined,
    };
  }

  it("fetches two sharp ranges, one per video, each covering that video's every part", async () => {
    const plan = await renderPrepare(run(montage(false)));
    // The montage owns no sharp range: each video's is its own clip's, read among the video's assets.
    expect(rows.assets.some((row) => row.clipId === CLIP_ID)).toBe(false);
    expect(fetched).toEqual([KEYS.sharpA, KEYS.sharpB]);
    expect(await readFile(path.join(dir, 'source-0.mp4'), 'utf8')).toBe('sharpA');
    expect(await readFile(path.join(dir, 'source-1.mp4'), 'utf8')).toBe('sharpB');
    // Three runs: A from its range's start (10 s), B from its own (38 s), A again.
    expect(plan.inputs.map((i) => [i.sourceId, i.file, i.seekMs])).toEqual([
      ['srcA', 'source-0.mp4', 1_000],
      ['srcB', 'source-1.mp4', 1_000],
      ['srcA', 'source-0.mp4', 9_000],
    ]);
    expect(
      plan.segments.map((s) => [s.trimStartMs, s.trimEndMs, s.outStartMs, s.overlapMs]),
    ).toEqual([
      [1_000, 3_000, 0, undefined],
      [1_000, 4_000, 1_700, 300],
      [1_000, 3_000, 4_400, 300],
    ]);
    expect(plan.output.durationMs).toBe(7_000 - 600);
  });

  it('reads each part of one video from its own sharp range when no single one covers them', async () => {
    // Two clips of video A, far apart, as one source: no SEGMENT spans 12 to 52 s.
    const doc = montage(false);
    doc.segments = doc.segments.map((segment) =>
      segment.id === 'a2' ? { ...segment, sourceIn: 50_000, sourceOut: 52_000 } : segment,
    );
    const lateKey = `clips/${ORG}/clips/a-late.mp4`;
    storage.objects.set(lateKey, Buffer.from('lateA'));
    rows.assets = rows.assets.filter((row) => row.id !== 'sharp-a');
    rows.assets.push(
      asset('early-a', 'SEGMENT', KEYS.sharpA, VIDEO_ID, CLIP_A, {
        fromMs: 10_000,
        toMs: 16_000,
        height: 1080,
        fps: 30,
      }),
      asset('late-a', 'SEGMENT', lateKey, VIDEO_ID, CLIP_B, {
        fromMs: 48_000,
        toMs: 54_000,
        height: 1080,
        fps: 30,
      }),
    );
    const plan = await renderPrepare(run(doc));
    // The taller short range covers the first part (12 to 14 s), the late one the last.
    expect(fetched).toEqual([KEYS.shortA, lateKey, KEYS.sharpB]);
    expect(plan.inputs.map((i) => [i.sourceId, i.file, i.seekMs])).toEqual([
      ['srcA', 'source-0.mp4', 1_000],
      ['srcB', 'source-2.mp4', 1_000],
      ['srcA', 'source-1.mp4', 1_000],
    ]);
  });

  it('reads a sharp range of another clip of the video for a clip that owns none', async () => {
    const doc = montage(false);
    delete doc.meta;
    delete doc.joins;
    await renderPrepare(run(doc));
    expect(fetched).toEqual([KEYS.sharpA, KEYS.sharpB]);
  });

  it("falls back to a video's light copy when no sharp range covers its parts", async () => {
    rows.assets = rows.assets.filter((row) => row.id !== 'sharp-b');
    await renderPrepare(run(montage(false)));
    expect(fetched).toEqual([KEYS.sharpA, KEYS.proxyB]);
  });

  it("reads each video's captions from its own transcript, inside the workspace", async () => {
    const words = (text: string, start: number) =>
      mergeTranscript(emptyTranscript('en', 'simulation'), {
        ranges: [{ fromMs: 0, toMs: 60_000 }],
        words: [{ start, end: start + 300, text, sure: 0.9 }],
      });
    const a = words('Alpha', 12_500);
    const b = words('Bravo', 40_500);
    storage.objects.set(KEYS.transcriptA, gzipSync(Buffer.from(encodeTranscript(a))));
    storage.objects.set(KEYS.transcriptB, gzipSync(Buffer.from(encodeTranscript(b))));
    rows.assets.push(
      asset('ta', 'TRANSCRIPT', KEYS.transcriptA, VIDEO_ID, null, transcriptAssetMeta(a, [])),
    );
    rows.assets.push(
      asset('tb', 'TRANSCRIPT', KEYS.transcriptB, VIDEO_B, null, transcriptAssetMeta(b, [])),
    );
    rows.assets = rows.assets.map((row) =>
      row.id === 'ta'
        ? { ...row, id: TRANSCRIPT_A }
        : row.id === 'tb'
          ? { ...row, id: TRANSCRIPT_B }
          : row,
    );
    await writeFile(path.join(fontsDir, 'montserrat-800.ttf'), 'twin bytes');
    const asked: Array<[string, string]> = [];
    const captionRows: CaptionRows = {
      videoAssets: async (org, videoId) => {
        asked.push([org, videoId]);
        return org === ORG ? rows.assets.filter((row) => row.videoId === videoId) : [];
      },
      captionStyle: async () => null,
    };
    const plan = await renderPrepare(run(montage(true), captionRows));
    expect(asked).toEqual([
      [ORG, VIDEO_ID],
      [ORG, VIDEO_B],
    ]);
    expect(plan.captions?.layout.words.map((w) => [w.text, w.start])).toEqual([['Alpha', 500]]);
    // B's word is half a second into its part, which starts 0.3 s before A's part ends.
    expect(plan.moreCaptions?.[0]?.layout.words.map((w) => [w.text, w.start])).toEqual([
      ['Bravo', 2_200],
    ]);
    expect(plan.captions?.layout.look).toEqual(
      expect.objectContaining({ font: builtInCaptionStyle('bold-pop')?.look.font }),
    );
  });
});
