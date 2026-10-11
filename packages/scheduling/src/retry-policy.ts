/**
 * The publish retry policy, as data.
 *
 * Temporal applies it (the workflow hands these values to `proxyActivities`),
 * but two other places need the same numbers: the activity, which writes "retry
 * 2 of 5 at 10:32" into the post's status so the queue can show it, and the
 * API's status endpoint, which describes the policy to the UI. One definition,
 * three readers.
 *
 * The values: 30 s, 1 min, 2 min, 4 min between the five attempts — about eight
 * minutes end to end. Long enough to ride out a rate-limit window or a platform
 * having a bad minute; short enough that a post scheduled for 9:00 that fails
 * at 9:00 is either out or flagged by 9:10, while the person who scheduled it
 * is still around. `SocialAbstract.fetch` has already made three quick retries
 * inside each attempt by the time one of these fires.
 */
export interface RetryPolicyValues {
  initialIntervalMs: number;
  backoffCoefficient: number;
  maximumIntervalMs: number;
  maximumAttempts: number;
}

export const PUBLISH_RETRY_POLICY: RetryPolicyValues = {
  initialIntervalMs: 30_000,
  backoffCoefficient: 2,
  maximumIntervalMs: 10 * 60_000,
  maximumAttempts: 5,
};

/**
 * How long Temporal waits after a failed attempt before the next one.
 *
 * `attempt` is 1-based, as in `Context.current().info.attempt`. Returns null
 * when there is no next attempt. Temporal adds no jitter to activity retries,
 * so this is exact rather than approximate.
 */
export function backoffAfterAttempt(
  attempt: number,
  policy: RetryPolicyValues = PUBLISH_RETRY_POLICY,
): number | null {
  if (attempt < 1 || attempt >= policy.maximumAttempts) {
    return null;
  }

  return Math.min(
    policy.initialIntervalMs * policy.backoffCoefficient ** (attempt - 1),
    policy.maximumIntervalMs,
  );
}
