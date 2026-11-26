import type { TranscriptWord } from '@postgear/video-engine';
import {
  CLIP_AIR_MS,
  clipRangeForWords,
  findInWords,
  SELECT_TO_CLIP,
  sheetSections,
} from './video-transcript-model';

function words(spec: Array<[string, number, number]>): TranscriptWord[] {
  return spec.map(([text, start, end], i) => ({ i, start, end, text, sure: 0.9 }));
}

const SAID = words([
  ['So,', 1_000, 1_200],
  ['what', 1_300, 1_500],
  ['we', 1_550, 1_700],
  ['learned', 1_750, 2_200],
  ['is', 2_250, 2_400],
  ['this.', 2_450, 2_900],
  ['We', 70_000, 70_300],
  ['learned', 70_350, 70_900],
  ['fast.', 70_950, 71_400],
]);

describe('the video page transcript', () => {
  it('shows the listened parts as paragraphs and the rest as gaps to listen to', () => {
    const sections = sheetSections(
      SAID,
      [
        { fromMs: 0, toMs: 30_000 },
        { fromMs: 60_000, toMs: 90_000 },
      ],
      120_000,
    );
    expect(
      sections.map((section) => [section.kind, section.range.fromMs, section.range.toMs]),
    ).toEqual([
      ['words', 0, 30_000],
      ['gap', 30_000, 60_000],
      ['words', 60_000, 90_000],
      ['gap', 90_000, 120_000],
    ]);
    const first = sections[0];
    expect(first?.kind === 'words' && first.paragraphs[0]?.label).toBe('0:01');
  });

  it('finds a word by its start, and several words only in a row', () => {
    expect(findInWords(SAID, 'learn')).toEqual([[3], [7]]);
    expect(findInWords(SAID, 'we learned')).toEqual([
      [2, 3],
      [6, 7],
    ]);
    expect(findInWords(SAID, 'What WE')).toEqual([[1, 2]]);
    expect(findInWords(SAID, 'this')).toEqual([[5]]);
    expect(findInWords(SAID, '  ')).toEqual([]);
    expect(findInWords(SAID, 'nothing')).toEqual([]);
  });

  it('makes a clip from the first selected word to the last, with a little air', () => {
    expect(clipRangeForWords(SAID, [1, 2, 3, 4, 5, 6, 7], 120_000)).toEqual({
      ok: true,
      fromMs: 1_300 - CLIP_AIR_MS,
      toMs: 70_900 + CLIP_AIR_MS,
    });
  });

  it('refuses a selection under 3 seconds, and asks for one when nothing is selected', () => {
    expect(clipRangeForWords(SAID, [3], 120_000)).toEqual({
      ok: false,
      sentence: 'Select at least 3 seconds of speech to make a clip.',
    });
    expect(clipRangeForWords(SAID, [], 120_000)).toEqual({ ok: false, sentence: SELECT_TO_CLIP });
    expect(clipRangeForWords(SAID, [0, 1, 2, 3, 4, 5, 6, 7, 8], 120_000).ok).toBe(true);
  });
});
