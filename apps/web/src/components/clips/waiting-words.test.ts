import type { ClipJobView } from '@/types/clips';
import {
  jobWords,
  LOW_PRIORITY_LINE,
  lowPriorityLine,
  queuedOr,
  WAITING_WORDS,
  waitingLine,
  waitingTime,
} from './waiting-words';

type Job = Pick<ClipJobView, 'status' | 'waiting' | 'stageLabel'>;

const queued = (waiting: ClipJobView['waiting']): Job => ({
  status: 'QUEUED',
  waiting,
  stageLabel: 'Waiting for our turn',
});

describe('the waiting words (Module 15)', () => {
  it('say our turn, never its turn', () => {
    expect(WAITING_WORDS).toBe('Waiting for our turn');
    expect(LOW_PRIORITY_LINE).toBe('Plans with a higher priority go first.');
  });

  it('give the time in whole minutes, one minute in the singular, under one as less than a minute', () => {
    expect(waitingTime(240)).toBe('about 4 minutes');
    expect(waitingTime(60)).toBe('about 1 minute');
    expect(waitingTime(0)).toBe('less than a minute');
    expect(waitingTime(29)).toBe('less than a minute');
    expect(waitingTime(null)).toBeNull();
    expect(waitingTime(Number.NaN)).toBeNull();
  });

  it('add the time to the line only when there is one', () => {
    expect(waitingLine(queued({ aboutSeconds: 240, position: 2, lowPriority: false }))).toBe(
      'Waiting for our turn, about 4 minutes',
    );
    expect(waitingLine(queued({ aboutSeconds: 60, position: 0, lowPriority: false }))).toBe(
      'Waiting for our turn, about 1 minute',
    );
    expect(waitingLine(queued({ aboutSeconds: 0, position: 0, lowPriority: false }))).toBe(
      'Waiting for our turn, less than a minute',
    );
    expect(waitingLine(queued({ aboutSeconds: null, position: 3, lowPriority: false }))).toBe(
      'Waiting for our turn',
    );
    expect(waitingLine(queued(null))).toBe('Waiting for our turn');
  });

  it('show the second line only for a low priority job still waiting', () => {
    expect(lowPriorityLine(queued({ aboutSeconds: 60, position: 1, lowPriority: true }))).toBe(
      'Plans with a higher priority go first.',
    );
    expect(
      lowPriorityLine(queued({ aboutSeconds: 60, position: 1, lowPriority: false })),
    ).toBeNull();
    expect(lowPriorityLine(queued(null))).toBeNull();
    expect(
      lowPriorityLine({
        status: 'RUNNING',
        waiting: { aboutSeconds: 60, position: 1, lowPriority: true },
      }),
    ).toBeNull();
    expect(lowPriorityLine(null)).toBeNull();
  });

  it("keep a running job's own words, and the fallback when there is no job", () => {
    const running: Job = { status: 'RUNNING', waiting: null, stageLabel: 'Getting the video' };
    expect(jobWords(running)).toBe('Getting the video');
    expect(jobWords({ ...running, stageLabel: '  ' }, 'Getting ready')).toBe('Getting ready');
    expect(jobWords(null)).toBe('Waiting for our turn');
    expect(jobWords(queued({ aboutSeconds: 120, position: 1, lowPriority: false }))).toBe(
      'Waiting for our turn, about 2 minutes',
    );
    expect(queuedOr(running, 'Listening to what is said')).toBe('Listening to what is said');
    expect(queuedOr(queued(null), 'Listening to what is said')).toBe('Waiting for our turn');
  });
});
