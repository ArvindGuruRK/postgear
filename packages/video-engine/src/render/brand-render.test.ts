/**
 * The brand kit in the render (Sprint 13, Module 10): an intro from another
 * video of another size and rate, a part's own layout, the closing card, and
 * the rendered clock. The real FFmpeg check is `brand-parity.test.ts` in
 * media-tools.
 */
import { applyBrandKit, brandSourceId } from '../brand/apply';
import type { ClipBrandKit } from '../brand/types';
import type { ClipCard, ClipDocument } from '../document/schema';
import { cardsMs, renderedDuration, renderedMoment } from '../time/cards';
import { buildAss } from './ass';
import { cardLayout } from './card-style';
import { compileFfmpeg, compileMeasure, joinsOtherVideos } from './compile';
import { fontsNeeded } from './fonts';
import { frameState, renderedFrameState } from './frame-state';
import { buildRenderPlan } from './plan';
import { stickerFilesNeeded } from './sticker-plan';
import {
  TEST_ASSET_ID,
  testContextWithFonts,
  testDocument,
  testSegment,
  testSource,
  testStickerAsset,
} from './test-docs';
import { expectedOutputOf } from './verify';

const KIT_ID = '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081';
const INTRO_ID = '3d4e5f60-7182-493a-9c4d-5e6f708192a3';
const INTRO = brandSourceId(INTRO_ID);

const KIT: ClipBrandKit = {
  id: KIT_ID,
  name: 'Acme',
  logo: { assetId: TEST_ASSET_ID, width: 512, height: 512 },
  logoPosition: 'top-right',
  captionStyleId: null,
  intro: { videoId: INTRO_ID, durationMs: 2_000, width: 1280, height: 720 },
  outro: { kind: 'card', text: 'Thanks {for} watching', background: '#101820', colour: '#FFD43B' },
};

function context() {
  return testContextWithFonts({
    assets: {
      sources: {
        src: testSource(),
        [INTRO]: testSource({
          file: 'intro.mp4',
          durationMs: 2_000,
          width: 1280,
          height: 720,
          fps: 25,
        }),
      },
      stickers: { [`asset:${TEST_ASSET_ID}`]: testStickerAsset() },
    },
  });
}

describe('a branded clip in the render plan', () => {
  const base = testDocument([testSegment('body', 10_000, 16_000)], { fadeOutMs: 500 });
  const doc = applyBrandKit(base, KIT);
  const plan = buildRenderPlan(doc, context());

  it('lasts the clip plus its card, and keeps the clip length for the body', () => {
    expect(cardsMs(doc)).toBe(2_000);
    expect(renderedDuration(doc)).toBe(10_000);
    expect(plan.output.durationMs).toBe(10_000);
    expect(plan.cards?.bodyMs).toBe(8_000);
    expect(expectedOutputOf(plan).durationMs).toBe(10_000);
    expect(plan.fades).toEqual({ inMs: 0, outMs: 500 });
  });

  it('reads the intro from its own input, drawn by its own cover layout', () => {
    expect(plan.inputs.map((input) => [input.sourceId, input.file])).toEqual([
      [INTRO, 'intro.mp4'],
      ['src', 'source.mp4'],
    ]);
    const intro = plan.segments[0];
    expect(intro?.picture.areas[0]).toMatchObject({
      crop: { x: 438, y: 0, w: 406, h: 720 },
      width: 1080,
      height: 1920,
    });
    expect(intro?.picture.fillsOutput).toBe(true);
    expect(plan.segments.map((s) => [s.id, s.outStartMs, s.outEndMs])).toEqual([
      ['seg_brand_intro', 0, 2_000],
      ['body', 2_000, 8_000],
    ]);
  });

  it('plans the closing card with the logo centred and the line below it', () => {
    const card = plan.cards?.closing;
    expect(card).toMatchObject({
      place: 'closing',
      durationMs: 2_000,
      background: '#101820',
      assFile: 'card-closing.ass',
      logo: { inputIndex: 3, file: 'sticker-0.png', width: 388, height: 388, x: 346 },
    });
    expect(card?.text?.colour).toBe('#FFD43B');
    expect(card?.text?.startMs).toBe(0);
    expect(card?.text?.endMs).toBe(2_000);
    // The logo sticker on the clip reads input 2; the card's logo comes after.
    expect(plan.stickers.map((s) => s.inputIndex)).toEqual([2]);
    expect(plan.stickers[0]).toMatchObject({ startMs: 0, endMs: 8_000 });
    expect(plan.fonts.files).toContain('inter-700.ttf');
  });

  it('compiles every segment to one format, then the card after the finished clip', () => {
    expect(joinsOtherVideos(plan)).toBe(true);
    const compiled = compileFfmpeg(plan);
    const graph = compiled.filterComplexScript;
    expect(graph).toContain('setpts=PTS-STARTPTS,fps=30,setsar=1,format=yuv420p[v0]');
    expect(graph).toContain('setpts=PTS-STARTPTS,fps=30,setsar=1,format=yuv420p[v1]');
    expect(graph).toContain(
      'color=c=0x101820:s=1080x1920:r=30:d=2.000,format=yuv420p,setsar=1[kcb]',
    );
    expect(graph).toContain('ass=filename=card-closing.ass:fontsdir=fonts[vkc]');
    expect(graph).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=2.000');
    expect(graph).toContain('[vbody][abody][vkc][akc]concat=n=2:v=1:a=1[vout][aout]');
    // The clip's fade ends at the clip's end, not the card's.
    expect(graph).toContain('fade=t=out:st=7.500:d=0.500');
    expect(graph).toContain('apad=whole_dur=8.000,atrim=end=8.000,asetpts=PTS-STARTPTS[abody]');
    expect(compiled.inputs.map((input) => input.file)).toEqual([
      'intro.mp4',
      'source.mp4',
      'sticker-0.png',
      'sticker-0.png',
    ]);
    expect(compiled.outputArgs).toContain('10.000');
    expect(compiled.durationMs).toBe(10_000);
    expect(compiled.assFiles.map((file) => file.name)).toEqual(['card-closing.ass']);
    expect(compiled.fonts?.files).toEqual(['inter-700.ttf']);
    // The braces of the line are written as plain braces, never an override.
    expect(compiled.assFiles[0]?.content).toContain('Thanks \\{for\\} watching');
    expect(graph).toMatchSnapshot('branded graph');
    expect(compiled.assFiles[0]?.content).toMatchSnapshot('card ass');
  });

  it('measures only the clip sound', () => {
    const measure = compileMeasure(plan);
    expect(measure?.durationMs).toBe(8_000);
    expect(measure?.filterComplexScript).not.toContain('card');
  });

  it('asks for the card logo and the card font like any sticker and text', () => {
    expect(stickerFilesNeeded(doc).map((ref) => ref.key)).toEqual([`asset:${TEST_ASSET_ID}`]);
    expect(stickerFilesNeeded({ tracks: [], cards: doc.cards }).map((ref) => ref.key)).toEqual([
      `asset:${TEST_ASSET_ID}`,
    ]);
    expect(fontsNeeded(doc)).toEqual(['Inter']);
  });

  it('refuses a card logo that was not handed in', () => {
    const ctx = context();
    expect(() => buildRenderPlan(doc, { ...ctx, assets: { ...ctx.assets, stickers: {} } })).toThrow(
      expect.objectContaining({ code: 'sticker_missing' }),
    );
  });
});

describe('an opening card and a part with its own layout', () => {
  const opening: ClipCard = {
    text: 'Part One',
    background: '#FFFFFF',
    colour: '#111111',
    logo: null,
    look: 'hook-bold',
    durationMs: 2_000,
  };
  const base = testDocument([testSegment('a', 0, 3_000), testSegment('b', 5_000, 8_000)]);
  const doc: ClipDocument = {
    ...base,
    cards: { opening },
    segments: [
      base.segments[0] as ClipDocument['segments'][number],
      {
        ...(base.segments[1] as ClipDocument['segments'][number]),
        layoutOverride: {
          kind: 'blurred',
          areas: [
            {
              id: 'fit',
              name: 'Video',
              frame: { x: 0, y: 0, w: 1, h: 1 },
              crop: [{ at: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }],
              fit: 'contain',
            },
          ],
        },
      },
    ],
  };
  const plan = buildRenderPlan(doc, testContextWithFonts());

  it("draws the overridden part with its own areas and base, the other with the clip's", () => {
    expect(plan.segments[0]?.picture.base.kind).toBe('colour');
    expect(plan.segments[1]?.picture.base.kind).toBe('blurred');
    expect(plan.segments[1]?.picture.areas[0]).toMatchObject({ width: 1080, height: 608, y: 656 });
    expect(frameState(doc, 4_000).layoutKind).toBe('blurred');
    expect(frameState(doc, 1_000).layoutKind).toBe('fullscreen');
  });

  it('joins the opening card before the clip, drawn in its hook look', () => {
    expect(plan.output.durationMs).toBe(8_000);
    expect(plan.cards?.opening?.text?.main.fontSize).toBeGreaterThan(0);
    expect(plan.fonts.families).toEqual(['Anton']);
    const compiled = compileFfmpeg(plan);
    expect(compiled.filterComplexScript).toContain(
      'color=c=0xFFFFFF:s=1080x1920:r=30:d=2.000,format=yuv420p,setsar=1,ass=filename=card-opening.ass:fontsdir=fonts[vko]',
    );
    expect(compiled.filterComplexScript).toContain(
      '[vko][ako][vbody][abody]concat=n=2:v=1:a=1[vout][aout]',
    );
    expect(buildAss(plan).map((file) => file.name)).toEqual(['card-opening.ass']);
    expect(compiled.filterComplexScript).toMatchSnapshot('opening card graph');
  });

  it('answers the rendered clock: card, then clip time, unchanged for the clip', () => {
    expect(renderedMoment(doc, 500)).toEqual({ card: 'opening', cardMs: 500, clipMs: null });
    expect(renderedMoment(doc, 2_500)).toEqual({ card: null, cardMs: null, clipMs: 500 });
    const during = renderedFrameState(doc, 1_000);
    expect(during.card).toBe('opening');
    expect(during.state.outputMs).toBe(0);
    const after = renderedFrameState(doc, 6_000);
    expect(after.card).toBeNull();
    expect(after.state).toEqual(frameState(doc, 4_000));
    const plain = testDocument([testSegment('a', 0, 3_000)]);
    expect(renderedFrameState(plain, 1_234).state).toEqual(frameState(plain, 1_234));
  });
});

describe('card layout', () => {
  it('centres the logo and the line as one group', () => {
    const card: ClipCard = {
      text: 'Hi',
      background: '#000000',
      colour: '#FFFFFF',
      logo: { asset: TEST_ASSET_ID },
      look: null,
      durationMs: 2_000,
    };
    const layout = cardLayout(card, { width: 1080, height: 1920 }, { width: 100, height: 100 });
    const logo = layout.logo as NonNullable<typeof layout.logo>;
    expect(logo.w).toBeCloseTo(388.8, 6);
    const lineH = 72 * 1.25;
    const textCy = (layout.text?.transform.y ?? 0) * 1920;
    const groupTop = logo.y;
    const groupBottom = textCy + lineH / 2;
    expect(groupTop + groupBottom).toBeCloseTo(1920, 6);
    expect(cardLayout({ ...card, text: '' }, { width: 1080, height: 1920 }, null)).toEqual({
      text: null,
      logo: null,
    });
  });
});
