import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render as renderPlain, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { graphOf, installFlowDom, line, runOf, step, stepRow } from './canvas-test-kit';
import { RunCanvas } from './run-canvas';

// Jest has no stylesheet transform; the canvas's CSS does not matter here.
jest.mock('./workflow-canvas.css', () => ({}));

installFlowDom();

/** The classes on an element (a card, a line), for plain Jest matchers. */
function classOf(element: Element | null | undefined): string[] {
  return element ? [...element.classList] : [];
}

function render(ui: ReactElement) {
  return renderPlain(ui, { wrapper: TooltipProvider });
}

const graph = graphOf(
  [
    step('t', 'trigger.manual', { name: 'Start', position: { x: 0, y: 0 } }),
    step('a', 'notify.slack', { name: 'Slack', position: { x: 320, y: 0 } }),
    step('b', 'logic.setFields', { name: 'Set Fields', position: { x: 640, y: 0 } }),
  ],
  [line('t', 'a'), line('a', 'b')],
);

const run = runOf(
  graph,
  [
    stepRow('t', 'SUCCEEDED', { durationMs: 12 }),
    stepRow('a', 'DRY_RUN', { durationMs: 1200 }),
    stepRow('b', 'FAILED', {
      durationMs: 40,
      error: { message: 'The field list is empty.', code: 'EMPTY', retryable: false },
    }),
  ],
  { status: 'FAILED', finishedAt: '2026-10-29T14:02:03.000Z' },
);

function badgeStates(): (string | null)[] {
  return screen.getAllByTestId('run-badge').map((badge) => badge.getAttribute('data-state'));
}

describe('RunCanvas', () => {
  it('renders without a builder provider, and edits nothing', () => {
    render(<RunCanvas graph={graph} run={null} catalog={null} />);
    expect(screen.getByTestId('run-canvas')).toBeTruthy();
    expect(screen.getByText('Slack')).toBeTruthy();
    expect(screen.queryAllByTestId('run-badge')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Add a step/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
    fireEvent.mouseEnter(screen.getByText('Slack'));
    expect(screen.queryByRole('button', { name: 'Test Slack' })).toBeNull();
  });

  it('paints the run on its cards', () => {
    render(<RunCanvas graph={graph} run={run} catalog={null} />);
    expect(badgeStates()).toEqual(['succeeded', 'dryRun', 'failed']);
    expect(screen.getByText('Dry Run, 1.2 s')).toBeTruthy();
    expect(screen.getByText('Failed, 40 ms')).toBeTruthy();
    // A failed card says why in place of its summary.
    expect(screen.getByText('The field list is empty.')).toBeTruthy();
  });

  it('selects a step from its card or its badge', () => {
    const onSelectStep = jest.fn();
    render(<RunCanvas graph={graph} run={run} catalog={null} onSelectStep={onSelectStep} />);
    fireEvent.click(screen.getByText('Set Fields'));
    expect(onSelectStep).toHaveBeenLastCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: /^Slack: Dry Run, 1\.2 s\./ }));
    expect(onSelectStep).toHaveBeenLastCalledWith('a');
    expect(onSelectStep).toHaveBeenCalledTimes(2);
  });

  it('rings the selected step', () => {
    render(<RunCanvas graph={graph} run={run} catalog={null} selectedKey="a" />);
    const card = screen.getByText('Slack').closest('.pg-step-card');
    expect(classOf(card)).toEqual(expect.arrayContaining(['outline-focusRing']));
    expect(classOf(screen.getByText('Set Fields').closest('.pg-step-card'))).not.toEqual(
      expect.arrayContaining(['outline-focusRing']),
    );
  });
});
