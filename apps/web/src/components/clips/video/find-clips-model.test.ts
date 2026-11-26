import { fixtureClipSummary } from '../library/clip-list-fixtures';
import {
  asksFirst,
  findAgainSentence,
  findClipsBlock,
  findClipsLabel,
  findClipsNotes,
  foundByLine,
  LISTENED_NOTE,
  NO_SOUND_NOTE,
  NOTHING_FOUND_NOTE,
  orderClips,
  reasonLabels,
  scoreText,
  WATCHED_NOTE,
} from './find-clips-model';

const CYCLE_END = '2026-12-01T00:00:00.000Z';
const meter = (remaining: number | null, limit: number | null = 300) => ({
  limit,
  remaining,
  cycleEnd: CYCLE_END,
});
const run = (
  status: 'DONE' | 'FAILED' | 'RUNNING',
  found = 3,
  foundBy: string | null = 'Sound and picture',
) => ({
  status,
  found,
  foundBy,
});

describe('the button', () => {
  it('carries the price in Title Case, one minute singular', () => {
    expect(findClipsLabel(15)).toBe('Find Clips (15 AI Minutes)');
    expect(findClipsLabel(1)).toBe('Find Clips (1 AI Minute)');
  });

  it('is on with enough minutes, unlimited ones, or a meter not read yet', () => {
    expect(findClipsBlock(15, meter(15))).toBeNull();
    expect(findClipsBlock(15, meter(null, null))).toBeNull();
    expect(findClipsBlock(15, null)).toBeNull();
  });

  it('is off, with the sentence from the stories, when short or out', () => {
    expect(findClipsBlock(15, meter(9))).toBe(
      'This needs 15 AI minutes and you have 9 left. They come back on 1 December, or you can upgrade the plan.',
    );
    expect(findClipsBlock(15, meter(0))).toBe(
      'This workspace has used all its AI minutes for this month. They reset on 1 December.',
    );
  });
});

describe('the confirm', () => {
  it('asks before a second run, with the price', () => {
    expect(findAgainSentence(15)).toBe(
      'Find clips again? New clips you have not opened will be replaced. This costs 15 AI minutes.',
    );
    expect(findAgainSentence(1)).toMatch(/This costs 1 AI minute\.$/);
  });

  it('asks only once a run finished or AI clips are on the list', () => {
    expect(asksFirst({ run: null }, [fixtureClipSummary()])).toBe(false);
    expect(asksFirst({ run: null }, [fixtureClipSummary({ origin: 'AI_SIGNALS' })])).toBe(true);
    expect(
      asksFirst(
        {
          run: {
            ...run('DONE'),
            id: 'r',
            jobId: 'j',
            tracks: [],
            aiMinutes: 3,
            refunded: false,
            createdAt: '',
            finishedAt: null,
          },
        },
        [],
      ),
    ).toBe(true);
    expect(
      asksFirst(
        {
          run: {
            ...run('FAILED'),
            id: 'r',
            jobId: 'j',
            tracks: [],
            aiMinutes: 3,
            refunded: true,
            createdAt: '',
            finishedAt: null,
          },
        },
        [],
      ),
    ).toBe(false);
  });
});

describe('the notes', () => {
  it('says no sound and nothing found when they apply, and nothing otherwise', () => {
    expect(findClipsNotes({ noSound: false, run: null }, false)).toEqual([]);
    expect(findClipsNotes({ noSound: true, run: null }, false)).toEqual([NO_SOUND_NOTE]);
    const empty = {
      ...run('DONE', 0),
      id: 'r',
      jobId: 'j',
      tracks: [],
      aiMinutes: 3,
      refunded: false,
      createdAt: '',
      finishedAt: null,
    };
    expect(findClipsNotes({ noSound: false, run: empty }, false)).toEqual([NOTHING_FOUND_NOTE]);
    // Not while a new run is on.
    expect(findClipsNotes({ noSound: false, run: empty }, true)).toEqual([]);
  });

  it('says AI watched for action when Look For Action ran (Module 06)', () => {
    const base = {
      ...run('DONE', 3),
      id: 'r',
      jobId: 'j',
      tracks: [],
      aiMinutes: 3,
      refunded: false,
      createdAt: '',
      finishedAt: null,
    };
    const ai = { read: true, noSpeech: false, asked: false, matched: 0 };
    expect(findClipsNotes({ noSound: false, run: { ...base, ai } }, false)).toEqual([
      LISTENED_NOTE,
    ]);
    expect(
      findClipsNotes({ noSound: false, run: { ...base, ai: { ...ai, watched: true } } }, false),
    ).toEqual([WATCHED_NOTE]);
  });

  it('names the tracks used once a run found clips', () => {
    expect(foundByLine(run('DONE', 4, 'Sound, picture and chat'))).toBe(
      'How this was found: Sound, picture and chat',
    );
    expect(foundByLine(run('DONE', 0))).toBeNull();
    expect(foundByLine(run('RUNNING'))).toBeNull();
    expect(foundByLine(null)).toBeNull();
  });
});

describe('the list', () => {
  it('puts AI picks first, best score first, then the hand-made ones as they came', () => {
    const clips = [
      fixtureClipSummary({ id: 'mine-new', createdAt: '2026-11-19T10:00:00.000Z' }),
      fixtureClipSummary({ id: 'ai-60', origin: 'AI_SIGNALS', score: 60 }),
      fixtureClipSummary({ id: 'mine-old', createdAt: '2026-11-18T10:00:00.000Z' }),
      fixtureClipSummary({ id: 'ai-92', origin: 'AI_SIGNALS', score: 92 }),
    ];
    const { ai, manual } = orderClips(clips);
    expect(ai.map((clip) => clip.id)).toEqual(['ai-92', 'ai-60']);
    expect(manual.map((clip) => clip.id)).toEqual(['mine-new', 'mine-old']);
  });

  it('reads up to three reasons in words and leaves unknown codes out', () => {
    expect(reasonLabels(['chat_burst', 'loud', 'mystery', 'fast_cuts', 'replayed'])).toEqual([
      'Chat exploded',
      'Loud reaction',
      'Fast cuts',
    ]);
  });

  it('shows the score as a whole number from 0 to 100', () => {
    expect(scoreText(91.6)).toBe('92');
    expect(scoreText(140)).toBe('100');
    expect(scoreText(null)).toBeNull();
  });
});
