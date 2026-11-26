import { captionWords } from '../captions/map';
import { createClipDocument } from '../document/create';
import { CLIP_MIN_MS, MAX_SEGMENTS } from '../document/limits';
import { type ClipDocument, clipDocumentSchema } from '../document/schema';
import { setSpeed, splitAt } from '../time/edits';
import { outputDuration } from '../time/time-map';
import type { Transcript, TranscriptWord } from '../transcript/types';
import {
  alignToFrame,
  cutForWords,
  findFillers,
  findSilences,
  hasFillerList,
  healSegments,
  loudFromPeaks,
  mergeCuts,
  PIECE_MIN_MS,
  removedWords,
  removeSourceRange,
  removeSourceRanges,
  SILENCE_KEEP_MS,
  WORD_AIR_MS,
  wordPlaces,
} from './index';

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';

/** A 60 s clip of the video from 10 s to 70 s, at 30 fps. */
function clip(fromMs = 10_000, toMs = 70_000): ClipDocument {
  return createClipDocument({ videoId: VIDEO, fromMs, toMs, ratio: '9:16' });
}
const source = (doc: ClipDocument) => (doc.segments[0] as { source: string }).source;

/** Words at `[start, end]` pairs, indexes in order unless given. */
function words(spec: Array<[string, number, number, number?]>): TranscriptWord[] {
  return spec.map(([text, start, end, i], k) => ({ i: i ?? k, start, end, text, sure: 0.9 }));
}
function transcript(list: TranscriptWord[], covered = [{ fromMs: 0, toMs: 120_000 }]): Transcript {
  return {
    version: 1,
    language: 'en',
    model: 'simulation',
    source: 'listened',
    covered,
    words: list,
    nextIndex: list.length,
  };
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

describe('cut ranges', () => {
  it('rounds cut points to the canvas frames', () => {
    expect(alignToFrame(10_016, 30)).toBe(10_000);
    expect(alignToFrame(10_020, 30)).toBe(10_033);
    expect(alignToFrame(1_234, 25)).toBe(1_240);
  });

  it('merges touching and overlapping cuts', () => {
    expect(
      mergeCuts([
        { fromMs: 500, toMs: 700 },
        { fromMs: 100, toMs: 300 },
        { fromMs: 300, toMs: 400 },
        { fromMs: 650, toMs: 900 },
        { fromMs: 5, toMs: 5 },
      ]),
    ).toEqual([
      { fromMs: 100, toMs: 400 },
      { fromMs: 500, toMs: 900 },
    ]);
  });

  it('splits the part around a stretch and drops its middle', () => {
    const doc = clip();
    const result = ok(removeSourceRange(doc, source(doc), 20_000, 25_000));
    expect(result.doc.segments.map((s) => [s.sourceIn, s.sourceOut])).toEqual([
      [10_000, 20_000],
      [25_000, 70_000],
    ]);
    expect(result.doc.segments[0]?.id).toBe(doc.segments[0]?.id);
    expect(result.doc.segments[1]?.id).not.toBe(doc.segments[0]?.id);
    expect(outputDuration(result.doc)).toBe(55_000);
    expect(clipDocumentSchema.safeParse(result.doc).success).toBe(true);
  });

  it('cuts every part that plays the stretch, and none of another source', () => {
    const doc = clip();
    const split = ok(splitAt(doc, 30_000)).doc; // parts 10-40 and 40-70
    const result = ok(removeSourceRange(split, source(doc), 38_000, 42_000));
    expect(result.doc.segments.map((s) => [s.sourceIn, s.sourceOut])).toEqual([
      [10_000, 38_000],
      [42_000, 70_000],
    ]);
    expect(removeSourceRange(split, 'another-source', 38_000, 42_000)).toEqual({
      ok: false,
      code: 'nothing_to_cut',
    });
  });

  it('takes a sliver under the shortest piece along with the cut', () => {
    const doc = clip();
    const result = ok(
      removeSourceRanges(doc, source(doc), [
        { fromMs: 20_000, toMs: 21_000 },
        { fromMs: 21_000 + PIECE_MIN_MS - 50, toMs: 23_000 },
      ]),
    );
    expect(result.doc.segments.map((s) => [s.sourceIn, s.sourceOut])).toEqual([
      [10_000, 20_000],
      [23_000, 70_000],
    ]);
  });

  it('refuses to leave under 3 seconds, and refuses nothing to cut', () => {
    const doc = clip(10_000, 14_000);
    expect(removeSourceRange(doc, source(doc), 10_000, 12_000)).toEqual({
      ok: false,
      code: 'clip_too_short',
    });
    expect(CLIP_MIN_MS).toBe(3_000);
    expect(removeSourceRange(doc, source(doc), 80_000, 90_000)).toEqual({
      ok: false,
      code: 'nothing_to_cut',
    });
    expect(removeSourceRange(doc, source(doc), 0, 100_000)).toEqual({
      ok: false,
      code: 'clip_too_short',
    });
  });

  it('refuses past the most parts a clip holds, all or nothing', () => {
    const doc = clip(0, 1_600_000);
    const cuts = Array.from({ length: MAX_SEGMENTS }, (_, k) => ({
      fromMs: 1_000 + k * 10_000,
      toMs: 2_000 + k * 10_000,
    }));
    expect(removeSourceRanges(doc, source(doc), cuts)).toEqual({
      ok: false,
      code: 'too_many_segments',
    });
    expect(removeSourceRanges(doc, source(doc), cuts.slice(0, MAX_SEGMENTS - 1)).ok).toBe(true);
  });

  it('keeps speed in the pieces it leaves', () => {
    const base = clip();
    const fast = ok(setSpeed(base, base.segments[0]?.id as string, 2)).doc;
    const result = ok(removeSourceRange(fast, source(fast), 20_000, 30_000));
    expect(result.doc.segments.every((s) => s.speed === 2)).toBe(true);
    expect(outputDuration(result.doc)).toBe(25_000);
  });

  it('heals a gap when the parts beside it are otherwise untouched', () => {
    const doc = clip();
    const cut = ok(removeSourceRange(doc, source(doc), 20_000, 25_000)).doc;
    const healed = ok(healSegments(cut, source(doc), 20_200, 24_800));
    expect(healed.doc.segments.map((s) => [s.sourceIn, s.sourceOut])).toEqual([[10_000, 70_000]]);
    expect(healed.doc.segments[0]?.id).toBe(doc.segments[0]?.id);
  });

  it('will not heal when a part beside the gap changed', () => {
    const doc = clip();
    const cut = ok(removeSourceRange(doc, source(doc), 20_000, 25_000)).doc;
    const second = cut.segments[1]?.id as string;
    const faster = ok(setSpeed(cut, second, 2)).doc;
    expect(healSegments(faster, source(doc), 20_200, 24_800)).toEqual({
      ok: false,
      code: 'cannot_restore',
    });
    expect(healSegments(doc, source(doc), 20_200, 24_800)).toEqual({
      ok: false,
      code: 'cannot_restore',
    });
  });
});

describe('cuts for words', () => {
  const list = words([
    ['So', 10_000, 10_300],
    ['this', 10_350, 10_600],
    ['is', 11_600, 11_800],
    ['it.', 11_850, 12_100],
    ['Next', 12_160, 12_500],
  ]);

  it('cuts between words, never more than the air past them', () => {
    // "is it.": the gap before is 1 s (air caps at 150 ms), after is 60 ms (its middle).
    expect(cutForWords(transcript(list), 2, 3)).toEqual({
      fromMs: 11_600 - WORD_AIR_MS,
      toMs: 12_130,
    });
  });

  it('takes the words in either order and everything between', () => {
    expect(cutForWords(transcript(list), 3, 1)).toEqual(cutForWords(transcript(list), 1, 3));
  });

  it('finds words by their stable index, not their place', () => {
    const shuffled = words([
      ['a', 1_000, 1_200, 7],
      ['b', 1_300, 1_500, 2],
      ['c', 1_600, 1_800, 9],
    ]);
    expect(cutForWords(transcript(shuffled), 2, 2)).toEqual({ fromMs: 1_250, toMs: 1_550 });
    expect(cutForWords(transcript(shuffled), 4, 4)).toBeNull();
  });

  it('never cuts inside the words beside it', () => {
    for (let k = 0; k < list.length; k += 1) {
      const cut = cutForWords(transcript(list), k, k);
      const before = list[k - 1];
      const after = list[k + 1];
      if (before) expect(cut?.fromMs).toBeGreaterThanOrEqual(before.end);
      if (after) expect(cut?.toMs).toBeLessThanOrEqual(after.start);
    }
  });

  it('deleting a sentence keeps the captions on their words after the cut', () => {
    const doc = clip();
    const cut = cutForWords(transcript(list), 0, 1);
    const result = ok(removeSourceRange(doc, source(doc), cut?.fromMs ?? 0, cut?.toMs ?? 0));
    const track = { edits: {} };
    const shown = captionWords(result.doc, track, transcript(list));
    expect(shown.map((word) => word.text)).toEqual(['is', 'it.', 'Next']);
  });
});

describe('silences', () => {
  const list = words([
    ['One', 10_000, 10_400],
    ['two', 10_500, 10_800],
    ['three', 12_800, 13_200], // a 2 s pause before
    ['four', 14_200, 14_500], // a 1 s pause before
    ['five', 15_000, 15_300], // 0.5 s
  ]);
  const window = [{ fromMs: 10_000, toMs: 16_000 }];

  it('finds pauses at least the chosen length, keeping air at both ends', () => {
    const found = findSilences(transcript(list), window, { minMs: 800 });
    expect(found.cuts).toEqual([
      { fromMs: 10_800 + SILENCE_KEEP_MS, toMs: 12_800 - SILENCE_KEEP_MS },
      { fromMs: 13_200 + SILENCE_KEEP_MS, toMs: 14_200 - SILENCE_KEEP_MS },
    ]);
    expect(found.totalMs).toBe(1_700 + 700);
  });

  it('counts change with the slider', () => {
    expect(findSilences(transcript(list), window, { minMs: 2_000 }).cuts).toHaveLength(1);
    expect(findSilences(transcript(list), window, { minMs: 500 }).cuts).toHaveLength(3);
  });

  it('skips a pause under the shortest removal once its air is kept', () => {
    // The 0.5 s pause before "five", less 150 ms at each end, leaves 200 ms: not worth a cut.
    const tight = findSilences(transcript(list), [{ fromMs: 14_000, toMs: 15_400 }], {
      minMs: 500,
    });
    expect(tight.cuts).toEqual([]);
  });

  it('keeps loud pauses and anything not listened to', () => {
    const loud = findSilences(transcript(list), window, {
      minMs: 800,
      isLoud: (range) => range.fromMs < 12_000,
    });
    expect(loud.cuts).toHaveLength(1);
    const unheard = findSilences(transcript(list, [{ fromMs: 13_000, toMs: 16_000 }]), window, {
      minMs: 800,
    });
    expect(unheard.cuts).toEqual([{ fromMs: 13_350, toMs: 14_050 }]);
  });
});

describe('loudness from the waveform', () => {
  it('calls a stretch loud when enough of its peaks are sound', () => {
    // 20 peaks a second: 0 to 1 s quiet room, 1 to 2 s music, 2 to 3 s one clap.
    const peaks = new Uint8Array(60);
    peaks.fill(4, 0, 20);
    peaks.fill(90, 20, 40);
    peaks.fill(4, 40, 60);
    peaks[50] = 200;
    const loud = loudFromPeaks(peaks, 20);
    expect(loud({ fromMs: 0, toMs: 1_000 })).toBe(false);
    expect(loud({ fromMs: 1_000, toMs: 2_000 })).toBe(true);
    expect(loud({ fromMs: 2_000, toMs: 3_000 })).toBe(false);
    expect(loud({ fromMs: 5_000, toMs: 6_000 })).toBe(false);
    expect(loudFromPeaks(peaks, 0)({ fromMs: 1_000, toMs: 2_000 })).toBe(false);
  });

  it('keeps a pause with music in it when Remove Silences is given the waveform', () => {
    const list = words([
      ['One', 1_000, 1_400],
      ['two', 3_000, 3_400],
      ['three', 5_000, 5_400],
    ]);
    const peaks = new Uint8Array(140);
    peaks.fill(90, 30, 100); // music under 1.5 s to 5 s
    const found = findSilences(transcript(list), [{ fromMs: 0, toMs: 7_000 }], {
      minMs: 800,
      isLoud: loudFromPeaks(peaks, 20),
    });
    // The pause before "two" is half music, so it stays; the end after "three" is quiet.
    expect(found.cuts.map((cut) => cut.fromMs)).toEqual([150, 5_550]);
    expect(found.loudKept).toBe(2);
  });
});

describe('filler words', () => {
  const list = words([
    ['Um,', 1_000, 1_200],
    ['I', 1_300, 1_400],
    ['like', 1_450, 1_700],
    ['it.', 1_750, 2_000],
    ['It', 2_600, 2_800],
    ['was,', 2_850, 3_100],
    ['like,', 3_500, 3_800],
    ['great,', 4_200, 4_500],
    ['you', 4_600, 4_700],
    ['know,', 4_750, 5_000],
    ['uhh', 5_400, 5_600],
    ['Do', 6_000, 6_100],
    ['you', 6_150, 6_250],
    ['know', 6_300, 6_500],
    ['him?', 6_550, 6_800],
  ]);
  const window = [{ fromMs: 0, toMs: 10_000 }];

  it('finds the plain fillers always, and "like" and "you know" only alone', () => {
    const groups = findFillers(transcript(list), 'en', window);
    const summary = Object.fromEntries(groups.map((group) => [group.key, group.count]));
    expect(summary).toEqual({ um: 1, uh: 1, like: 1, 'you know': 1 });
    const like = groups.find((group) => group.key === 'like');
    expect(like?.words).toEqual([6]);
    const youKnow = groups.find((group) => group.key === 'you know');
    expect(youKnow?.words).toEqual([8, 9]);
  });

  it('gives each one a cut between words', () => {
    const um = findFillers(transcript(list), 'en', window).find((group) => group.key === 'um');
    expect(um?.cuts).toEqual([{ fromMs: 850, toMs: 1_250 }]);
  });

  it('only looks inside the clip, and has no list for Hindi and Tamil yet', () => {
    expect(findFillers(transcript(list), 'en', [{ fromMs: 3_000, toMs: 4_000 }])).toHaveLength(1);
    expect(findFillers(transcript(list), 'hi', window)).toEqual([]);
    expect(hasFillerList('en')).toBe(true);
    expect(hasFillerList('ta')).toBe(false);
    expect(hasFillerList('fr')).toBe(false);
  });
});

describe('word places', () => {
  const list = words([
    ['before', 5_000, 5_400],
    ['in', 12_000, 12_300],
    ['cut', 20_500, 20_800],
    ['end', 60_000, 60_400],
    ['after', 75_000, 75_300],
  ]);

  it('marks words played, cut out, and outside the clip', () => {
    const doc = clip();
    const result = ok(removeSourceRange(doc, source(doc), 20_000, 25_000)).doc;
    const places = wordPlaces(result, transcript(list), source(doc));
    expect([...places.entries()]).toEqual([
      [0, 'outside'],
      [1, 'played'],
      [2, 'removed'],
      [3, 'played'],
      [4, 'outside'],
    ]);
    expect(removedWords(result, transcript(list), source(doc))).toEqual([2]);
  });

  it('lists every word removed after several cuts', () => {
    const doc = clip();
    const once = ok(removeSourceRange(doc, source(doc), 11_900, 12_400)).doc;
    const twice = ok(removeSourceRange(once, source(doc), 59_900, 60_500)).doc;
    expect(removedWords(twice, transcript(list), source(doc))).toEqual([1, 3]);
  });
});
