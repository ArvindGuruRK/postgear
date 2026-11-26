/**
 * Add Hook Clip and Add Hook Title (Module 09): the hook as first parts,
 * the item rule (hook titles stay, other clip items move, moment items
 * follow their moment), the exact undo, captions on the hook, the
 * suggestion, and the three hook looks.
 */
import { captionWords } from '../captions';
import { setBleeps } from '../cleanup/bleeps';
import {
  type AudioItem,
  type ClipDocument,
  clipDocumentSchema,
  type TimedItem,
  type Track,
} from '../document/schema';
import { HOOK_STYLE_IDS, HOOK_TEXT_STYLES, textStylePreset } from '../document/text';
import { FONT_MANIFEST } from '../render/fonts-manifest';
import { testDocument, testSegment, testText, TEST_ASSET_ID, withItems } from '../render/test-docs';
import { outputDuration } from '../time/time-map';
import type { Transcript } from '../transcript/types';
import {
  addHookTitle,
  canSetHook,
  HOOK_TITLE_MS,
  hookOf,
  hookTitleOf,
  peaksFromWaveform,
  removeHook,
  setHook,
  suggestHook,
} from './hook';

const LIBRARY_SOUND = '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6';

function music(id: string, overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id,
    type: 'music',
    start: 0,
    duration: 20_000,
    anchor: 'clip',
    ref: { library: 'sound', id: LIBRARY_SOUND },
    offsetMs: 0,
    volume: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    duck: false,
    ...overrides,
  };
}

/** A 20 s clip: video 10 to 20 s, then 30 to 40 s; texts and a whole-clip music bed. */
function clip(): ClipDocument {
  const doc = withItems(
    testDocument([testSegment('a', 10_000, 20_000), testSegment('b', 30_000, 40_000)]),
    [
      testText('title', { start: 0, duration: HOOK_TITLE_MS, anchor: 'clip', hookTitle: true }),
      testText('pinned', { start: 5_000, duration: 2_000, anchor: 'clip' }),
      testText('moment', { start: 12_000, duration: 2_000, anchor: 'moment' }),
    ],
  );
  return {
    ...doc,
    tracks: [...doc.tracks, { id: 'aud', kind: 'audio', items: [music('bed')] } satisfies Track],
  };
}

const item = (doc: ClipDocument, id: string) =>
  doc.tracks
    .flatMap((track): TimedItem[] => (track.kind === 'captions' ? [] : track.items))
    .find((one) => one.id === id);

describe('setHook', () => {
  it('copies the stretch as a first part with the hook role, the same video read twice', () => {
    const doc = setHook(clip(), { fromOutputMs: 2_000, toOutputMs: 4_500 });
    expect(doc.segments[0]).toMatchObject({
      source: 'src',
      sourceIn: 12_000,
      sourceOut: 14_500,
      role: 'hook',
    });
    expect(doc.segments.slice(1).map((s) => s.id)).toEqual(['a', 'b']);
    expect(outputDuration(doc)).toBe(22_500);
    expect(clipDocumentSchema.safeParse(doc).success).toBe(true);
    expect(hookOf(doc)).toEqual({
      segmentIds: [doc.segments[0]?.id],
      durationMs: 2_500,
      range: { fromOutputMs: 2_000, toOutputMs: 4_500 },
    });
  });

  it('copies each piece of a stretch over a cut, at its own speed', () => {
    const fast = testDocument([
      testSegment('a', 10_000, 20_000),
      testSegment('b', 30_000, 40_000, 2),
    ]);
    const doc = setHook(fast, { fromOutputMs: 8_000, toOutputMs: 12_000 });
    expect(doc.segments.slice(0, 2)).toMatchObject([
      { sourceIn: 18_000, sourceOut: 20_000, speed: 1, role: 'hook' },
      { sourceIn: 30_000, sourceOut: 34_000, speed: 2, role: 'hook' },
    ]);
    expect(hookOf(doc)?.durationMs).toBe(4_000);
  });

  it('takes 1 to 5 seconds, and refuses anything else with the same document', () => {
    const doc = clip();
    expect(canSetHook(doc, { fromOutputMs: 0, toOutputMs: 999 })).toBe('hook_too_short');
    expect(canSetHook(doc, { fromOutputMs: 0, toOutputMs: 5_001 })).toBe('hook_too_long');
    expect(canSetHook(doc, { fromOutputMs: 3_000, toOutputMs: 2_000 })).toBe('invalid_time');
    expect(canSetHook(doc, { fromOutputMs: Number.NaN, toOutputMs: 2_000 })).toBe('invalid_time');
    // Mostly past the clip's end: what is left is too short.
    expect(canSetHook(doc, { fromOutputMs: 19_500, toOutputMs: 22_000 })).toBe('hook_too_short');
    expect(setHook(doc, { fromOutputMs: 0, toOutputMs: 6_000 })).toBe(doc);
    expect(canSetHook(doc, { fromOutputMs: 0, toOutputMs: 1_000 })).toBeNull();
    expect(canSetHook(doc, { fromOutputMs: 0, toOutputMs: 5_000 })).toBeNull();
  });

  it('keeps one hook at most: a second one replaces the first', () => {
    const once = setHook(clip(), { fromOutputMs: 2_000, toOutputMs: 4_500 });
    const twice = setHook(once, { fromOutputMs: 6_000, toOutputMs: 7_000 });
    expect(twice.segments.filter((s) => s.role === 'hook')).toHaveLength(1);
    expect(twice.segments[0]).toMatchObject({ sourceIn: 16_000, sourceOut: 17_000 });
    expect(twice).toEqual(setHook(clip(), { fromOutputMs: 6_000, toOutputMs: 7_000 }));
  });

  it('keeps hook titles at 0, moves other clip items later, and moment items follow their moment', () => {
    const before = clip();
    const doc = setHook(before, { fromOutputMs: 2_000, toOutputMs: 4_500 });
    expect(item(doc, 'title')).toMatchObject({ start: 0, duration: HOOK_TITLE_MS });
    expect(item(doc, 'pinned')).toMatchObject({ start: 7_500, duration: 2_000 });
    expect(item(doc, 'moment')).toMatchObject({ start: 14_500, duration: 2_000 });
    // A Whole Clip bed stays whole.
    expect(item(doc, 'bed')).toMatchObject({ start: 0, duration: 22_500 });
  });

  it('is undone exactly by removeHook', () => {
    let before = clip();
    before = setBleeps(
      before,
      [{ wordIndex: 3, from: 13_000, to: 13_400, text: 'x' }],
      'bleep',
      'src',
    );
    before = {
      ...before,
      tracks: [
        ...before.tracks,
        {
          id: 'cc',
          kind: 'captions',
          transcriptAssetId: TEST_ASSET_ID,
          language: 'en',
          styleId: 'bold-pop',
          position: { x: 0.5, y: 0.72 },
          sizePx: 86,
          maxWords: 3,
          edits: {},
        },
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(before));
    for (const range of [
      { fromOutputMs: 2_000, toOutputMs: 4_500 },
      { fromOutputMs: 8_500, toOutputMs: 12_500 },
      { fromOutputMs: 0, toOutputMs: 1_000 },
      { fromOutputMs: 15_000, toOutputMs: 20_000 },
    ]) {
      const hooked = setHook(before, range);
      expect(hooked).not.toBe(before);
      expect(removeHook(hooked)).toEqual(before);
    }
    expect(before).toEqual(snapshot);
    expect(removeHook(before)).toBe(before);
    expect(hookOf(before)).toBeNull();
  });

  it('keeps the hook when it is all the clip has left (a clip needs a part)', () => {
    const hooked = setHook(clip(), { fromOutputMs: 2_000, toOutputMs: 4_000 });
    const onlyHook: ClipDocument = {
      ...hooked,
      segments: hooked.segments.filter((segment) => segment.role === 'hook'),
    };
    expect(onlyHook.segments.length).toBeGreaterThan(0);
    expect(removeHook(onlyHook)).toBe(onlyHook);
  });

  it('shows captions on the hook too (the mapping loops over parts)', () => {
    const transcript: Transcript = {
      version: 1,
      language: 'en',
      model: 'test',
      source: 'listened',
      covered: [{ fromMs: 0, toMs: 60_000 }],
      words: ['zero', 'one', 'two', 'three', 'four'].map((text, i) => ({
        i,
        start: 11_000 + i * 1_000,
        end: 11_000 + i * 1_000 + 400,
        text,
        sure: 0.9,
      })),
      nextIndex: 5,
    };
    // The hook plays 12 to 14 s of the video (output 2 to 4 s of the clip).
    const doc = setHook(clip(), { fromOutputMs: 2_000, toOutputMs: 4_000 });
    const words = captionWords(doc, { edits: {} }, transcript);
    expect(words.map((w) => w.text)).toEqual(['one', 'two', 'zero', 'one', 'two', 'three', 'four']);
    expect(words.slice(0, 2).map((w) => w.start)).toEqual([0, 1_000]);
    expect(words.filter((w) => w.text === 'one').map((w) => w.start)).toEqual([0, 4_000]);
    // A bleep on a hooked word masks it on both plays.
    const bleeped = setBleeps(
      doc,
      [{ wordIndex: 1, from: 12_000, to: 12_400, text: 'one' }],
      'bleep',
      'src',
    );
    expect(
      captionWords(bleeped, { edits: {} }, transcript)
        .filter((w) => w.i === 1)
        .map((w) => w.text),
    ).toEqual(['o**', 'o**']);
  });
});

describe('suggestHook', () => {
  const doc = testDocument([testSegment('a', 10_000, 20_000), testSegment('b', 30_000, 40_000)]);

  it('takes 2.5 s around the strongest peak the clip plays', () => {
    const peaks = [
      { at: 5_000, value: 99 }, // before the clip: not played
      { at: 13_000, value: 40 },
      { at: 34_000, value: 80 },
      { at: 25_000, value: 95 }, // cut out
    ];
    expect(suggestHook(doc, { peaks }, null)).toEqual({ fromOutputMs: 12_750, toOutputMs: 15_250 });
  });

  it('keeps the suggestion inside the clip, and picks the earliest of equal peaks', () => {
    expect(suggestHook(doc, { peaks: [{ at: 10_200, value: 5 }] }, null)).toEqual({
      fromOutputMs: 0,
      toOutputMs: 2_500,
    });
    expect(suggestHook(doc, { peaks: [{ at: 39_900, value: 5 }] }, null)).toEqual({
      fromOutputMs: 17_500,
      toOutputMs: 20_000,
    });
    const tie = [
      { at: 36_000, value: 7 },
      { at: 15_000, value: 7 },
    ];
    expect(suggestHook(doc, { peaks: tie }, null)).toEqual({
      fromOutputMs: 3_750,
      toOutputMs: 6_250,
    });
  });

  it('moves its edges out to the words they cut through', () => {
    // Plain range: output 3,750 to 6,250, which is video 13,750 to 16,250.
    const words = [
      { start: 13_600, end: 13_900 },
      { start: 14_000, end: 14_300 },
      { start: 16_100, end: 16_500 },
    ];
    expect(suggestHook(doc, { peaks: [{ at: 15_000, value: 1 }] }, words)).toEqual({
      fromOutputMs: 3_600,
      toOutputMs: 6_500,
    });
  });

  it('gives nothing without a peak inside the clip, and reads the clip without its hook', () => {
    expect(suggestHook(doc, null, null)).toBeNull();
    expect(suggestHook(doc, { peaks: [] }, null)).toBeNull();
    expect(suggestHook(doc, { peaks: [{ at: 25_000, value: 9 }] }, null)).toBeNull();
    const hooked = setHook(doc, { fromOutputMs: 0, toOutputMs: 3_000 });
    expect(suggestHook(hooked, { peaks: [{ at: 15_000, value: 1 }] }, null)).toEqual({
      fromOutputMs: 3_750,
      toOutputMs: 6_250,
    });
  });

  it("turns a waveform into peaks smoothed over a second, in the video's time", () => {
    const wave = [0, 0, 0, 0, 200, 0, 0, 0, 100, 100, 100, 100];
    const peaks = peaksFromWaveform(wave, 4);
    expect(peaks).toHaveLength(12);
    expect(peaks[4]?.at).toBe(1_000);
    const loudest = peaks.reduce((a, b) => (b.value > a.value ? b : a));
    // The steady loud second beats the single loud sample.
    expect(loudest.at).toBeGreaterThanOrEqual(2_000);
    expect(peaksFromWaveform(wave, 4, { fromMs: 1_000, toMs: 2_000 })).toHaveLength(4);
    expect(peaksFromWaveform(wave, 0)).toEqual([]);
  });
});

describe('addHookTitle', () => {
  const doc = testDocument([testSegment('a', 10_000, 20_000)]);

  it('puts the title at 0 for 3 s on the clip clock, in the top third, marked as a hook title', () => {
    const next = addHookTitle(doc, '  I quit my job  with no plan 😀 ', 'hook-box');
    const title = hookTitleOf(next);
    expect(title).toMatchObject({
      type: 'text',
      start: 0,
      duration: HOOK_TITLE_MS,
      anchor: 'clip',
      hookTitle: true,
      text: 'I quit my job with no plan',
      style: textStylePreset('hook-box').style,
    });
    expect(title?.transform.y).toBeLessThan(1 / 3);
    expect(clipDocumentSchema.safeParse(next).success).toBe(true);
  });

  it('keeps one title: choosing again changes its words and look, not where it is', () => {
    const first = addHookTitle(doc, 'First one', 'hook-bold');
    const id = hookTitleOf(first)?.id as string;
    const moved: ClipDocument = {
      ...first,
      tracks: first.tracks.map((track) =>
        track.kind === 'overlay'
          ? {
              ...track,
              items: track.items.map((one) => ({
                ...one,
                transform: { ...one.transform, y: 0.25 },
              })),
            }
          : track,
      ),
    };
    const second = addHookTitle(moved, 'Second one', 'hook-pop');
    expect(hookTitleOf(second)).toMatchObject({ id, text: 'Second one', transform: { y: 0.25 } });
    expect(hookTitleOf(second)?.style.font).toBe('Luckiest Guy');
    expect(addHookTitle(second, 'Second one', 'hook-pop')).toBe(second);
  });

  it('ignores an empty title', () => {
    expect(addHookTitle(doc, '   ', 'hook-bold')).toBe(doc);
    expect(addHookTitle(doc, '😀', 'hook-bold')).toBe(doc);
  });

  it('has three hook looks, each drawn with a font the render ships', () => {
    expect(HOOK_TEXT_STYLES.map((preset) => preset.id)).toEqual([...HOOK_STYLE_IDS]);
    for (const preset of HOOK_TEXT_STYLES) {
      const { font, weight } = preset.style;
      expect(
        FONT_MANIFEST.fonts.some((entry) => entry.family === font && entry.weight === weight),
      ).toBe(true);
      expect(preset.style.size).toBeGreaterThanOrEqual(80);
    }
  });
});
