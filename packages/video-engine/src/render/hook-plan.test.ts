/**
 * A hook clip in the render plan (Sprint 13, Module 09): the hook part plays
 * first from its own seeked input, then the main part from its own, with a
 * cut fade at the join. The real FFmpeg check (the hook's frames, then the
 * main part's, at known output times) is `bleep-parity.test.ts` in
 * media-tools.
 */
import type { Segment } from '../document/schema';
import { compileFfmpeg, cutFades } from './compile';
import { buildRenderPlan } from './plan';
import { testContext, testDocument, testSegment } from './test-docs';

function hookSegment(id: string, sourceIn: number, sourceOut: number): Segment {
  return { ...testSegment(id, sourceIn, sourceOut), role: 'hook' };
}

describe('a hook clip in the render plan', () => {
  const doc = testDocument([
    hookSegment('hook', 10_000, 13_000),
    testSegment('body', 5_000, 20_000),
  ]);
  const plan = buildRenderPlan(doc, testContext());

  it('plays the hook first, then the main part, for the clip length', () => {
    expect(plan.output.durationMs).toBe(18_000);
    expect(plan.segments.map((s) => [s.id, s.outStartMs, s.outEndMs])).toEqual([
      ['hook', 0, 3_000],
      ['body', 3_000, 18_000],
    ]);
  });

  it('reads each from its own seeked input, so nothing is held in memory between them', () => {
    expect(plan.inputs.map((input) => [input.seekMs, input.segmentCount])).toEqual([
      [9_000, 1],
      [4_000, 1],
    ]);
    expect(plan.segments.map((s) => [s.inputIndex, s.trimStartMs, s.trimEndMs])).toEqual([
      [0, 1_000, 4_000],
      [1, 1_000, 16_000],
    ]);
    const graph = compileFfmpeg(plan).filterComplexScript;
    expect(graph).not.toContain('split=');
  });

  it('fades the sound at the join after the hook, which is a cut', () => {
    expect(cutFades(plan)).toEqual([
      { inMs: 0, outMs: 15 },
      { inMs: 15, outMs: 0 },
    ]);
  });

  it('handles a hook taken from the very start of the clip the same way', () => {
    const early = buildRenderPlan(
      testDocument([hookSegment('hook', 5_000, 7_000), testSegment('body', 5_000, 20_000)]),
      testContext(),
    );
    expect(early.inputs).toHaveLength(2);
    expect(early.output.durationMs).toBe(17_000);
  });
});
