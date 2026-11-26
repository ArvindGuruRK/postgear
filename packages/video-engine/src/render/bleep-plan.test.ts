/**
 * Bleeps and mutes on the clip's clock and in the export's graph (Sprint 13,
 * Module 09). The real FFmpeg checks (the gate lands on the asked times, no
 * click, 300 bleeps still parse) are `bleep-parity.test.ts` in media-tools.
 */
import { MAX_BLEEPS } from '../document/limits';
import type { Bleep, ClipDocument, Segment } from '../document/schema';
import { BLEEP_RAMP_MS, bleepRanges, bleepSets, bleepsAt, mergeBleepRanges } from './bleep-plan';
import { bleepLines, compileFfmpeg, compileMeasure } from './compile';
import { frameState } from './frame-state';
import { buildRenderPlan, type RenderPlan } from './plan';
import { TEST_ASSET_ID, testContext, testDocument, testSegment } from './test-docs';

const AUDIO_FORMAT =
  'aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

function bleep(id: string, from: number, to: number, mode: Bleep['mode'] = 'bleep'): Bleep {
  return { id, source: 'src', from, to, mode };
}

function withBleeps(doc: ClipDocument, bleeps: Bleep[]): ClipDocument {
  return { ...doc, bleeps };
}

function hookSegment(id: string, sourceIn: number, sourceOut: number): Segment {
  return { ...testSegment(id, sourceIn, sourceOut), role: 'hook' };
}

/** The bleep stage alone, for a clip of `durationMs`. */
function stage(bleeps: RenderPlan['bleeps'], durationMs = 6_000) {
  return bleepLines({ bleeps, output: { width: 1080, height: 1920, fps: 30, durationMs } }, '[ac]');
}

describe('bleepRanges: bleeps on the clip clock', () => {
  it('maps a bleep through the part that plays it', () => {
    const doc = withBleeps(testDocument([testSegment('a', 10_000, 20_000)]), [
      bleep('b1', 12_000, 12_500),
      bleep('b2', 15_000, 15_040, 'mute'),
    ]);
    expect(bleepRanges(doc)).toEqual([
      { id: 'b1', mode: 'bleep', fromMs: 2_000, toMs: 2_500 },
      { id: 'b2', mode: 'mute', fromMs: 5_000, toMs: 5_040 },
    ]);
  });

  it('splits a bleep over a cut and drops one inside a removed part', () => {
    const doc = withBleeps(
      testDocument([testSegment('a', 0, 5_000), testSegment('b', 8_000, 12_000)]),
      [bleep('over', 4_800, 8_200), bleep('gone', 6_000, 7_000), bleep('before', -0, 100)],
    );
    expect(bleepRanges(doc)).toEqual([
      { id: 'before', mode: 'bleep', fromMs: 0, toMs: 100 },
      { id: 'over', mode: 'bleep', fromMs: 4_800, toMs: 5_000 },
      { id: 'over', mode: 'bleep', fromMs: 5_000, toMs: 5_200 },
    ]);
  });

  it('plays a bleep in a 2x part in half the time', () => {
    const doc = withBleeps(
      testDocument([testSegment('a', 0, 4_000), testSegment('b', 4_000, 8_000, 2)]),
      [bleep('fast', 5_000, 5_400), bleep('across', 3_800, 4_200)],
    );
    expect(bleepRanges(doc)).toEqual([
      { id: 'across', mode: 'bleep', fromMs: 3_800, toMs: 4_000 },
      { id: 'across', mode: 'bleep', fromMs: 4_000, toMs: 4_100 },
      { id: 'fast', mode: 'bleep', fromMs: 4_500, toMs: 4_700 },
    ]);
  });

  it('plays the bleeps inside a hook in the hook and again in the main part', () => {
    const doc = withBleeps(
      testDocument([hookSegment('hook', 10_000, 13_000), testSegment('body', 5_000, 20_000)]),
      [bleep('inside', 11_000, 11_500), bleep('outside', 6_000, 6_200, 'mute')],
    );
    expect(bleepRanges(doc)).toEqual([
      { id: 'inside', mode: 'bleep', fromMs: 1_000, toMs: 1_500 },
      { id: 'outside', mode: 'mute', fromMs: 4_000, toMs: 4_200 },
      { id: 'inside', mode: 'bleep', fromMs: 9_000, toMs: 9_500 },
    ]);
  });

  it('gives no bleep to a part whose sound is off', () => {
    const doc = withBleeps(
      testDocument([testSegment('a', 0, 4_000), testSegment('quiet', 4_000, 8_000, 1, 0)]),
      [bleep('b1', 1_000, 1_200), bleep('b2', 5_000, 5_200)],
    );
    expect(bleepRanges(doc).map((r) => r.id)).toEqual(['b1']);
  });

  it('reads another video only for its own bleeps', () => {
    const doc = testDocument([testSegment('a', 0, 4_000)]);
    const two: ClipDocument = {
      ...doc,
      sources: [...doc.sources, { id: 'other', videoId: '7f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' }],
      bleeps: [{ id: 'b', source: 'other', from: 1_000, to: 1_200, mode: 'bleep' }],
    };
    expect(bleepRanges(two)).toEqual([]);
  });

  it('answers a fresh list each time, so a caller cannot change the cached one', () => {
    const doc = withBleeps(testDocument([testSegment('a', 0, 4_000)]), [bleep('b', 1_000, 1_200)]);
    const first = bleepRanges(doc);
    (first[0] as { fromMs: number }).fromMs = 0;
    expect(bleepRanges(doc)[0]?.fromMs).toBe(1_000);
  });
});

describe('frameState: the bleeps sounding now', () => {
  const doc = withBleeps(
    testDocument([hookSegment('hook', 10_000, 13_000), testSegment('body', 5_000, 20_000)]),
    [bleep('inside', 11_000, 11_500), bleep('outside', 6_000, 6_200, 'mute')],
  );

  it.each([
    [0, []],
    [999, []],
    [1_000, ['inside']],
    [1_499, ['inside']],
    [1_500, []],
    [4_100, ['outside']],
    [4_200, []],
    [9_000, ['inside']],
    [9_499, ['inside']],
    [9_500, []],
  ])('at %i ms: %j', (t, ids) => {
    expect(frameState(doc, t).bleeps.map((b) => b.id)).toEqual(ids);
    expect(bleepsAt(doc, t).map((b) => b.id)).toEqual(ids);
  });

  it('carries the mode, so the preview knows to play the tone', () => {
    expect(frameState(doc, 4_100).bleeps).toEqual([
      { id: 'outside', mode: 'mute', fromMs: 4_000, toMs: 4_200 },
    ]);
  });

  it('is empty for a clip with no bleeps', () => {
    expect(frameState(testDocument([testSegment('a', 0, 4_000)]), 1_000).bleeps).toEqual([]);
  });
});

describe('the merged sets the graph writes', () => {
  it('joins ranges closer than a ramp, so two ramps never add up', () => {
    expect(
      mergeBleepRanges(
        [
          { fromMs: 1_000, toMs: 1_500 },
          { fromMs: 1_500 + BLEEP_RAMP_MS - 1, toMs: 1_600 },
          { fromMs: 1_600 + BLEEP_RAMP_MS, toMs: 1_700 },
        ],
        6_000,
      ),
    ).toEqual([
      { fromMs: 1_000, toMs: 1_600 },
      { fromMs: 1_605, toMs: 1_700 },
    ]);
  });

  it('clamps to the clip and drops what is outside it', () => {
    expect(
      mergeBleepRanges(
        [
          { fromMs: 5_900, toMs: 6_300 },
          { fromMs: 7_000, toMs: 7_100 },
        ],
        6_000,
      ),
    ).toEqual([{ fromMs: 5_900, toMs: 6_000 }]);
  });

  it('mutes every range and tones only the bleep-mode ones', () => {
    const sets = bleepSets(
      [
        { id: 'a', mode: 'bleep', fromMs: 1_000, toMs: 1_500 },
        { id: 'b', mode: 'mute', fromMs: 2_000, toMs: 2_100 },
      ],
      6_000,
    );
    expect(sets.mutes).toEqual([
      { fromMs: 1_000, toMs: 1_500 },
      { fromMs: 2_000, toMs: 2_100 },
    ]);
    expect(sets.tones).toEqual([{ fromMs: 1_000, toMs: 1_500 }]);
  });
});

describe('the bleep stage of the graph', () => {
  it('writes research 09 section 5 as given for one bleep', () => {
    const { lines, label } = stage([{ id: 'a', mode: 'bleep', fromMs: 1_000, toMs: 1_500 }]);
    expect(label).toBe('[ableep]');
    expect(lines).toEqual([
      "[ac]aeval='val(0)*(1-(clip((t-1.000)/0.005,0,1)*clip((1.500+0.005-t)/0.005,0,1)))':c=same[bmute]",
      "aevalsrc='0.35*sin(2*PI*1000*t)*(between(t,1.000,1.500))':s=48000:c=stereo:d=6.000[btone]",
      `[bmute][btone]amix=inputs=2:normalize=0:duration=first,${AUDIO_FORMAT}[ableep]`,
    ]);
  });

  it('writes three bleeps as a balanced lazy sum', () => {
    const { lines } = stage([
      { id: 'a', mode: 'bleep', fromMs: 1_000, toMs: 1_500 },
      { id: 'b', mode: 'bleep', fromMs: 2_250, toMs: 2_601 },
      { id: 'c', mode: 'bleep', fromMs: 4_000, toMs: 4_050 },
    ]);
    const r = (a: string, b: string) => `clip((t-${a})/0.005,0,1)*clip((${b}+0.005-t)/0.005,0,1)`;
    const g = (a: string, b: string) => `between(t,${a},${b})`;
    expect(lines).toEqual([
      `[ac]aeval='val(0)*(1-(if(lt(t,4.000),if(lt(t,2.250),${r('1.000', '1.500')},${r('2.250', '2.601')}),${r('4.000', '4.050')})))':c=same[bmute]`,
      `aevalsrc='0.35*sin(2*PI*1000*t)*(if(lt(t,4.000),if(lt(t,2.250),${g('1.000', '1.500')},${g('2.250', '2.601')}),${g('4.000', '4.050')}))':s=48000:c=stereo:d=6.000[btone]`,
      `[bmute][btone]amix=inputs=2:normalize=0:duration=first,${AUDIO_FORMAT}[ableep]`,
    ]);
  });

  it('mutes without a tone when every range is a mute', () => {
    const { lines } = stage([
      { id: 'a', mode: 'mute', fromMs: 1_000, toMs: 1_500 },
      { id: 'b', mode: 'mute', fromMs: 4_000, toMs: 4_050 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[ac\]aeval='val\(0\)\*\(1-\(if\(lt\(t,4\.000\),/);
    expect(lines[0]).toMatch(/':c=same,aresample=48000,[^[]+\[ableep\]$/);
    expect(lines.join('')).not.toContain('aevalsrc');
  });

  it('tones only the bleep-mode ranges of a mixed set', () => {
    const { lines } = stage([
      { id: 'a', mode: 'mute', fromMs: 1_000, toMs: 1_500 },
      { id: 'b', mode: 'bleep', fromMs: 4_000, toMs: 4_050 },
    ]);
    expect(lines[0]).toContain('clip((t-1.000)/0.005');
    expect(lines[0]).toContain('clip((t-4.000)/0.005');
    expect(lines[1]).toBe(
      "aevalsrc='0.35*sin(2*PI*1000*t)*(between(t,4.000,4.050))':s=48000:c=stereo:d=6.000[btone]",
    );
  });

  it('keeps 300 bleeps shallow: log2 levels of if, about 100 characters a bleep', () => {
    const bleeps = Array.from({ length: MAX_BLEEPS }, (_, k) => ({
      id: `b${k}`,
      mode: 'bleep' as const,
      fromMs: 100 + k * 200,
      toMs: 200 + k * 200,
    }));
    const { lines } = stage(bleeps, 61_000);
    const text = lines.join('\n');
    let depth = 0;
    let deepest = 0;
    for (const ch of text) {
      if (ch === '(') deepest = Math.max(deepest, ++depth);
      if (ch === ')') depth -= 1;
    }
    expect(depth).toBe(0);
    // Nine levels of `if` for 300 ranges, plus a term's own few.
    expect(deepest).toBeLessThan(20);
    expect(text.length).toBeLessThan(MAX_BLEEPS * 120);
  });
});

describe('compileFfmpeg and compileMeasure with bleeps', () => {
  const plain = testDocument([testSegment('a', 0, 4_000), testSegment('b', 8_000, 12_000, 2)]);

  it('leaves the graph byte for byte as it was with no bleeps', () => {
    const before = compileFfmpeg(buildRenderPlan(plain, testContext())).filterComplexScript;
    // A bleep wholly inside a removed stretch plays nowhere, so it changes nothing either.
    const cutOut = withBleeps(plain, [bleep('gone', 5_000, 6_000)]);
    const plan = buildRenderPlan(cutOut, testContext());
    expect(plan.bleeps).toEqual([]);
    expect(compileFfmpeg(plan).filterComplexScript).toBe(before);
    expect(before).not.toContain('aeval');
    expect(compileMeasure(plan)?.filterComplexScript).toBe(
      compileMeasure(buildRenderPlan(plain, testContext()))?.filterComplexScript,
    );
  });

  it('gates the joined sound in output time, after the speed change', () => {
    const doc = withBleeps(plain, [bleep('slow', 1_000, 1_500), bleep('fast', 9_000, 9_400)]);
    const plan = buildRenderPlan(doc, testContext());
    expect(plan.bleeps).toEqual([
      { id: 'slow', mode: 'bleep', fromMs: 1_000, toMs: 1_500 },
      { id: 'fast', mode: 'bleep', fromMs: 4_500, toMs: 4_700 },
    ]);
    const graph = compileFfmpeg(plan).filterComplexScript;
    const lines = graph.trim().split(';\n');
    const concat = lines.findIndex((line) => line.includes('concat=n=2:v=1:a=1[vc][ac]'));
    const gate = lines.findIndex((line) => line.startsWith('[ac]aeval='));
    expect(concat).toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThan(concat);
    expect(graph).toContain('between(t,4.500,4.700)');
    expect(graph).toContain('d=6.000[btone]');
    expect(lines[lines.length - 1]).toBe('[ableep]apad=whole_dur=6.000[aout]');
  });

  it('bleeps the voice before the music is mixed in, and the measure hears the same', () => {
    const doc: ClipDocument = {
      ...withBleeps(plain, [bleep('bl', 1_000, 1_500, 'mute')]),
      tracks: [
        {
          id: 'au',
          kind: 'audio',
          items: [
            {
              id: 'm',
              type: 'music',
              start: 0,
              duration: 6_000,
              anchor: 'clip',
              ref: { asset: TEST_ASSET_ID },
              offsetMs: 0,
              volume: 0.5,
              fadeInMs: 0,
              fadeOutMs: 0,
              duck: false,
            },
          ],
        },
      ],
    };
    const base = testContext();
    const plan = buildRenderPlan(doc, {
      ...base,
      assets: {
        ...base.assets,
        sounds: {
          [`asset:${TEST_ASSET_ID}`]: { file: 'music-0.m4a', durationMs: 60_000 },
        },
      },
    });
    const graph = compileFfmpeg(plan).filterComplexScript;
    expect(graph).toContain('[abase][ableep][as0]amix=inputs=3');
    expect(graph).not.toContain('[abase][ac]');
    const measure = compileMeasure(plan)?.filterComplexScript ?? '';
    const gate = graph.split(';\n').find((line) => line.startsWith('[ac]aeval='));
    expect(gate).toBeDefined();
    expect(measure).toContain(gate as string);
    expect(measure).toContain('[abase][ableep][as0]amix=inputs=3');
  });
});
