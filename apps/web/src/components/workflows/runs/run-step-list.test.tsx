import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { RunStep } from '@/types/workflows';
import { RETRY_OLD_VERSION, RETRY_PUBLISHING } from './retry-rules';
import { CUT_NOTE } from './run-detail-model';
import { type RunInfo, RunStepList } from './run-step-list';
import { makeStep } from './run-test-fixtures';

jest.mock('@/lib/workflows-api', () => ({ answerReview: jest.fn() }));

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});

const failedRun: RunInfo = { runId: 'run-1', status: 'FAILED', mode: 'LIVE', version: 3 };

function renderSteps(
  steps: RunStep[],
  options: { run?: RunInfo; activeVersion?: number | null; open?: string[] } = {},
) {
  const onRetry = jest.fn();
  const onToggle = jest.fn();
  render(
    <TooltipProvider>
      <RunStepList
        steps={steps}
        paint={Object.fromEntries(
          steps.map((step) => [
            step.nodeKey,
            {
              state: step.status === 'FAILED' ? 'failed' : 'succeeded',
              attempt: step.attempt,
              attempts: step.attempts,
              durationMs: step.durationMs,
              startedAt: step.startedAt,
              dryRun: false,
            },
          ]),
        )}
        nodes={[]}
        iconOf={() => null}
        run={options.run ?? failedRun}
        workflowName="Failed Post Alert"
        activeVersion={options.activeVersion ?? 3}
        open={new Set(options.open ?? steps.map((step) => step.nodeKey))}
        selectedKey={null}
        retryingKey={null}
        focusReviewKey={null}
        onToggle={onToggle}
        onRetry={onRetry}
        onReviewAnswered={() => undefined}
        rowRef={() => undefined}
      />
    </TooltipProvider>,
  );
  return { onRetry, onToggle };
}

const failedInApp = makeStep({
  nodeKey: 'notify',
  nodeType: 'notify.inApp',
  nodeName: 'Notify The Team',
  status: 'FAILED',
  attempts: 2,
  output: null,
  error: {
    message: 'The notice could not be saved. It was too long.',
    code: 'permanent',
    retryable: false,
  },
});

describe('RunStepList', () => {
  it('shows a failed step in one sentence, what to do, and Retry From Here', () => {
    const { onRetry } = renderSteps([failedInApp]);
    expect(screen.getByText('The notice could not be saved.')).toBeTruthy();
    expect(screen.getByText(/fix what it says/)).toBeTruthy();
    expect(screen.getByText('Failed after 2 attempts')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy Details' })).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry From Here' });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledWith('notify');
  });

  it('disables Retry From Here with the reason for a publishing step', () => {
    renderSteps([
      { ...failedInApp, nodeKey: 'publish', nodeType: 'postgear.publish', nodeName: 'Publish' },
    ]);
    expect(
      (screen.getByRole('button', { name: 'Retry From Here' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId('retry-reason').textContent).toBe(RETRY_PUBLISHING);
  });

  it('disables Retry From Here on a run of an older version', () => {
    renderSteps([failedInApp], { activeVersion: 4 });
    expect(
      (screen.getByRole('button', { name: 'Retry From Here' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId('retry-reason').textContent).toBe(RETRY_OLD_VERSION);
  });

  it('shows input and output, and says when data was cut', () => {
    renderSteps([makeStep({ truncated: true })]);
    const input = screen.getByRole('region', { name: 'Slack input' });
    expect(within(input).getByRole('heading', { name: 'Input' })).toBeTruthy();
    expect(within(input).getByText('Hello')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Output' })).toBeTruthy();
    expect(screen.getByText(CUT_NOTE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry From Here' })).toBeNull();
  });

  it('opens and closes a step from its row', () => {
    const { onToggle } = renderSteps([makeStep()], { open: [] });
    fireEvent.click(screen.getByRole('button', { name: /Slack/ }));
    expect(onToggle).toHaveBeenCalledWith('slack');
    expect(screen.queryByRole('heading', { name: 'Input' })).toBeNull();
  });
});
