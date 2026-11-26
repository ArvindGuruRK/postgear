import {
  applyFixes,
  cleanHeardWord,
  clipRanges,
  decodeTranscript,
  emptyTranscript,
  encodeTranscript,
  endsSentence,
  type HeardWord,
  isCovered,
  isLanguageChoice,
  isTranscriptLanguage,
  isUnsure,
  languageName,
  mergeRanges,
  mergeTranscript,
  missingRanges,
  rangesMs,
  rangesToListen,
  removeFix,
  replaceEverywhere,
  roundOutward,
  sameWordCount,
  sentenceAt,
  sentences,
  type Transcript,
  TRANSCRIPT_LANGUAGES,
  TranscriptFileError,
  TranscriptTooLongError,
  upsertFix,
  type WordFix,
  wordAt,
  wordByIndex,
  wordCore,
  wordsInRange,
  wordsInRanges,
} from './index';

/** Words a second apart, each 400 ms long, from `fromSec`. */
function heard(texts: string[], fromSec: number, sure = 0.9): HeardWord[] {
  return texts.map((text, index) => ({
    start: (fromSec + index) * 1000,
    end: (fromSec + index) * 1000 + 400,
    text,
    sure,
  }));
}

function listened(texts: string[], fromSec: number, toSec: number): Transcript {
  return mergeTranscript(emptyTranscript('en', 'simulation'), {
    ranges: [{ fromMs: fromSec * 1000, toMs: toSec * 1000 }],
    words: heard(texts, fromSec),
  });
}

describe('covered ranges', () => {
  it('merges overlapping and touching ranges and drops empty ones', () => {
    expect(
      mergeRanges([
        { fromMs: 30_000, toMs: 60_000 },
        { fromMs: 0, toMs: 30_000 },
        { fromMs: 50_000, toMs: 90_000 },
        { fromMs: 200_000, toMs: 200_000 },
        { fromMs: 300_000, toMs: 250_000 },
        { fromMs: 120_000, toMs: 150_000 },
      ]),
    ).toEqual([
      { fromMs: 0, toMs: 90_000 },
      { fromMs: 120_000, toMs: 150_000 },
    ]);
  });

  it('answers only the gaps of a request', () => {
    const covered = [
      { fromMs: 60_000, toMs: 120_000 },
      { fromMs: 180_000, toMs: 240_000 },
    ];
    expect(missingRanges(covered, { fromMs: 0, toMs: 300_000 })).toEqual([
      { fromMs: 0, toMs: 60_000 },
      { fromMs: 120_000, toMs: 180_000 },
      { fromMs: 240_000, toMs: 300_000 },
    ]);
    expect(missingRanges(covered, { fromMs: 70_000, toMs: 110_000 })).toEqual([]);
    expect(missingRanges([], { fromMs: 5, toMs: 10 })).toEqual([{ fromMs: 5, toMs: 10 }]);
    expect(missingRanges(covered, { fromMs: 10, toMs: 10 })).toEqual([]);
  });

  it('knows when a stretch is fully covered', () => {
    const covered = [{ fromMs: 0, toMs: 120_000 }];
    expect(isCovered(covered, { fromMs: 60_000, toMs: 120_000 })).toBe(true);
    expect(isCovered(covered, { fromMs: 60_000, toMs: 120_001 })).toBe(false);
    expect(isCovered(covered, { fromMs: 5, toMs: 5 })).toBe(false);
  });

  it('adds up lengths with overlaps counted once and clips to a window', () => {
    const ranges = [
      { fromMs: 0, toMs: 60_000 },
      { fromMs: 30_000, toMs: 90_000 },
    ];
    expect(rangesMs(ranges)).toBe(90_000);
    expect(clipRanges(ranges, { fromMs: 45_000, toMs: 70_000 })).toEqual([
      { fromMs: 45_000, toMs: 70_000 },
    ]);
  });

  it('rounds a request outward to 30 second blocks inside the video', () => {
    expect(roundOutward({ fromMs: 61_500, toMs: 179_200 }, 600_000)).toEqual({
      fromMs: 60_000,
      toMs: 180_000,
    });
    // The last block is short when the video ends inside it.
    expect(roundOutward({ fromMs: 170_000, toMs: 999_999 }, 185_400)).toEqual({
      fromMs: 150_000,
      toMs: 185_400,
    });
    expect(roundOutward({ fromMs: 700_000, toMs: 800_000 }, 600_000)).toBeNull();
  });

  it('a nudged clip inside listened blocks needs nothing more', () => {
    const covered = [{ fromMs: 60_000, toMs: 180_000 }];
    expect(rangesToListen(covered, { fromMs: 61_000, toMs: 179_500 }, 600_000)).toEqual([]);
    expect(rangesToListen(covered, { fromMs: 0, toMs: 240_000 }, 600_000)).toEqual([
      { fromMs: 0, toMs: 60_000 },
      { fromMs: 180_000, toMs: 240_000 },
    ]);
  });
});

describe('mergeTranscript', () => {
  it('numbers the first words from zero and marks the stretch covered', () => {
    const transcript = listened(['Hello', 'there.'], 60, 120);
    expect(transcript.words.map((word) => word.i)).toEqual([0, 1]);
    expect(transcript.covered).toEqual([{ fromMs: 60_000, toMs: 120_000 }]);
    expect(transcript.nextIndex).toBe(2);
  });

  it('never renumbers a word that already has an index, even when earlier words arrive', () => {
    const first = listened(['later', 'words'], 60, 120);
    const merged = mergeTranscript(first, {
      ranges: [{ fromMs: 0, toMs: 60_000 }],
      words: heard(['earlier', 'words'], 10),
    });
    expect(merged.words.map((word) => [word.text, word.i])).toEqual([
      ['earlier', 2],
      ['words', 3],
      ['later', 0],
      ['words', 1],
    ]);
    expect(merged.covered).toEqual([{ fromMs: 0, toMs: 120_000 }]);
    expect(first.words).toHaveLength(2);
  });

  it('a stretch listened to again keeps the index of a word heard the same way', () => {
    const first = listened(['one', 'two', 'three'], 60, 120);
    const again = mergeTranscript(first, {
      ranges: [{ fromMs: 60_000, toMs: 120_000 }],
      words: [
        { start: 60_020, end: 60_400, text: 'one', sure: 0.95 },
        { start: 61_000, end: 61_400, text: 'too', sure: 0.7 },
        { start: 62_000, end: 62_400, text: 'three', sure: 0.9 },
        { start: 63_000, end: 63_400, text: 'four', sure: 0.9 },
      ],
    });
    expect(again.words.map((word) => [word.text, word.i])).toEqual([
      ['one', 0],
      ['too', 3],
      ['three', 2],
      ['four', 4],
    ]);
    expect(again.nextIndex).toBe(5);
  });

  it('records a silent stretch as covered so it is never listened to again', () => {
    const silent = mergeTranscript(emptyTranscript('en', 'simulation'), {
      ranges: [{ fromMs: 0, toMs: 30_000 }],
      words: [],
    });
    expect(silent.words).toEqual([]);
    expect(isCovered(silent.covered, { fromMs: 0, toMs: 30_000 })).toBe(true);
  });

  it('takes only words whose middle is inside the asked stretch', () => {
    const merged = mergeTranscript(emptyTranscript('en', 'simulation'), {
      ranges: [{ fromMs: 60_000, toMs: 120_000 }],
      words: [
        { start: 59_500, end: 59_900, text: 'before', sure: 1 },
        { start: 59_900, end: 60_400, text: 'edge', sure: 1 },
        { start: 119_900, end: 120_300, text: 'after', sure: 1 },
      ],
    });
    expect(merged.words.map((word) => word.text)).toEqual(['edge']);
  });

  it('takes the language found only while the transcript is still empty', () => {
    const first = mergeTranscript(emptyTranscript('en', 'simulation'), {
      ranges: [{ fromMs: 0, toMs: 30_000 }],
      words: heard(['vanakkam'], 1),
      language: 'ta',
    });
    expect(first.language).toBe('ta');
    const second = mergeTranscript(first, {
      ranges: [{ fromMs: 30_000, toMs: 60_000 }],
      words: heard(['hello'], 31),
      language: 'en',
    });
    expect(second.language).toBe('ta');
  });

  it('cleans what a listener hands back', () => {
    expect(cleanHeardWord({ start: 10.4, end: 10.2, text: '  hi  there ', sure: 7 })).toEqual({
      start: 10,
      end: 11,
      text: 'hi there',
      sure: 1,
    });
    expect(cleanHeardWord({ start: 0, end: 5, text: '   ', sure: 1 })).toBeNull();
    expect(cleanHeardWord({ start: 0, end: 90_000, text: 'aaa', sure: Number.NaN })).toEqual({
      start: 0,
      end: 15_000,
      text: 'aaa',
      sure: 0,
    });
  });

  it('refuses to grow past the word limit', () => {
    const big: Transcript = {
      ...emptyTranscript('en', 'simulation'),
      words: Array.from({ length: 400_000 }, (_, i) => ({
        i,
        start: i * 10,
        end: i * 10 + 5,
        text: 'w',
        sure: 1,
      })),
      nextIndex: 400_000,
      covered: [{ fromMs: 0, toMs: 4_000_000 }],
    };
    expect(() =>
      mergeTranscript(big, {
        ranges: [{ fromMs: 5_000_000, toMs: 5_030_000 }],
        words: [{ start: 5_000_100, end: 5_000_400, text: 'more', sure: 1 }],
      }),
    ).toThrow(TranscriptTooLongError);
  });
});

describe('word fixes', () => {
  const base = listened(['My', 'name', 'is', 'Arvin,', 'and', 'Arvin', 'codes.'], 60, 120);

  it('a fix changes what is read and marks the word sure', () => {
    const fixes = upsertFix([], base.words[3] as { start: number }, 'Arvind,');
    const read = applyFixes(base, fixes);
    expect(read.words[3]).toMatchObject({ text: 'Arvind,', sure: 1, i: 3 });
    expect(base.words[3]?.text).toBe('Arvin,');
  });

  it('a fix survives the video being listened to again, even when the word moved a little', () => {
    const fixes = upsertFix([], base.words[3] as { start: number }, 'Arvind,');
    const again = mergeTranscript(base, {
      ranges: [{ fromMs: 60_000, toMs: 120_000 }],
      words: heard(['My', 'name', 'is', 'Irvine,', 'and', 'Arvin', 'codes.'], 60).map((word) => ({
        ...word,
        start: word.start + 120,
        end: word.end + 120,
      })),
    });
    expect(again.words[3]?.text).toBe('Irvine,');
    expect(applyFixes(again, fixes).words[3]?.text).toBe('Arvind,');
  });

  it('fixing a word twice keeps one fix, and removing it reads the word as heard', () => {
    let fixes: WordFix[] = upsertFix([], base.words[0] as { start: number }, 'Our');
    fixes = upsertFix(fixes, base.words[0] as { start: number }, 'Their');
    expect(fixes).toEqual([{ at: 60_000, text: 'Their' }]);
    expect(removeFix(fixes, base.words[0] as { start: number })).toEqual([]);
    expect(upsertFix(fixes, base.words[1] as { start: number }, '   ')).toEqual(fixes);
  });

  it('Replace Everywhere fixes every spelling of the word and keeps its punctuation', () => {
    const { fixes, changed } = replaceEverywhere(base, [], 'arvin', 'Arvind');
    expect(changed).toBe(2);
    const read = applyFixes(base, fixes);
    expect(read.words.map((word) => word.text)).toEqual([
      'My',
      'name',
      'is',
      'Arvind,',
      'and',
      'Arvind',
      'codes.',
    ]);
    expect(replaceEverywhere(base, [], '...', 'x').changed).toBe(0);
    expect(replaceEverywhere(base, [], 'name', '  ').changed).toBe(0);
  });

  it('counts the other words that read the same, for the Replace Everywhere offer', () => {
    expect(sameWordCount(base, base.words[3] as Transcript['words'][number])).toBe(1);
    expect(sameWordCount(base, base.words[0] as Transcript['words'][number])).toBe(0);
    expect(wordCore('  "Job,"  ')).toBe('job');
    expect(wordCore('வணக்கம்!')).toBe('வணக்கம்');
  });
});

describe('windows', () => {
  const transcript = listened(['a', 'b', 'c', 'd', 'e'], 60, 120);

  it('answers the words whose middle falls in a stretch', () => {
    expect(wordsInRange(transcript, 61_000, 63_100).map((word) => word.text)).toEqual(['b', 'c']);
    expect(wordsInRange(transcript, 0, 60_000)).toEqual([]);
    expect(wordsInRange(transcript, 63_000, 63_000)).toEqual([]);
    expect(
      wordsInRanges(transcript, [
        { fromMs: 60_000, toMs: 61_000 },
        { fromMs: 64_000, toMs: 65_000 },
      ]).map((word) => word.text),
    ).toEqual(['a', 'e']);
  });

  it('two stretches that meet never both hold a word', () => {
    const left = wordsInRange(transcript, 60_000, 62_200);
    const right = wordsInRange(transcript, 62_200, 70_000);
    expect(left.length + right.length).toBe(transcript.words.length);
    expect(left.map((word) => word.i).filter((i) => right.some((word) => word.i === i))).toEqual(
      [],
    );
  });

  it('finds the word being said and a word by its index', () => {
    expect(wordAt(transcript, 59_000)).toBeNull();
    expect(wordAt(transcript, 62_100)?.text).toBe('c');
    expect(wordAt(transcript, 62_900)?.text).toBe('c');
    expect(wordByIndex(transcript, 4)?.text).toBe('e');
    expect(wordByIndex(transcript, 99)).toBeNull();
  });

  it('marks low-confidence words as unsure', () => {
    expect(isUnsure({ sure: 0.59 })).toBe(true);
    expect(isUnsure({ sure: 0.6 })).toBe(false);
  });
});

describe('sentences', () => {
  it('ends a sentence at closing punctuation, in English, Hindi and with quotes', () => {
    expect(endsSentence('job.')).toBe(true);
    expect(endsSentence('really?!')).toBe(true);
    expect(endsSentence('done."')).toBe(true);
    expect(endsSentence('है।')).toBe(true);
    expect(endsSentence('job,')).toBe(false);
    expect(endsSentence('3.5')).toBe(false);
  });

  it('splits on punctuation and keeps every word in exactly one sentence', () => {
    const transcript = listened(['I', 'quit.', 'It', 'was', 'hard!', 'Then', 'nothing'], 60, 120);
    const list = sentences(transcript);
    expect(list.map((sentence) => sentence.text)).toEqual([
      'I quit.',
      'It was hard!',
      'Then nothing',
    ]);
    expect(list[0]).toMatchObject({ from: 60_000, to: 61_400, wordFrom: 0, wordTo: 1 });
    const counted = list.reduce((sum, s) => sum + (s.wordTo - s.wordFrom + 1), 0);
    expect(counted).toBe(transcript.words.length);
  });

  it('splits on a long pause and on a run with no punctuation at all', () => {
    const paused = mergeTranscript(emptyTranscript('en', 'simulation'), {
      ranges: [{ fromMs: 0, toMs: 60_000 }],
      words: [
        { start: 1_000, end: 1_400, text: 'so', sure: 1 },
        { start: 1_500, end: 1_900, text: 'anyway', sure: 1 },
        { start: 4_000, end: 4_400, text: 'next', sure: 1 },
      ],
    });
    expect(sentences(paused).map((s) => s.text)).toEqual(['so anyway', 'next']);
    const run = mergeTranscript(emptyTranscript('en', 'simulation'), {
      ranges: [{ fromMs: 0, toMs: 120_000 }],
      words: Array.from({ length: 90 }, (_, i) => ({
        start: i * 500,
        end: i * 500 + 400,
        text: 'word',
        sure: 1,
      })),
    });
    const rows = sentences(run);
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) {
      expect(row.wordTo - row.wordFrom + 1).toBeLessThanOrEqual(40);
      expect(row.to - row.from).toBeLessThanOrEqual(20_000);
    }
  });

  it('never joins words across two listened stretches', () => {
    const first = mergeTranscript(emptyTranscript('en', 'simulation'), {
      ranges: [{ fromMs: 0, toMs: 30_000 }],
      words: [{ start: 29_300, end: 29_700, text: 'end', sure: 1 }],
    });
    const both = mergeTranscript(first, {
      ranges: [{ fromMs: 60_000, toMs: 90_000 }],
      words: [{ start: 60_000, end: 60_300, text: 'start', sure: 1 }],
    });
    expect(sentences(both, { pauseMs: 120_000 }).map((s) => s.text)).toEqual(['end', 'start']);
  });

  it('finds the sentence a moment falls in', () => {
    const list = sentences(listened(['One.', 'Two.', 'Three.'], 10, 30));
    expect(sentenceAt(list, 11_200)?.text).toBe('Two.');
    expect(sentenceAt(list, 0)?.text).toBe('One.');
    expect(sentenceAt([], 5)).toBeNull();
  });
});

describe('the transcript file', () => {
  it('round trips', () => {
    const transcript = listened(['Hello', 'there.'], 60, 120);
    expect(decodeTranscript(encodeTranscript(transcript))).toEqual(transcript);
  });

  it.each([
    ['not json', '{'],
    ['an unknown key', JSON.stringify({ ...listened(['a'], 0, 30), extra: 1 })],
    [
      'words out of order',
      JSON.stringify({
        ...emptyTranscript('en', 'm'),
        nextIndex: 2,
        words: [
          { i: 0, start: 500, end: 600, text: 'b', sure: 1 },
          { i: 1, start: 100, end: 200, text: 'a', sure: 1 },
        ],
      }),
    ],
    [
      'an index used twice',
      JSON.stringify({
        ...emptyTranscript('en', 'm'),
        nextIndex: 2,
        words: [
          { i: 0, start: 100, end: 200, text: 'a', sure: 1 },
          { i: 0, start: 500, end: 600, text: 'b', sure: 1 },
        ],
      }),
    ],
    [
      'an index past the next one',
      JSON.stringify({
        ...emptyTranscript('en', 'm'),
        nextIndex: 1,
        words: [{ i: 5, start: 100, end: 200, text: 'a', sure: 1 }],
      }),
    ],
    [
      'overlapping covered stretches',
      JSON.stringify({
        ...emptyTranscript('en', 'm'),
        covered: [
          { fromMs: 0, toMs: 100 },
          { fromMs: 50, toMs: 200 },
        ],
      }),
    ],
    ['a language that is not a code', JSON.stringify({ ...emptyTranscript('English', 'm') })],
  ])('refuses %s without echoing the text', (_name, text) => {
    expect(() => decodeTranscript(text)).toThrow(TranscriptFileError);
    try {
      decodeTranscript(text);
    } catch (error) {
      expect((error as Error).message).toBe('The transcript file could not be read.');
    }
  });

  it('refuses to write a transcript that breaks its own rules', () => {
    const broken: Transcript = {
      ...emptyTranscript('en', 'm'),
      nextIndex: 1,
      words: [{ i: 0, start: 200, end: 100, text: 'a', sure: 1 }],
    };
    expect(() => encodeTranscript(broken)).toThrow(TranscriptFileError);
  });
});

describe('languages', () => {
  it('offers only languages whose captions can be drawn, Tamil and Hindi among them', () => {
    const codes = TRANSCRIPT_LANGUAGES.map((language) => language.code);
    expect(codes).toEqual(expect.arrayContaining(['en', 'hi', 'ta']));
    expect(new Set(codes).size).toBe(codes.length);
    for (const language of TRANSCRIPT_LANGUAGES) {
      // A script outside Latin needs its own font, and marks whole words only.
      if (language.script !== 'latin') {
        expect(language.font).toMatch(/^Noto Sans /);
        expect(language.highlight).toBe('page');
      }
    }
  });

  it('knows a language choice from anything else', () => {
    expect(isLanguageChoice('auto')).toBe(true);
    expect(isLanguageChoice('ta')).toBe(true);
    expect(isLanguageChoice('xx')).toBe(false);
    expect(isTranscriptLanguage('auto')).toBe(false);
    expect(languageName('ta')).toBe('Tamil');
    expect(languageName('zz')).toBe('ZZ');
  });
});
