import { compileFfmpeg } from '../render/compile';
import { frameState } from '../render/frame-state';
import { buildRenderPlan } from '../render/plan';
import { testContext, testDocument, testSegment } from '../render/test-docs';
import { addBlur, blurInto, removeBlur, updateBlur } from './blur';
import { MAX_BLURS } from './limits';
import { clipDocumentSchema } from './schema';

describe('Blur A Region (Module 17 item 18)', () => {
  const clip = () => testDocument([testSegment('a', 0, 6_000)]);

  it('adds, keeps inside the picture, caps and removes boxes', () => {
    const doc = clip();
    const source = doc.sources[0]?.id as string;
    const added = addBlur(doc, source);
    if (!added.ok) throw new Error(added.code);
    expect(clipDocumentSchema.safeParse(added.doc).success).toBe(true);
    const moved = updateBlur(added.doc, added.blurId as string, { x: 0.95, w: 0.3 });
    expect(moved.ok && moved.doc.blurs?.[0]).toMatchObject({ x: 0.7, w: 0.3 });
    let full = added.doc;
    for (let k = 1; k < MAX_BLURS; k += 1) {
      const next = addBlur(full, source);
      if (next.ok) full = next.doc;
    }
    expect(addBlur(full, source)).toEqual({ ok: false, code: 'too_many_blurs' });
    const removed = removeBlur(added.doc, added.blurId as string);
    expect(removed.ok && removed.doc.blurs).toBeUndefined();
  });

  it('places a box inside an area crop, or nowhere when the crop misses it', () => {
    const box = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
    const into = blurInto(box, { x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(into?.x).toBeCloseTo(0.3, 9);
    expect(into?.w).toBeCloseTo(0.4, 9);
    expect(into?.y).toBeCloseTo(0.4, 9);
    expect(into?.h).toBeCloseTo(0.2, 9);
    expect(blurInto(box, { x: 0.7, y: 0, w: 0.3, h: 1 })).toBeNull();
  });

  it('is in the frame state and blurs the video before any crop in the export', () => {
    const doc = clip();
    const added = addBlur(doc, doc.sources[0]?.id as string);
    if (!added.ok) throw new Error(added.code);
    expect(frameState(added.doc, 1_000).blurs).toEqual([{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }]);
    const graph = compileFfmpeg(buildRenderPlan(added.doc, testContext())).filterComplexScript;
    expect(graph).toContain('[0:v]split=2[i0b0m][i0b0c]');
    expect(graph).toContain("boxblur=luma_radius='min(w,h)/6'");
    expect(graph).toContain('[i0b0m][i0b0z]overlay=x=main_w*0.4:y=main_h*0.4[i0b0]');
    expect(compileFfmpeg(buildRenderPlan(doc, testContext())).filterComplexScript).not.toContain(
      'boxblur',
    );
  });
});
