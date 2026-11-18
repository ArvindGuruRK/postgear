import { estimateEtaSeconds, JOB_END_LABELS, jobLabel, PREVIEW_LABEL, WAITING_LABEL } from './jobs';

describe('jobLabel', () => {
  it('names the step while a job runs', () => {
    expect(jobLabel('IMPORT', 'RUNNING', 'fetching')).toBe('Getting the video');
    expect(jobLabel('RENDER', 'RUNNING', 'rendering')).toBe('Rendering');
  });

  it('waits while queued, whatever stage the row still holds', () => {
    expect(jobLabel('IMPORT', 'QUEUED', null)).toBe(WAITING_LABEL);
    expect(jobLabel('IMPORT', 'QUEUED', 'preparing')).toBe(WAITING_LABEL);
  });

  it('says a finished job is over, never that it is waiting', () => {
    // The row keeps its last stage after it ends (the import run of 2026-11-18 showed it).
    expect(jobLabel('IMPORT', 'DONE', 'preparing')).toBe(JOB_END_LABELS.DONE);
    expect(jobLabel('RENDER', 'FAILED', 'rendering')).toBe(JOB_END_LABELS.FAILED);
    expect(jobLabel('SEGMENT', 'CANCELLED', null)).toBe(JOB_END_LABELS.CANCELLED);
  });

  it('keeps a Preview Export on its one sentence until it ends', () => {
    expect(jobLabel('RENDER', 'QUEUED', null, { proof: true })).toBe(PREVIEW_LABEL);
    expect(jobLabel('RENDER', 'RUNNING', 'rendering', { proof: true })).toBe(PREVIEW_LABEL);
    expect(jobLabel('RENDER', 'DONE', 'finishing', { proof: true })).toBe(JOB_END_LABELS.DONE);
  });

  it('falls back to waiting for a stage it does not know', () => {
    expect(jobLabel('IMPORT', 'RUNNING', 'mystery')).toBe(WAITING_LABEL);
  });
});

describe('estimateEtaSeconds', () => {
  const at = (seconds: number, progress: number) => ({ at: seconds * 1000, progress });

  it('projects a steady rate over the recent past', () => {
    // 10 percent in 10 seconds, 60 percent left: 60 seconds.
    expect(estimateEtaSeconds([at(0, 30), at(5, 35), at(10, 40)], null)).toBe(60);
  });

  it('forgets a slow start older than a minute', () => {
    // Crawled 5 to 10 over the first 100 s, then 10 to 50 in the last 20 s: 2 per second.
    const samples = [at(0, 5), at(100, 10), at(110, 30), at(120, 50)];
    expect(estimateEtaSeconds(samples, null)).toBe(25);
  });

  it('uses the prior when there is not enough history, scaled by what is left', () => {
    expect(estimateEtaSeconds([at(0, 50)], 200)).toBe(100);
  });

  it('uses the prior when the job has stalled, and answers nothing without one', () => {
    const stalled = [at(0, 40), at(30, 40)];
    expect(estimateEtaSeconds(stalled, 100)).toBe(60);
    expect(estimateEtaSeconds(stalled, null)).toBeNull();
  });

  it('answers nothing under 5 percent, for no samples, or a nonsense prior', () => {
    expect(estimateEtaSeconds([at(0, 1), at(10, 4)], 100)).toBeNull();
    expect(estimateEtaSeconds([], 100)).toBeNull();
    expect(estimateEtaSeconds([at(0, 50)], -5)).toBeNull();
    expect(estimateEtaSeconds([at(0, 50)], Number.NaN)).toBeNull();
  });

  it('is zero at 100 percent and never negative, rounded up', () => {
    expect(estimateEtaSeconds([at(0, 100)], null)).toBe(0);
    // 3 percent in 4 s is 0.75 a second; 92 percent left is 122.67 s, rounded up.
    expect(estimateEtaSeconds([at(0, 5), at(4, 8)], null)).toBe(123);
  });
});
