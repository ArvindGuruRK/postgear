import {
  CLIP_EMOTE_STAGES,
  CLIP_EMOTE_WORKFLOW,
  CLIP_JOB_QUEUES,
  CLIP_JOB_TIMEOUTS_MS,
  CLIP_JOB_WORKFLOWS,
  CLIP_NON_RETRYABLE,
  clipStorageOverLine,
  MEDIA_TASK_QUEUE,
} from './clips';

describe('clipStorageOverLine (Module 19)', () => {
  it('rounds like the space meter beside it, so the two agree', () => {
    // 1,218,598,509 bytes: the meter reads "1.2 GB of 1 GB".
    expect(clipStorageOverLine(1.218598509, 1)).toBe(
      "Your videos use 1.2 GB, over your plan's 1 GB. Delete some, or upgrade, to bring in more.",
    );
  });

  it('rounds up only where plain rounding would hide the overrun', () => {
    expect(clipStorageOverLine(1.04, 1)).toContain('use 1.1 GB');
    expect(clipStorageOverLine(1.0001, 1)).toContain('use 1.1 GB');
  });

  it('uses whole gigabytes from 100 GB, like the meter', () => {
    expect(clipStorageOverLine(123.4, 100)).toContain("use 123 GB, over your plan's 100 GB");
    expect(clipStorageOverLine(100.2, 100)).toContain("use 101 GB, over your plan's 100 GB");
  });

  it('never prints a negative or broken number', () => {
    expect(clipStorageOverLine(Number.NaN, -1)).toContain("use 0 GB, over your plan's 0 GB");
  });
});

describe('the EMOTE kind (Module 14)', () => {
  it('runs clipEmoteWorkflow on the media queue within thirty minutes', () => {
    expect(CLIP_JOB_WORKFLOWS.EMOTE).toBe(CLIP_EMOTE_WORKFLOW);
    expect(CLIP_EMOTE_WORKFLOW).toBe('clipEmoteWorkflow');
    expect(CLIP_JOB_QUEUES.EMOTE).toBe(MEDIA_TASK_QUEUE);
    expect(CLIP_JOB_TIMEOUTS_MS.EMOTE).toBe(30 * 60_000);
    expect([...CLIP_EMOTE_STAGES]).toEqual(['fetching', 'encoding', 'finishing']);
  });

  it('never retries an emote that is too big, too long or out of range', () => {
    expect(CLIP_NON_RETRYABLE).toEqual(
      expect.arrayContaining(['emote_too_big', 'emote_too_long', 'emote_range_invalid']),
    );
  });
});
