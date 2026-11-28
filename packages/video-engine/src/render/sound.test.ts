import type { AudioItem, ClipDocument } from '../document/schema';
import { compileFfmpeg, compileMeasure, soundChain } from './compile';
import { isRenderCompileError } from './errors';
import {
  decideLoudness,
  fileLoudnessArgs,
  type LoudnessMeasure,
  loudnessModeFor,
  loudnessResult,
  loudnormApplyFilter,
  loudnormMeasureFilter,
  parseLoudnormJson,
} from './loudness';
import { buildRenderPlan } from './plan';
import { planHasSound, type RenderSoundAsset } from './sound-plan';
import { TEST_ASSET_ID, testContext, testDocument, testSegment, testSource } from './test-docs';
import { ffmpegArgsFor } from './types';

const LIBRARY_ID = '33333333-3333-4333-8333-333333333333';
const LIB_KEY = `library:${LIBRARY_ID}`;
const ASSET_KEY = `asset:${TEST_ASSET_ID}`;

function sound(id: string, overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id,
    type: 'sfx',
    start: 3_000,
    duration: 1_000,
    anchor: 'moment',
    ref: { library: 'sound', id: LIBRARY_ID },
    offsetMs: 0,
    volume: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    duck: false,
    ...overrides,
  };
}

function withSounds(doc: ClipDocument, items: AudioItem[]): ClipDocument {
  return { ...doc, tracks: [{ id: 'au', kind: 'audio', items }] };
}

function contextWith(sounds: Record<string, RenderSoundAsset>, watermark = false) {
  const base = testContext({ watermark });
  return {
    ...base,
    assets: {
      ...base.assets,
      sounds,
      watermark: watermark ? { file: 'mark.png', width: 400, height: 100 } : null,
    },
  };
}

/** A 12 s clip: a voice part, a muted part. */
function clip(): ClipDocument {
  return testDocument([testSegment('a', 0, 8_000), testSegment('b', 20_000, 24_000, 1, 0)], {
    fadeOutMs: 1_000,
  });
}

const MEASURED: LoudnessMeasure = {
  inputI: -24.3,
  inputTp: -14.1,
  inputLra: 6.2,
  inputThresh: -34.6,
  targetOffset: 0.4,
};

describe('sounds in the plan', () => {
  it('plans an effect, a looping bed and skips a silent one, after the mark', () => {
    const doc = withSounds(clip(), [
      sound('fx', { start: 3_000, duration: 1_500, volume: 0.8, fadeInMs: 100, fadeOutMs: 400, offsetMs: 200 }),
      sound('bed', {
        type: 'music',
        anchor: 'clip',
        start: 0,
        duration: 12_000,
        ref: { asset: TEST_ASSET_ID },
        volume: 0.2,
        fadeInMs: 1_000,
        fadeOutMs: 1_000,
        offsetMs: 1_000,
      }),
      sound('mute', { start: 6_000, volume: 0 }),
    ]);
    const plan = buildRenderPlan(
      doc,
      contextWith({ [LIB_KEY]: { file: 'sound-0.m4a', durationMs: 1_000 }, [ASSET_KEY]: { file: 'sound-1.m4a', durationMs: 5_000 } }, true),
    );
    expect(plan.sounds).toEqual([
      {
        id: 'fx',
        inputIndex: 3,
        file: 'sound-0.m4a',
        loop: false,
        offsetMs: 200,
        startMs: 3_000,
        // The file holds 800 ms after the offset, though the item lasts 1.5 s.
        durationMs: 800,
        volume: 0.8,
        fadeInMs: 100,
        fadeOutMs: 400,
        itemMs: 1_500,
        fileMs: 1_000,
        wraps: false,
        duck: [],
      },
      {
        id: 'bed',
        inputIndex: 4,
        file: 'sound-1.m4a',
        loop: true,
        offsetMs: 1_000,
        startMs: 0,
        durationMs: 12_000,
        volume: 0.2,
        fadeInMs: 1_000,
        fadeOutMs: 1_000,
        itemMs: 12_000,
        fileMs: 5_000,
        wraps: true,
        duck: [],
      },
    ]);
    expect(plan.inputs).toHaveLength(2);
    expect(plan.watermark?.inputIndex).toBe(2);
  });

  it('refuses a sound whose file was not handed in', () => {
    const doc = withSounds(clip(), [sound('fx')]);
    let code = '';
    try {
      buildRenderPlan(doc, testContext());
    } catch (error) {
      if (isRenderCompileError(error)) code = error.code;
    }
    expect(code).toBe('sound_missing');
  });

  it('knows when a clip has no sound at all', () => {
    const muted = testDocument([testSegment('a', 0, 4_000, 1, 0)]);
    const plan = buildRenderPlan(muted, testContext());
    expect(planHasSound(plan)).toBe(false);
    expect(compileMeasure(plan)).toBeNull();
    const silentFile = buildRenderPlan(
      testDocument([testSegment('a', 0, 4_000)]),
      testContext({ assets: { sources: { src: testSource({ hasAudio: false }) } } }),
    );
    expect(planHasSound(silentFile)).toBe(false);
    expect(planHasSound(buildRenderPlan(testDocument([testSegment('a', 0, 4_000)]), testContext()))).toBe(true);
  });
});

describe('the sound graph', () => {
  it('cuts, fades, turns and delays one effect in whole ms', () => {
    const chain = soundChain(
      {
        id: 'fx',
        inputIndex: 2,
        file: 'sound-0.m4a',
        loop: false,
        offsetMs: 0,
        startMs: 3_000.4,
        durationMs: 800,
        volume: 0.8,
        fadeInMs: 100,
        fadeOutMs: 400,
        itemMs: 1_500,
        fileMs: 1_000,
        wraps: false,
        duck: [],
      },
      '[as0]',
    );
    expect(chain).toBe(
      '[2:a]atrim=duration=0.800,asetpts=PTS-STARTPTS,aresample=48000,' +
        'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=0.8,' +
        'afade=t=in:st=0:d=0.100,afade=t=out:st=1.100:d=0.400,adelay=3000|3000[as0]',
    );
  });

  it('mixes over a silent base with normalize off, then fades, corrects and pads', () => {
    const doc = withSounds(clip(), [
      sound('fx', { offsetMs: 200 }),
      sound('bed', { type: 'music', anchor: 'clip', start: 0, duration: 12_000, ref: { asset: TEST_ASSET_ID }, volume: 0.2 }),
    ]);
    const plan = buildRenderPlan(
      doc,
      contextWith({ [LIB_KEY]: { file: 'sound-0.m4a', durationMs: 1_500 }, [ASSET_KEY]: { file: 'sound-1.m4a', durationMs: 5_000 } }),
    );
    const compiled = compileFfmpeg(plan, { loudness: decideLoudness(MEASURED) });
    expect(compiled.inputs.slice(2)).toEqual([
      { file: 'sound-0.m4a', seekMs: 200, options: [] },
      { file: 'sound-1.m4a', seekMs: null, options: [] },
    ]);
    const graph = compiled.filterComplexScript;
    expect(graph).toContain(
      'anullsrc=r=48000:cl=stereo,atrim=duration=12.000,asetpts=PTS-STARTPTS,aresample=48000,' +
        'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[abase]',
    );
    expect(graph).toContain('[3:a]aloop=loop=-1:size=2147483647:start=0,atrim=start=0.000:duration=12.000');
    expect(graph).toContain(
      '[abase][ac][as0][as1]amix=inputs=4:normalize=0:duration=first:dropout_transition=0,afade=t=out:st=11.000:d=1.000[am]',
    );
    expect(graph).toContain(
      `[am]${loudnormApplyFilter(MEASURED)},aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad=whole_dur=12.000[aout]`,
    );
    expect(graph).toMatchSnapshot();
  });

  it('keeps the old tail when there is no sound item and no correction', () => {
    const plan = buildRenderPlan(clip(), testContext());
    expect(compileFfmpeg(plan).filterComplexScript).toContain(
      '[ac]afade=t=out:st=11.000:d=1.000,apad=whole_dur=12.000[aout]',
    );
    // A skipped correction changes nothing either.
    expect(compileFfmpeg(plan, { loudness: decideLoudness(null) }).filterComplexScript).toBe(
      compileFfmpeg(plan).filterComplexScript,
    );
    // A correction alone goes on the video's sound.
    expect(compileFfmpeg(plan, { loudness: decideLoudness(MEASURED) }).filterComplexScript).toContain(
      `[ac]afade=t=out:st=11.000:d=1.000[am];\n[am]${loudnormApplyFilter(MEASURED)},`,
    );
  });

  it('measures the same mix, to nowhere, at the info level', () => {
    const doc = withSounds(clip(), [sound('fx')]);
    const plan = buildRenderPlan(doc, contextWith({ [LIB_KEY]: { file: 'sound-0.m4a', durationMs: 1_500 } }));
    const measure = compileMeasure(plan);
    expect(measure).not.toBeNull();
    const text = measure?.filterComplexScript ?? '';
    expect(text).toContain('[a0][a1]concat=n=2:v=0:a=1[ac]');
    expect(text).toContain(`[am]${loudnormMeasureFilter()}[aout]`);
    expect(text).not.toMatch(/\[v\d/);
    expect(measure?.outputArgs).toEqual(['-map', '[aout]', '-f', 'null']);
    const args = ffmpegArgsFor(measure as NonNullable<typeof measure>, '-');
    expect(args.slice(0, 5)).toEqual(['-hide_banner', '-nostdin', '-y', '-loglevel', 'info']);
    expect(args.at(-1)).toBe('-');
    expect(text).toMatchSnapshot();
  });
});

describe('loudness', () => {
  it('writes the measuring and correcting filters', () => {
    expect(loudnormMeasureFilter()).toBe('loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json');
    expect(loudnormApplyFilter(MEASURED)).toBe(
      'loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-24.30:measured_TP=-14.10:measured_LRA=6.20:' +
        'measured_thresh=-34.60:offset=0.40:linear=true',
    );
    // Values outside loudnorm's ranges are clamped.
    expect(loudnormApplyFilter({ ...MEASURED, inputI: -120, inputLra: 140 })).toContain('measured_I=-99.00');
  });

  it('reads the JSON block FFmpeg prints', () => {
    const log = [
      'Input #0, lavfi, from ...',
      '[Parsed_loudnorm_3 @ 0000021a] ',
      '{',
      '\t"input_i" : "-27.61",',
      '\t"input_tp" : "-4.47",',
      '\t"input_lra" : "18.06",',
      '\t"input_thresh" : "-39.20",',
      '\t"output_i" : "-16.58",',
      '\t"output_tp" : "-1.50",',
      '\t"output_lra" : "14.78",',
      '\t"output_thresh" : "-27.71",',
      '\t"normalization_type" : "dynamic",',
      '\t"target_offset" : "0.58"',
      '}',
      '[out#0/null @ 000001] video:0KiB audio:2250KiB',
    ].join('\n');
    expect(parseLoudnormJson(log)).toEqual({
      inputI: -27.61,
      inputTp: -4.47,
      inputLra: 18.06,
      inputThresh: -39.2,
      targetOffset: 0.58,
    });
    expect(parseLoudnormJson('no block here')).toBeNull();
    expect(parseLoudnormJson('{ "other": 1 }')).toBeNull();
    const silent = parseLoudnormJson(
      '{ "input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0.00", "input_thresh" : "-inf", "target_offset" : "inf" }',
    );
    expect(silent?.inputI).toBe(Number.NEGATIVE_INFINITY);
    expect(silent?.inputThresh).toBe(-70);
  });

  it('skips silence and a mix already in range, and predicts the mode', () => {
    expect(decideLoudness(null)).toEqual({ apply: false, mode: 'skipped', measured: null });
    expect(decideLoudness({ ...MEASURED, inputI: Number.NEGATIVE_INFINITY }).apply).toBe(false);
    expect(decideLoudness({ ...MEASURED, inputI: -14.6, inputTp: -2 }).apply).toBe(false);
    // In range but peaking over the ceiling: corrected.
    expect(decideLoudness({ ...MEASURED, inputI: -14.6, inputTp: -0.5 }).apply).toBe(true);
    expect(loudnessModeFor(MEASURED)).toBe('linear');
    // Raising a quiet clip with a high peak would clip: FFmpeg goes dynamic.
    expect(loudnessModeFor({ ...MEASURED, inputI: -32.6, inputTp: -15 })).toBe('dynamic');
    expect(loudnessModeFor({ ...MEASURED, inputLra: 14 })).toBe('dynamic');
  });

  it('records the result for the job', () => {
    expect(loudnessResult(null, null)).toEqual({ inputLufs: null, inputTp: null, finalLufs: null, mode: 'skipped' });
    expect(loudnessResult(decideLoudness(MEASURED), { ...MEASURED, inputI: -14.04 })).toEqual({
      inputLufs: -24.3,
      inputTp: -14.1,
      finalLufs: -14,
      mode: 'linear',
    });
    // Skipped because already in range: the final loudness is the measured one.
    expect(loudnessResult(decideLoudness({ ...MEASURED, inputI: -14.3, inputTp: -3 }), null).finalLufs).toBe(-14.3);
  });

  it('measures a finished file at the info level', () => {
    expect(fileLoudnessArgs('render.mp4')).toEqual([
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'info',
      '-nostats',
      '-i',
      'render.mp4',
      '-map',
      '0:a:0',
      '-af',
      'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
      '-f',
      'null',
      '-',
    ]);
  });
});
