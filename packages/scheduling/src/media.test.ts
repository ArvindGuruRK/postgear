import { MEDIA_TASK_QUEUE } from './clips';
import {
  MEDIA_POSTER_AT_MS,
  MEDIA_VIDEO_FACTS_BATCH,
  MEDIA_VIDEO_FACTS_RETRY_POLICY,
  MEDIA_VIDEO_FACTS_TASK_QUEUE,
  MEDIA_VIDEO_FACTS_WORKFLOW,
  mediaPosterTimeMs,
  mediaVideoFactsWorkflowId,
} from './media';
import { backoffAfterAttempt } from './retry-policy';

describe('media video facts contract', () => {
  it('runs on the media queue, never the publishing one', () => {
    expect(MEDIA_VIDEO_FACTS_TASK_QUEUE).toBe(MEDIA_TASK_QUEUE);
    expect(MEDIA_VIDEO_FACTS_WORKFLOW).toBe('mediaVideoFactsWorkflow');
  });

  it('derives one workflow id per Media row', () => {
    expect(mediaVideoFactsWorkflowId('m-1')).toBe('media-video-facts:m-1');
    expect(mediaVideoFactsWorkflowId('m-1')).toBe(mediaVideoFactsWorkflowId('m-1'));
    expect(mediaVideoFactsWorkflowId('m-1')).not.toBe(mediaVideoFactsWorkflowId('m-2'));
  });

  it('takes the poster one second in, or the first frame of a shorter video', () => {
    expect(mediaPosterTimeMs(42_000)).toBe(MEDIA_POSTER_AT_MS);
    expect(mediaPosterTimeMs(1_001)).toBe(1_000);
    expect(mediaPosterTimeMs(1_000)).toBe(0);
    expect(mediaPosterTimeMs(400)).toBe(0);
    expect(mediaPosterTimeMs(Number.NaN)).toBe(0);
  });

  it('tries twice, half a minute apart, and backfills twenty a pass', () => {
    expect(MEDIA_VIDEO_FACTS_RETRY_POLICY.maximumAttempts).toBe(2);
    expect(backoffAfterAttempt(1, MEDIA_VIDEO_FACTS_RETRY_POLICY)).toBe(30_000);
    expect(backoffAfterAttempt(2, MEDIA_VIDEO_FACTS_RETRY_POLICY)).toBeNull();
    expect(MEDIA_VIDEO_FACTS_BATCH).toBe(20);
  });
});
