import {
  AUTOMATION_FAILURE_TYPES,
  AUTOMATION_RUN_WORKFLOW,
  AUTOMATION_STEP_RETRY_POLICY,
  AUTOMATION_STEP_TIMEOUTS,
  automationRunWorkflowId,
  automationStepRetryPolicy,
  NON_RETRYABLE_AUTOMATION_FAILURES,
  REVIEW_DECISION_SIGNAL,
  RUN_STOPPING_AUTOMATION_FAILURES,
} from './automations';
import { backoffAfterAttempt } from './retry-policy';
import { CANCEL_SIGNAL } from './workflows';

describe('automation run contract', () => {
  it('derives the workflow id from the run row', () => {
    expect(automationRunWorkflowId('run-1')).toBe('automation-run:run-1');
    expect(AUTOMATION_RUN_WORKFLOW).toBe('automationRunWorkflow');
  });

  it('keeps the review signal apart from cancel', () => {
    expect(REVIEW_DECISION_SIGNAL).toBe('reviewDecision');
    expect(REVIEW_DECISION_SIGNAL).not.toBe(CANCEL_SIGNAL);
  });

  it('retries only the retryable failure type', () => {
    const all = Object.values(AUTOMATION_FAILURE_TYPES);
    expect(new Set(all).size).toBe(all.length);
    expect(NON_RETRYABLE_AUTOMATION_FAILURES).not.toContain(AUTOMATION_FAILURE_TYPES.retryable);
    expect([...NON_RETRYABLE_AUTOMATION_FAILURES].sort()).toEqual(
      all.filter((type) => type !== AUTOMATION_FAILURE_TYPES.retryable).sort(),
    );
  });

  it('stops the run on missing connections and credits only', () => {
    expect([...RUN_STOPPING_AUTOMATION_FAILURES].sort()).toEqual(
      [AUTOMATION_FAILURE_TYPES.notConnected, AUTOMATION_FAILURE_TYPES.outOfCredits].sort(),
    );
  });

  it('waits 5 s, 15 s, 45 s between transient attempts', () => {
    expect(AUTOMATION_STEP_RETRY_POLICY).toEqual({
      initialIntervalMs: 5_000,
      backoffCoefficient: 3,
      maximumIntervalMs: 300_000,
      maximumAttempts: 4,
    });
    expect(backoffAfterAttempt(1, AUTOMATION_STEP_RETRY_POLICY)).toBe(5_000);
    expect(backoffAfterAttempt(2, AUTOMATION_STEP_RETRY_POLICY)).toBe(15_000);
    expect(backoffAfterAttempt(3, AUTOMATION_STEP_RETRY_POLICY)).toBe(45_000);
    expect(backoffAfterAttempt(4, AUTOMATION_STEP_RETRY_POLICY)).toBeNull();
  });

  it('gives fast steps 30 s and slow steps 5 minutes with heartbeats', () => {
    expect(AUTOMATION_STEP_TIMEOUTS.fast.startToCloseMs).toBe(30_000);
    expect(AUTOMATION_STEP_TIMEOUTS.slow).toEqual({ startToCloseMs: 300_000, heartbeatMs: 30_000 });
  });
});

describe('automationStepRetryPolicy', () => {
  it('runs a no-retry step once', () => {
    expect(automationStepRetryPolicy('none').maximumAttempts).toBe(1);
  });

  it('adds own retries to a no-retry step, evenly spaced', () => {
    expect(automationStepRetryPolicy('none', { max: 2, waitSeconds: 30 })).toEqual({
      initialIntervalMs: 30_000,
      backoffCoefficient: 1,
      maximumIntervalMs: 30_000,
      maximumAttempts: 3,
    });
  });

  it('uses the transient policy, raised by own retries', () => {
    expect(automationStepRetryPolicy('transient')).toEqual(AUTOMATION_STEP_RETRY_POLICY);
    expect(automationStepRetryPolicy('safe', { max: 3, waitSeconds: 10 })).toEqual({
      ...AUTOMATION_STEP_RETRY_POLICY,
      initialIntervalMs: 10_000,
      maximumAttempts: 7,
    });
  });

  it('never sets the first wait above the cap (Temporal refuses that)', () => {
    const policy = automationStepRetryPolicy('transient', { max: 1, waitSeconds: 600 });
    expect(policy.initialIntervalMs).toBe(600_000);
    expect(policy.maximumIntervalMs).toBeGreaterThanOrEqual(policy.initialIntervalMs);
  });

  it('caps own retries at 5 extra attempts', () => {
    expect(
      automationStepRetryPolicy('transient', { max: 50, waitSeconds: 5 }).maximumAttempts,
    ).toBe(9);
    expect(automationStepRetryPolicy('none', { max: -1, waitSeconds: 5 }).maximumAttempts).toBe(1);
  });
});
