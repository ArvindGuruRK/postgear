import { copyDetailsText, failureNextStep, oneSentence } from './copy-details';
import { makeStep } from './run-test-fixtures';

describe('copyDetailsText', () => {
  it('puts the workflow, run, step, error code and time on their own lines', () => {
    const text = copyDetailsText({
      workflowName: 'Failed Post Alert',
      runId: 'run-42',
      step: makeStep({
        status: 'FAILED',
        attempts: 3,
        error: {
          message: 'Slack did not accept the link.',
          code: 'not_connected',
          retryable: false,
        },
        finishedAt: '2026-10-29T14:02:11.000Z',
      }),
    });
    expect(text).toBe(
      [
        'Workflow: Failed Post Alert',
        'Run: run-42',
        'Step: Slack (slack)',
        'Error code: not_connected',
        'Time: 2026-10-29T14:02:11.000Z',
        'Attempts: 3',
        'Message: Slack did not accept the link.',
      ].join('\n'),
    );
  });

  it('falls back to the last update time and says when there is no code', () => {
    const text = copyDetailsText({
      workflowName: 'Report',
      runId: 'run-1',
      step: makeStep({ finishedAt: null, updatedAt: '2026-10-29T10:00:00.000Z', error: null }),
    });
    expect(text).toContain('Time: 2026-10-29T10:00:00.000Z');
    expect(text).toContain('Error code: none');
  });
});

describe('failureNextStep', () => {
  it('says what to do for the known codes', () => {
    expect(failureNextStep({ code: 'not_connected', retryable: false })).toMatch(/Connections/);
    expect(failureNextStep({ code: 'out_of_credits', retryable: false })).toMatch(/credits/);
    expect(failureNextStep({ code: 'some_api_code', retryable: true })).toMatch(/temporary/);
    expect(failureNextStep({ code: 'some_api_code', retryable: false })).toMatch(/Editor/);
    expect(failureNextStep(null)).toMatch(/Editor/);
  });
});

describe('oneSentence', () => {
  it('keeps the first sentence only', () => {
    expect(oneSentence('Slack refused it. It said 403. Try later.')).toBe('Slack refused it.');
    expect(oneSentence('No full stop')).toBe('No full stop');
    expect(oneSentence('Version 1.2 failed.')).toBe('Version 1.2 failed.');
  });
});
