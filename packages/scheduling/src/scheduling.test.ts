import { parsePublishStatus, serializePublishStatus } from './publish-status';
import { backoffAfterAttempt, PUBLISH_RETRY_POLICY } from './retry-policy';
import { publishWorkflowId, tokenRefreshWorkflowId } from './workflows';

describe('retry policy', () => {
  it('doubles from 30 seconds and stops after the last attempt', () => {
    expect(backoffAfterAttempt(1)).toBe(30_000);
    expect(backoffAfterAttempt(2)).toBe(60_000);
    expect(backoffAfterAttempt(3)).toBe(120_000);
    expect(backoffAfterAttempt(4)).toBe(240_000);
    expect(backoffAfterAttempt(PUBLISH_RETRY_POLICY.maximumAttempts)).toBeNull();
    expect(backoffAfterAttempt(0)).toBeNull();
  });

  it('caps at the maximum interval', () => {
    expect(
      backoffAfterAttempt(8, {
        initialIntervalMs: 1_000,
        backoffCoefficient: 10,
        maximumIntervalMs: 5_000,
        maximumAttempts: 20,
      }),
    ).toBe(5_000);
  });
});

describe('publish status', () => {
  it('round-trips a retrying status', () => {
    const status = {
      kind: 'retrying' as const,
      attempt: 2,
      maxAttempts: 5,
      nextAttemptAt: '2026-10-11T10:32:00.000Z',
      message: 'X is temporarily unavailable.',
      updatedAt: '2026-10-11T10:31:00.000Z',
    };

    expect(parsePublishStatus(serializePublishStatus(status))).toEqual(status);
  });

  it('round-trips a failure and defaults an unknown reason', () => {
    const parsed = parsePublishStatus(
      JSON.stringify({ kind: 'failed', reason: 'made_up', message: 'Nope', attempts: 3 }),
    );

    expect(parsed).toMatchObject({ kind: 'failed', reason: 'unexpected', attempts: 3 });
  });

  it('round-trips the in-flight marker', () => {
    const status = {
      kind: 'in_flight' as const,
      attempt: 1,
      startedAt: '2026-10-11T10:00:00.000Z',
    };
    expect(parsePublishStatus(serializePublishStatus(status))).toEqual(status);
  });

  it('reads legacy plain text as a failure message', () => {
    expect(parsePublishStatus('Unauthorized')).toMatchObject({
      kind: 'failed',
      message: 'Unauthorized',
    });
    expect(parsePublishStatus('{"not":"a status"}')).toMatchObject({ kind: 'failed' });
    expect(parsePublishStatus(null)).toBeNull();
    expect(parsePublishStatus('')).toBeNull();
  });
});

describe('workflow ids', () => {
  it('derive deterministically from the row id', () => {
    expect(publishWorkflowId('abc')).toBe('post-publish:abc');
    expect(tokenRefreshWorkflowId('ch1')).toBe('token-refresh:ch1');
  });
});
