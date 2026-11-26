/**
 * Moving crops in the export (Sprint 13, Module 08): the `sendcmd` command
 * file per segment and moving area, the named `crop` in the graph, and the
 * clock its times are in. The same keys are also run through a small
 * stand-in for `sendcmd` and `crop` (enter an interval when a frame's time
 * falls in it, evaluate the one linear expression, round like `lrint`) and
 * compared frame by frame with `frameState`; the real FFmpeg check is in
 * `packages/media-tools/src/render/reframe-parity.test.ts`.
 */
import type { ClipDocument, CropKeyframe } from '../document/schema';
import { compileFfmpeg, formatNumber } from './compile';
import { cropCommandText, planCropPath } from './crop-path';
import { isRenderCompileError } from './errors';
import { frameState } from './frame-state';
import { buildRenderPlan, type RenderContext, type RenderPlan } from './plan';
import {
  CENTRED_VERTICAL_CROP,
  testContext,
  testDocument,
  testSegment,
  testSource,
} from './test-docs';

const W = 0.31640625;
const SOURCE = { width: 1920, height: 1080, fps: 30 };

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` keys from `fromMs`, about a frame apart: a random walk across the
 * picture at up to about 450 px a second, the fast end of a camera path.
 */
function randomKeys(count: number, fromMs: number, seed = 7): CropKeyframe[] {
  const random = seeded(seed);
  let x = (1 - W) / 2;
  return Array.from({ length: count }, (_, i) => {
    x = Math.min(1 - W, Math.max(0, x + (random() - 0.5) * 0.016));
    return { at: fromMs + i * 33 + (i % 3), rect: { x, y: 0, w: W, h: 1 } };
  });
}

function withCrop(doc: ClipDocument, keys: CropKeyframe[], area = 0): ClipDocument {
  const areas = doc.layout.areas.map((a, k) => (k === area ? { ...a, crop: keys } : a));
  return { ...doc, layout: { ...doc.layout, areas } };
}

const at = (ms: number, x: number, y = 0): CropKeyframe => ({ at: ms, rect: { x, y, w: W, h: 1 } });

/** One parsed line of a command file. */
interface Interval {
  start: number;
  end: number;
  x: string | null;
}

function parseCommands(text: string, target: string): Interval[] {
  return text
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^([0-9.]+)(?:-([0-9.]+))? (.*);$/.exec(line);
      if (!match) throw new Error(`Not a command line: ${line}`);
      const x = new RegExp(`${target.replace(/[@]/g, '\\@')} x '([^']*)'`).exec(match[3] as string);
      return {
        start: Number(match[1]),
        end: match[2] === undefined ? Number.POSITIVE_INFINITY : Number(match[2]),
        x: x ? (x[1] as string) : null,
      };
    });
}

/** `a`, `a+b*(t-c)` or `a-b*(t-c)`; nothing else is ever written. */
function evaluate(expression: string, t: number): number {
  const linear = /^(-?[0-9.]+)([+-])([0-9.]+)\*\(t-([0-9.]+)\)$/.exec(expression);
  if (linear) {
    const sign = linear[2] === '-' ? -1 : 1;
    return Number(linear[1]) + sign * Number(linear[3]) * (t - Number(linear[4]));
  }
  if (!/^-?[0-9.]+$/.test(expression)) throw new Error(`Not a linear expression: ${expression}`);
  return Number(expression);
}

/**
 * What `sendcmd` plus `crop` do with a file, for frames at `times` (seconds
 * of the run's clock, rising): a frame enters every interval it falls in,
 * the last entered expression stays set, and `crop` rounds with `lrint`.
 */
function simulateX(text: string, target: string, x0: number, times: number[]): number[] {
  const intervals = parseCommands(text, target);
  const entered = intervals.map(() => false);
  let expression = String(x0);
  return times.map((t) => {
    intervals.forEach((interval, k) => {
      const inside = t >= interval.start - 1e-9 && t < interval.end - 1e-9;
      if (inside && !entered[k] && interval.x !== null) expression = interval.x;
      entered[k] = inside;
    });
    return Math.round(evaluate(expression, t));
  });
}

/** Every source frame each segment shows, with the crop `frameState` says and the one FFmpeg would draw. */
function compareWithFrameState(doc: ClipDocument, ctx: RenderContext = testContext()) {
  const plan = buildRenderPlan(doc, ctx);
  const compiled = compileFfmpeg(plan);
  const files = new Map(compiled.commandFiles.map((f) => [f.name, f.content]));
  const asset = ctx.assets.sources.src ?? testSource();
  const results: Array<{ expected: number; drawn: number }> = [];
  for (const segment of plan.segments) {
    const area = segment.picture.areas[0];
    if (!area) throw new Error('no area');
    const input = plan.inputs[segment.inputIndex];
    const clock = asset.sourceOffsetMs + (input?.seekMs ?? 0);
    const frames: Array<{ outMs: number; t: number }> = [];
    const step = 1000 / plan.output.fps;
    for (let n = Math.ceil(segment.outStartMs / step); n * step < segment.outEndMs; n += 1) {
      const state = frameState(doc, n * step, { sources: { src: SOURCE } });
      // A moment on the join can round into the next segment: it is that segment's frame.
      if (state.segment.index !== segment.index) continue;
      const frame = state.segment.sourceFrame as number;
      frames.push({ outMs: n * step, t: ((frame * 1000) / asset.fps - clock) / 1000 });
    }
    const drawn = area.path
      ? simulateX(
          files.get(area.path.file) as string,
          area.path.target,
          area.crop.x,
          frames.map((f) => f.t),
        )
      : frames.map(() => area.crop.x);
    frames.forEach((f, k) => {
      const state = frameState(doc, f.outMs, { sources: { src: SOURCE } });
      const visible = state.areas[0]?.visibleCrop.x as number;
      const expected = Math.min(1920 - area.crop.w, Math.max(0, Math.round(visible * 1920)));
      results.push({ expected, drawn: drawn[k] as number });
    });
  }
  return { plan, compiled, results };
}

function worstError(results: Array<{ expected: number; drawn: number }>): number {
  return results.reduce((worst, r) => Math.max(worst, Math.abs(r.expected - r.drawn)), 0);
}

describe('a moving crop in the export', () => {
  it('compiles 480 keys to one sendcmd file of 480 lines, never a chain in the graph', () => {
    const doc = withCrop(testDocument([testSegment('a', 9_000, 27_000)]), randomKeys(480, 10_000));
    const { compiled, results } = compareWithFrameState(doc);
    expect(compiled.commandFiles.map((f) => f.name)).toEqual(['crop-s0-a0.txt']);
    const lines = (compiled.commandFiles[0]?.content ?? '').trim().split('\n');
    expect(lines).toHaveLength(480);
    // 479 ramps, then a constant at the last key.
    expect(lines.slice(0, -1).every((line) => /^[0-9.]+-[0-9.]+ /.test(line))).toBe(true);
    expect(lines[lines.length - 1]).toMatch(/^[0-9.]+ crop@s0a0 x '[0-9.]+';$/);
    // One linear expression per line, never a chain of terms.
    for (const line of lines) {
      expect((line.match(/\(t-/g) ?? []).length).toBeLessThanOrEqual(1);
      expect(line).not.toMatch(/if\(|between\(|clip\(|gte\(|lt\(/);
    }
    // The graph names the file and the crop; it holds no expression of time at all.
    const graph = compiled.filterComplexScript;
    expect(graph).toContain('sendcmd=f=crop-s0-a0.txt,crop@s0a0=w=608:h=1080:x=');
    expect(graph).not.toMatch(/\(t-|between\(|if\(/);
    expect(Math.max(...graph.split('\n').map((line) => line.length))).toBeLessThan(400);
    // Every source frame the clip shows is where frameState puts it (to the pixel).
    expect(results.length).toBeGreaterThan(500);
    expect(worstError(results)).toBeLessThanOrEqual(1);
  });

  it('keeps the graph the same size whatever the number of keys', () => {
    const few = withCrop(testDocument([testSegment('a', 9_000, 27_000)]), randomKeys(3, 10_000));
    const many = withCrop(testDocument([testSegment('a', 9_000, 27_000)]), randomKeys(480, 10_000));
    const small = compileFfmpeg(buildRenderPlan(few, testContext())).filterComplexScript;
    const large = compileFfmpeg(buildRenderPlan(many, testContext())).filterComplexScript;
    expect(large.replace(/x=\d+/, 'x=X')).toBe(small.replace(/x=\d+/, 'x=X'));
  });

  it('keeps the old plain crop text, byte for byte, for a crop that holds still', () => {
    const doc = testDocument([
      testSegment('a', 10_000, 20_000),
      testSegment('b', 20_000, 30_000, 2),
    ]);
    const plain = compileFfmpeg(buildRenderPlan(doc, testContext()));
    expect(plain.commandFiles).toEqual([]);
    expect(plain.filterComplexScript).not.toContain('sendcmd');
    // Two keys at one place are a crop that holds still.
    const twice = withCrop(doc, [
      at(0, CENTRED_VERTICAL_CROP.x),
      at(15_000, CENTRED_VERTICAL_CROP.x),
    ]);
    const same = compileFfmpeg(buildRenderPlan(twice, testContext()));
    expect(same.filterComplexScript).toBe(plain.filterComplexScript);
    expect(same.commandFiles).toEqual([]);
    expect(buildRenderPlan(twice, testContext())).toEqual(buildRenderPlan(doc, testContext()));
  });

  it('draws a segment the crop does not move in with the plain crop', () => {
    // Keys in the first segment only: the second plays after the last key and holds it.
    const doc = withCrop(
      testDocument([testSegment('a', 10_000, 20_000), testSegment('b', 40_000, 50_000)]),
      [at(12_000, 0.1), at(18_000, 0.5)],
    );
    const { compiled, plan, results } = compareWithFrameState(doc);
    expect(compiled.commandFiles.map((f) => f.name)).toEqual(['crop-s0-a0.txt']);
    expect(plan.segments[1]?.picture.areas[0]?.path).toBeUndefined();
    expect(compiled.filterComplexScript).toContain(
      '[1:v]trim=start=1.000:end=11.000,crop=608:1080:960:0:exact=1',
    );
    expect(worstError(results)).toBeLessThanOrEqual(1);
  });

  it('refuses a crop whose size changes', () => {
    const doc = withCrop(testDocument([testSegment('a', 10_000, 20_000)]), [
      at(10_000, 0.1),
      { at: 15_000, rect: { x: 0.1, y: 0, w: 0.25, h: 1 } },
    ]);
    let caught: unknown = null;
    try {
      buildRenderPlan(doc, testContext());
    } catch (error) {
      caught = error;
    }
    expect(isRenderCompileError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('crop_keyframes_unsupported');
    expect((caught as { details: Record<string, unknown> }).details.reason).toBe('size changes');
  });

  it('writes each segment its own file, in its own run clock, through a speed change and a second run', () => {
    // 10 to 20 s at 1x and 20 to 30 s at 2x play as one run (seek 9 s);
    // 40 to 46 s at 0.5x is a run of its own (seek 39 s); the file starts at source 5 s.
    const doc = withCrop(
      testDocument([
        testSegment('a', 10_000, 20_000),
        testSegment('b', 20_000, 30_000, 2),
        testSegment('c', 40_000, 46_000, 0.5),
      ]),
      [
        at(12_000, 0.1),
        at(18_000, 0.6),
        at(22_000, 0.2),
        at(28_000, 0.4),
        at(43_000, 0.0),
        at(45_000, 0.68),
      ],
    );
    const ctx = testContext({
      assets: { sources: { src: testSource({ sourceOffsetMs: 5_000, durationMs: 60_000 }) } },
    });
    const plan: RenderPlan = buildRenderPlan(doc, ctx);
    expect(plan.inputs.map((i) => i.seekMs)).toEqual([4_000, 34_000]);
    const compiled = compileFfmpeg(plan);
    expect(compiled.commandFiles.map((f) => f.name)).toEqual([
      'crop-s0-a0.txt',
      'crop-s1-a0.txt',
      'crop-s2-a0.txt',
    ]);
    const times = compiled.commandFiles.map((f) =>
      f.content
        .trim()
        .split('\n')
        .map((line) => line.split(' ')[0]),
    );
    // Run clock = source - 5 s offset - the run's seek. a: trim 1 to 11 s; b: 11 to 21 s; c: 1 to 7 s.
    expect(times[0]).toEqual(['3.000-9.000', '9.000-11.000', '11.000']);
    // b ends at 30 s, between the keys at 28 and 43 s: its last key is the crop at 30 s.
    expect(times[1]).toEqual(['11.000-13.000', '13.000-19.000', '19.000-21.000', '21.000']);
    expect(times[2]).toEqual(['1.000-4.000', '4.000-6.000', '6.000']);
    expect(compiled.filterComplexScript).toContain('trim=start=11.000:end=21.000');
    expect(compiled.filterComplexScript).toContain(
      '[1:v]trim=start=1.000:end=7.000,sendcmd=f=crop-s2-a0.txt',
    );
    const { results } = compareWithFrameState(doc, ctx);
    expect(worstError(results)).toBeLessThanOrEqual(1);
  });

  it('makes a jump (two keys a millisecond apart) a jump, with no frame part of the way', () => {
    const doc = withCrop(testDocument([testSegment('a', 0, 10_000)]), [
      at(2_000, 0.1),
      at(5_000, 0.1),
      at(5_001, 0.6),
    ]);
    const { compiled, results } = compareWithFrameState(doc);
    const text = compiled.commandFiles[0]?.content as string;
    const x1 = 192;
    const x2 = 1152;
    expect(text).toBe(
      [`2.000-5.000 crop@s0a0 x '${x1}';`, `5.000001 crop@s0a0 x '${x2}';`, ''].join('\n'),
    );
    // The held stretch before the jump is the crop's own x: no command for it.
    expect(compiled.filterComplexScript).toContain(`crop@s0a0=w=608:h=1080:x=${x1}:y=0:exact=1`);
    expect(worstError(results)).toBe(0);
    // The frame at 5 s still shows the first place, any later one the second.
    const xs = simulateX(text, 'crop@s0a0', x1, [4.9667, 5, 5.0003, 5.0333, 5.0667]);
    expect(xs).toEqual([x1, x1, x2, x2, x2]);

    // A jump that a frame falls inside (keys at 5033 and 5034 ms, a frame at 5033.33 ms):
    // frameState reads 5034 ms there, and the export draws the new place, not a third of the way.
    const between = withCrop(testDocument([testSegment('a', 0, 10_000)]), [
      at(2_000, 0.1),
      at(5_033, 0.1),
      at(5_034, 0.6),
      at(7_000, 0.5),
    ]);
    const second = compareWithFrameState(between);
    expect(second.compiled.commandFiles[0]?.content).toBe(
      [
        `2.000-5.033 crop@s0a0 x '${x1}';`,
        `5.033001-7.000 crop@s0a0 x '${x2}-${formatNumber((192 * 1000) / 1966)}*(t-5.034)';`,
        `7.000 crop@s0a0 x '960';`,
        '',
      ].join('\n'),
    );
    expect(worstError(second.results)).toBeLessThanOrEqual(1);
  });

  it('clips keys outside a segment to its edges, with the crop there exactly', () => {
    const keys = [at(5_000, 0.1), at(25_000, 0.5)];
    const path = planCropPath({
      area: { frame: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover', crop: keys },
      areaIndex: 1,
      segmentIndex: 3,
      sourceIn: 10_000,
      sourceOut: 20_000,
      clockOffsetMs: 9_000,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasAspect: 9 / 16,
      size: { w: 608, h: 1080 },
    });
    expect(path?.file).toBe('crop-s3-a1.txt');
    expect(path?.target).toBe('crop@s3a1');
    // cropAt(10 s) is a quarter of the way, cropAt(20 s) three quarters (in source pixels).
    const quarter = 384;
    const threeQuarters = 768;
    expect(path?.keys).toEqual([
      { ms: 1_000, x: quarter, y: 0 },
      { ms: 11_000, x: threeQuarters, y: 0 },
    ]);
    expect(cropCommandText(path as NonNullable<typeof path>)).toBe(
      `1.000-11.000 crop@s3a1 x '${quarter}+${(threeQuarters - quarter) / 10}*(t-1.000)';\n` +
        `11.000 crop@s3a1 x '${threeQuarters}';\n`,
    );
  });

  it('moves y as well, and a move to the left is written with a minus', () => {
    // A square crop of a portrait-ish window: x and y both move.
    const keys = [
      { at: 1_000, rect: { x: 0.5, y: 0.3, w: 0.2, h: 0.3 } },
      { at: 2_000, rect: { x: 0.25, y: 0.1, w: 0.2, h: 0.3 } },
    ];
    const path = planCropPath({
      area: { frame: { x: 0, y: 0, w: 1, h: 1 }, fit: 'contain', crop: keys },
      areaIndex: 0,
      segmentIndex: 0,
      sourceIn: 0,
      sourceOut: 3_000,
      clockOffsetMs: 0,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasAspect: 9 / 16,
      size: { w: 384, h: 324 },
    });
    expect(cropCommandText(path as NonNullable<typeof path>)).toBe(
      "1.000-2.000 crop@s0a0 x '960-480*(t-1.000)', crop@s0a0 y '324-216*(t-1.000)';\n" +
        "2.000 crop@s0a0 x '480', crop@s0a0 y '108';\n",
    );
  });

  it('is deterministic: the same plan gives the same files', () => {
    const doc = withCrop(
      testDocument([testSegment('a', 9_000, 27_000)]),
      randomKeys(120, 10_000, 3),
    );
    const one = compileFfmpeg(buildRenderPlan(doc, testContext()));
    const two = compileFfmpeg(buildRenderPlan(doc, testContext()));
    expect(two).toEqual(one);
  });
});
