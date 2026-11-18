import type { OverlayTrack } from '../document/schema';
import { copyTextStyle, textStylePreset } from '../document/text';
import { assAlpha, buildAss, escapeAssText } from './ass';
import { compileFfmpeg } from './compile';
import { isRenderCompileError, type RenderCompileError } from './errors';
import {
  familyWeights,
  lineHeightEm,
  missingCharacters,
  nearestWeight,
  resolveTextFont,
  textBoxMetrics,
  textRuns,
} from './fonts';
import { FONT_MANIFEST } from './fonts-manifest';
import { frameState } from './frame-state';
import { buildRenderPlan } from './plan';
import {
  testContext,
  testContextWithFonts,
  testDocument,
  testSegment,
  testText,
  withTexts,
} from './test-docs';
import { planTexts, textFadeAt, textFades, textGeometry } from './text-plan';
import { ffmpegArgsFor } from './types';

/** A 10 s Vertical clip. */
function tenSeconds() {
  return testDocument([testSegment('seg', 0, 10_000)]);
}

function compileError(fn: () => unknown): RenderCompileError {
  try {
    fn();
  } catch (error) {
    if (isRenderCompileError(error)) return error;
    throw error;
  }
  throw new Error('Expected a RenderCompileError');
}

describe('the font manifest', () => {
  it('has every weight of a variable family and the one weight of a static one', () => {
    expect(familyWeights(FONT_MANIFEST, 'Montserrat')).toEqual([
      100, 200, 300, 400, 500, 600, 700, 800, 900,
    ]);
    expect(familyWeights(FONT_MANIFEST, 'anton')).toEqual([400]);
    expect(familyWeights(FONT_MANIFEST, 'Noto Sans Tamil')).toEqual([]);
  });

  it('never names a twin after the family (reserved font names stay out of the files)', () => {
    for (const entry of FONT_MANIFEST.fonts) {
      expect(entry.assName).toMatch(/^PGF [0-9a-f]{6} [1-9]00$/);
      expect(entry.psName).toBe(entry.assName.replace(/ /g, '-'));
      expect(entry.assName.toLowerCase()).not.toContain(entry.family.toLowerCase());
    }
    const names = FONT_MANIFEST.fonts.map((entry) => entry.psName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('picks the nearest weight, the heavier one on a tie', () => {
    expect(nearestWeight([400, 700], 550)).toBe(700);
    expect(nearestWeight([400, 700], 500)).toBe(400);
    expect(nearestWeight([], 400)).toBeNull();
    expect(resolveTextFont(FONT_MANIFEST, 'Anton', 800)?.weight).toBe(400);
    expect(resolveTextFont(FONT_MANIFEST, 'montserrat', 800)?.file).toBe('montserrat-800.ttf');
    expect(resolveTextFont(FONT_MANIFEST, 'Comic Sans MS', 400)).toBeNull();
  });

  it('spaces lines as libass does: the font own ascent plus descent', () => {
    const entry = resolveTextFont(FONT_MANIFEST, 'Montserrat', 800);
    if (!entry) throw new Error('no Montserrat');
    expect(lineHeightEm(entry)).toBeCloseTo(1.562, 3);
    const metrics = textBoxMetrics({ font: 'Montserrat', weight: 800, size: 76 }, FONT_MANIFEST, 2);
    expect(metrics?.lineHeightPx).toBeCloseTo(152 * 1.562, 2);
    expect(metrics?.assFontSize).toBe(237.42);
  });
});

describe('text runs and fallbacks', () => {
  const main = resolveTextFont(FONT_MANIFEST, 'Montserrat', 800);
  if (!main) throw new Error('no Montserrat');

  it('sends Tamil, Hindi and the rupee sign to the Noto twins and keeps each cluster whole', () => {
    const result = textRuns('Hi வணக்கம் नमस्ते ₹99', main, FONT_MANIFEST);
    if (!result.ok) throw new Error(result.missing.join(''));
    expect(result.runs.map((run) => [run.text, run.entry.fontId])).toEqual([
      ['Hi ', 'montserrat'],
      ['வணக்கம்', 'noto-sans-tamil'],
      [' ', 'montserrat'],
      ['नमस्ते', 'noto-sans-devanagari'],
      [' ', 'montserrat'],
      ['₹', 'noto-sans-devanagari'],
      ['99', 'montserrat'],
    ]);
    // A heavy text gets the bold fallback.
    expect(result.runs[1]?.entry.weight).toBe(700);
  });

  it('reports letters no font has, each once', () => {
    expect(missingCharacters('中文 中', 'Montserrat', 800, FONT_MANIFEST)).toEqual(['中', '文']);
    expect(missingCharacters('Hello வணக்கம்', 'Montserrat', 800, FONT_MANIFEST)).toEqual([]);
    expect(missingCharacters('anything', 'Comic Sans MS', 400, FONT_MANIFEST)).toEqual([]);
  });
});

describe('text geometry and fades', () => {
  it('centres the box on the item and scales size, backing and shadow with it', () => {
    const item = testText('t', {
      transform: { x: 0.5, y: 0.3, scale: 2, rotation: 0, opacity: 1 },
    });
    expect(textGeometry(item, { width: 1080, height: 1920 })).toEqual({
      cx: 540,
      cy: 576,
      boxLeft: 540 - 864,
      boxWidth: 1728,
      sizePx: 152,
      backingPx: 10,
      shadowPx: 0,
    });
    const boxed = testText('b', { style: copyTextStyle(textStylePreset('on-a-box').style) });
    expect(textGeometry(boxed, { width: 1080, height: 1920 }).backingPx).toBe(18);
    const plain = testText('p', { style: copyTextStyle(textStylePreset('plain').style) });
    expect(textGeometry(plain, { width: 1080, height: 1920 }).shadowPx).toBe(4);
  });

  it('never lets the two fades overlap, and fades the opacity frameState reports', () => {
    expect(textFades({ fadeInMs: 500, fadeOutMs: 2_000, duration: 1_000 })).toEqual({
      inMs: 500,
      outMs: 500,
    });
    const item = testText('t', { start: 1_000, duration: 2_000, fadeInMs: 500, fadeOutMs: 200 });
    expect(textFadeAt(item, 0)).toBe(0);
    expect(textFadeAt(item, 250)).toBeCloseTo(0.5, 12);
    expect(textFadeAt(item, 1_000)).toBe(1);
    expect(textFadeAt(item, 1_900)).toBeCloseTo(0.5, 12);
    const doc = withTexts(tenSeconds(), [
      { ...item, transform: { ...item.transform, opacity: 0.8 } },
    ]);
    expect(frameState(doc, 1_250).overlays[0]?.opacity).toBeCloseTo(0.4, 12);
    expect(frameState(doc, 2_000).overlays[0]?.opacity).toBeCloseTo(0.8, 12);
    expect(frameState(doc, 2_000).overlays[0]?.item).toBe((doc.tracks[0] as OverlayTrack).items[0]);
  });
});

describe('planTexts', () => {
  it('refuses a family the manifest lacks and a letter no font has, naming the letter', () => {
    const unknown = withTexts(tenSeconds(), [
      testText('t', { style: { ...testText('t').style, font: 'Comic Sans MS' } }),
    ]);
    expect(compileError(() => planTexts(unknown, FONT_MANIFEST)).code).toBe('font_missing');
    expect(compileError(() => planTexts(unknown, null)).code).toBe('font_missing');
    const chinese = withTexts(tenSeconds(), [testText('t', { text: 'Hi 中' })]);
    const error = compileError(() => planTexts(chinese, FONT_MANIFEST));
    expect(error.code).toBe('font_missing');
    expect(error.details).toMatchObject({ itemId: 't', characters: 'U+4E2D' });
  });

  it('plans upper case, layers in track order and the fonts the worker copies', () => {
    const doc = withTexts(tenSeconds(), [
      testText('a', { text: 'big news', style: { ...testText('a').style, uppercase: true } }),
      testText('b', { text: 'வணக்கம்', start: 1_000 }),
    ]);
    const plan = buildRenderPlan(doc, testContextWithFonts());
    expect(
      plan.texts.map((text) => [text.id, text.layer, text.runs.map((run) => run.text)]),
    ).toEqual([
      ['a', 0, ['BIG NEWS']],
      ['b', 1, ['வணக்கம்']],
    ]);
    expect(plan.fonts.files).toEqual(['montserrat-800.ttf', 'noto-sans-tamil-700.ttf']);
    expect(plan.fonts.psNames).toEqual(['PGF-4bc567-700', 'PGF-f04607-800']);
  });

  it('compiles the text into the picture before the mark and the fades, logging the font choice', () => {
    const doc = { ...withTexts(tenSeconds(), [testText('a')]), fades: { inMs: 500, outMs: 0 } };
    const compiled = compileFfmpeg(
      buildRenderPlan(doc, testContextWithFonts({ watermark: false })),
    );
    expect(compiled.filterComplexScript).toContain(
      '[vc]fps=30,format=yuv420p,ass=filename=captions.ass:fontsdir=fonts,fade=t=in:st=0:d=0.500[vout]',
    );
    expect(compiled.fonts).toEqual({
      dir: 'fonts',
      files: ['montserrat-800.ttf'],
      psNames: ['PGF-f04607-800'],
    });
    expect(ffmpegArgsFor(compiled, 'out.mp4')).toContain('info');
    // No text: no file, no fonts, the quiet log level.
    const quiet = compileFfmpeg(buildRenderPlan(tenSeconds(), testContext()));
    expect(quiet.assFiles).toEqual([]);
    expect(quiet.fonts).toBeNull();
    expect(ffmpegArgsFor(quiet, 'out.mp4')).toContain('error');
  });
});

describe('buildAss', () => {
  function assFor(texts: ReturnType<typeof testText>[]): string {
    const plan = buildRenderPlan(withTexts(tenSeconds(), texts), testContextWithFonts());
    const [file] = buildAss(plan);
    if (!file) throw new Error('no ASS file');
    expect(file.name).toBe('captions.ass');
    return file.content;
  }

  it('writes the three ready styles as the stored file', () => {
    const content = assFor([
      testText('a'),
      testText('b', {
        text: 'On a box',
        start: 2_000,
        style: { ...copyTextStyle(textStylePreset('on-a-box').style), align: 'left' },
        transform: { x: 0.4, y: 0.6, scale: 1.5, rotation: 15, opacity: 0.5 },
        fadeInMs: 200,
        fadeOutMs: 500,
      }),
      testText('c', {
        text: 'Plain {braces} C:\\path\nnext line',
        start: 4_000,
        style: { ...copyTextStyle(textStylePreset('plain').style), align: 'right', italic: true },
      }),
    ]);
    expect(content).toMatchSnapshot();
  });

  it('sets the canvas as the play size and turns about the item centre', () => {
    const content = assFor([
      testText('a', { transform: { x: 0.25, y: 0.5, scale: 1, rotation: 90, opacity: 1 } }),
    ]);
    expect(content).toContain('PlayResX: 1080\nPlayResY: 1920');
    expect(content).toContain('{\\an5\\pos(270,960)\\org(270,960)\\frz-90}Hello there');
    // The box is the event margins: 864 wide about x = 270.
    expect(content).toContain(',-162,378,0,,');
  });

  it('switches fonts for each fallback run and back again', () => {
    const content = assFor([testText('a', { text: 'Hi வணக்கம் ok' })]);
    expect(content).toContain(
      'Hi {\\fnPGF 4bc567 700\\fs94.24\\b700}வணக்கம்{\\fnPGF f04607 800\\fs118.71\\b800} ok',
    );
  });

  it('multiplies a box opacity by the item opacity instead of replacing it', () => {
    const half = testText('b', {
      style: {
        ...copyTextStyle(textStylePreset('on-a-box').style),
        background: { colour: '#FFFFFF', opacity: 0.5, radius: 0, pad: 18 },
      },
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 0.5 },
    });
    const content = assFor([half]);
    expect(content).toContain(`\\1a${assAlpha(0.5)}\\3a${assAlpha(0.25)}\\4a${assAlpha(0.3)}`);
    expect(content).not.toContain('\\alpha');
  });

  it('can never be broken out of by what a person types', () => {
    expect(escapeAssText('{\\an8}hi')).toBe('\\{\\\u2060an8\\}hi');
  });
});
