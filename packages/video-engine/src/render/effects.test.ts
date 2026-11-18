/**
 * Module 13 in the compiler: zooms as `perspective`, the look as one
 * `colorchannelmixer`, the vignette on `gbrp`. The zoom filters are checked
 * by evaluating their own expressions frame by frame against `frameState`,
 * so the export and the editor share one curve.
 */
import type { ClipDocument, Zoom } from '../document/schema';
import { stickerRefKey } from '../document/sticker';
import { compileFfmpeg } from './compile';
import { frameState } from './frame-state';
import { lookFilters, lookMixerFilter, planLook } from './looks';
import { buildRenderPlan } from './plan';
import {
  testContext,
  testDocument,
  testSegment,
  testSticker,
  testStickerAsset,
  withItems,
} from './test-docs';
import { type PlanZoom, zoomFilter } from './zoom';

function zoom(id: string, from: number, to: number, overrides: Partial<Zoom> = {}): Zoom {
  return {
    id,
    source: 'src',
    from,
    to,
    scale: 2,
    focus: { x: 0.5, y: 0.5 },
    ease: 300,
    ...overrides,
  };
}

/** Source 10 to 20 s at 1x, then 20 to 30 s at 2x. */
function twoSegments(zooms: Zoom[] = []): ClipDocument {
  return {
    ...testDocument([testSegment('a', 10_000, 20_000), testSegment('b', 20_000, 30_000, 2)]),
    zooms,
  };
}

/** The graph's filters, split on the commas and semicolons outside quotes. */
function filtersOf(graph: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of graph) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && (ch === ',' || ch === ';' || ch === '\n')) {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function perspectives(graph: string): string[] {
  return filtersOf(graph)
    .map((f) => f.replace(/^(\[[^\]]+\])+/, '').replace(/(\[[^\]]+\])+$/, ''))
    .filter((f) => f.startsWith('perspective='));
}

/** The value of one `perspective` option (an expression in quotes). */
function option(filter: string, name: string): string {
  const match = new RegExp(`[=:]${name}='([^']*)'`).exec(filter);
  if (!match) throw new Error(`no ${name} in ${filter}`);
  return match[1] as string;
}

/** Evaluates an FFmpeg expression with the few functions the compiler writes. */
function evaluate(expression: string, vars: Record<string, number>): number {
  const fns = {
    min: Math.min,
    max: Math.max,
    clip: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)),
    between: (v: number, lo: number, hi: number) => (v >= lo && v <= hi ? 1 : 0),
    gte: (a: number, b: number) => (a >= b ? 1 : 0),
    lt: (a: number, b: number) => (a < b ? 1 : 0),
  };
  if (!/^[\w\s.+\-*/(),]*$/.test(expression)) throw new Error(`unexpected text in ${expression}`);
  const names = [...Object.keys(fns), ...Object.keys(vars)];
  const values = [...Object.values(fns), ...Object.values(vars)];
  // `in` is a word of its own in JavaScript.
  const body = expression.replace(/\bin\b/g, 'frameIn');
  return new Function(...names, `return (${body});`)(...values) as number;
}

describe('zoom filters', () => {
  it('writes one perspective per window, every one limited with enable, after the join', () => {
    const doc = twoSegments([zoom('z', 12_000, 14_000), zoom('y', 22_000, 24_000, { ease: 0 })]);
    const graph = compileFfmpeg(buildRenderPlan(doc, testContext())).filterComplexScript;
    const filters = perspectives(graph);
    expect(filters).toHaveLength(2);
    for (const filter of filters) {
      expect(filter).toMatch(/:enable='[^']+'$/);
      expect(filter).toContain(':eval=frame:');
      expect(filter).toContain(':interpolation=cubic:');
    }
    // Zoom and look sit on the joined picture, before the text, the mark and the fades.
    expect(graph).toMatch(/\[vc\]fps=30,format=yuv420p,perspective=/);
  });

  it('uses linear interpolation for Preview Export', () => {
    const doc = twoSegments([zoom('z', 12_000, 14_000)]);
    const graph = compileFfmpeg(
      buildRenderPlan(doc, testContext({ proof: true })),
    ).filterComplexScript;
    expect(perspectives(graph)[0]).toContain(':interpolation=linear:');
  });

  it('enables an eased zoom 20 ms either side and a Snap zoom exactly', () => {
    const doc = twoSegments([zoom('z', 12_000, 14_000), zoom('y', 22_000, 24_000, { ease: 0 })]);
    const [eased, snap] = perspectives(
      compileFfmpeg(buildRenderPlan(doc, testContext())).filterComplexScript,
    );
    expect(option(eased as string, 'enable')).toBe('between(t,1.98,4.02)');
    expect(option(snap as string, 'enable')).toBe('gte(t,11.000)*lt(t,12.000)');
    expect(option(snap as string, 'x0')).toBe('540-540/2');
  });

  it('puts the focus in output pixels', () => {
    const doc = twoSegments([zoom('z', 12_000, 14_000, { focus: { x: 0.25, y: 0.75 } })]);
    const plan = buildRenderPlan(doc, testContext({ quality: '720p' }));
    expect(plan.zooms).toEqual([
      { id: 'z', startMs: 2_000, endMs: 4_000, easeMs: 300, scale: 2, focusX: 180, focusY: 960 },
    ]);
  });

  it('draws the same zoom as frameState on every frame, across a change of speed and a cut', () => {
    const doc: ClipDocument = {
      ...testDocument([
        testSegment('a', 10_000, 20_000),
        testSegment('b', 20_000, 30_000, 2),
        testSegment('c', 40_000, 50_000, 0.5),
      ]),
      zooms: [
        zoom('z', 18_000, 24_000, { focus: { x: 0.3, y: 0.6 }, scale: 1.8 }),
        zoom('y', 29_000, 41_000, { ease: 800, scale: 2.5, focus: { x: 0.7, y: 0.2 } }),
      ],
    };
    const plan = buildRenderPlan(doc, testContext());
    const { width, height, fps, durationMs } = plan.output;
    const filters = perspectives(compileFfmpeg(plan).filterComplexScript);
    expect(filters).toHaveLength(3);

    const frames = Math.round((durationMs * fps) / 1000);
    for (let k = 0; k < frames; k += 1) {
      const t = k / fps;
      // Compose every enabled perspective: x0 is where the frame's left edge comes from.
      let left = 0;
      let top = 0;
      let right = width;
      let bottom = height;
      for (const filter of filters) {
        if (!evaluate(option(filter, 'enable'), { t })) continue;
        const vars = { frameIn: k + 1 };
        const x0 = evaluate(option(filter, 'x0'), vars);
        const x3 = evaluate(option(filter, 'x3'), vars);
        const y0 = evaluate(option(filter, 'y0'), vars);
        const y3 = evaluate(option(filter, 'y3'), vars);
        // The windows never overlap, so at most one is away from the identity.
        if (Math.abs(x0) > 1e-9 || Math.abs(y0) > 1e-9) {
          left = x0;
          top = y0;
          right = x3;
          bottom = y3;
        }
      }
      const state = frameState(doc, (k * 1000) / fps);
      const z = state.zoom.scale;
      const fx = state.zoom.focus.x * width;
      const fy = state.zoom.focus.y * height;
      expect(left).toBeCloseTo(fx - fx / z, 2);
      expect(right).toBeCloseTo(fx + (width - fx) / z, 2);
      expect(top).toBeCloseTo(fy - fy / z, 2);
      expect(bottom).toBeCloseTo(fy + (height - fy) / z, 2);
    }
  });

  it('writes a window as filter text with the ease and the scale', () => {
    const window: PlanZoom = {
      id: 'z',
      startMs: 1_000,
      endMs: 3_000,
      easeMs: 300,
      scale: 1.5,
      focusX: 540,
      focusY: 960,
    };
    expect(zoomFilter(window, { width: 1080, height: 1920, fps: 30 }, 'cubic')).toMatchSnapshot();
  });
});

describe('look filters', () => {
  it('writes nothing for None, Strength 0 and no vignette', () => {
    expect(lookFilters(planLook({ colour: 'none', strength: 1, vignette: 0 }))).toEqual([]);
    expect(lookFilters(planLook({ colour: 'warm', strength: 0, vignette: 0 }))).toEqual([]);
    expect(lookFilters(undefined)).toEqual([]);
  });

  it('writes the matrix as one colorchannelmixer on RGBA, the offset in the alpha column', () => {
    const filters = lookFilters(planLook({ colour: 'black_white', strength: 1, vignette: 0 }));
    expect(filters).toEqual([
      'format=rgba',
      'colorchannelmixer=rr=0.3:rg=0.59:rb=0.11:ra=0:gr=0.3:gg=0.59:gb=0.11:ga=0:br=0.3:bg=0.59:bb=0.11:ba=0',
      'format=rgba',
      'format=yuv420p',
    ]);
    const warm = planLook({ colour: 'warm', strength: 1, vignette: 0 });
    expect(lookMixerFilter(warm.matrix as NonNullable<typeof warm.matrix>)).toContain(':ra=0.035:');
  });

  it('writes the vignette on gbrp, pinned on both sides, after the look', () => {
    expect(lookFilters(planLook({ colour: 'none', strength: 0, vignette: 1 }))).toEqual([
      'format=gbrp',
      'vignette=angle=0.785398',
      'format=gbrp',
      'format=yuv420p',
    ]);
    const both = lookFilters(planLook({ colour: 'sepia', strength: 0.5, vignette: 0.4 }));
    expect(both).toEqual([
      'format=rgba',
      expect.stringMatching(/^colorchannelmixer=/),
      'format=rgba',
      'format=gbrp',
      'vignette=angle=0.314159',
      'format=gbrp',
      'format=yuv420p',
    ]);
  });

  it('tints the picture before the stickers and the text, so overlays keep their colours', () => {
    const doc = withItems(
      {
        ...twoSegments([zoom('z', 12_000, 14_000)]),
        looks: { colour: 'sepia', strength: 1, vignette: 0.5 },
      },
      [testSticker('s')],
    );
    const ctx = testContext({
      assets: {
        sources: testContext().assets.sources,
        stickers: { [stickerRefKey(testSticker('s').ref) as string]: testStickerAsset() },
      },
    });
    const graph = compileFfmpeg(buildRenderPlan(doc, ctx)).filterComplexScript;
    const joined = graph.split(';\n').find((line) => line.startsWith('[vc]')) as string;
    expect(joined).toMatch(
      /^\[vc\]fps=30,format=yuv420p,perspective=.*,format=rgba,colorchannelmixer=.*,format=rgba,format=gbrp,vignette=angle=0\.392699,format=gbrp,format=yuv420p\[sp0\]$/,
    );
  });
});
