/**
 * The pure helpers of the run workflow: which activity options a step gets
 * from its definition and its On Error retries, and how a step's final
 * failure is read. Plain Jest; no Temporal server.
 */
import { getDefinition, type NodeType } from '@postgear/automation';
import {
  AUTOMATION_FAILURE_TYPES,
  AUTOMATION_STEP_RETRY_POLICY,
  AUTOMATION_STEP_TIMEOUTS,
  NON_RETRYABLE_AUTOMATION_FAILURES,
} from '@postgear/scheduling';
import {
  ActivityFailure,
  ApplicationFailure,
  RetryState,
  TimeoutFailure,
  TimeoutType,
} from '@temporalio/common';
import {
  BOOKKEEPING_ACTIVITY_OPTIONS,
  classifyStepFailure,
  STEP_TIMED_OUT_MESSAGE,
  STEP_UNEXPECTED_MESSAGE,
  stepActivityOptions,
} from './automation-run.options';

function def(type: NodeType) {
  const found = getDefinition(type);
  if (!found) throw new Error(`No definition for ${type}`);
  return found;
}

describe('stepActivityOptions', () => {
  it('gives a fast step with retry none one attempt of 30 seconds', () => {
    expect(stepActivityOptions(def('trigger.manual'), {})).toEqual({
      startToCloseTimeout: AUTOMATION_STEP_TIMEOUTS.fast.startToCloseMs,
      retry: {
        initialInterval: AUTOMATION_STEP_RETRY_POLICY.initialIntervalMs,
        backoffCoefficient: 1,
        maximumInterval: AUTOMATION_STEP_RETRY_POLICY.initialIntervalMs,
        maximumAttempts: 1,
        nonRetryableErrorTypes: NON_RETRYABLE_AUTOMATION_FAILURES,
      },
    });
  });

  it('gives a slow step 5 minutes, a 30 second heartbeat and the transient policy', () => {
    expect(stepActivityOptions(def('ai.generateText'), {})).toEqual({
      startToCloseTimeout: AUTOMATION_STEP_TIMEOUTS.slow.startToCloseMs,
      heartbeatTimeout: AUTOMATION_STEP_TIMEOUTS.slow.heartbeatMs,
      retry: {
        initialInterval: AUTOMATION_STEP_RETRY_POLICY.initialIntervalMs,
        backoffCoefficient: AUTOMATION_STEP_RETRY_POLICY.backoffCoefficient,
        maximumInterval: AUTOMATION_STEP_RETRY_POLICY.maximumIntervalMs,
        maximumAttempts: AUTOMATION_STEP_RETRY_POLICY.maximumAttempts,
        nonRetryableErrorTypes: NON_RETRYABLE_AUTOMATION_FAILURES,
      },
    });
  });

  it('adds a step’s own retries on top of the transient ones, with their wait first', () => {
    const options = stepActivityOptions(def('notify.slack'), {
      onError: { mode: 'continue', retries: { max: 2, waitSeconds: 20 } },
    });

    expect(options.heartbeatTimeout).toBeUndefined();
    expect(options.retry).toMatchObject({
      initialInterval: 20_000,
      maximumAttempts: AUTOMATION_STEP_RETRY_POLICY.maximumAttempts + 2,
    });
  });

  it('raises the interval cap to meet a long own wait (Temporal refuses a cap below it)', () => {
    const options = stepActivityOptions(def('notify.slack'), {
      onError: { mode: 'stop', retries: { max: 1, waitSeconds: 600 } },
    });

    expect(options.retry?.initialInterval).toBe(600_000);
    expect(options.retry?.maximumInterval).toBe(600_000);
  });

  it('gives a retry none step that handles errors its own retries only', () => {
    const options = stepActivityOptions(def('logic.delay'), {
      onError: { mode: 'continue', retries: { max: 2, waitSeconds: 30 } },
    });

    expect(options.retry).toMatchObject({
      initialInterval: 30_000,
      maximumInterval: 30_000,
      backoffCoefficient: 1,
      maximumAttempts: 3,
    });
  });

  it('ignores On Error retries on a step that cannot handle errors', () => {
    const options = stepActivityOptions(def('trigger.manual'), {
      onError: { mode: 'continue', retries: { max: 3, waitSeconds: 10 } },
    });

    expect(options.retry?.maximumAttempts).toBe(1);
  });

  it('runs an unknown step type fast, once', () => {
    const options = stepActivityOptions(undefined, {
      onError: { mode: 'stop', retries: { max: 5, waitSeconds: 10 } },
    });

    expect(options.startToCloseTimeout).toBe(AUTOMATION_STEP_TIMEOUTS.fast.startToCloseMs);
    expect(options.retry?.maximumAttempts).toBe(1);
  });

  it('never retries a final failure, own retries or not', () => {
    const final = Object.values(AUTOMATION_FAILURE_TYPES).filter(
      (type) => type !== AUTOMATION_FAILURE_TYPES.retryable,
    );

    expect(stepActivityOptions(def('notify.slack'), {}).retry?.nonRetryableErrorTypes).toEqual(
      final,
    );
    expect(BOOKKEEPING_ACTIVITY_OPTIONS.retry?.nonRetryableErrorTypes).toEqual(final);
  });
});

describe('classifyStepFailure', () => {
  const failed = (cause: Error) =>
    new ActivityFailure(
      'Activity task failed',
      'executeNodeActivity',
      '1',
      RetryState.NON_RETRYABLE_FAILURE,
      'worker',
      cause,
    );
  const typed = (type: string, message: string) =>
    failed(ApplicationFailure.create({ type, message, nonRetryable: true }));

  it('passes a permanent failure through with its sentence', () => {
    expect(
      classifyStepFailure(typed(AUTOMATION_FAILURE_TYPES.permanent, 'Slack said no.')),
    ).toEqual({
      failureType: AUTOMATION_FAILURE_TYPES.permanent,
      message: 'Slack said no.',
      timedOut: false,
      stopsRun: false,
    });
  });

  it('reads retries that ran out as the retryable type, not a run stopper', () => {
    expect(
      classifyStepFailure(typed(AUTOMATION_FAILURE_TYPES.retryable, 'Slack did not answer.')),
    ).toMatchObject({ failureType: AUTOMATION_FAILURE_TYPES.retryable, stopsRun: false });
  });

  it.each([AUTOMATION_FAILURE_TYPES.notConnected, AUTOMATION_FAILURE_TYPES.outOfCredits])(
    'says %s stops the run',
    (type) => {
      expect(classifyStepFailure(typed(type, 'Connect Slack again.'))).toMatchObject({
        failureType: type,
        stopsRun: true,
      });
    },
  );

  it('reads a timeout as timed out, with no failure type', () => {
    const timeout = new TimeoutFailure(undefined, undefined, TimeoutType.START_TO_CLOSE);

    expect(classifyStepFailure(failed(timeout))).toEqual({
      failureType: null,
      message: STEP_TIMED_OUT_MESSAGE,
      timedOut: true,
      stopsRun: false,
    });
  });

  it('hides an untyped error behind a plain sentence', () => {
    const bug = failed(ApplicationFailure.create({ type: 'TypeError', message: 'x is undefined' }));

    expect(classifyStepFailure(bug)).toEqual({
      failureType: null,
      message: STEP_UNEXPECTED_MESSAGE,
      timedOut: false,
      stopsRun: false,
    });
    expect(classifyStepFailure(new Error('boom')).message).toBe(STEP_UNEXPECTED_MESSAGE);
  });

  it('gives a typed failure without a message the plain sentence', () => {
    expect(classifyStepFailure(typed(AUTOMATION_FAILURE_TYPES.permanent, '')).message).toBe(
      STEP_UNEXPECTED_MESSAGE,
    );
  });
});
