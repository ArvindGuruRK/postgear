/**
 * Montage (Sprint 13, Module 11): order and lengths, re-keyed sources, items
 * and captions on their moments through Fade joins, shapes refitted, hooks
 * and brand parts, the title card, the limits, and the editor's helpers.
 */
import { applyBrandKit } from '../brand/apply';
import type { ClipBrandKit } from '../brand/types';
import { captionsTrackOf, captionsTracksOf, captionWords } from '../captions/map';
import { createCaptionsTrack, updateCaptionsTrack, withCaptionsTrack } from '../captions/track';
import { createClipDocument } from '../document/create';
import { CLIP_ERROR_MESSAGES } from '../errors';
import { MONTAGE_MAX_MS } from '../document/limits';
import {
  type ClipDocument,
  clipDocumentSchema,
  type CaptionsTrack,
  type ClipLayout,
  joinOverlaps,
} from '../document/schema';
import { addHookTitle, setHook } from '../effects/hook';
import { setCanvasRatio } from '../layout/edit';
import { presetFor } from '../layout/presets';
import { frameState } from '../render/frame-state';
import { testSticker, testText } from '../render/test-docs';
import { removeSegment, splitAt } from '../time/edits';
import {
  joinAt,
  outputDuration,
  placeSegments,
  segmentAt,
  toOutput,
  toSource,
} from '../time/time-map';
import { zoomWindows } from '../time/zooms';
import type { Transcript } from '../transcript/types';
import {
  createMontage,
  type MontageClip,
  MONTAGE_REFUSALS,
  montageParts,
  montageRatios,
  segmentLayout,
  withSegmentLayout,
} from './index';

const VIDEO_A = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
const VIDEO_B = '7a2d3c9f-4e5b-4c6d-8e7f-8091a2b3c4d5';
const VIDEO_C = '8b3e4dab-5f6c-4d7e-9f80-91a2b3c4d5e6';
const TRANSCRIPT_A = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TRANSCRIPT_B = '2b3c4d5e-6f70-4b8c-9dae-1f2a3b4c5d6e';
const CLIP_IDS = [
  '0f0e0d0c-0b0a-4908-8706-050403020100',
  '1f1e1d1c-1b1a-4918-9716-151413121110',
  '2f2e2d2c-2b2a-4928-a726-252423222120',
  '3f3e3d3c-3b3a-4938-b736-353433323130',
];

function clipDoc(
  videoId: string,
  fromMs: number,
  toMs: number,
  ratio: ClipDocument['canvas']['ratio'] = '9:16',
): ClipDocument {
  return createClipDocument({ videoId, fromMs, toMs, ratio });
}

function entry(document: ClipDocument, k: number, title = `Clip ${k + 1}`): MontageClip {
  return { id: CLIP_IDS[k] ?? `clip_${k}`, title, document };
}

function made(clips: MontageClip[], options: Parameters<typeof createMontage>[1]): ClipDocument {
  const result = createMontage(clips, options);
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  expect(clipDocumentSchema.safeParse(result.document).success).toBe(true);
  return result.document;
}

/** The video a montage moment shows: the video id and its moment. */
function videoAt(doc: ClipDocument, outputMs: number): { videoId: string; ms: number } | null {
  const moment = toSource(doc, outputMs);
  if (!moment) return null;
  const videoId = doc.sources.find((source) => source.id === moment.sourceId)?.videoId ?? '';
  return { videoId, ms: moment.sourceMs };
}

function withItems(doc: ClipDocument, items: Parameters<typeof testText>[1][] = []): ClipDocument {
  return {
    ...doc,
    tracks: [{ id: 'ov', kind: 'overlay', items: items.map((over, i) => testText(`t${i}`, over)) }],
  };
}

function words(from: number, count: number, step = 500): Transcript['words'] {
  return Array.from({ length: count }, (_, i) => ({
    i,
    start: from + i * step,
    end: from + i * step + 400,
    text: `w${i}`,
    sure: 1,
  }));
}

function withCaptions(doc: ClipDocument, transcriptId: string, styleId = 'bold-pop'): ClipDocument {
  return withCaptionsTrack(
    doc,
    createCaptionsTrack({
      transcriptAssetId: transcriptId,
      language: 'en',
      styleId,
      look: { sizePx: 72, maxWords: 3 },
    }),
  );
}

describe('createMontage: order and lengths', () => {
  const a = clipDoc(VIDEO_A, 10_000, 20_000);
  const b = clipDoc(VIDEO_B, 0, 6_000);
  const c = clipDoc(VIDEO_A, 40_000, 48_000);

  it('plays the clips in order, and a Cut montage lasts the sum of the clips', () => {
    const doc = made([entry(a, 0), entry(b, 1), entry(c, 2)], { transition: 'cut' });
    expect(doc.segments.map((s) => [s.sourceIn, s.sourceOut])).toEqual([
      [10_000, 20_000],
      [0, 6_000],
      [40_000, 48_000],
    ]);
    expect(outputDuration(doc)).toBe(24_000);
    expect(doc.joins).toBeUndefined();
    expect(doc.meta?.montage?.parts.map((part) => part.title)).toEqual([
      'Clip 1',
      'Clip 2',
      'Clip 3',
    ]);
  });

  it('with Fade lasts 0.3 s less per join, a join before each clip but the first', () => {
    const doc = made([entry(a, 0), entry(b, 1), entry(c, 2)], { transition: 'fade' });
    expect(doc.joins).toEqual([
      { beforeSegment: doc.segments[1]?.id, kind: 'fade', ms: 300 },
      { beforeSegment: doc.segments[2]?.id, kind: 'fade', ms: 300 },
    ]);
    expect(joinOverlaps(doc)).toEqual([0, 300, 300]);
    expect(outputDuration(doc)).toBe(24_000 - 600);
    expect(montageParts(doc).map((part) => part.outStart)).toEqual([0, 9_700, 15_400]);
  });

  it('re-keys the sources (one per video) and every id, so nothing collides', () => {
    const doc = made([entry(a, 0), entry(b, 1), entry(c, 2)], { transition: 'cut' });
    expect(doc.sources).toEqual([
      { id: 'src_1', videoId: VIDEO_A },
      { id: 'src_2', videoId: VIDEO_B },
    ]);
    expect(doc.segments.map((s) => s.source)).toEqual(['src_1', 'src_2', 'src_1']);
    const ids = doc.segments.map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
    // A clip twice: still distinct parts.
    const twice = made([entry(a, 0), entry(a, 1)], { transition: 'cut' });
    expect(twice.sources).toHaveLength(1);
    expect(new Set(twice.segments.map((s) => s.id)).size).toBe(2);
  });

  it('each part carries its clip framing; the montage layout is the first clip one', () => {
    const framed: ClipDocument = {
      ...b,
      layout: {
        ...b.layout,
        areas: b.layout.areas.map((area) => ({
          ...area,
          crop: [{ at: 0, rect: { x: 0, y: 0, w: 0.31640625, h: 1 } }],
        })),
      },
    };
    const doc = made([entry(a, 0), entry(framed, 1)], { transition: 'cut' });
    expect(doc.segments[0]?.layoutOverride?.areas[0]?.crop).toEqual(a.layout.areas[0]?.crop);
    expect(doc.segments[1]?.layoutOverride?.areas[0]?.crop[0]?.rect.x).toBe(0);
    expect(doc.layout.areas[0]?.crop).toEqual(a.layout.areas[0]?.crop);
    expect(segmentLayout(doc, doc.segments[1]?.id as string).areas[0]?.crop[0]?.rect.x).toBe(0);
  });
});

describe('createMontage: items keep their moments', () => {
  it('an item on a moment in clip three is still on its moment, also after two fade joins', () => {
    const a = clipDoc(VIDEO_A, 10_000, 20_000);
    const b = clipDoc(VIDEO_B, 0, 6_000);
    // Clip three: a sticker at 1.5 s into it, over the video's 41.5 s.
    const c: ClipDocument = {
      ...clipDoc(VIDEO_C, 40_000, 48_000),
      tracks: [{ id: 'ov', kind: 'overlay', items: [testSticker('s', { start: 1_500 })] }],
    };
    for (const transition of ['cut', 'fade'] as const) {
      const doc = made([entry(a, 0), entry(b, 1), entry(c, 2)], { transition });
      const track = doc.tracks.find((t) => t.kind === 'overlay');
      const item = track?.kind === 'overlay' ? track.items[0] : undefined;
      expect(item?.start).toBe(transition === 'cut' ? 17_500 : 16_900);
      expect(videoAt(doc, item?.start as number)).toEqual({ videoId: VIDEO_C, ms: 41_500 });
    }
  });

  it('a Whole Clip item covers its clip stretch; nothing runs on into the next clip', () => {
    const a: ClipDocument = {
      ...clipDoc(VIDEO_A, 10_000, 20_000),
      tracks: [
        {
          id: 'music',
          kind: 'audio',
          items: [
            {
              id: 'm',
              type: 'music',
              start: 0,
              duration: 10_000,
              anchor: 'clip',
              ref: { asset: TRANSCRIPT_A },
              offsetMs: 0,
              volume: 1,
              fadeInMs: 0,
              fadeOutMs: 0,
              duck: true,
            },
          ],
        },
        { id: 'ov', kind: 'overlay', items: [testText('late', { start: 9_000, duration: 1_000 })] },
      ],
    };
    const b = clipDoc(VIDEO_B, 0, 6_000);
    const doc = made([entry(b, 0), entry(a, 1), entry(b, 2)], { transition: 'fade' });
    const music = doc.tracks.find((t) => t.kind === 'audio');
    expect(music?.kind === 'audio' && music.items[0]).toMatchObject({
      start: 5_700,
      duration: 10_000,
    });
    const text = doc.tracks.find((t) => t.kind === 'overlay');
    // 9 s into clip two (which starts at 5.7 s), ending with the clip at 15.7 s.
    expect(text?.kind === 'overlay' && text.items[0]).toMatchObject({
      start: 14_700,
      duration: 1_000,
    });
  });

  it('merges tracks by place and gives every item a new id', () => {
    const a = withItems(clipDoc(VIDEO_A, 10_000, 20_000), [{ start: 0 }, { start: 3_000 }]);
    const b = withItems(clipDoc(VIDEO_B, 0, 6_000), [{ start: 1_000 }]);
    const doc = made([entry(a, 0), entry(b, 1)], { transition: 'cut' });
    const overlays = doc.tracks.filter((t) => t.kind === 'overlay');
    expect(overlays).toHaveLength(1);
    const items = overlays[0]?.kind === 'overlay' ? overlays[0].items : [];
    expect(items.map((item) => item.start)).toEqual([0, 3_000, 11_000]);
    expect(new Set(items.map((item) => item.id)).size).toBe(3);
  });

  it('copies zooms and bleeps with their sources re-keyed (they follow in the video time)', () => {
    const b: ClipDocument = {
      ...clipDoc(VIDEO_B, 0, 6_000),
      zooms: [],
      bleeps: [],
    };
    const source = b.sources[0]?.id as string;
    b.zooms = [
      { id: 'z', source, from: 1_000, to: 3_000, scale: 1.5, focus: { x: 0.5, y: 0.5 }, ease: 200 },
    ];
    b.bleeps = [{ id: 'b', source, from: 2_000, to: 2_400, mode: 'bleep' }];
    const a = clipDoc(VIDEO_A, 10_000, 20_000);
    const doc = made([entry(a, 0), entry(b, 1)], { transition: 'fade' });
    expect(doc.zooms[0]).toMatchObject({ source: 'src_2', from: 1_000, to: 3_000 });
    expect(doc.bleeps[0]).toMatchObject({ source: 'src_2', from: 2_000, to: 2_400 });
    // The zoom's window is on the montage clock: 9.7 s plus 1 s.
    expect(zoomWindows(doc)[0]).toMatchObject({ startMs: 10_700, endMs: 12_700 });
  });
});

describe('createMontage: captions from several videos', () => {
  it('one captions track per video, each on its own video parts at the right times', () => {
    const a = withCaptions(clipDoc(VIDEO_A, 10_000, 20_000), TRANSCRIPT_A, 'bold-pop');
    const b = withCaptions(clipDoc(VIDEO_B, 0, 6_000), TRANSCRIPT_B, 'karaoke');
    const doc = made([entry(a, 0), entry(b, 1)], { transition: 'fade' });
    const tracks = captionsTracksOf(doc);
    expect(tracks.map((t) => [t.transcriptAssetId, t.source])).toEqual([
      [TRANSCRIPT_A, 'src_1'],
      [TRANSCRIPT_B, 'src_2'],
    ]);
    // Every track in the style of the first.
    expect(tracks.map((t) => t.styleId)).toEqual(['bold-pop', 'bold-pop']);
    expect(captionsTrackOf(doc)?.transcriptAssetId).toBe(TRANSCRIPT_A);

    const wordsA = captionWords(doc, tracks[0] as CaptionsTrack, { words: words(10_000, 20) });
    const wordsB = captionWords(doc, tracks[1] as CaptionsTrack, { words: words(0, 12) });
    // Video A's words only on clip one, from 0; video B's on clip two, from 9.7 s.
    expect(wordsA[0]).toMatchObject({ start: 0, end: 400 });
    expect(wordsA.every((w) => w.end <= 10_000)).toBe(true);
    // Its first word shows from the fade's middle (9,850), where the picture hands over.
    expect(wordsB[0]).toMatchObject({ start: 9_850, end: 10_100 });
    expect(wordsB.at(-1)).toMatchObject({ start: 9_700 + 5_500 });
  });

  it('two clips of one video with one transcript share a track, their edits merged', () => {
    const a = updateCaptionsTrack(
      withCaptions(clipDoc(VIDEO_A, 10_000, 20_000), TRANSCRIPT_A),
      (t) => ({
        ...t,
        edits: { '3': { text: 'first' } },
      }),
    );
    const c = updateCaptionsTrack(
      withCaptions(clipDoc(VIDEO_A, 40_000, 48_000), TRANSCRIPT_A),
      (t) => ({
        ...t,
        edits: { '3': { text: 'second' }, '90': { hidden: true } },
      }),
    );
    const doc = made([entry(a, 0), entry(c, 1)], { transition: 'cut' });
    const tracks = captionsTracksOf(doc);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.source).toBeUndefined();
    expect(tracks[0]?.edits).toEqual({ '3': { text: 'first' }, '90': { hidden: true } });
  });

  it('a video without captions gets none, while the other is named', () => {
    const a = withCaptions(clipDoc(VIDEO_A, 10_000, 20_000), TRANSCRIPT_A);
    const b = clipDoc(VIDEO_B, 0, 6_000);
    const doc = made([entry(a, 0), entry(b, 1)], { transition: 'cut' });
    const tracks = captionsTracksOf(doc);
    expect(tracks.map((t) => t.source)).toEqual(['src_1']);
    const shown = captionWords(doc, tracks[0] as CaptionsTrack, { words: words(0, 40) });
    expect(shown.every((w) => w.segmentIndex === 0)).toBe(true);
  });
});

describe('createMontage: shapes', () => {
  const vertical = clipDoc(VIDEO_A, 10_000, 20_000, '9:16');
  const square = withItems(clipDoc(VIDEO_B, 0, 6_000, '1:1'), [
    { start: 0, transform: { x: 1.2, y: 0.5, scale: 1, rotation: 0, opacity: 1 } },
  ]);

  it('asks for one shape when the shapes differ', () => {
    expect(montageRatios([{ document: vertical }, { document: square }])).toEqual(['9:16', '1:1']);
    expect(createMontage([entry(vertical, 0), entry(square, 1)], { transition: 'cut' })).toEqual({
      ok: false,
      code: 'montage_shapes_differ',
    });
  });

  it('refits each clip to the chosen shape', () => {
    const doc = made([entry(vertical, 0), entry(square, 1)], { transition: 'fade', ratio: '9:16' });
    expect(doc.canvas).toMatchObject({ ratio: '9:16', width: 1080, height: 1920 });
    const override = doc.segments[1]?.layoutOverride as ClipLayout;
    const frame = presetFor('fullscreen', '9:16')?.areas[0]?.frame;
    expect(override.areas[0]?.frame).toEqual(frame);
    // A cover crop of a 16:9 video in a 9:16 frame: 9/16 of the height wide, in real proportions.
    const rect = override.areas[0]?.crop[0]?.rect;
    expect(((rect?.w as number) * 16) / 9 / (rect?.h as number)).toBeCloseTo(9 / 16, 6);
    // An item off the square's edge is pulled inside the canvas.
    const items = doc.tracks.flatMap((t) => (t.kind === 'overlay' ? t.items : []));
    expect(items[0]?.transform.x).toBe(1);
  });

  it('a shape change in the editor refits every part own layout too', () => {
    const doc = made([entry(vertical, 0), entry(square, 1)], { transition: 'cut', ratio: '9:16' });
    const wide = setCanvasRatio(doc, '16:9', { width: 1920, height: 1080 });
    const frame = presetFor('fullscreen', '16:9')?.areas[0]?.frame;
    expect(wide.segments.map((s) => s.layoutOverride?.areas[0]?.frame)).toEqual([frame, frame]);
    expect(wide.layout.areas[0]?.frame).toEqual(frame);
    expect(clipDocumentSchema.safeParse(wide).success).toBe(true);
  });

  it('a followed layout keeps its moving crop when refitted', () => {
    const followed: ClipDocument = {
      ...square,
      layout: {
        ...square.layout,
        areas: square.layout.areas.map((area) => ({
          ...area,
          crop: [
            { at: 0, rect: { x: 0, y: 0, w: 0.5625, h: 1 } },
            { at: 3_000, rect: { x: 0.4375, y: 0, w: 0.5625, h: 1 } },
          ],
        })),
        follow: {
          mode: 'speaker',
          faceAssetId: TRANSCRIPT_B,
          overrides: [],
          saved: { kind: 'fullscreen', areas: square.layout.areas },
        },
      },
    };
    const doc = made([entry(vertical, 0), entry(followed, 1)], {
      transition: 'cut',
      ratio: '9:16',
    });
    const override = doc.segments[1]?.layoutOverride as ClipLayout;
    const keys = override.areas[0]?.crop ?? [];
    expect(keys).toHaveLength(2);
    expect(keys[0]?.rect.w).toBeCloseTo(keys[1]?.rect.w as number, 9);
    expect(keys[0]?.rect.x).toBeLessThan(keys[1]?.rect.x as number);
    expect(override.follow?.saved.areas[0]?.frame).toEqual(override.areas[0]?.frame);
  });
});

describe('createMontage: hooks and brand parts', () => {
  const INTRO = '3d4e5f60-7182-493a-9c4d-5e6f708192a3';
  const OUTRO = '4e5f6071-8293-4a4b-8d5e-6f708192a3b4';
  const kit: ClipBrandKit = {
    id: '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081',
    name: 'Kit',
    logo: null,
    logoPosition: null,
    captionStyleId: null,
    intro: { videoId: INTRO, durationMs: 2_000, width: 1920, height: 1080 },
    outro: {
      kind: 'video',
      video: { videoId: OUTRO, durationMs: 1_500, width: 1920, height: 1080 },
    },
  };

  it('drops every hook, with the hook title; items keep their place on the main part', () => {
    const base = withItems(clipDoc(VIDEO_A, 10_000, 20_000), [{ start: 4_000, duration: 1_000 }]);
    const hooked = addHookTitle(
      setHook(base, { fromOutputMs: 5_000, toOutputMs: 7_000 }),
      'Watch this',
      'hook-box',
    );
    expect(hooked.segments.some((s) => s.role === 'hook')).toBe(true);
    const doc = made([entry(hooked, 0), entry(clipDoc(VIDEO_B, 0, 6_000), 1)], {
      transition: 'cut',
    });
    expect(doc.segments.some((s) => s.role === 'hook')).toBe(false);
    expect(outputDuration(doc)).toBe(16_000);
    const items = doc.tracks.flatMap((t) => (t.kind === 'overlay' ? t.items : []));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ start: 4_000, duration: 1_000 });
    expect(videoAt(doc, 4_000)).toEqual({ videoId: VIDEO_A, ms: 14_000 });
  });

  it('the title card takes the first clip hook look over a dark card', () => {
    const hooked = addHookTitle(clipDoc(VIDEO_A, 10_000, 20_000), 'Hi', 'hook-pop');
    const doc = made([entry(hooked, 0), entry(clipDoc(VIDEO_B, 0, 6_000), 1)], {
      transition: 'cut',
      titleCard: '  Best   Of The Week  ',
    });
    expect(doc.cards?.opening).toEqual({
      text: 'Best Of The Week',
      background: '#111111',
      colour: '#FFFFFF',
      logo: null,
      look: 'hook-pop',
      durationMs: 2_000,
    });
    const plain = made(
      [entry(clipDoc(VIDEO_A, 10_000, 20_000), 0), entry(clipDoc(VIDEO_B, 0, 6_000), 1)],
      {
        transition: 'cut',
        titleCard: 'Title',
      },
    );
    expect(plain.cards?.opening?.look).toBe('hook-bold');
    const none = made(
      [entry(clipDoc(VIDEO_A, 10_000, 20_000), 0), entry(clipDoc(VIDEO_B, 0, 6_000), 1)],
      {
        transition: 'cut',
        titleCard: '   ',
      },
    );
    expect(none.cards).toBeUndefined();
  });

  it('keeps the first clip intro and the last clip outro and closing card, drops the rest', () => {
    const branded = (doc: ClipDocument) => applyBrandKit(doc, kit);
    const cardKit: ClipBrandKit = {
      ...kit,
      outro: { kind: 'card', text: 'Bye', background: '#101820', colour: '#ffd43b' },
    };
    // An item on each clip intro (0.5 s in) and one on its main part (3 s in).
    const onIntro = (doc: ClipDocument) =>
      withItems(doc, [
        { start: 500, duration: 1_000 },
        { start: 5_000, duration: 1_000 },
      ]);
    const first = onIntro(branded(clipDoc(VIDEO_A, 10_000, 20_000)));
    const middle = onIntro(branded(clipDoc(VIDEO_B, 0, 6_000)));
    const last = applyBrandKit(clipDoc(VIDEO_C, 0, 5_000), cardKit);
    const doc = made([entry(first, 0), entry(middle, 1), entry(last, 2)], { transition: 'cut' });
    expect(doc.segments.map((s) => s.role ?? 'main')).toEqual(['intro', 'main', 'main', 'main']);
    expect(doc.cards?.closing?.text).toBe('Bye');
    expect(outputDuration(doc)).toBe(2_000 + 10_000 + 6_000 + 5_000);
    // The middle clip item on its dropped intro is gone; the first clip one stays on its intro.
    const items = doc.tracks.flatMap((t) => (t.kind === 'overlay' ? t.items : []));
    expect(items.map((item) => item.start)).toEqual([500, 5_000, 12_000 + 3_000]);
    expect(videoAt(doc, 15_000)).toEqual({ videoId: VIDEO_B, ms: 3_000 });
    expect(doc.sources.map((s) => s.videoId)).toEqual([INTRO, VIDEO_A, VIDEO_B, VIDEO_C]);
    expect(doc.sources[0]?.id.startsWith('src_brand_')).toBe(true);

    const withOutro = made([entry(first, 0), entry(middle, 1)], { transition: 'fade' });
    expect(withOutro.segments.map((s) => s.role ?? 'main')).toEqual([
      'intro',
      'main',
      'main',
      'outro',
    ]);
    expect(withOutro.joins).toHaveLength(1);
    expect(withOutro.joins?.[0]?.beforeSegment).toBe(withOutro.segments[2]?.id);
  });
});

describe('createMontage: limits', () => {
  const short = clipDoc(VIDEO_A, 0, 5_000);

  it('refuses fewer than 2 and more than 15 clips', () => {
    expect(createMontage([entry(short, 0)], { transition: 'cut' })).toEqual({
      ok: false,
      code: 'montage_too_few',
    });
    const many = Array.from({ length: 16 }, (_, k) => entry(short, k));
    expect(createMontage(many, { transition: 'cut' })).toEqual({
      ok: false,
      code: 'montage_too_many',
    });
    expect(createMontage(many.slice(0, 15), { transition: 'cut' }).ok).toBe(true);
  });

  it('refuses a montage longer than 20 minutes after its joins', () => {
    const long = clipDoc(VIDEO_A, 0, 400_000);
    const tail = clipDoc(VIDEO_B, 0, 400_150);
    const three = [entry(long, 0), entry(long, 1), entry(tail, 2)];
    // 1 200 150 ms cut; 1 199 550 ms faded.
    expect(createMontage(three, { transition: 'cut' })).toEqual({
      ok: false,
      code: 'montage_too_long',
    });
    const faded = createMontage(three, { transition: 'fade' });
    expect(faded.ok && outputDuration(faded.document)).toBe(MONTAGE_MAX_MS - 450);
  });

  it('refuses more parts or items than one document holds', () => {
    let split = clipDoc(VIDEO_A, 0, 80_000);
    for (let at = 1_000; at < 80_000; at += 1_000) {
      const result = splitAt(split, at);
      if (result.ok) split = result.doc;
    }
    expect(split.segments).toHaveLength(80);
    expect(createMontage([entry(split, 0), entry(split, 1)], { transition: 'cut' })).toEqual({
      ok: false,
      code: 'montage_too_many_parts',
    });
    const busy = withItems(
      clipDoc(VIDEO_A, 0, 60_000),
      Array.from({ length: 60 }, (_, i) => ({ start: i * 900, duration: 500 })),
    );
    expect(createMontage([entry(busy, 0), entry(busy, 1)], { transition: 'cut' })).toEqual({
      ok: false,
      code: 'montage_too_many_parts',
    });
  });

  it('every refusal has its sentence', () => {
    for (const code of MONTAGE_REFUSALS) {
      expect(CLIP_ERROR_MESSAGES[code]).toMatch(/\.$/);
    }
  });
});

describe('the time map with joins', () => {
  const doc = made(
    [entry(clipDoc(VIDEO_A, 10_000, 14_000), 0), entry(clipDoc(VIDEO_B, 0, 4_000), 1)],
    { transition: 'fade' },
  );

  it('overlaps the parts and shortens the clip', () => {
    expect(placeSegments(doc).map((p) => [p.outStart, p.outEnd, p.overlapMs])).toEqual([
      [0, 4_000, 0],
      [3_700, 7_700, 300],
    ]);
    expect(outputDuration(doc)).toBe(7_700);
  });

  it('segmentAt answers the outgoing part until the overlap middle, then the incoming one', () => {
    expect(segmentAt(doc, 3_699)?.index).toBe(0);
    expect(segmentAt(doc, 3_700)?.index).toBe(0);
    expect(segmentAt(doc, 3_849)?.index).toBe(0);
    expect(segmentAt(doc, 3_850)?.index).toBe(1);
    expect(segmentAt(doc, 7_700)?.index).toBe(1);
  });

  it('toOutput places each video moment on its own part', () => {
    expect(toOutput(doc, 'src_1', 13_800)).toBe(3_800);
    expect(toOutput(doc, 'src_2', 0)).toBe(3_700);
    expect(toOutput(doc, 'src_2', 1_000)).toBe(4_700);
  });

  it('joinAt says how far the mix is, and nothing on a cut', () => {
    expect(joinAt(doc, 3_699)).toBeNull();
    expect(joinAt(doc, 3_700)).toMatchObject({ fromIndex: 0, toIndex: 1, progress: 0 });
    expect(joinAt(doc, 3_775)?.progress).toBeCloseTo(0.25, 9);
    expect(joinAt(doc, 4_000)).toBeNull();
    const cut = { ...doc, joins: [] };
    expect(joinAt(cut, 3_800)).toBeNull();
  });

  it('frameState carries the join while inside the overlap', () => {
    const [first, second] = doc.segments;
    expect(frameState(doc, 3_000).join).toBeNull();
    expect(frameState(doc, 3_760).join).toEqual({
      fromSegment: first?.id,
      toSegment: second?.id,
      progress: 0.2,
    });
    expect(frameState(doc, 3_760).segment.id).toBe(first?.id);
    expect(frameState(doc, 3_900).segment.id).toBe(second?.id);
    expect(frameState(doc, 3_900).join?.progress).toBeCloseTo(2 / 3, 9);
    expect(frameState(doc, 4_000).join).toBeNull();
  });
});

describe('withSegmentLayout and montageParts', () => {
  it('sets a layout on every part of the selected part original clip, not on the others', () => {
    const a = clipDoc(VIDEO_A, 10_000, 20_000);
    const b = clipDoc(VIDEO_B, 0, 6_000);
    let doc = made([entry(a, 0), entry(b, 1)], { transition: 'fade' });
    // Split clip two in two: both halves are still clip two.
    const split = splitAt(doc, 12_000);
    expect(split.ok).toBe(true);
    if (split.ok) doc = split.doc;
    expect(doc.segments).toHaveLength(3);
    const blurred: ClipLayout = { ...doc.layout, kind: 'blurred' };
    const next = withSegmentLayout(doc, doc.segments[2]?.id as string, blurred);
    expect(next.segments.map((s) => s.layoutOverride?.kind)).toEqual([
      'fullscreen',
      'blurred',
      'blurred',
    ]);
    expect(montageParts(next).map((p) => [p.title, p.outStart])).toEqual([
      ['Clip 1', 0],
      ['Clip 2', 9_700],
    ]);
    expect(withSegmentLayout(doc, 'nope', blurred)).toBe(doc);
  });

  it('on a clip that is not a montage, sets that one part', () => {
    const base = clipDoc(VIDEO_A, 10_000, 20_000);
    const split = splitAt(base, 5_000);
    const doc = split.ok ? split.doc : base;
    const next = withSegmentLayout(doc, doc.segments[1]?.id as string, {
      ...doc.layout,
      kind: 'blurred',
    });
    expect(next.segments.map((s) => s.layoutOverride?.kind)).toEqual([undefined, 'blurred']);
    expect(montageParts(doc)).toEqual([]);
    expect(segmentLayout(next, doc.segments[0]?.id as string)).toBe(next.layout);
  });

  it('drops the divider of a clip whose first part was removed', () => {
    const doc = made(
      [entry(clipDoc(VIDEO_A, 10_000, 20_000), 0), entry(clipDoc(VIDEO_B, 0, 6_000), 1)],
      { transition: 'cut' },
    );
    const gone = { ...doc, segments: doc.segments.slice(0, 1) };
    expect(montageParts(gone).map((p) => p.title)).toEqual(['Clip 1']);
  });
});

describe('editing a Fade montage keeps its joins and dividers (review fix)', () => {
  const three = () =>
    made(
      [
        entry(clipDoc(VIDEO_A, 10_000, 20_000), 0),
        entry(clipDoc(VIDEO_B, 0, 8_000), 1),
        entry(clipDoc(VIDEO_C, 30_000, 36_000), 2),
      ],
      { transition: 'fade' },
    );

  it("moves the fade and the divider to a clip's new first part when its first part is deleted", () => {
    const doc = three();
    const second = doc.segments[1]?.id as string;
    const split = splitAt(doc, 14_000);
    if (!split.ok) throw new Error(split.code);
    const halves = split.doc.segments.map((segment) => segment.id);
    expect(halves[1]).toBe(second);
    const removed = removeSegment(split.doc, second);
    if (!removed.ok) throw new Error(removed.code);
    const next = halves[2] as string;
    expect(removed.doc.joins?.map((join) => join.beforeSegment)).toEqual([next, halves[3]]);
    expect(removed.doc.meta?.montage?.parts.map((part) => part.firstSegment)).toEqual([
      halves[0],
      next,
      halves[3],
    ]);
    expect(clipDocumentSchema.safeParse(removed.doc).success).toBe(true);
    expect(montageParts(removed.doc).map((part) => part.title)).toEqual([
      'Clip 1',
      'Clip 2',
      'Clip 3',
    ]);
  });

  it('drops the fade of a clip deleted whole, and the document still saves', () => {
    const doc = three();
    const removed = removeSegment(doc, doc.segments[1]?.id as string);
    if (!removed.ok) throw new Error(removed.code);
    expect(removed.doc.joins).toEqual([
      { beforeSegment: doc.segments[2]?.id, kind: 'fade', ms: 300 },
    ]);
    expect(clipDocumentSchema.safeParse(removed.doc).success).toBe(true);
    expect(montageParts(removed.doc).map((part) => part.title)).toEqual(['Clip 1', 'Clip 3']);
    // A stale join from an older save is ignored, not refused.
    const stale = {
      ...removed.doc,
      joins: [
        ...(removed.doc.joins ?? []),
        { beforeSegment: 'gone', kind: 'fade' as const, ms: 300 as const },
      ],
    };
    expect(clipDocumentSchema.safeParse(stale).success).toBe(true);
  });
});
