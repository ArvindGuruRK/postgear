import {
  autoEditInputSchema,
  autoEditOutputSchema,
  CLIP_JOB_INPUT_SCHEMAS,
  CLIP_JOB_KINDS,
  CLIP_JOB_OUTPUT_SCHEMAS,
  CLIP_JOB_STAGES,
  estimateEtaSeconds,
  JOB_END_LABELS,
  jobLabel,
  PREVIEW_LABEL,
  WAITING_LABEL,
} from './jobs';

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

describe('AUTO_EDIT (Module 10)', () => {
  const videoId = '11111111-1111-4111-8111-111111111111';
  const clipId = '22222222-2222-4222-8222-222222222222';
  const listenJobId = '33333333-3333-4333-8333-333333333333';
  const base = {
    videoId,
    clipId,
    recipeId: 'starter-auto-edit-talking-video',
    range: { fromMs: 0, toMs: 600_000 },
    listenJobId,
    listenStarted: true,
  };

  it('is a kind with its input and output schemas and two stages', () => {
    expect(CLIP_JOB_KINDS).toContain('AUTO_EDIT');
    expect(CLIP_JOB_INPUT_SCHEMAS.AUTO_EDIT).toBe(autoEditInputSchema);
    expect(CLIP_JOB_OUTPUT_SCHEMAS.AUTO_EDIT).toBe(autoEditOutputSchema);
    expect(CLIP_JOB_STAGES.AUTO_EDIT).toEqual(['listening', 'applying']);
  });

  it('names its two steps in words', () => {
    expect(jobLabel('AUTO_EDIT', 'RUNNING', 'listening')).toBe('Listening to what is said');
    expect(jobLabel('AUTO_EDIT', 'RUNNING', 'applying')).toBe('Applying your recipe');
    expect(jobLabel('AUTO_EDIT', 'QUEUED', 'applying')).toBe(WAITING_LABEL);
  });

  it('takes a starter id or a uuid, a range, and an optional listen job', () => {
    expect(autoEditInputSchema.safeParse(base).success).toBe(true);
    expect(
      autoEditInputSchema.safeParse({ ...base, recipeId: '44444444-4444-4444-8444-444444444444' })
        .success,
    ).toBe(true);
    expect(
      autoEditInputSchema.safeParse({ ...base, listenJobId: null, listenStarted: false }).success,
    ).toBe(true);
  });

  it('refuses a made-up recipe id, a backwards range and unknown keys', () => {
    expect(autoEditInputSchema.safeParse({ ...base, recipeId: 'starter-nope' }).success).toBe(
      false,
    );
    expect(
      autoEditInputSchema.safeParse({ ...base, range: { fromMs: 10, toMs: 10 } }).success,
    ).toBe(false);
    expect(autoEditInputSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it('reads its output: the clip, the parts skipped and whether anyone spoke', () => {
    const output = {
      clipId,
      skipped: [{ part: 'captions', reason: 'no_speech' }],
      noSpeech: true,
    };
    expect(autoEditOutputSchema.parse(output)).toEqual(output);
    expect(
      autoEditOutputSchema.safeParse({ ...output, skipped: [{ part: 'x', reason: 'no_speech' }] })
        .success,
    ).toBe(false);
  });
});
