import type { ClipDocument } from '../document/schema';
import { applyLayout, setFitCrop } from '../layout/edit';
import { PRESET_KINDS, type PresetKind } from '../layout/presets';
import { compileFfmpeg } from './compile';
import { roundedMaskExpression } from './layout-graph';
import { buildRenderPlan } from './plan';
import { testContext, testDocument, testSegment } from './test-docs';

const VIDEO = { width: 1920, height: 1080 };

/** 5 s of source from 10 s, then 3 s at 2x from 30 s: two segments, two inputs. */
function layoutDoc(kind: PresetKind): ClipDocument {
  const doc = testDocument([testSegment('a', 10_000, 15_000), testSegment('b', 30_000, 36_000, 2)]);
  return applyLayout(doc, kind, VIDEO);
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
  }
  return use;
}

describe.each(PRESET_KINDS)('the %s layout graph', (kind) => {
  const doc = layoutDoc(kind);
  const plan = buildRenderPlan(doc, testContext());
  const graph = compileFfmpeg(plan).filterComplexScript;

  it('matches the stored graph', () => {
    expect(graph).toMatchSnapshot();
  });

  it('writes shortest=1 and format=yuv420 on every overlay', () => {
    const overlays = graph.match(/overlay=[^,;[]*/g) ?? [];
    for (const overlay of overlays) {
      expect(overlay).toContain('shortest=1');
      expect(overlay).toContain('format=yuv420');
    }
    const expected = plan.segments.reduce((sum, s) => {
      const p = s.picture;
      const baseIsFirst = p.base.kind === 'colour' && (p.areas[0]?.radius ?? 0) === 0;
      return sum + p.areas.length - (baseIsFirst ? 1 : 0);
    }, 0);
    expect(overlays).toHaveLength(expected);
  });

  it('never turns the picture rgba', () => {
    expect(graph).not.toContain('rgba');
    expect(graph).not.toContain('format=auto');
  });

  it('writes every label once and reads it once', () => {
    for (const [label, count] of labelUse(graph)) {
      if (/^\[\d+:[va]\]$/.test(label)) {
        expect(count).toEqual({ out: 0, in: 1 });
      } else if (label === '[vout]' || label === '[aout]') {
        expect(count).toEqual({ out: 1, in: 0 });
      } else {
        expect([label, count]).toEqual([label, { out: 1, in: 1 }]);
      }
    }
  });

  it('places each overlay at the plan pixels, with even sizes everywhere', () => {
    for (const segment of plan.segments) {
      for (const area of segment.picture.areas) {
        for (const n of [area.width, area.height, area.x, area.y, area.crop.w, area.crop.h]) {
          expect(n % 2).toBe(0);
        }
        expect(area.x + area.width).toBeLessThanOrEqual(plan.output.width);
        expect(area.y + area.height).toBeLessThanOrEqual(plan.output.height);
        expect(area.crop.x + area.crop.w).toBeLessThanOrEqual(1920);
        expect(area.crop.y + area.crop.h).toBeLessThanOrEqual(1080);
        expect(graph).toContain(`scale=${area.width}:${area.height}:flags=bicubic`);
      }
    }
    for (const match of graph.matchAll(/(?:crop|scale|pad)=(\d+):(\d+)/g)) {
      expect(Number(match[1]) % 2).toBe(0);
      expect(Number(match[2]) % 2).toBe(0);
    }
  });
});

describe('layout graph details', () => {
  it('keeps Module 05 text for a single square area', () => {
    const graph = compileFfmpeg(
      buildRenderPlan(layoutDoc('fullscreen'), testContext()),
    ).filterComplexScript;
    expect(graph).not.toContain('overlay');
    expect(graph).toContain(
      '[0:v]trim=start=1.000:end=6.000,crop=608:1080:656:0:exact=1,scale=1080:1920:flags=bicubic,setpts=PTS-STARTPTS,fps=30,setsar=1[v0]',
    );
  });

  it('draws the Gameplay camera rounded, with a looped mask merged in yuv420p', () => {
    const plan = buildRenderPlan(layoutDoc('gameplay'), testContext());
    const camera = plan.segments[0]?.picture.areas[1];
    // 0.36 of 1080 is 388.8: 388 wide and tall, 36 px corners, at (44, 58).
    expect(camera).toMatchObject({ width: 388, height: 388, x: 44, y: 58, radius: 36 });
    const graph = compileFfmpeg(plan).filterComplexScript;
    expect(graph).toContain(
      `[l0s1]crop=432:432:0:648:exact=1,scale=388:388:flags=bicubic,setsar=1,format=yuv420p[l0r1]`,
    );
    expect(graph).toContain(
      `color=c=gray:s=388x388:r=30:d=0.04,format=gray,geq=lum='${roundedMaskExpression(388, 388, 36)}',loop=loop=-1:size=1:start=0,setpts=N/(30*TB)[l0m1]`,
    );
    expect(graph).toContain('[l0r1][l0m1]alphamerge=shortest=1[l0a1]');
    // The game is the base: no colour, no pad.
    expect(graph).toContain(
      '[l0s0]crop=608:1080:656:0:exact=1,scale=1080:1920:flags=bicubic,setsar=1[l0b]',
    );
    expect(graph).toContain(
      '[l0b][l0a1]overlay=x=44:y=58:format=yuv420:shortest=1,setpts=PTS-STARTPTS,fps=30,setsar=1[v0]',
    );
  });

  it('scales the corner radius with the export', () => {
    const plan = buildRenderPlan(layoutDoc('gameplay'), testContext({ quality: '720p' }));
    expect(plan.segments[0]?.picture.areas[1]?.radius).toBe(24);
    const proof = buildRenderPlan(layoutDoc('gameplay'), testContext({ proof: true }));
    expect(proof.segments[0]?.picture.areas[1]?.radius).toBe(12);
  });

  it('writes the mask expression of the cookbook', () => {
    expect(roundedMaskExpression(388, 388, 36)).toBe(
      'clip((36-hypot(max(abs(X-194+0.5)-158,0),max(abs(Y-194+0.5)-158,0)))+0.5,0,1)*255',
    );
  });

  it('pads the first Split area onto the canvas colour and overlays the second', () => {
    const graph = compileFfmpeg(
      buildRenderPlan(layoutDoc('split'), testContext()),
    ).filterComplexScript;
    expect(graph).toContain('[0:v]trim=start=1.000:end=6.000,split=2[l0s0][l0s1]');
    expect(graph).toMatch(
      /\[l0s0\]crop=[^;]*,scale=1080:720:flags=bicubic,setsar=1,pad=1080:1920:0:0:color=0x000000\[l0b\]/,
    );
    expect(graph).toMatch(/\[l0b\]\[l0a1\]overlay=x=0:y=720:format=yuv420:shortest=1,setpts/);
  });

  it('draws Screen Share on the blurred base, the camera rounded', () => {
    const graph = compileFfmpeg(
      buildRenderPlan(layoutDoc('screen_share'), testContext()),
    ).filterComplexScript;
    expect(graph).toContain('split=3[l0s0][l0s1][l0s2]');
    expect(graph).toContain('scale=108:192:flags=bilinear,gblur=sigma=3:steps=2,scale=1080:1920');
    expect(graph).toContain('alphamerge');
    expect(graph.match(/overlay=/g)).toHaveLength(4);
  });

  it('follows the Fit crop ratio in the Blurred export', () => {
    const doc = setFitCrop(layoutDoc('blurred'), '1:1', VIDEO);
    const plan = buildRenderPlan(doc, testContext());
    expect(plan.segments[0]?.picture.areas[0]).toMatchObject({
      crop: { x: 420, y: 0, w: 1080, h: 1080 },
      width: 1080,
      height: 1080,
      x: 0,
      y: 420,
    });
  });

  it('draws a lone rounded area over a colour base made from the picture', () => {
    const doc = layoutDoc('fullscreen');
    const area = doc.layout.areas[0];
    if (!area) throw new Error('no area');
    area.radius = 60;
    area.frame = { x: 0.1, y: 0.1, w: 0.8, h: 0.45 };
    doc.layout.kind = 'custom';
    const graph = compileFfmpeg(buildRenderPlan(doc, testContext())).filterComplexScript;
    expect(graph).toContain(
      '[l0s0]crop=2:2:0:0:exact=1,setsar=1,pad=1080:1920:0:0:color=0x000000,drawbox=x=0:y=0:w=2:h=2:color=0x000000:t=fill[l0b]',
    );
    expect(graph).toContain('alphamerge=shortest=1[l0a1]');
  });
});
