/**
 * The identity that keeps the export the timeline's length: after any run of
 * trims, splits, removes, speed changes and drags, the parts' output lengths
 * add up exactly to `outputDuration(doc)`, and so do the render plan's
 * segments. 300 seeded random sequences (no `Math.random`, so a failure
 * always reproduces from its seed).
 */
import { SPEEDS } from '../document/limits';
import { type ClipDocument, clipDocumentSchema, segmentOutputMs } from '../document/schema';
import { type EditResult, removeSegment, setSpeed, splitAt, trimSegment } from '../time/edits';
import { outputDuration, placeSegments } from '../time/time-map';
import { dragTrimEnd, dragTrimStart } from '../timeline/gestures';
import { buildRenderPlan } from './plan';
import { testContext, testDocument, testSegment } from './test-docs';

/** The test source holds 0 to 120 s of the video. */
const VIDEO_LENGTH = 120_000;
const SEQUENCES = 300;
const STEPS = 25;

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

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)] as T;
}

/** One random edit; refusals leave the document as it was. */
function step(doc: ClipDocument, random: () => number): { doc: ClipDocument; applied: boolean } {
  const segment = pick(random, doc.segments);
  const total = outputDuration(doc);
  const roll = random();
  let result: EditResult | null = null;

  if (roll < 0.3) {
    result = splitAt(doc, random() * total);
  } else if (roll < 0.5) {
    result = trimSegment(doc, {
      segmentId: segment.id,
      edge: random() < 0.5 ? 'start' : 'end',
      sourceMs: -5_000 + random() * (VIDEO_LENGTH + 10_000),
      videoDurationMs: VIDEO_LENGTH,
    });
  } else if (roll < 0.7) {
    const drag = {
      segmentId: segment.id,
      pointerMs: -2_000 + random() * (total + 4_000),
      videoDurationMs: VIDEO_LENGTH,
    };
    const dragged = random() < 0.5 ? dragTrimStart(doc, drag) : dragTrimEnd(doc, drag);
    return { doc: dragged.doc, applied: dragged.doc !== doc };
  } else if (roll < 0.85) {
    result = setSpeed(doc, segment.id, pick(random, SPEEDS));
  } else {
    result = removeSegment(doc, segment.id);
  }
  return result.ok ? { doc: result.doc, applied: true } : { doc, applied: false };
}

function checkIdentity(doc: ClipDocument, label: string): void {
  const parsed = clipDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    throw new Error(`${label}: invalid document ${JSON.stringify(parsed.error.issues[0])}`);
  }
  const total = outputDuration(doc);
  const placed = placeSegments(doc);
  const sum = placed.reduce((acc, p) => acc + (p.outEnd - p.outStart), 0);
  expect(sum).toBe(total);
  expect(placed[placed.length - 1]?.outEnd).toBe(total);

  const plan = buildRenderPlan(doc, testContext());
  expect(plan.output.durationMs).toBe(total);
  let planSum = 0;
  let cursor = 0;
  for (const segment of plan.segments) {
    expect(segment.outStartMs).toBe(cursor);
    const length = segment.outEndMs - segment.outStartMs;
    // The trim window plays exactly the part's output length at its speed.
    expect(
      segmentOutputMs({
        sourceIn: segment.trimStartMs,
        sourceOut: segment.trimEndMs,
        speed: segment.speed,
      }),
    ).toBe(length);
    planSum += length;
    cursor = segment.outEndMs;
  }
  expect(planSum).toBe(total);
}

describe('the render plan keeps the timeline length', () => {
  it(`holds after every step of ${SEQUENCES} random edit sequences`, () => {
    let applied = 0;
    let maxParts = 0;
    for (let seed = 1; seed <= SEQUENCES; seed += 1) {
      const random = seeded(seed);
      let doc = testDocument([testSegment('s1', 10_000, 40_000)]);
      checkIdentity(doc, `seed ${seed} start`);
      for (let i = 0; i < STEPS; i += 1) {
        const next = step(doc, random);
        doc = next.doc;
        if (next.applied) applied += 1;
        maxParts = Math.max(maxParts, doc.segments.length);
        checkIdentity(doc, `seed ${seed} step ${i}`);
      }
    }
    // The run really edits: most steps apply, and clips get cut into many parts.
    expect(applied).toBeGreaterThan(SEQUENCES * STEPS * 0.5);
    expect(maxParts).toBeGreaterThan(5);
  });
});
