import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { graphOf, installMatchMedia, runOf, step, stepRow } from '../canvas/canvas-test-kit';
import { RunBar, type RunBarProps, runBarSummary, settledSteps, waitingStep } from './run-bar';
import type { RunModel } from './run-model';

installMatchMedia();

/** The classes on an element (a card, a line), for plain Jest matchers. */
function classOf(element: Element | null | undefined): string[] {
  return element ? [...element.classList] : [];
}

// 14:02 local time, so the clock reads 14:02 in any time zone.
const START = new Date(2026, 9, 29, 14, 2, 0).toISOString();
const at = (ms: number) => new Date(Date.parse(START) + ms).toISOString();

const graph = graphOf([
  step('t', 'trigger.manual'),
  step('a', 'logic.setFields'),
  step('review', 'logic.manualReview'),
  step('b', 'notify.inApp'),
]);

function model(overrides: Parameters<typeof runOf>[2] = {}, steps = defaultSteps()): RunModel {
  return runOf(graph, steps, { startedAt: START, ...overrides });
}

function defaultSteps() {
  return [stepRow('t', 'SUCCEEDED'), stepRow('a', 'SKIPPED'), stepRow('review', 'RUNNING')];
}

function renderBar(props: Partial<RunBarProps> & { run: RunModel }) {
  const handlers = { onStop: jest.fn(), onClose: jest.fn(), onOpenReview: jest.fn() };
  render(
    <TooltipProvider>
      <RunBar totalSteps={4} stopping={false} {...handlers} {...props} />
    </TooltipProvider>,
  );
  return handlers;
}

describe('runBarSummary', () => {
  it('reads "Test run 14:02, 2 of 4 steps, 3.1 s"', () => {
    const run = model();
    expect(settledSteps(run)).toBe(2);
    expect(runBarSummary(run, 4, Date.parse(START) + 3100)).toBe(
      'Test run 14:02, 2 of 4 steps, 3.1 s',
    );
  });

  it('says Live run for a live one and stops the clock when it ended', () => {
    const run = model({ mode: 'LIVE', status: 'SUCCEEDED', finishedAt: at(65_000) });
    expect(runBarSummary(run, 4, Date.parse(START) + 999_999)).toBe(
      'Live run 14:02, 2 of 4 steps, 1 min 5 s',
    );
  });

  it('leaves out the time and duration before the run starts', () => {
    const run = model({ startedAt: null, status: 'QUEUED' }, []);
    expect(runBarSummary(run, 1, Date.now())).toBe('Test run, 0 of 1 step');
  });
});

describe('RunBar', () => {
  it('shows the summary, the status in words and Stop while it runs', () => {
    const { onStop } = renderBar({ run: model() });
    expect(screen.getByTestId('run-bar-summary').textContent).toMatch(
      /^Test run 14:02, 2 of 4 steps, /,
    );
    expect(screen.getByRole('status').textContent).toContain('Running');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('is busy while stopping', () => {
    renderBar({ run: model(), stopping: true });
    const stop = screen.getByRole('button', { name: 'Stopping' });
    expect((stop as HTMLButtonElement).disabled).toBe(true);
    expect(stop.getAttribute('aria-busy')).toBe('true');
  });

  it('offers Close once the run ended, and no Stop', () => {
    const { onClose } = renderBar({
      run: model({ status: 'SUCCEEDED', finishedAt: at(3100) }),
    });
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens the waiting review', () => {
    const steps = [stepRow('t', 'SUCCEEDED'), stepRow('review', 'WAITING')];
    const run = model({ status: 'WAITING' }, steps);
    expect(waitingStep(run)).toBe('review');
    const { onOpenReview } = renderBar({ run });
    expect(screen.getByRole('status').textContent).toContain('Waiting For Review');
    fireEvent.click(screen.getByRole('button', { name: 'Open Review' }));
    expect(onOpenReview).toHaveBeenCalledWith('review');
  });

  it('has no Open Review when nothing waits', () => {
    renderBar({ run: model() });
    expect(screen.queryByRole('button', { name: 'Open Review' })).toBeNull();
  });

  it.each([
    ['REJECTED', 'Rejected'],
    ['EXPIRED', 'Review Expired'],
    ['CANCELLED', 'Cancelled'],
  ] as const)('reads %s as a neutral "%s", never red', (status, label) => {
    renderBar({ run: model({ status, finishedAt: at(1000) }) });
    const sticker = screen.getByText(label);
    expect(sticker.getAttribute('data-tone')).toBe('neutral');
    expect(classOf(sticker)).not.toEqual(expect.arrayContaining(['bg-actionDanger']));
  });

  it('reads a failure red, with its sentence', () => {
    renderBar({
      run: model({ status: 'FAILED', finishedAt: at(1000), error: 'Slack did not answer.' }),
    });
    expect(classOf(screen.getByText('Failed'))).toEqual(
      expect.arrayContaining(['bg-actionDanger']),
    );
    expect(screen.getByText('Slack did not answer.')).toBeTruthy();
  });
});
