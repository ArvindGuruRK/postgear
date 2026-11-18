import type { ClipDocument } from '../document/schema';
import { EXPORT_QUALITIES } from '../quality';
import { assColour, assTime, buildAss, escapeAssText } from './ass';
import { atempoChain, compileFfmpeg, ffmpegColour, formatNumber, setptsFor } from './compile';
import { isRenderCompileError, jobErrorCodeFor, RenderCompileError } from './errors';
import {
  assFontSize,
  checkFonts,
  emptyFontManifest,
  fontsNeeded,
  parseFontManifest,
} from './fonts';
import { buildRenderPlan, isSafeRelativeName, type RenderContext } from './plan';
import { ENCODE_SPECS, encodeSpecFor, evenSize, outputSizeFor, PROOF_SPEC } from './specs';
import {
  TEST_ASSET_ID,
  testContext,
  testContextWithFonts,
  testDocument,
  testSegment,
  testSource,
  testText,
  withTexts,
} from './test-docs';
import { ffmpegArgsFor, GRAPH_FILE } from './types';

/** Source 10 to 20 s at 1x, then 20 to 30 s at 2x: 15 s of clip from one stretch of video. */
function twoSegmentDoc(): ClipDocument {
  return testDocument([testSegment('a', 10_000, 20_000), testSegment('b', 20_000, 30_000, 2)]);
}

/** Every `[label]` in the graph: how often it is written as an output and read as an input. */
function labelUse(graph: string): Map<string, { out: number; in: number }> {
  const use = new Map<string, { out: number; in: number }>();
  const touch = (label: string, key: 'out' | 'in') => {
    const entry = use.get(label) ?? { out: 0, in: 0 };
    entry[key] += 1;
    use.set(label, entry);
  };
  for (const chain of graph.split(';')) {
    const text = chain.trim();
    const leading = text.match(/^(\[[^\]]+\])+/);
    const trailing = text.match(/(\[[^\]]+\])+$/);
    for (const label of leading?.[0].match(/\[[^\]]+\]/g) ?? []) touch(label, 'in');
    for (const label of trailing?.[0].match(/\[[^\]]+\]/g) ?? []) touch(label, 'out');
    // Labels in the middle of a chain (`split=2[x][y]` followed by nothing) are outputs too.
  }
  return use;
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(isRenderCompileError(error)).toBe(true);
    expect((error as RenderCompileError).code).toBe(code);
    return;
  }
  throw new Error(`Expected a RenderCompileError with code ${code}`);
}

describe('compileFfmpeg: two segments, the second at 2x', () => {
  const plan = buildRenderPlan(twoSegmentDoc(), testContext());
  const compiled = compileFfmpeg(plan);
  const graph = compiled.filterComplexScript;

  it('matches the stored graph', () => {
    expect(graph).toMatchSnapshot();
    expect(compiled.outputArgs).toMatchSnapshot();
  });

  it('reads one contiguous stretch through one seeked input, split for the two segments', () => {
    expect(compiled.inputs).toEqual([{ file: 'source.mp4', seekMs: 9_000, options: [] }]);
    expect(graph).toContain('[0:v]split=2[i0v0][i0v1]');
    expect(graph).toContain('[0:a]asplit=2[i0a0][i0a1]');
    // The seek point (9 s) is taken off every trim, with a second of preroll.
    expect(graph).toContain('trim=start=1.000:end=11.000');
    expect(graph).toContain('trim=start=11.000:end=21.000');
    expect(graph).toContain('atrim=start=11.000:end=21.000');
  });

  it('speeds the second segment picture and sound by 2', () => {
    expect(graph).toContain('setpts=PTS-STARTPTS,fps=30,setsar=1[v0]');
    expect(graph).toContain('setpts=(PTS-STARTPTS)/2,fps=30,setsar=1[v1]');
    expect(graph).toMatch(/asetpts=PTS-STARTPTS,atempo=2,aresample=48000/);
    expect(graph).not.toMatch(/\[i0a0\][^;]*atempo/);
  });

  it('adds up the segment lengths to the output length', () => {
    const sum = plan.segments.reduce(
      (total, s) => total + (s.trimEndMs - s.trimStartMs) / s.speed,
      0,
    );
    expect(sum).toBe(15_000);
    expect(plan.output.durationMs).toBe(15_000);
    expect(compiled.durationMs).toBe(15_000);
    expect(compiled.outputArgs).toEqual(expect.arrayContaining(['-t', '15.000']));
    expect(graph).toContain('apad=whole_dur=15.000[aout]');
    expect(graph).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][ac]');
  });

  it('writes even sizes for every crop and scale', () => {
    const sizes = [...graph.matchAll(/(?:crop|scale|pad)=(\d+):(\d+)/g)];
    expect(sizes.length).toBeGreaterThan(0);
    for (const match of sizes) {
      expect(Number(match[1]) % 2).toBe(0);
      expect(Number(match[2]) % 2).toBe(0);
    }
    // 9:16 of a 1920 by 1080 picture is 607.5 wide: the plan writes 608, centred.
    expect(graph).toContain('crop=608:1080:656:0:exact=1,scale=1080:1920:flags=bicubic');
  });

  it('writes every label once as an output and reads it once', () => {
    const use = labelUse(graph);
    for (const [label, count] of use) {
      if (/^\[\d+:[va]\]$/.test(label)) {
        expect(count).toEqual({ out: 0, in: 1 });
      } else if (label === '[vout]' || label === '[aout]') {
        expect(count).toEqual({ out: 1, in: 0 });
      } else {
        expect([label, count]).toEqual([label, { out: 1, in: 1 }]);
      }
    }
  });

  it('is deterministic', () => {
    const again = compileFfmpeg(buildRenderPlan(twoSegmentDoc(), testContext()));
    expect(again).toEqual(compiled);
  });

  it('passes the graph by file, with no removed options anywhere', () => {
    const args = ffmpegArgsFor(compiled, 'render.mp4.part');
    expect(args).toContain('-/filter_complex');
    expect(args[args.indexOf('-/filter_complex') + 1]).toBe(GRAPH_FILE);
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4)).toEqual([
      '-ss',
      '9.000',
      '-i',
      'source.mp4',
    ]);
    const text = `${args.join(' ')} ${graph}`;
    expect(text).not.toContain('-filter_complex_script');
    expect(text).not.toContain('-vsync');
    expect(args[args.length - 1]).toBe('render.mp4.part');
    expect(args).toEqual(
      expect.arrayContaining(['-f', 'mp4', '-fps_mode', 'cfr', '-movflags', '+faststart']),
    );
  });

  it('has no text files yet', () => {
    expect(compiled.assFiles).toEqual([]);
  });
});

describe('compileFfmpeg: inputs, sound and the base', () => {
  it('opens a second input when a part of the video was cut out', () => {
    const doc = testDocument([testSegment('a', 0, 5_000), testSegment('b', 40_000, 45_000)]);
    const compiled = compileFfmpeg(buildRenderPlan(doc, testContext()));
    expect(compiled.inputs.map((i) => [i.file, i.seekMs])).toEqual([
      ['source.mp4', null],
      ['source.mp4', 39_000],
    ]);
    expect(compiled.filterComplexScript).toContain('[0:v]trim=start=0.000:end=5.000');
    expect(compiled.filterComplexScript).toContain('[1:v]trim=start=1.000:end=6.000');
    expect(compiled.filterComplexScript).not.toContain('split');
  });

  it('chains atempo for a quarter speed segment', () => {
    const doc = testDocument([testSegment('a', 0, 1_000, 0.25)]);
    const compiled = compileFfmpeg(buildRenderPlan(doc, testContext()));
    expect(compiled.filterComplexScript).toContain('atempo=0.5,atempo=0.5,aresample=48000');
    expect(compiled.filterComplexScript).toContain('setpts=(PTS-STARTPTS)/0.25');
    expect(compiled.durationMs).toBe(4_000);
  });

  it('makes silence of the right length for a video with no sound', () => {
    const ctx = testContext({ assets: { sources: { src: testSource({ hasAudio: false }) } } });
    const compiled = compileFfmpeg(buildRenderPlan(twoSegmentDoc(), ctx));
    const graph = compiled.filterComplexScript;
    expect(graph).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=10.000');
    expect(graph).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=5.000');
    expect(graph).not.toContain(':a]');
  });

  it('writes the segment volume', () => {
    const doc = testDocument([testSegment('a', 0, 5_000, 1, 0.5)]);
    expect(compileFfmpeg(buildRenderPlan(doc, testContext())).filterComplexScript).toContain(
      'asetpts=PTS-STARTPTS,volume=0.5,aresample',
    );
  });

  it('draws the Blurred base with yuv420 overlays that end with the picture', () => {
    const doc = testDocument([testSegment('a', 0, 5_000)], { crop: { x: 0, y: 0, w: 1, h: 1 } });
    doc.layout.kind = 'blurred';
    const area = doc.layout.areas[0];
    if (!area) throw new Error('no area');
    area.fit = 'contain';
    const graph = compileFfmpeg(buildRenderPlan(doc, testContext())).filterComplexScript;
    expect(graph).toContain('[0:v]trim=start=0.000:end=5.000,split=2[vb0][vf0]');
    expect(graph).toContain(
      '[vb0]crop=608:1080:656:0:exact=1,scale=108:192:flags=bilinear,gblur=sigma=3:steps=2,scale=1080:1920',
    );
    // The whole 16:9 picture, 1080 wide and 608 tall (607.5 rounded to even), centred at y 656.
    expect(graph).toContain(
      '[vf0]crop=1920:1080:0:0:exact=1,scale=1080:608:flags=bicubic,setsar=1[vff0]',
    );
    expect(graph).toContain(
      '[vbb0][vff0]overlay=x=0:y=656:format=yuv420:shortest=1,setpts=PTS-STARTPTS',
    );
    expect(graph).not.toMatch(/overlay=(?![^,;]*format=yuv420)/);
  });

  it('pads an area that does not fill the canvas onto the background colour', () => {
    const doc = testDocument([testSegment('a', 0, 5_000)]);
    const area = doc.layout.areas[0];
    if (!area) throw new Error('no area');
    area.frame = { x: 0, y: 0.25, w: 1, h: 0.5 };
    doc.canvas.background = '#112233';
    const graph = compileFfmpeg(buildRenderPlan(doc, testContext())).filterComplexScript;
    expect(graph).toContain('pad=1080:1920:0:480:color=0x112233');
  });

  it('adds the mark after the join and before the fades, only when asked', () => {
    const doc = testDocument([testSegment('a', 0, 10_000)], { fadeInMs: 500, fadeOutMs: 1_000 });
    const ctx: RenderContext = {
      ...testContext({ quality: '720p', watermark: true }),
      assets: {
        sources: { src: testSource() },
        watermark: { file: 'watermark.png', width: 600, height: 150 },
      },
    };
    const compiled = compileFfmpeg(buildRenderPlan(doc, ctx));
    expect(compiled.inputs[1]).toEqual({
      file: 'watermark.png',
      seekMs: null,
      options: ['-loop', '1', '-framerate', '30'],
    });
    const graph = compiled.filterComplexScript;
    expect(graph).toContain(
      '[1:v]scale=130:32:flags=bicubic,format=rgba,colorchannelmixer=aa=0.7[wm]',
    );
    expect(graph).toContain(
      '[vj][wm]overlay=x=562:y=1220:format=yuv420:shortest=1,fade=t=in:st=0:d=0.500,fade=t=out:st=9.000:d=1.000[vout]',
    );
    expect(graph).toContain(
      '[ac]afade=t=in:st=0:d=0.500,afade=t=out:st=9.000:d=1.000,apad=whole_dur=10.000[aout]',
    );

    const plain = compileFfmpeg(buildRenderPlan(doc, testContext({ quality: '720p' })));
    expect(plain.inputs).toHaveLength(1);
    expect(plain.filterComplexScript).not.toContain('[wm]');
  });
});

describe('encode specs and output arguments', () => {
  it('sizes every quality and the proof from the short side, keeping the shape', () => {
    expect(outputSizeFor({ width: 1080, height: 1920 }, ENCODE_SPECS['720p'])).toEqual({
      width: 720,
      height: 1280,
      scale: 720 / 1080,
    });
    expect(outputSizeFor({ width: 1080, height: 1920 }, PROOF_SPEC)).toMatchObject({
      width: 360,
      height: 640,
    });
    expect(outputSizeFor({ width: 1080, height: 1350 }, ENCODE_SPECS['720p'])).toMatchObject({
      width: 720,
      height: 900,
    });
    expect(outputSizeFor({ width: 1920, height: 1080 }, ENCODE_SPECS['1080p'])).toMatchObject({
      width: 1920,
      height: 1080,
    });
    expect(evenSize(607.5)).toBe(608);
    expect(evenSize(0.4)).toBe(2);
  });

  it.each([
    ['720p', '30', '60', '5000k', '10000k', 'veryfast', '21'],
    ['720p60', '60', '120', '8000k', '16000k', 'veryfast', '21'],
    ['1080p', '30', '60', '8000k', '16000k', 'veryfast', '21'],
    ['1080p60', '60', '120', '12000k', '24000k', 'veryfast', '21'],
  ] as const)('writes the %s encode', (quality, rate, gop, maxrate, bufsize, preset, crf) => {
    const compiled = compileFfmpeg(buildRenderPlan(twoSegmentDoc(), testContext({ quality })));
    const args = compiled.outputArgs;
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(after('-r')).toBe(rate);
    expect(after('-g')).toBe(gop);
    expect(after('-keyint_min')).toBe(gop);
    expect(after('-maxrate')).toBe(maxrate);
    expect(after('-bufsize')).toBe(bufsize);
    expect(after('-preset')).toBe(preset);
    expect(after('-crf')).toBe(crf);
    expect(after('-profile:v')).toBe('high');
    expect(after('-pix_fmt')).toBe('yuv420p');
    expect(after('-sc_threshold')).toBe('0');
    expect(after('-c:a')).toBe('aac');
    expect(after('-b:a')).toBe('128k');
    expect(after('-ar')).toBe('48000');
    expect(after('-ac')).toBe('2');
    expect(after('-fps_mode')).toBe('cfr');
    expect(compiled.filterComplexScript).toContain(`fps=${rate},format=yuv420p`);
  });

  it('renders a proof at 360 wide, ultrafast, CRF 28, whatever the quality', () => {
    const plan = buildRenderPlan(twoSegmentDoc(), testContext({ quality: '1080p60', proof: true }));
    expect(plan.output).toEqual({ width: 360, height: 640, fps: 30, durationMs: 15_000 });
    const args = compileFfmpeg(plan).outputArgs;
    expect(args.slice(args.indexOf('-preset'), args.indexOf('-preset') + 4)).toEqual([
      '-preset',
      'ultrafast',
      '-crf',
      '28',
    ]);
    expect(args).toContain('2000k');
    expect(encodeSpecFor('720p', true).id).toBe('proof');
    expect(EXPORT_QUALITIES.map((q) => encodeSpecFor(q, false).id)).toEqual([...EXPORT_QUALITIES]);
  });
});

describe('refusals', () => {
  it('no longer refuses other layouts, more areas or rounded corners (Module 10)', () => {
    const doc = twoSegmentDoc();
    doc.layout.kind = 'split';
    expect(() => buildRenderPlan(doc, testContext())).not.toThrow();
    const two = twoSegmentDoc();
    const area = two.layout.areas[0];
    if (!area) throw new Error('no area');
    two.layout.areas.push({ ...area, id: 'second' });
    expect(buildRenderPlan(two, testContext()).segments[0]?.picture.areas).toHaveLength(2);
    const rounded = twoSegmentDoc();
    (rounded.layout.areas[0] as typeof area).radius = 36;
    expect(buildRenderPlan(rounded, testContext()).segments[0]?.picture.areas[0]?.radius).toBe(36);
  });

  it('refuses a moving crop on any area, and no longer refuses a zoom or a look (Module 13)', () => {
    const second = twoSegmentDoc();
    const base = second.layout.areas[0];
    if (!base) throw new Error('no area');
    second.layout.areas.push({
      ...base,
      id: 'second',
      crop: [...base.crop, { at: 15_000, rect: { x: 0.1, y: 0, w: 0.31640625, h: 1 } }],
    });
    expectCode(() => buildRenderPlan(second, testContext()), 'crop_keyframes_unsupported');

    const moving = twoSegmentDoc();
    (moving.layout.areas[0] as { crop: unknown[] }).crop.push({
      at: 15_000,
      rect: { x: 0.1, y: 0, w: 0.31640625, h: 1 },
    });
    expectCode(() => buildRenderPlan(moving, testContext()), 'crop_keyframes_unsupported');

    const zoomed = twoSegmentDoc();
    zoomed.zooms = [
      {
        id: 'z',
        source: 'src',
        from: 12_000,
        to: 14_000,
        scale: 2,
        focus: { x: 0.5, y: 0.5 },
        ease: 200,
      },
    ];
    expect(buildRenderPlan(zoomed, testContext()).zooms).toHaveLength(1);

    const looked = twoSegmentDoc();
    looked.looks = { colour: 'warm', strength: 1, vignette: 0.4 };
    const plan = buildRenderPlan(looked, testContext());
    expect(plan.look.matrix).not.toBeNull();
    expect(plan.look.vignetteAngle).toBeGreaterThan(0);
  });

  it('checks a text font, plans the text, stickers and sounds, and refuses captions', () => {
    const text = withTexts(twoSegmentDoc(), [
      testText('t', { anchor: 'clip', style: { ...testText('t').style, font: 'Anton', weight: 400 } }),
    ]);
    expectCode(() => buildRenderPlan(text, testContext()), 'font_missing');
    const unknown = withTexts(twoSegmentDoc(), [
      testText('t', { style: { ...testText('t').style, font: 'Comic Sans MS' } }),
    ]);
    expectCode(() => buildRenderPlan(unknown, testContextWithFonts()), 'font_missing');
    const planned = buildRenderPlan(text, testContextWithFonts());
    expect(planned.texts).toHaveLength(1);
    expect(planned.fonts.files).toEqual(['anton-400.ttf']);

    const sticker = twoSegmentDoc();
    sticker.tracks = [
      {
        id: 'ov',
        kind: 'overlay',
        items: [
          {
            id: 's',
            type: 'sticker',
            start: 0,
            duration: 1_000,
            anchor: 'moment',
            ref: { asset: TEST_ASSET_ID },
            transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
            flipX: false,
            widthPx: 270,
            heightPx: 270,
            loop: true,
          },
        ],
      },
    ];
    // A sticker whose file was not handed in (removed from the library) is refused; with it, it is planned.
    expectCode(() => buildRenderPlan(sticker, testContext()), 'sticker_missing');
    const withFile = testContext();
    withFile.assets = { ...withFile.assets, stickers: { [`asset:${TEST_ASSET_ID}`]: { file: 'sticker-0.png', animated: false, width: 512, height: 512, fps: null, frames: null } } };
    expect(buildRenderPlan(sticker, withFile).stickers).toHaveLength(1);

    const sound = twoSegmentDoc();
    sound.tracks = [
      {
        id: 'au',
        kind: 'audio',
        items: [
          {
            id: 'm',
            type: 'music',
            start: 0,
            duration: 1_000,
            anchor: 'clip',
            ref: { asset: TEST_ASSET_ID },
            offsetMs: 0,
            volume: 1,
            fadeInMs: 0,
            fadeOutMs: 0,
            duck: true,
          },
        ],
      },
    ];
    // A sound whose file was not handed in is refused (`sound_missing`); with it, it is planned.
    expectCode(() => buildRenderPlan(sound, testContext()), 'sound_missing');
    const withSound = testContext();
    withSound.assets = { ...withSound.assets, sounds: { [`asset:${TEST_ASSET_ID}`]: { file: 'sound-0.m4a', durationMs: 4_000 } } };
    expect(buildRenderPlan(sound, withSound).sounds).toHaveLength(1);

    const captions = twoSegmentDoc();
    captions.tracks = [{ id: 'cc', kind: 'captions', transcriptAssetId: TEST_ASSET_ID, style: {} }];
    expectCode(() => buildRenderPlan(captions, testContext()), 'captions_unsupported');

    // Empty tracks are fine.
    const empty = twoSegmentDoc();
    empty.tracks = [{ id: 'ov', kind: 'overlay', items: [] }];
    expect(() => buildRenderPlan(empty, testContext())).not.toThrow();
  });

  it('refuses missing inputs and files that do not hold the clip', () => {
    expectCode(
      () => buildRenderPlan(twoSegmentDoc(), testContext({ assets: { sources: {} } })),
      'input_missing',
    );
    expectCode(
      () => buildRenderPlan(twoSegmentDoc(), testContext({ watermark: true })),
      'input_missing',
    );
    // A sharp range from 12 s cannot play source 10 s.
    const late = testContext({
      assets: { sources: { src: testSource({ sourceOffsetMs: 12_000 }) } },
    });
    expectCode(() => buildRenderPlan(twoSegmentDoc(), late), 'source_not_covered');
    // A file that stops at 25 s cannot play up to 30 s.
    const short = testContext({ assets: { sources: { src: testSource({ durationMs: 25_000 }) } } });
    expectCode(() => buildRenderPlan(twoSegmentDoc(), short), 'source_not_covered');
    // One frame short of the end is allowed: a probed length can be a frame under.
    const frameShort = testContext({
      assets: { sources: { src: testSource({ durationMs: 29_970 }) } },
    });
    expect(() => buildRenderPlan(twoSegmentDoc(), frameShort)).not.toThrow();
  });

  it('works from a sharp range that starts later in the video', () => {
    const ctx = testContext({
      assets: {
        sources: {
          src: testSource({ file: 'sharp.mp4', sourceOffsetMs: 8_000, durationMs: 30_000 }),
        },
      },
    });
    const plan = buildRenderPlan(twoSegmentDoc(), ctx);
    // Source 10 s is file 2 s; seeking would start at 1 s.
    expect(plan.inputs[0]).toMatchObject({ file: 'sharp.mp4', seekMs: 1_000 });
    expect(plan.segments[0]).toMatchObject({ trimStartMs: 1_000, trimEndMs: 11_000 });
  });

  it('refuses an invalid document and an unsafe file name', () => {
    const bad = twoSegmentDoc();
    (bad as { extra?: boolean }).extra = true;
    expectCode(() => buildRenderPlan(bad, testContext()), 'invalid_document');
    const unsafe = testContext({
      assets: { sources: { src: testSource({ file: '../etc/source.mp4' }) } },
    });
    expectCode(() => buildRenderPlan(twoSegmentDoc(), unsafe), 'invalid_context');
    expect(isSafeRelativeName('C:/x.mp4')).toBe(false);
    expect(isSafeRelativeName('/abs.mp4')).toBe(false);
    expect(isSafeRelativeName('fonts/anton.ttf')).toBe(true);
    expect(isSafeRelativeName("it's.mp4")).toBe(false);
  });

  it('maps codes to job errors', () => {
    expect(jobErrorCodeFor('font_missing')).toBe('font_missing');
    expect(jobErrorCodeFor('zoom_unsupported')).toBe('export_failed');
    const error = new RenderCompileError('input_missing', 'x', { sourceId: 'src' });
    expect(error.details).toEqual({ sourceId: 'src' });
    expect(isRenderCompileError(new Error('plain'))).toBe(false);
  });
});

describe('small pieces', () => {
  it('chains atempo inside 0.5 to 100', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    expect(atempoChain(0.5)).toEqual(['atempo=0.5']);
    expect(atempoChain(1.5)).toEqual(['atempo=1.5']);
    expect(atempoChain(4)).toEqual(['atempo=4']);
    expect(atempoChain(0.1)).toEqual(['atempo=0.5', 'atempo=0.5', 'atempo=0.5', 'atempo=0.8']);
    expect(atempoChain(250)).toEqual(['atempo=100', 'atempo=2.5']);
    expect(() => atempoChain(0)).toThrow();
  });

  it('formats numbers and colours for filter text', () => {
    expect(formatNumber(2)).toBe('2');
    expect(formatNumber(0.25)).toBe('0.25');
    expect(formatNumber(1 / 3)).toBe('0.333333');
    expect(formatNumber(-0.0000001)).toBe('0');
    expect(formatNumber(1e-7)).toBe('0');
    expect(setptsFor(1)).toBe('setpts=PTS-STARTPTS');
    expect(setptsFor(1.5)).toBe('setpts=(PTS-STARTPTS)/1.5');
    expect(ffmpegColour('#0a0B0c')).toBe('0x0A0B0C');
    expect(() => ffmpegColour('red')).toThrow();
  });

  it('escapes ASS text so it can never become an override', () => {
    expect(escapeAssText('a{b}c')).toBe('a\\{b\\}c');
    expect(escapeAssText('C:\\New')).toBe('C:\\\u2060New');
    expect(escapeAssText('one\r\ntwo\nthree')).toBe('one\\Ntwo\\Nthree');
    expect(escapeAssText('tab\there, comma')).toBe('tabhere, comma');
    expect(escapeAssText('हिन्दी தமிழ்')).toBe('हिन्दी தமிழ்');
  });

  it('writes ASS colours and times', () => {
    expect(assColour('#FF8000')).toBe('&H000080FF');
    expect(assColour('#ff8000', 0.5)).toBe('&H800080FF');
    expect(assColour('#000000', 0)).toBe('&HFF000000');
    expect(assTime(0)).toBe('0:00:00.00');
    expect(assTime(3_723_456)).toBe('1:02:03.46');
  });

  it('builds no ASS file for a plan without text', () => {
    expect(buildAss(buildRenderPlan(twoSegmentDoc(), testContext()))).toEqual([]);
  });

  it('checks fonts against the manifest', () => {
    const arial = {
      fontId: 'arial',
      family: 'Arial',
      weight: 400,
      assName: 'PGF 000000 400',
      psName: 'PGF-000000-400',
      file: 'arial-400.ttf',
      unitsPerEm: 2048,
      winAscent: 1854,
      winDescent: 434,
      fallback: false,
    };
    const manifest = parseFontManifest({ version: 2, fonts: [arial], coverage: { arial: [[32, 126]] } });
    expect(checkFonts(manifest, ['arial', 'Anton', 'anton'])).toEqual(['Anton']);
    expect(checkFonts(null, ['Sora'])).toEqual(['Sora']);
    expect(checkFonts(emptyFontManifest(), [])).toEqual([]);
    // CSS 100 px Arial is ASS 111.72: the line height, not the em.
    expect(assFontSize(manifest.fonts[0] as (typeof manifest.fonts)[number], 100)).toBe(111.72);
    // A version 1 manifest (one file per family, no names) is refused: the build must be rerun.
    expect(() =>
      parseFontManifest({ version: 1, fonts: [{ family: 'X', file: 'x.woff2' }] }),
    ).toThrow();
    expect(fontsNeeded(twoSegmentDoc())).toEqual([]);
  });
});
