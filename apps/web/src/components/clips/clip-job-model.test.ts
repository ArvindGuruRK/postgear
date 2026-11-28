import type { ClipJobView } from '@/types/clips';
import { isTerminalJob, mergeJobView, minutesLeft } from './clip-job-model';

function view(patch: Partial<ClipJobView> = {}): ClipJobView {
  return {
    id: 'job-1',
    kind: 'IMPORT',
    status: 'RUNNING',
    stage: 'fetching',
    stageLabel: 'Getting the video',
    progress: 10,
    etaSeconds: null,
    videoId: 'video-1',
    clipId: null,
    error: null,
    result: null,
    createdAt: '2026-11-18T10:00:00.000Z',
    startedAt: '2026-11-18T10:00:01.000Z',
    finishedAt: null,
    waiting: null,
    ...patch,
  };
}

describe('mergeJobView', () => {
  it('takes the first view as it is', () => {
    expect(mergeJobView(null, view())).toEqual(view());
  });

  it('moves forward with new progress and new steps', () => {
    expect(mergeJobView(view({ progress: 10 }), view({ progress: 40 })).progress).toBe(40);
    const next = mergeJobView(view({ progress: 70 }), view({ stage: 'preparing', progress: 72 }));
    expect(next.stage).toBe('preparing');
  });

  it('never shows progress going backwards within a step', () => {
    expect(mergeJobView(view({ progress: 40 }), view({ progress: 35 })).progress).toBe(40);
  });

  it('never takes a finished job back to running', () => {
    const done = view({ status: 'DONE', progress: 100 });
    expect(mergeJobView(done, view({ progress: 90 }))).toBe(done);
    const failed = view({ status: 'FAILED' });
    expect(mergeJobView(failed, view({ status: 'DONE' }))).toBe(failed);
  });

  it('ignores a view of another job', () => {
    const shown = view();
    expect(mergeJobView(shown, view({ id: 'job-2' }))).toBe(shown);
  });
});

describe('minutesLeft', () => {
  it('rounds up to whole minutes and hides short or unknown times', () => {
    expect(minutesLeft(null)).toBeNull();
    expect(minutesLeft(29)).toBeNull();
    expect(minutesLeft(30)).toBe(1);
    expect(minutesLeft(61)).toBe(2);
    expect(minutesLeft(240)).toBe(4);
  });

  it('knows which statuses are final', () => {
    expect(isTerminalJob('RUNNING')).toBe(false);
    expect(isTerminalJob('CANCELLED')).toBe(true);
  });
});
