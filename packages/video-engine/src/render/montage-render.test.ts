/**
 * A montage in the render plan and the compiler (Sprint 13, Module 11):
 * parts of several videos of different shapes, each with its own layout
 * (`layoutOverride`), joined by cuts or by Fade joins (`joins`), with a
 * title card and one captions track per video.
 *
 * - Cuts keep one `concat`; Fade joins chain `xfade` and `acrossfade` with
 *   offsets computed from the time map (`joinOverlaps`), and cuts between
 *   two fades stay a `concat` group.
 * - Every chain ends in the output size, SAR 1, the rate and `yuv420p`.
 * - A part whose start lies inside a fade still draws its own layout.
 * - Bleeps, items and captions sit on the clip's clock with the overlaps
 *   taken off; the title card is the opening card in its hook look.
 * - The output check compares against the length with overlaps and cards.
 */
import { builtInCaptionStyle, type CaptionLook } from '../captions';
import type {
  CaptionsTrack,
  ClipDocument,
  ClipLayout as Layout,
  Segment,
} from '../document/schema';
import type { Transcript } from '../transcript';
import { createClipDocument } from '../document/create';
import { createMontage } from '../montage';
import { pickSourceFiles, sourceFilesSharp } from '../sources';
import { outputDuration, placeSegments } from '../time/time-map';
import { buildAss } from './ass';
import { cardAssFile } from './card-plan';
import { compileFfmpeg, compileMeasure, cutFades } from './compile';
import { FONT_MANIFEST } from './fonts-manifest';
import { resolveTextFont } from './fonts';
import { frameState } from './frame-state';
import { buildRenderPlan, type RenderContext } from './plan';
import {
  TEST_ASSET_ID,
  testContextWithFonts,
  testSource,
  testSticker,
  testStickerAsset,
} from './test-docs';
import { expectedOutputOf, type RenderedFileFacts, verifyOutput } from './verify';

const VIDEO_A = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
const VIDEO_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const TRANSCRIPT_B = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
/** A 9:16 crop of a 16:9 picture's width. */
const NARROW = 0.31640625;

function fullscreen(id: string, crop: Layout['areas'][number]['crop']): Layout {
  return {
    kind: 'fullscreen',
    areas: [{ id, name: 'Video', frame: { x: 0, y: 0, w: 1, h: 1 }, crop, fit: 'cover' }],
  };
}

const CENTRED = fullscreen('main', [
  { at: 0, rect: { x: (1 - NARROW) / 2, y: 0, w: NARROW, h: 1 } },
]);
/** Video B is square: the whole picture, cover-fitted (the plan narrows it to 9:16). */
const SQUARE = fullscreen('b', [{ at: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }]);
/** A crop that pans across video A from its left edge (5 s) to its right edge (7 s). */
const PAN = fullscreen('pan', [
  { at: 5_000, rect: { x: 0, y: 0, w: NARROW, h: 1 } },
  { at: 7_000, rect: { x: 1 - NARROW, y: 0, w: NARROW, h: 1 } },
]);

function part(
  id: string,
  source: string,
  sourceIn: number,
  sourceOut: number,
  layoutOverride?: Layout,
): Segment {
  return {
    id,
    source,
    sourceIn,
    sourceOut,
    speed: 1,
    volume: 1,
    ...(layoutOverride ? { layoutOverride } : {}),
  };
}

/** Three 2 s parts: A (the document's layout), B (its own square fit), A again (a pan of its own). */
function montage(options: { fadeBefore?: string[]; title?: boolean; segments?: Segment[] } = {}) {
  const doc: ClipDocument = {
    schemaVersion: 2,
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
    sources: [
      { id: 'srcA', videoId: VIDEO_A },
      { id: 'srcB', videoId: VIDEO_B },
    ],
    segments: options.segments ?? [
      part('p1', 'srcA', 1_000, 3_000),
      part('p2', 'srcB', 1_000, 3_000, SQUARE),
      part('p3', 'srcA', 5_000, 7_000, PAN),
    ],
    layout: CENTRED,
    zooms: [],
    looks: { colour: 'none', strength: 0, vignette: 0 },
    fades: { inMs: 0, outMs: 0 },
    tracks: [],
    bleeps: [],
  };
  if (options.fadeBefore) {
    doc.joins = options.fadeBefore.map((id) => ({ beforeSegment: id, kind: 'fade', ms: 300 }));
  }
  if (options.title) {
    doc.cards = {
      opening: {
        text: 'Best Of The Week',
        background: '#111111',
        colour: '#FFFFFF',
        logo: null,
        look: 'hook-bold',
        durationMs: 2_000,
      },
    };
  }
  return doc;
}

function context(overrides: Partial<RenderContext['assets']> = {}): RenderContext {
  const base = testContextWithFonts();
  return {
    ...base,
    assets: {
      ...base.assets,
      sources: {
        srcA: testSource({ file: 'source-0.mp4', durationMs: 10_000, width: 1280, height: 720 }),
        srcB: testSource({
          file: 'source-1.mp4',
          durationMs: 10_000,
          width: 720,
          height: 720,
          fps: 25,
        }),
      },
      ...overrides,
    },
  };
}

const graphOf = (doc: ClipDocument, ctx = context()) =>
  compileFfmpeg(buildRenderPlan(doc, ctx)).filterComplexScript;

describe('a montage of cuts', () => {
  const doc = montage();
  const plan = buildRenderPlan(doc, context());
  const graph = compileFfmpeg(plan).filterComplexScript;

  it('joins every part with one concat and plays them back to back', () => {
    expect(plan.output.durationMs).toBe(6_000);
    expect(plan.segments.map((s) => [s.outStartMs, s.outEndMs])).toEqual([
      [0, 2_000],
      [2_000, 4_000],
      [4_000, 6_000],
    ]);
    expect(plan.segments.every((s) => s.overlapMs === undefined)).toBe(true);
    expect(graph).toContain('[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[vc][ac]');
    expect(graph).not.toContain('xfade');
    expect(graph).not.toContain('acrossfade');
  });

  it('ends every chain in the output size, SAR 1, the rate, yuv420p and 48 kHz stereo', () => {
    const chains = graph.split(';\n').filter((line) => /\[v\d\]$/.test(line));
    expect(chains).toHaveLength(3);
    for (const chain of chains) {
      expect(chain).toMatch(/setpts=PTS-STARTPTS,fps=30,setsar=1,format=yuv420p\[v\d\]$/);
    }
    // Part 2 is the square video: its own crop, cover-fitted to the 9:16 canvas, and no pad.
    expect(plan.segments[1]?.picture.areas[0]?.crop).toEqual({ x: 158, y: 0, w: 406, h: 720 });
    expect(plan.segments[1]?.picture.fillsOutput).toBe(true);
    const sounds = graph.split(';\n').filter((line) => /\[a\d\]$/.test(line));
    expect(sounds).toHaveLength(3);
    for (const sound of sounds) {
      expect(sound).toContain('aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo');
    }
  });

  it("draws a part's own moving crop with its own command file, keyed on its run's clock", () => {
    const pan = plan.segments[2]?.picture.areas[0];
    expect(pan?.path?.file).toBe('crop-s2-a0.txt');
    // The run is seeked to 4 s (a second before the part), so the keys are 1 s and 3 s.
    expect(pan?.path?.keys.map((key) => key.ms)).toEqual([1_000, 3_000]);
    expect(pan?.path?.keys[0]?.x).toBe(0);
    expect(pan?.path?.keys[1]?.x).toBeCloseTo(1280 - pan.crop.w, 0);
    // The part of A with no override keeps the document's centred crop, which does not move.
    expect(plan.segments[0]?.picture.areas[0]?.path).toBeUndefined();
    expect(compileFfmpeg(plan).commandFiles.map((file) => file.name)).toEqual(['crop-s2-a0.txt']);
  });

  it("draws a followed part's own crop path (a layout override with `follow`)", () => {
    const followed: Layout = {
      ...PAN,
      follow: { mode: 'speaker', faceAssetId: TRANSCRIPT_B, overrides: [], saved: CENTRED },
    };
    const doc = montage({
      segments: [
        part('p1', 'srcA', 1_000, 3_000),
        part('p2', 'srcB', 1_000, 3_000, SQUARE),
        part('p3', 'srcA', 5_000, 7_000, followed),
      ],
    });
    const followedPlan = buildRenderPlan(doc, context());
    expect(followedPlan.segments[2]?.picture.areas[0]?.path).toEqual(
      plan.segments[2]?.picture.areas[0]?.path,
    );
    const file = compileFfmpeg(followedPlan).commandFiles[0];
    expect(file?.name).toBe('crop-s2-a0.txt');
    expect(file?.content.split('\n')[0]).toMatch(
      /^1\.000-3\.000 crop@s2a0 x '0\+\d+(\.\d+)?\*\(t-1\.000\)';$/,
    );
  });
});

describe('a montage with Fade joins', () => {
  const doc = montage({ fadeBefore: ['p2', 'p3'] });
  const plan = buildRenderPlan(doc, context());
  const compiled = compileFfmpeg(plan);
  const graph = compiled.filterComplexScript;

  it('is 0.3 s shorter per join, each part starting inside the one before', () => {
    expect(plan.output.durationMs).toBe(5_400);
    expect(compiled.durationMs).toBe(5_400);
    expect(compiled.outputArgs.join(' ')).toContain('-t 5.400');
    expect(plan.segments.map((s) => [s.outStartMs, s.outEndMs, s.overlapMs])).toEqual([
      [0, 2_000, undefined],
      [1_700, 3_700, 300],
      [3_400, 5_400, 300],
    ]);
  });

  it('chains xfade and acrossfade in order, with offsets in the output of the join before', () => {
    const lines = graph.split(';\n');
    expect(lines).toContain('[v0][v1]xfade=transition=fade:duration=0.300:offset=1.700[vx1]');
    expect(lines).toContain('[a0][a1]acrossfade=d=0.300:c1=tri:c2=tri[ax1]');
    expect(lines).toContain('[vx1][v2]xfade=transition=fade:duration=0.300:offset=3.400[vc]');
    expect(lines).toContain('[ax1][a2]acrossfade=d=0.300:c1=tri:c2=tri[ac]');
    expect(graph).not.toContain('concat');
  });

  it('gives no 15 ms cut fade at a Fade join (acrossfade mixes it)', () => {
    expect(cutFades(plan)).toEqual([
      { inMs: 0, outMs: 0 },
      { inMs: 0, outMs: 0 },
      { inMs: 0, outMs: 0 },
    ]);
  });

  it("draws each part's own layout although its start lies inside the fade", () => {
    // At part 2's start the time map still answers part 1 (the overlap's first half).
    expect(frameState(doc, 1_700).segment.id).toBe('p1');
    expect(plan.segments[1]?.picture.areas[0]?.id).toBe('b');
    expect(plan.segments[1]?.picture.areas[0]?.crop).toEqual({ x: 158, y: 0, w: 406, h: 720 });
    expect(plan.segments[2]?.picture.areas[0]?.id).toBe('pan');
    expect(plan.segments[2]?.picture.areas[0]?.crop.x).toBe(0);
    // Without joins the same parts draw the same pictures.
    const cut = buildRenderPlan(montage(), context());
    expect(plan.segments.map((s) => s.picture)).toEqual(cut.segments.map((s) => s.picture));
  });

  it('mixes the measuring pass the same way', () => {
    const measure = compileMeasure(plan)?.filterComplexScript ?? '';
    expect(measure).toContain('[a0][a1]acrossfade=d=0.300:c1=tri:c2=tri[ax1]');
    expect(measure).toContain('[ax1][a2]acrossfade=d=0.300:c1=tri:c2=tri[ac]');
    expect(measure).not.toContain('xfade=');
  });

  it('passes the output check only at the shortened length', () => {
    const expected = expectedOutputOf(plan);
    expect(expected.durationMs).toBe(5_400);
    const facts: RenderedFileFacts = {
      durationMs: 5_400,
      width: plan.output.width,
      height: plan.output.height,
      fps: 30,
      codec: 'h264',
      profile: 'High',
      pixFmt: 'yuv420p',
      keyframesMs: [0, 2_000, 4_000],
      moovFirst: true,
      bytes: 1,
    };
    expect(verifyOutput(facts, expected)).toEqual([]);
    expect(verifyOutput({ ...facts, durationMs: 6_000 }, expected)).toEqual(['duration']);
  });
});

describe('cuts and fades in one montage', () => {
  it('keeps the parts between two fades as one concat group', () => {
    const doc = montage({
      fadeBefore: ['p3'],
      segments: [
        part('p1', 'srcA', 1_000, 2_000),
        part('p2', 'srcA', 2_500, 4_000),
        part('p3', 'srcB', 1_000, 3_000, SQUARE),
        part('p4', 'srcB', 4_000, 5_000, SQUARE),
      ],
    });
    const plan = buildRenderPlan(doc, context());
    const lines = compileFfmpeg(plan).filterComplexScript.split(';\n');
    expect(plan.output.durationMs).toBe(1_000 + 1_500 + 2_000 + 1_000 - 300);
    expect(lines).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vg0][ag0]');
    expect(lines).toContain('[v2][a2][v3][a3]concat=n=2:v=1:a=1[vg1][ag1]');
    // 2.5 s of the first group, less the 0.3 s overlap.
    expect(lines).toContain('[vg0][vg1]xfade=transition=fade:duration=0.300:offset=2.200[vc]');
    expect(lines).toContain('[ag0][ag1]acrossfade=d=0.300:c1=tri:c2=tri[ac]');
    expect(plan.segments[2]?.outStartMs).toBe(2_200);
    // The cut inside a group still gets its 15 ms fades; the fade join gets none.
    expect(cutFades(plan).map((f) => [f.inMs, f.outMs])).toEqual([
      [0, 15],
      [15, 0],
      [0, 15],
      [15, 0],
    ]);
  });

  it('a join before a part that is gone, or before the first part, is a cut', () => {
    const doc = montage({ fadeBefore: ['p1'] });
    expect(graphOf(doc)).toContain('concat=n=3');
    expect(buildRenderPlan(doc, context()).output.durationMs).toBe(6_000);
  });
});

describe('the clock after the joins', () => {
  it('moves bleeps earlier by each earlier overlap, and the preview reads the same ones', () => {
    const doc = montage({ fadeBefore: ['p2', 'p3'] });
    doc.bleeps = [{ id: 'bl', source: 'srcA', from: 5_500, to: 5_800, mode: 'bleep' }];
    const plan = buildRenderPlan(doc, context());
    // Part 3 starts at 3.4 s; the bleep is half a second into it.
    expect(plan.bleeps).toEqual([{ id: 'bl', mode: 'bleep', fromMs: 3_900, toMs: 4_200 }]);
    expect(frameState(doc, 4_000).bleeps.map((b) => b.id)).toEqual(['bl']);
    expect(frameState(doc, 4_300).bleeps).toEqual([]);
    const cut = montage();
    cut.bleeps = doc.bleeps;
    expect(buildRenderPlan(cut, context()).bleeps[0]?.fromMs).toBe(4_500);
  });

  it('accepts items and sounds that run to the shortened end, and draws stickers on its clock', () => {
    const doc = montage({ fadeBefore: ['p2', 'p3'] });
    const length = outputDuration(doc);
    doc.tracks = [
      {
        id: 'ov',
        kind: 'overlay',
        items: [testSticker('st', { start: 3_900, duration: length - 3_900 })],
      },
    ];
    const plan = buildRenderPlan(
      doc,
      context({ stickers: { [`asset:${TEST_ASSET_ID}`]: testStickerAsset() } }),
    );
    expect(plan.stickers[0]?.startMs).toBe(3_900);
    expect(plan.stickers[0]?.endMs).toBe(5_400);
    expect(compileFfmpeg(plan).filterComplexScript).toContain("enable='between(t,3.900,5.399)'");
  });
});

describe('the title card', () => {
  const doc = montage({ fadeBefore: ['p2', 'p3'], title: true });
  const plan = buildRenderPlan(doc, context());
  const compiled = compileFfmpeg(plan);

  it('plays 2 s before the montage, in the hook look, and the check counts it', () => {
    expect(plan.cards?.bodyMs).toBe(5_400);
    expect(plan.output.durationMs).toBe(7_400);
    expect(expectedOutputOf(plan).durationMs).toBe(7_400);
    const card = plan.cards?.opening;
    expect(card?.background).toBe('#111111');
    expect(card?.assFile).toBe(cardAssFile('opening'));
    // The first clip's hook look (Hook Bold: Anton), not the plain card text (Inter).
    expect(card?.text?.main.psName).toBe(resolveTextFont(FONT_MANIFEST, 'Anton', 400)?.psName);
    const file = compiled.assFiles.find((f) => f.name === 'card-opening.ass');
    expect(file?.content).toContain('BEST OF THE WEEK');
    expect(plan.fonts.families).toContain('Anton');
  });

  it('joins the card before the faded montage', () => {
    const lines = compiled.filterComplexScript.split(';\n');
    expect(lines).toContain('[vx1][v2]xfade=transition=fade:duration=0.300:offset=3.400[vc]');
    expect(lines.some((line) => line.startsWith('color=c=0x111111:s=1080x1920:r=30:d=2.000'))).toBe(
      true,
    );
    expect(lines.at(-1)?.trim()).toBe('[vko][ako][vbody][abody]concat=n=2:v=1:a=1[vout][aout]');
  });
});

describe('one captions track per video', () => {
  const look = (builtInCaptionStyle('bold-pop') as { look: CaptionLook }).look;
  function transcript(texts: string[], startMs: number): Transcript {
    return {
      version: 1,
      language: 'en',
      model: 'test',
      source: 'listened',
      covered: [{ fromMs: 0, toMs: 60_000 }],
      words: texts.map((text, i) => ({
        i,
        start: startMs + i * 400,
        end: startMs + i * 400 + 300,
        text,
        sure: 0.9,
      })),
      nextIndex: texts.length,
    };
  }
  function track(
    id: string,
    source: string,
    overrides: Partial<CaptionsTrack> = {},
  ): CaptionsTrack {
    return {
      id,
      kind: 'captions',
      transcriptAssetId: id === 'ccA' ? TEST_ASSET_ID : TRANSCRIPT_B,
      source,
      language: 'en',
      styleId: 'bold-pop',
      position: { x: 0.5, y: 0.72 },
      sizePx: look.sizePx,
      maxWords: 1,
      edits: {},
      ...overrides,
    };
  }
  const doc = montage({ fadeBefore: ['p2', 'p3'] });
  doc.tracks = [
    track('ccA', 'srcA'),
    // Its own place and size are not used: the montage draws every track in the first one's style.
    track('ccB', 'srcB', {
      position: { x: 0.5, y: 0.2 },
      sizePx: 60,
      edits: { '1': { text: 'Sky' } },
    }),
  ];
  const ctx = context({
    captionsByTrack: {
      ccA: { transcript: transcript(['Alpha', 'Beta'], 1_200), look, wordTimed: true },
      ccB: { transcript: transcript(['Green', 'Blue'], 1_200), look, wordTimed: true },
    },
  });

  it("writes every track's words into one ASS file, in the first track's style", () => {
    const plan = buildRenderPlan(doc, ctx);
    expect(plan.captions?.layout.words.map((w) => w.text)).toEqual(['Alpha', 'Beta']);
    expect(plan.moreCaptions?.map((c) => c.layout.words.map((w) => w.text))).toEqual([
      ['Green', 'Sky'],
    ]);
    const files = buildAss(plan);
    expect(files.map((f) => f.name)).toEqual(['captions.ass']);
    const content = files[0]?.content ?? '';
    expect(content.split('\n').filter((line) => line.startsWith('Style: '))).toHaveLength(1);
    const events = content.split('\n').filter((line) => line.startsWith('Dialogue: '));
    // A's words at 0.2 s and 0.6 s of part 1; B's at 0.2 s and 0.6 s of part 2, which starts at 1.7 s.
    const at = (word: string) =>
      events
        .find((line) => line.includes(word))
        ?.split(',')
        .slice(1, 2)[0];
    expect(at('ALPHA')).toBe('0:00:00.20');
    expect(at('GREEN')).toBe('0:00:01.90');
    expect(at('SKY')).toBe('0:00:02.30');
    // Same place for both tracks.
    expect(events.every((line) => line.includes('\\pos(540,1382.4)'))).toBe(true);
  });

  it('stops with captions_missing when a track has no words handed in', () => {
    const missing = context({
      captionsByTrack: {
        ccA: { transcript: transcript(['Alpha'], 1_200), look, wordTimed: true },
      },
    });
    expect(() => buildRenderPlan(doc, missing)).toThrow(
      expect.objectContaining({ code: 'captions_missing' }),
    );
  });

  it('keeps one track exactly as before', () => {
    const one = montage();
    one.tracks = [track('ccA', 'srcA')];
    const plan = buildRenderPlan(
      one,
      context({ captions: { transcript: transcript(['Alpha'], 1_200), look, wordTimed: true } }),
    );
    expect(plan.moreCaptions).toBeUndefined();
    expect(plan.captions?.layout.words.map((w) => w.segmentId)).toEqual(['p1']);
  });
});

describe('a montage made by createMontage', () => {
  function made(transition: 'cut' | 'fade'): ClipDocument {
    const result = createMontage(
      [
        {
          id: '11111111-2222-4333-8444-555555555555',
          title: 'First',
          document: createClipDocument({
            videoId: VIDEO_A,
            fromMs: 1_000,
            toMs: 4_000,
            ratio: '9:16',
          }),
        },
        {
          id: '22222222-3333-4444-8555-666666666666',
          title: 'Second',
          document: createClipDocument({
            videoId: VIDEO_B,
            fromMs: 2_000,
            toMs: 6_000,
            ratio: '1:1',
          }),
        },
      ],
      { ratio: '9:16', transition, titleCard: 'Best Of' },
    );
    if (!result.ok) throw new Error(`refused: ${result.code}`);
    return result.document;
  }

  function madeContext(doc: ClipDocument): RenderContext {
    const base = context();
    const byVideo: Record<string, RenderContext['assets']['sources'][string]> = {
      [VIDEO_A]: base.assets.sources.srcA as RenderContext['assets']['sources'][string],
      [VIDEO_B]: base.assets.sources.srcB as RenderContext['assets']['sources'][string],
    };
    return {
      ...base,
      assets: {
        ...base.assets,
        sources: Object.fromEntries(doc.sources.map((s) => [s.id, byVideo[s.videoId]])) as never,
      },
    };
  }

  it('compiles its fade with offsets from the time map, each part in its own layout, after its title', () => {
    const doc = made('fade');
    const plan = buildRenderPlan(doc, madeContext(doc));
    const graph = compileFfmpeg(plan).filterComplexScript;
    expect(plan.cards?.bodyMs).toBe(3_000 + 4_000 - 300);
    expect(plan.output.durationMs).toBe(3_000 + 4_000 - 300 + 2_000);
    const placed = placeSegments(doc);
    const second = placed[1] as (typeof placed)[number];
    expect(second.overlapMs).toBe(300);
    expect(graph).toContain(
      `[v0][v1]xfade=transition=fade:duration=0.300:offset=${(second.outStart / 1000).toFixed(3)}[vc]`,
    );
    // Each part reads its own video in its own fit: A's 16:9 picture and B's square one.
    plan.segments.forEach((planned, k) => {
      const own = doc.segments[k]?.layoutOverride ?? doc.layout;
      expect(planned.picture.areas.map((a) => a.id)).toEqual(own.areas.map((a) => a.id));
    });
    expect(plan.cards?.opening?.text).not.toBeNull();
    expect(plan.cards?.opening?.background).toBe('#111111');
  });

  it('compiles its cut with one concat', () => {
    const doc = made('cut');
    const graph = compileFfmpeg(buildRenderPlan(doc, madeContext(doc))).filterComplexScript;
    expect(graph).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][ac]');
    expect(graph).not.toContain('xfade');
  });
});

describe('which files a montage reads (pickSourceFiles)', () => {
  const at = new Date('2026-11-20T10:00:00Z');
  const seg = (id: string, fromMs: number, toMs: number, height = 1080) => ({
    id,
    kind: 'SEGMENT',
    meta: { fromMs, toMs, height, fps: 30 },
    createdAt: at,
  });
  const proxy = { id: 'proxy', kind: 'PROXY', meta: {}, createdAt: at };

  it('picks one covering file per source, as pickSharpSource always did', () => {
    const doc = montage();
    const files = pickSourceFiles(doc, (videoId) =>
      videoId === VIDEO_A ? [seg('a', 0, 8_000), proxy] : [seg('b', 0, 4_000), proxy],
    );
    expect(files.map((f) => [f.sourceId, f.picked?.asset.id, f.parts, f.sharp])).toEqual([
      ['srcA', 'a', undefined, true],
      ['srcB', 'b', undefined, true],
    ]);
    expect(sourceFilesSharp(files)).toBe(true);
  });

  it('picks per part for a montage when no single file covers a source', () => {
    const doc = montage();
    doc.meta = {
      montage: {
        parts: [
          { clipId: 'clip_a', title: 'A', firstSegment: 'p1' },
          { clipId: 'clip_b', title: 'B', firstSegment: 'p2' },
        ],
      },
    };
    const assets = (videoId: string) =>
      videoId === VIDEO_A ? [seg('early', 0, 4_000), seg('late', 4_000, 8_000), proxy] : [proxy];
    const files = pickSourceFiles(doc, assets);
    expect(files[0]?.parts?.map((p) => [p.segmentId, p.picked?.asset.id])).toEqual([
      ['p1', 'early'],
      ['p3', 'late'],
    ]);
    expect(files[0]?.sharp).toBe(true);
    // B has only its light copy: the export is not sharp.
    expect(files[1]?.parts?.map((p) => p.picked?.asset.id)).toEqual(['proxy']);
    expect(sourceFilesSharp(files)).toBe(false);
    // A clip that is not a montage keeps the one-file rule: the light copy for the whole source.
    const single = pickSourceFiles({ ...doc, meta: undefined }, assets);
    expect(single[0]?.parts).toBeUndefined();
    expect(single[0]?.picked?.asset.id).toBe('proxy');
  });

  it("plans a part read from its own file as its own run, against that file's offset", () => {
    const base = context();
    const own = testSource({ file: 'source-2.mp4', sourceOffsetMs: 4_000, durationMs: 4_000 });
    const plan = buildRenderPlan(montage(), {
      ...base,
      assets: { ...base.assets, segmentSources: { p3: own } },
    });
    expect(plan.inputs.map((i) => [i.file, i.seekMs])).toEqual([
      ['source-0.mp4', null],
      ['source-1.mp4', null],
      ['source-2.mp4', null],
    ]);
    expect(plan.segments[2]?.trimStartMs).toBe(1_000);
    expect(plan.segments[2]?.trimEndMs).toBe(3_000);
  });
});
