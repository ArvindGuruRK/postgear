import type { AutomationGraph } from '@postgear/automation';
import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { AutomationStepStatus, RunStep } from '@/types/workflows';
import { type BuilderApi, BuilderProvider } from '../builder/builder-context';
import { EMPTY_SELECTION } from '../builder/builder-state';
import type { RunModel } from '../runs/run-model';
import { graphOf, installFlowDom, line, runOf, step, stepRow } from './canvas-test-kit';
import { WorkflowCanvas } from './workflow-canvas';

// Jest has no stylesheet transform; the canvas's CSS does not matter here.
jest.mock('./workflow-canvas.css', () => ({}));

installFlowDom();

/** The classes on an element (a card, a line), for plain Jest matchers. */
function classOf(element: Element | null | undefined): string[] {
  return element ? [...element.classList] : [];
}

function fakeBuilder(graph: AutomationGraph, extra: Partial<BuilderApi> = {}): BuilderApi {
  return {
    dispatch: jest.fn(),
    graphRef: { current: graph },
    locked: false,
    open: jest.fn(),
    expand: jest.fn(),
    pinned: new Set(),
    rename: jest.fn(),
    pickFrom: jest.fn(),
    pickOnEdge: jest.fn(),
    remove: jest.fn(),
    duplicate: jest.fn(),
    copy: jest.fn(),
    contextMenu: jest.fn(),
    ...extra,
  };
}

function renderCanvas(
  graph: AutomationGraph,
  options: {
    run?: RunModel | null;
    builder?: Partial<BuilderApi>;
    onRunBadgeClick?: (key: string) => void;
  } = {},
) {
  return render(
    <TooltipProvider>
      <BuilderProvider value={fakeBuilder(graph, options.builder)}>
        <ReactFlowProvider>
          <WorkflowCanvas
            graph={graph}
            selection={EMPTY_SELECTION}
            issues={new Map()}
            summary={{}}
            tidying={false}
            onConnectRefused={jest.fn()}
            onDropStep={jest.fn()}
            onPaneClick={jest.fn()}
            run={options.run}
            onRunBadgeClick={options.onRunBadgeClick}
          />
        </ReactFlowProvider>
      </BuilderProvider>
    </TooltipProvider>,
  );
}

/** One step per state, in a row. */
const STATES: [string, AutomationStepStatus, Partial<RunStep>][] = [
  ['q', 'QUEUED', {}],
  ['r', 'RUNNING', {}],
  ['w', 'WAITING', {}],
  ['s', 'SUCCEEDED', { durationMs: 1200 }],
  ['retried', 'SUCCEEDED', { durationMs: 3100, attempt: 2, attempts: 2 }],
  ['d', 'DRY_RUN', { durationMs: 300 }],
  ['h', 'HANDLED_ERROR', { durationMs: 50, ports: ['error'] }],
  ['f', 'FAILED', { durationMs: 40 }],
  ['k', 'SKIPPED', {}],
  ['c', 'CANCELLED', {}],
];

const wide = graphOf(
  STATES.map(([key], index) =>
    step(key, 'logic.setFields', { name: `Step ${key}`, position: { x: index * 300, y: 0 } }),
  ),
);
const paintedWide = runOf(
  wide,
  STATES.map(([key, status, extra]) => stepRow(key, status, extra)),
);

/** A step card's root (the box that hears hover and holds the stickers). */
function card(name: string): HTMLElement {
  const box = screen.getByText(name).closest('.pg-step-card')?.parentElement;
  if (!box) throw new Error(`No card for ${name}`);
  return box;
}

describe('WorkflowCanvas painting', () => {
  it('paints nothing without a run', () => {
    renderCanvas(wide, { run: null });
    expect(screen.queryAllByTestId('run-badge')).toHaveLength(0);
    expect(document.querySelector('[data-run-state]')).toBeNull();
  });

  it.each([
    ['q', 'queued', 'Queued'],
    ['r', 'running', 'Running'],
    ['w', 'waiting', 'Waiting For Review'],
    ['s', 'succeeded', 'Succeeded, 1.2 s'],
    ['retried', 'succeeded', 'Succeeded after 2 attempts, 3.1 s'],
    ['d', 'dryRun', 'Dry Run, 300 ms'],
    ['h', 'handled', 'Error Handled, 50 ms'],
    ['f', 'failed', 'Failed, 40 ms'],
    ['k', 'skipped', 'Skipped'],
    ['c', 'cancelled', 'Cancelled'],
  ])('step %s reads %s as "%s"', (key, state, words) => {
    renderCanvas(wide, { run: paintedWide });
    const box = card(`Step ${key}`);
    expect(box.getAttribute('data-run-state')).toBe(state);
    const badge = within(box).getByTestId('run-badge');
    expect(badge.getAttribute('data-state')).toBe(state);
    expect(badge.textContent).toContain(words);
  });

  it('styles each state on the card', () => {
    renderCanvas(wide, { run: paintedWide });
    const box = (key: string) => card(`Step ${key}`).querySelector('.pg-step-card');
    expect(classOf(box('q'))).toEqual(expect.arrayContaining(['border-dashed']));
    expect(classOf(box('f'))).toEqual(expect.arrayContaining(['border-actionDanger']));
    expect(classOf(box('k'))).toEqual(expect.arrayContaining(['opacity-40']));
    expect(within(card('Step r')).getByTestId('run-ring')).toBeTruthy();
    expect(card('Step r').querySelector('.pg-run-pulse')).not.toBeNull();
    expect(card('Step w').querySelector('.pg-run-waiting')).not.toBeNull();
    expect(card('Step s').querySelector('.pg-run-waiting, .pg-run-pulse')).toBeNull();
  });

  it('opens the step on that run from its badge', () => {
    const onRunBadgeClick = jest.fn();
    renderCanvas(wide, { run: paintedWide, onRunBadgeClick });
    fireEvent.click(
      screen.getByRole('button', { name: "Step f: Failed, 40 ms. Open this step's run data." }),
    );
    expect(onRunBadgeClick).toHaveBeenCalledWith('f');
  });
});

describe('Live In Tests and Test Step', () => {
  const graph = graphOf(
    [
      step('t', 'trigger.manual', { name: 'Start', position: { x: 0, y: 0 } }),
      step('a', 'notify.slack', { name: 'Slack', position: { x: 320, y: 0 } }),
      step('b', 'notify.inApp', { name: 'Bell', position: { x: 640, y: 0 } }),
    ],
    [line('t', 'a'), line('a', 'b')],
  );

  it('puts the red sticker on steps tests send for real, and only those', () => {
    renderCanvas(graph, { builder: { liveInTests: new Set(['a']) } });
    const stickers = screen.getAllByTestId('live-in-tests');
    expect(stickers).toHaveLength(1);
    expect(stickers[0].textContent).toContain('Live In Tests');
    expect(within(card('Slack')).getByTestId('live-in-tests')).toBeTruthy();
  });

  it('tests a step from the hover toolbar', () => {
    const testStep = jest.fn();
    renderCanvas(graph, { builder: { testStep } });
    fireEvent.mouseEnter(card('Slack'));
    fireEvent.click(screen.getByRole('button', { name: 'Test Slack' }));
    expect(testStep).toHaveBeenCalledWith('a');
  });

  it('offers no Test Step when the builder cannot test', () => {
    renderCanvas(graph);
    fireEvent.mouseEnter(card('Slack'));
    expect(screen.getByRole('button', { name: 'Delete Slack' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Test Slack' })).toBeNull();
  });
});

describe('lines', () => {
  const graph = graphOf(
    [
      step('t', 'trigger.manual', { name: 'Start', position: { x: 0, y: 0 } }),
      step('check', 'logic.ifElse', { name: 'Check', position: { x: 320, y: 0 } }),
      step('a', 'notify.slack', { name: 'Slack', position: { x: 640, y: -120 } }),
      step('b', 'notify.inApp', { name: 'Bell', position: { x: 640, y: 120 } }),
      step('c', 'logic.setFields', { name: 'Set Fields', position: { x: 960, y: -120 } }),
    ],
    [line('t', 'check'), line('check', 'a', 'true'), line('check', 'b', 'false'), line('a', 'c')],
  );
  const run = runOf(graph, [
    stepRow('t', 'SUCCEEDED'),
    stepRow('check', 'SUCCEEDED', { ports: ['true'] }),
    stepRow('a', 'SUCCEEDED'),
    stepRow('b', 'SKIPPED'),
    stepRow('c', 'RUNNING'),
  ]);

  function edge(id: string): Element {
    const found = document.querySelector(`[data-id="${id}"]`);
    if (!found) throw new Error(`No line ${id}`);
    return found;
  }

  it('draws taken, skipped and flowing lines from the model', () => {
    renderCanvas(graph, { run });
    const taken = edge('check:true->a').querySelector('.pg-edge-path');
    expect(classOf(taken)).toEqual(expect.arrayContaining(['pg-edge-taken', 'stroke-successInk']));
    expect(taken?.getAttribute('marker-end')).toMatch(/-taken\)$/);

    const skipped = edge('check:false->b');
    expect(classOf(skipped.querySelector('.pg-edge-path'))).toEqual(
      expect.arrayContaining(['pg-edge-skipped']),
    );
    expect(classOf(skipped.querySelector('g'))).toEqual(expect.arrayContaining(['opacity-35']));

    // The line into the running step: React Flow's animated class.
    expect(classOf(edge('a:out->c'))).toEqual(expect.arrayContaining(['animated']));
    expect(classOf(edge('t:out->check'))).not.toEqual(expect.arrayContaining(['animated']));
  });

  it('keeps plain lines and their midpoint "+" without a run', () => {
    renderCanvas(graph, { run: null });
    const path = edge('t:out->check').querySelector('.pg-edge-path');
    expect(classOf(path)).toEqual(expect.arrayContaining(['stroke-ink']));
    expect(classOf(path)).not.toEqual(expect.arrayContaining(['pg-edge-taken']));
    fireEvent.mouseEnter(edge('t:out->check').querySelector('g') as Element);
    expect(screen.getByRole('button', { name: 'Add a step here' })).toBeTruthy();
  });
});
