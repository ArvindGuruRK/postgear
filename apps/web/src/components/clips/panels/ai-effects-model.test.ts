import {
  type ClipDocument,
  countSounds,
  createClipDocument,
  findItem,
  setBleeps,
  type TranscriptWord,
} from '@postgear/video-engine';
import {
  addMadeVoice,
  clipBleepWords,
  hookLengthText,
  hookRangeText,
  madeVoiceOf,
  moveHookRange,
  playedWords,
  tickedWords,
  toggleWord,
  voiceButtonLabel,
  voiceCountText,
} from './ai-effects-model';

const VIDEO = '3f2a9c1e-0000-4000-8000-000000000009';

/** 10 s to 40 s of the video, one part. */
function clip(): ClipDocument {
  return createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' });
}

const word = (i: number, text: string, start: number): TranscriptWord => ({
  i,
  text,
  start,
  end: start + 400,
  sure: 1,
});

const WORDS: TranscriptWord[] = [
  word(0, 'Well', 5_000), // before the clip: never bleeped
  word(1, 'this', 12_000),
  word(2, 'shit,', 12_500),
  word(3, 'is', 13_000),
  word(4, 'darn', 14_000),
  word(5, 'bastards!', 20_000),
];

describe('Bleep Bad Words', () => {
  const DOC = clip();
  const source = () => DOC.segments[0]?.source ?? '';

  it('finds only words the clip plays, on the list or My Words', () => {
    const doc = DOC;
    expect(playedWords(doc, WORDS, source()).map((w) => w.index)).toEqual([1, 2, 3, 4, 5]);
    const found = clipBleepWords(doc, WORDS, source(), 'en', []);
    expect(found.map((w) => w.text)).toEqual(['shit,', 'bastards!']);
    const mine = clipBleepWords(doc, WORDS, source(), 'en', ['darn']);
    expect(mine.map((w) => w.text)).toEqual(['shit,', 'darn', 'bastards!']);
  });

  it('ticks a word when the bleeps cover it, and toggles one at a time', () => {
    const doc = DOC;
    const found = clipBleepWords(doc, WORDS, source(), 'en', []);
    expect(tickedWords(doc, source(), found)).toEqual([]);
    const all = setBleeps(doc, found, 'bleep', source());
    expect(tickedWords(all, source(), found)).toHaveLength(2);
    const one = toggleWord(tickedWords(all, source(), found), found[0] as never, false);
    expect(one.map((w) => w.text)).toEqual(['bastards!']);
    const back = toggleWord(one, found[0] as never, true);
    expect(back.map((w) => w.text)).toEqual(['shit,', 'bastards!']);
  });
});

describe('the hook range', () => {
  const TOTAL = 30_000;

  it('moves whole and stays inside the clip', () => {
    const range = { fromOutputMs: 1_000, toOutputMs: 3_500 };
    expect(moveHookRange(range, 'move', -5_000, TOTAL)).toEqual({
      fromOutputMs: 0,
      toOutputMs: 2_500,
    });
    expect(moveHookRange(range, 'move', 60_000, TOTAL)).toEqual({
      fromOutputMs: 27_500,
      toOutputMs: 30_000,
    });
  });

  it('keeps 1 to 5 seconds when an edge moves', () => {
    const range = { fromOutputMs: 10_000, toOutputMs: 12_500 };
    expect(moveHookRange(range, 'end', 10_000, TOTAL).toOutputMs).toBe(15_000);
    expect(moveHookRange(range, 'end', -10_000, TOTAL).toOutputMs).toBe(11_000);
    expect(moveHookRange(range, 'start', -10_000, TOTAL).fromOutputMs).toBe(7_500);
    expect(moveHookRange(range, 'start', 10_000, TOTAL).fromOutputMs).toBe(11_500);
    expect(
      moveHookRange({ fromOutputMs: 27_000, toOutputMs: 29_000 }, 'end', 9_000, TOTAL),
    ).toEqual({ fromOutputMs: 27_000, toOutputMs: 30_000 });
  });

  it('reads back as words', () => {
    expect(hookLengthText(2_500)).toBe('Hook: 2.5 s');
    expect(hookLengthText(3_000)).toBe('Hook: 3 s');
    expect(hookRangeText({ fromOutputMs: 4_000, toOutputMs: 6_500 })).toBe('From 0:04, 2.5 s long');
  });
});

describe('Text To Speech', () => {
  it('prices by characters, as the API charges', () => {
    expect(voiceButtonLabel(0)).toBe('Make The Voice (1 AI Minute)');
    expect(voiceButtonLabel(500)).toBe('Make The Voice (1 AI Minute)');
    expect(voiceCountText(12)).toBe('12 / 500');
  });

  it('reads the made voice off a finished job', () => {
    expect(madeVoiceOf({ result: { assetId: 'a1', durationMs: 2_400 } })).toEqual({
      assetId: 'a1',
      durationMs: 2_400,
    });
    expect(madeVoiceOf({ result: { durationMs: 2_400 } })).toBeNull();
    expect(madeVoiceOf({ result: null })).toBeNull();
    expect(madeVoiceOf(null)).toBeNull();
  });

  it('adds the voice as an uploaded sound at the playhead', () => {
    const doc = clip();
    const result = addMadeVoice(doc, { assetId: 'asset-9', durationMs: 2_400 }, 5_000);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.itemId) throw new Error('refused');
    expect(countSounds(result.doc)).toBe(1);
    const item = findItem(result.doc, result.itemId)?.item;
    expect(item).toMatchObject({
      type: 'sfx',
      start: 5_000,
      duration: 2_400,
      ref: { asset: 'asset-9' },
    });
  });
});
