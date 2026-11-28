import type { AudioItem, ClipDocument } from '../document/schema';
import type { TranscriptWord } from '../transcript/types';
import { compileFfmpeg } from './compile';
import {
  DUCK_ATTACK_MS,
  DUCK_GAIN,
  DUCK_RELEASE_MS,
  duckExpression,
  duckGainAt,
  duckSpansFor,
  speechSpans,
} from './duck';
import { isRenderCompileError } from './errors';
import { frameState } from './frame-state';
import { buildRenderPlan } from './plan';
import { testContext, testDocument, testSegment } from './test-docs';

const LIBRARY_ID = '33333333-3333-4333-8333-333333333333';

function said(...spec: Array<[number, number]>): { words: TranscriptWord[] } {
  return { words: spec.map(([start, end], i) => ({ i, start, end, text: `w${i}`, sure: 0.9 })) };
}

function music(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'mu',
    type: 'music',
    start: 0,
    duration: 8_000,
    anchor: 'moment',
    ref: { library: 'sound', id: LIBRARY_ID },
    offsetMs: 0,
    volume: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    duck: true,
    ...overrides,
  };
}

function withItems(doc: ClipDocument, items: AudioItem[]): ClipDocument {
  return { ...doc, tracks: [{ id: 'au', kind: 'audio', items }] };
}

/** Evaluates the FFmpeg expression the way `volume` would, for the parity test. */
function evaluate(expression: string, t: number): number {
  const js = expression
    .replace(/\bt\b/g, `(${t})`)
    .replace(/clip\(/g, 'clamp(')
    .replace(/min\(/g, 'Math.min(');
  return new Function('clamp', `return ${js};`)((x: number, a: number, b: number) =>
    Math.max(a, Math.min(b, x)),
  ) as number;
}

describe('speechSpans', () => {
  it('joins words closer than the join gap and splits at a real pause, on the clip clock', () => {
    // The clip plays the video from 10 s: words at 10.2 to 11.3 s, then 13 to 14.2 s.
    const doc = testDocument([testSegment('a', 10_000, 18_000)]);
    const spans = speechSpans(doc, said([10_200, 10_600], [10_900, 11_300], [13_000, 14_200]));
    expect(spans).toEqual([
      { fromMs: 200, toMs: 1_300 },
      { fromMs: 3_000, toMs: 4_200 },
    ]);
  });

  it('follows a cut: a removed stretch takes its speech with it', () => {
    // 11 s to 13 s is cut out, so its words go, and what is left closes up.
    const doc = testDocument([testSegment('a', 10_000, 11_000), testSegment('b', 13_000, 18_000)]);
    const spans = speechSpans(doc, said([10_200, 10_600], [11_400, 12_600], [15_000, 16_000]));
    expect(spans).toEqual([
      { fromMs: 200, toMs: 600 },
      { fromMs: 3_000, toMs: 4_000 },
    ]);
  });
});

describe('duckGainAt', () => {
  const spans = [{ fromMs: 2_000, toMs: 4_000 }];

  it('is full away from speech, low under it, and ramps in between', () => {
    expect(duckGainAt(spans, 0)).toBe(1);
    expect(duckGainAt(spans, 2_000 - DUCK_ATTACK_MS)).toBe(1);
    expect(duckGainAt(spans, 2_000 - DUCK_ATTACK_MS / 2)).toBeCloseTo(1 - (1 - DUCK_GAIN) / 2, 6);
    expect(duckGainAt(spans, 3_000)).toBeCloseTo(DUCK_GAIN, 6);
    expect(duckGainAt(spans, 4_000 + DUCK_RELEASE_MS / 2)).toBeCloseTo(1 - (1 - DUCK_GAIN) / 2, 6);
    expect(duckGainAt(spans, 4_000 + DUCK_RELEASE_MS)).toBe(1);
    expect(duckGainAt([], 3_000)).toBe(1);
  });

  it('draws the same line as the export expression (parity)', () => {
    const many = [
      { fromMs: 100, toMs: 900 },
      { fromMs: 2_000, toMs: 4_000 },
      { fromMs: 6_000, toMs: 6_300 },
    ];
    const expression = duckExpression(many);
    for (let ms = 0; ms <= 8_000; ms += 25) {
      expect(evaluate(expression, ms / 1000)).toBeCloseTo(duckGainAt(many, ms), 6);
    }
  });

  it('moves stretches onto a sound clock and keeps only the ones it hears', () => {
    const list = [
      { fromMs: 100, toMs: 900 },
      { fromMs: 5_000, toMs: 6_000 },
    ];
    expect(duckSpansFor(list, 4_000, 3_000)).toEqual([{ fromMs: 1_000, toMs: 2_000 }]);
    // A stretch whose release reaches the sound's start still counts.
    expect(duckSpansFor(list, 1_000, 500)).toEqual([{ fromMs: -900, toMs: -100 }]);
    expect(evaluate(duckExpression([{ fromMs: -900, toMs: -100 }]), 0)).toBeCloseTo(
      duckGainAt(list, 1_000),
      6,
    );
  });
});

describe('Lower Music Under Speech in the preview and the export', () => {
  const doc = withItems(testDocument([testSegment('a', 0, 8_000)]), [music()]);
  const speech = [{ fromMs: 2_000, toMs: 4_000 }];

  it('lowers only music with duck on, and only with speech handed in', () => {
    const gainAt = (d: ClipDocument, options = {}) => frameState(d, 3_000, options).sounds[0]?.gain;
    expect(gainAt(doc, { speech })).toBeCloseTo(DUCK_GAIN, 6);
    expect(gainAt(doc)).toBe(1);
    expect(gainAt(withItems(doc, [music({ duck: false })]), { speech })).toBe(1);
    expect(gainAt(withItems(doc, [music({ type: 'sfx', duck: true })]), { speech })).toBe(1);
  });

  it('puts the same line in the export, on the sound clock', () => {
    const base = testContext();
    const plan = buildRenderPlan(doc, {
      ...base,
      assets: {
        ...base.assets,
        sounds: { [`library:${LIBRARY_ID}`]: { file: 'sound-0.m4a', durationMs: 20_000 } },
        speech,
      },
    });
    expect(plan.sounds[0]?.duck).toEqual(speech);
    const graph = compileFfmpeg(plan).filterComplexScript;
    expect(graph).toContain(`volume=volume='${duckExpression(speech)}':eval=frame`);

    const flat = buildRenderPlan(doc, {
      ...base,
      assets: {
        ...base.assets,
        sounds: { [`library:${LIBRARY_ID}`]: { file: 'sound-0.m4a', durationMs: 20_000 } },
      },
    });
    expect(flat.sounds[0]?.duck).toEqual([]);
    expect(compileFfmpeg(flat).filterComplexScript).not.toContain('eval=frame');
  });

  it('refuses speech stretches that are not whole ms in order', () => {
    const base = testContext();
    const bad = () =>
      buildRenderPlan(doc, {
        ...base,
        assets: {
          ...base.assets,
          sounds: { [`library:${LIBRARY_ID}`]: { file: 'sound-0.m4a', durationMs: 20_000 } },
          speech: [{ fromMs: 3_000, toMs: 2_000 }],
        },
      });
    expect(bad).toThrow();
    try {
      bad();
    } catch (error) {
      expect(isRenderCompileError(error) && error.code).toBe('invalid_context');
    }
  });
});
