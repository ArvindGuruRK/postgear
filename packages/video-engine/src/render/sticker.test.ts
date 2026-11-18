import { STICKER_FRAMES_MAX } from '../document/limits';
import { buildAss, playMarkDrawing, roundRectDrawing } from './ass';
import { compileFfmpeg, stickerChain, stickerOverlay } from './compile';
import { isRenderCompileError } from './errors';
import { fontsNeeded } from './fonts';
import { buildRenderPlan } from './plan';
import { type PlanSticker, planStickers, stickerFilesNeeded } from './sticker-plan';
import {
  TEST_ASSET_ID,
  testBadge,
  testContext,
  testContextWithFonts,
  testDocument,
  testSegment,
  testSticker,
  testStickerAsset,
  testText,
  withItems,
} from './test-docs';

const ASSET_KEY = `asset:${TEST_ASSET_ID}`;
const LIBRARY_ID = '33333333-3333-4333-8333-333333333333';

/** A 10 s Vertical clip. */
function clip() {
  return testDocument([testSegment('a', 0, 10_000)]);
}

function contextWith(stickers: Record<string, ReturnType<typeof testStickerAsset>>, watermark = false) {
  const base = testContextWithFonts({ watermark });
  return {
    ...base,
    assets: {
      ...base.assets,
      stickers,
      watermark: watermark ? { file: 'mark.png', width: 400, height: 100 } : null,
    },
  };
}

function plannedSticker(sticker = testSticker('s'), asset = testStickerAsset()): PlanSticker {
  const plan = buildRenderPlan(withItems(clip(), [sticker]), contextWith({ [ASSET_KEY]: asset }));
  const [planned] = plan.stickers;
  if (!planned) throw new Error('no sticker planned');
  return planned;
}

describe('the sticker files a clip needs', () => {
  it('lists each picture file once, in first use order, and no file for a badge', () => {
    const doc = withItems(clip(), [
      testSticker('a', { ref: { library: 'sticker', id: LIBRARY_ID } }),
      testBadge('b'),
      testSticker('c'),
      testSticker('d', { ref: { library: 'sticker', id: LIBRARY_ID }, start: 3_000 }),
    ]);
    expect(stickerFilesNeeded(doc)).toEqual([
      { key: `library:${LIBRARY_ID}`, library: LIBRARY_ID },
      { key: ASSET_KEY, asset: TEST_ASSET_ID },
    ]);
    expect(stickerFilesNeeded(clip())).toEqual([]);
  });
});

describe('stickers in the plan', () => {
  it('scales the box to the output and centres it on the item', () => {
    // 270 canvas px at 1080p is 270 output px; the centre (540, 960) puts the top left at (405, 825), even: (406, 826).
    const planned = plannedSticker();
    expect(planned).toMatchObject({
      inputIndex: 1,
      file: 'sticker-0.png',
      animated: false,
      width: 270,
      height: 270,
      boxWidth: 270,
      boxHeight: 270,
      rotationDeg: 0,
      startMs: 0,
      endMs: 2_000,
    });
    expect(planned.x % 2).toBe(0);
    expect(Math.abs(planned.x + planned.boxWidth / 2 - 540)).toBeLessThanOrEqual(1);
    expect(Math.abs(planned.y + planned.boxHeight / 2 - 960)).toBeLessThanOrEqual(1);
  });

  it('puts a turned sticker in an even box its diagonal wide, still centred', () => {
    const planned = plannedSticker(
      testSticker('s', { transform: { x: 0.25, y: 0.75, scale: 2, rotation: 30, opacity: 0.5 } }),
    );
    expect(planned.width).toBe(540);
    expect(planned.boxWidth).toBe(2 * Math.ceil(Math.hypot(540, 540) / 2));
    expect(planned.boxWidth % 2).toBe(0);
    expect(Math.abs(planned.x + planned.boxWidth / 2 - 270)).toBeLessThanOrEqual(1);
    expect(Math.abs(planned.y + planned.boxHeight / 2 - 1440)).toBeLessThanOrEqual(1);
    expect(planned).toMatchObject({ rotationDeg: 30, opacity: 0.5 });
  });

  it('cuts the window to the clip and leaves out a sticker wholly after it', () => {
    // The schema keeps items inside the clip; the plan still never draws outside it.
    const doc = withItems(clip(), [
      testSticker('in', { start: 9_000, duration: 2_000 }),
      testSticker('out', { start: 10_500, duration: 1_000 }),
    ]);
    const planned = planStickers(
      doc,
      { [ASSET_KEY]: testStickerAsset() },
      { width: 1080, height: 1920, scale: 1, durationMs: 10_000 },
      1,
    );
    expect(planned.map((s) => [s.id, s.startMs, s.endMs])).toEqual([['in', 9_000, 10_000]]);
  });

  it('refuses a sticker whose file was not handed in, naming the item', () => {
    const doc = withItems(clip(), [testSticker('s', { ref: { library: 'sticker', id: LIBRARY_ID } })]);
    try {
      buildRenderPlan(doc, contextWith({ [ASSET_KEY]: testStickerAsset() }));
      throw new Error('expected a refusal');
    } catch (error) {
      expect(isRenderCompileError(error) && error.code).toBe('sticker_missing');
      expect(isRenderCompileError(error) && error.details).toEqual({ itemId: 's', ref: `library:${LIBRARY_ID}` });
    }
  });

  it('refuses a file name that is not a plain name, or a moving picture with no frame rate', () => {
    const doc = withItems(clip(), [testSticker('s')]);
    for (const asset of [
      testStickerAsset({ file: '../x.png' }),
      testStickerAsset({ animated: true, fps: null, frames: 10 }),
      // More frames than the render keeps in memory for a looping sticker.
      testStickerAsset({ animated: true, fps: 20, frames: STICKER_FRAMES_MAX + 1 }),
    ]) {
      expect(() => buildRenderPlan(doc, contextWith({ [ASSET_KEY]: asset }))).toThrow(
        expect.objectContaining({ code: 'invalid_context' }),
      );
    }
  });

  it('counts sticker inputs after the video and puts the mark after them', () => {
    const doc = withItems(clip(), [testSticker('sa'), testSticker('sb', { start: 2_000 })]);
    const plan = buildRenderPlan(doc, contextWith({ [ASSET_KEY]: testStickerAsset() }, true));
    expect(plan.stickers.map((s) => s.inputIndex)).toEqual([1, 2]);
    expect(plan.watermark?.inputIndex).toBe(3);
    const compiled = compileFfmpeg(plan);
    expect(compiled.inputs.map((input) => input.file)).toEqual([
      'source.mp4',
      'sticker-0.png',
      'sticker-0.png',
      'mark.png',
    ]);
  });
});

describe('sticker filters', () => {
  const still: PlanSticker = {
    id: 's',
    inputIndex: 1,
    file: 'sticker-0.png',
    animated: false,
    loop: true,
    fps: null,
    frames: null,
    width: 270,
    height: 270,
    boxWidth: 270,
    boxHeight: 270,
    x: 406,
    y: 826,
    rotationDeg: 0,
    opacity: 1,
    flipX: false,
    startMs: 1_000,
    endMs: 4_000,
  };

  it('draws a still picture once and repeats it, with an endless overlay inside its window', () => {
    expect(stickerChain(still, 30)).toBe(
      'format=rgba,scale=270:270:flags=bicubic,loop=loop=-1:size=1:start=0,setpts=N/(30*TB)',
    );
    expect(stickerOverlay(still)).toBe(
      "overlay=x=406:y=826:enable='between(t,1.000,3.999)':shortest=1:format=yuv420",
    );
  });

  it('flips, turns with transparent corners and fades a translucent one', () => {
    const turned = { ...still, flipX: true, rotationDeg: 30, boxWidth: 370, boxHeight: 370, opacity: 0.5 };
    expect(stickerChain(turned, 30)).toBe(
      'format=rgba,scale=270:270:flags=bicubic,hflip,rotate=a=0.523599:c=none:ow=370:oh=370,' +
        'colorchannelmixer=aa=0.5,loop=loop=-1:size=1:start=0,setpts=N/(30*TB)',
    );
  });

  it('times a moving one by frame number from its start; a looping one repeats its frames before the scale', () => {
    const looping = { ...still, animated: true, fps: 20, frames: 30 };
    expect(stickerChain(looping, 30)).toBe(
      'format=rgba,loop=loop=-1:size=30:start=0,scale=270:270:flags=bicubic,setpts=N/(20*TB)+1.000/TB',
    );
    expect(stickerOverlay(looping)).toContain(':shortest=1:');
    const once = { ...looping, loop: false };
    expect(stickerChain(once, 30)).toBe('format=rgba,scale=270:270:flags=bicubic,setpts=N/(20*TB)+1.000/TB');
    expect(stickerOverlay(once)).toBe("overlay=x=406:y=826:enable='between(t,1.000,3.999)':format=yuv420");
  });

  it('chains the overlays before the text, with no input options (never -stream_loop)', () => {
    const doc = withItems(clip(), [
      testSticker('sa', { start: 0, duration: 1_000 }),
      testText('t', { start: 1_000, duration: 1_000 }),
      testSticker('sb', { start: 2_000, ref: { library: 'sticker', id: LIBRARY_ID }, loop: false }),
    ]);
    const plan = buildRenderPlan(
      doc,
      contextWith({
        [ASSET_KEY]: testStickerAsset(),
        [`library:${LIBRARY_ID}`]: testStickerAsset({ file: 'sticker-1.apng', animated: true, fps: 20, frames: 40 }),
      }),
    );
    const compiled = compileFfmpeg(plan);
    expect(compiled.inputs.slice(1).map((input) => [input.file, input.options])).toEqual([
      ['sticker-0.png', []],
      ['sticker-1.apng', []],
    ]);
    const lines = compiled.filterComplexScript.split(';\n');
    // The last line is the sound's.
    const tail = lines.slice(-7, -1);
    expect(tail[0]).toBe('[vc]fps=30,format=yuv420p[sp0]');
    expect(tail[1]).toMatch(/^\[1:v\]format=rgba,.*\[st0\]$/);
    expect(tail[2]).toMatch(/^\[sp0\]\[st0\]overlay=.*\[sp1\]$/);
    expect(tail[3]).toMatch(/^\[2:v\]format=rgba,.*setpts=N\/\(20\*TB\)\+2\.000\/TB\[st1\]$/);
    expect(tail[4]).toMatch(/^\[sp1\]\[st1\]overlay=.*\[sp2\]$/);
    expect(tail[5]).toBe('[sp2]ass=filename=captions.ass:fontsdir=fonts[vout]');

    const looping = buildRenderPlan(
      withItems(clip(), [testSticker('sa')]),
      contextWith({ [ASSET_KEY]: testStickerAsset({ animated: true, fps: 20, frames: 40 }) }),
    );
    expect(compileFfmpeg(looping).inputs[1]?.options).toEqual([]);
    expect(compileFfmpeg(looping).filterComplexScript).toContain('loop=loop=-1:size=40:start=0');
    // No text and no fades: the last picture label passes straight through.
    expect(compileFfmpeg(looping).filterComplexScript).toContain('[sp1]null[vout]');
  });

  it('leaves the graph of a clip without stickers exactly as before', () => {
    const plan = buildRenderPlan(clip(), testContext());
    expect(compileFfmpeg(plan).filterComplexScript).toContain('[vc]fps=30,format=yuv420p[vout]');
  });
});

describe('the Follow Badge in the text layer', () => {
  it('needs its own font, and is shapes and two lines in the ASS file', () => {
    const doc = withItems(clip(), [testText('t1'), testBadge('b'), testText('t2')]);
    expect(fontsNeeded(doc)).toEqual(['Inter', 'Montserrat']);
    const plan = buildRenderPlan(doc, testContextWithFonts());
    expect(plan.stickers).toEqual([]);
    // Layers: the first text 0, the badge 1 to 5 (pill, disc, mark, then its lines), the last text 6.
    expect(plan.shapes.map((shape) => [shape.kind, shape.layer])).toEqual([
      ['pill', 1],
      ['disc', 2],
      ['mark', 3],
    ]);
    expect(plan.texts.map((text) => [text.id, text.layer])).toEqual([
      ['t1', 0],
      ['b-small', 4],
      ['b-name', 5],
      ['t2', 6],
    ]);
    expect(plan.fonts.families).toContain('Inter');
    expect(plan.fonts.files).toEqual(expect.arrayContaining(['inter-600.ttf', 'inter-800.ttf']));

    const [file] = buildAss(plan);
    const events = (file?.content ?? '').split('\n').filter((line) => line.startsWith('Dialogue:'));
    expect(events.map((line) => line.split(',')[0])).toEqual([
      'Dialogue: 0',
      'Dialogue: 1',
      'Dialogue: 2',
      'Dialogue: 3',
      'Dialogue: 4',
      'Dialogue: 5',
      'Dialogue: 6',
    ]);
    // The pill: top left at (330, 1466), drawn from the origin, Kick's dark fill at 92 percent.
    expect(events[1]).toContain('{\\an7\\pos(330,1466)\\org(540,1536)\\bord0\\shad0\\1c&H111111&\\1a&H14&\\p1}m 70 0 l 350 0');
    expect(events[1]).toMatch(/\{\\p0\}$/);
    // Twitch's disc colour is written blue, green, red.
    expect(events[2]).toContain('\\1c&HFF4691&');
    expect(events[4]).toContain('Follow On Twitch');
    expect(events[5]).toContain('simstreamer');
  });

  it('turns the shapes about their own centres, which the layout already moved', () => {
    const doc = withItems(clip(), [
      testBadge('b', { transform: { x: 0.5, y: 0.5, scale: 1, rotation: 90, opacity: 1 } }),
    ]);
    const plan = buildRenderPlan(doc, testContextWithFonts());
    const [file] = buildAss(plan);
    const disc = (file?.content ?? '').split('\n').find((line) => line.startsWith('Dialogue: 1,'));
    // Upright the disc is 140 px left of the centre (540 - 210 + 70); turned a quarter it is 140 px above.
    expect(disc).toContain('\\org(540,820)');
    expect(disc).toContain('\\frz-90');
  });

  it('draws a round rectangle and the play mark from the origin', () => {
    expect(roundRectDrawing(100, 100, 50)).toBe(
      'm 50 0 l 50 0 b 77.61 0 100 22.39 100 50 l 100 50 b 100 77.61 77.61 100 50 100 l 50 100 ' +
        'b 22.39 100 0 77.61 0 50 l 0 50 b 0 22.39 22.39 0 50 0',
    );
    expect(playMarkDrawing(38, 44)).toBe('m 0 0 l 38 22 l 0 44');
  });
});
