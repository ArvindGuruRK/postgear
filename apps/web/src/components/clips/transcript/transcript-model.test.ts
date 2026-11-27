import {
  type ClipDocument,
  createClipDocument,
  removeSourceRange,
  type TranscriptWord,
  wordPlaces,
} from '@postgear/video-engine';
import {
  cleanupToast,
  cutRefusalSentence,
  cutToast,
  manyUnsure,
  noPausesLine,
  PARAGRAPH_PAUSE_MS,
  pausesLine,
  spokenLength,
  spokenWordAt,
  transcriptParagraphs,
  withCleanupNote,
  wordsSpan,
} from './transcript-model';

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';

function clip(): ClipDocument {
  return createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' });
}
const sourceOf = (doc: ClipDocument) => doc.segments[0]?.source as string;

function words(spec: Array<[string, number, number, number?]>): TranscriptWord[] {
  return spec.map(([text, start, end, sure], i) => ({ i, start, end, text, sure: sure ?? 0.9 }));
}

const SAID = words([
  ['Before', 8_000, 8_400],
  ['We', 10_200, 10_400],
  ['spent', 10_450, 10_800],
  ['a', 10_850, 10_900],
  ['year.', 10_950, 11_300],
  ['Then', 13_000, 13_300], // a 1.7 s pause before
  ['um', 13_400, 13_600, 0.3],
  ['it', 13_700, 13_800, 0.4],
  ['worked.', 13_850, 14_200, 0.5],
  ['After', 41_000, 41_400],
]);

describe('the Transcript pane model', () => {
  it('breaks paragraphs at long pauses and at the clip edges, with their time on the clip', () => {
    const doc = clip();
    const places = wordPlaces(doc, { words: SAID }, sourceOf(doc));
    const paragraphs = transcriptParagraphs(SAID, places, doc, sourceOf(doc));
    expect(paragraphs.map((p) => p.words.map((w) => w.text).join(' '))).toEqual([
      'Before',
      'We spent a year.',
      'Then um it worked.',
      'After',
    ]);
    expect(paragraphs.map((p) => p.label)).toEqual(['Outside', '0:00', '0:03', 'Outside']);
    expect(PARAGRAPH_PAUSE_MS).toBeLessThan(1_700);
    expect(paragraphs[0]?.words[0]?.state).toBe('outside');
    expect(paragraphs[2]?.words[1]).toMatchObject({ state: 'normal', unsure: true });
  });

  it('strikes through words cut from the clip', () => {
    const doc = clip();
    const cut = removeSourceRange(doc, sourceOf(doc), 13_350, 13_650);
    if (!cut.ok) throw new Error(cut.code);
    const places = wordPlaces(cut.doc, { words: SAID }, sourceOf(doc));
    const paragraphs = transcriptParagraphs(SAID, places, cut.doc, sourceOf(doc));
    expect(paragraphs[2]?.words.map((w) => w.state)).toEqual([
      'normal',
      'removed',
      'normal',
      'normal',
    ]);
  });

  it('marks the word under the playhead, holds it briefly, and none in a pause', () => {
    const doc = clip();
    const source = sourceOf(doc);
    // Clip 0.3 s is video 10.3 s: "We".
    expect(spokenWordAt(doc, SAID, source, 300)).toBe(1);
    // Just after "year." ends (video 11.3 s): still marked for a moment.
    expect(spokenWordAt(doc, SAID, source, 1_400)).toBe(4);
    // In the long pause.
    expect(spokenWordAt(doc, SAID, source, 2_200)).toBeNull();
    expect(spokenWordAt(doc, SAID, 'another', 300)).toBeNull();
  });

  it('says "hard to hear" only when enough of the clip was unsure', () => {
    const doc = clip();
    const places = wordPlaces(doc, { words: SAID }, sourceOf(doc));
    expect(manyUnsure(SAID, places)).toBe(true);
    const clear = SAID.map((word) => ({ ...word, sure: 0.95 }));
    expect(manyUnsure(clear, places)).toBe(false);
  });

  it('turns refusals and results into sentences', () => {
    expect(cutRefusalSentence('clip_too_short')).toBe('A clip needs at least 3 seconds.');
    expect(cutRefusalSentence('cannot_restore')).toBe('Use Undo to bring this back.');
    expect(pausesLine(7, 4_200)).toBe('7 pauses, 4.2 seconds');
    expect(pausesLine(1, 1_000)).toBe('1 pause, 1 second');
    expect(noPausesLine(800)).toBe('No pauses longer than 0.8 seconds.');
    expect(cleanupToast('pauses', 7, 4_200)).toBe(
      'Removed 7 pauses. The clip is 4.2 seconds shorter.',
    );
    expect(cleanupToast('fillers', 1, 400)).toBe(
      'Removed 1 filler word. The clip is 0.4 seconds shorter.',
    );
    expect(cutToast(5, 1_900)).toBe('Cut 5 words. The clip is 1.9 seconds shorter.');
    expect(spokenLength(65_000)).toBe('1 minute 5 seconds');
  });

  it('finds the span of a run of words', () => {
    expect(wordsSpan(SAID, [6, 7])).toEqual({ fromMs: 13_400, toMs: 13_800 });
    expect(wordsSpan(SAID, [99])).toBeNull();
  });
});

describe('the cleanup note (Module 10)', () => {
  it('records the cleanup on the cut document, keeping what was there, and leaves a refusal alone', () => {
    const doc = createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' });
    const source = doc.segments[0]?.source ?? '';
    const cut = removeSourceRange({ ...doc, meta: { shapeChosen: true } }, source, 15_000, 16_000);
    const first = withCleanupNote(cut, { silencesMinMs: 900 });
    expect(first.ok && first.doc.meta).toEqual({
      shapeChosen: true,
      cleanup: { silencesMinMs: 900 },
    });
    const both = first.ok ? withCleanupNote({ ...first }, { fillers: true }) : first;
    expect(both.ok && both.doc.meta?.cleanup).toEqual({ silencesMinMs: 900, fillers: true });
    const refused = { ok: false as const, code: 'too_short' as never };
    expect(withCleanupNote(refused, { fillers: true })).toBe(refused);
  });
});
