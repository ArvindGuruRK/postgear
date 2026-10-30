/**
 * The run model against recorded event sequences (Module 08): the five the
 * module names (linear success, If / Else false path, failure with
 * continue, review wait then approve, cancel), replays of older rows, the
 * taken, skipped and active lines, and the badge words.
 */
import { type AutomationGraph, edgeId, type PortId } from '@postgear/automation';
import type { AutomationStepStatus, RunDetail, RunEvent, RunStep } from '@/types/workflows';
import {
  applyRunEvent,
  buildRunModel,
  isTerminalRun,
  type RunModel,
  type RunStreamEvent,
} from './run-model';
import { formatDuration, stepBadgeText } from './run-words';

const RUN_ID = 'run-1';
const START = Date.UTC(2026, 9, 29, 14, 2, 0);
let clock = 0;

function stamp(): string {
  clock += 1;
  return new Date(START + clock * 100).toISOString();
}

function graphOf(keys: string[], lines: [string, PortId, string][]): AutomationGraph {
  return {
    schemaVersion: 1,
    nodes: keys.map((key, index) => ({
      key,
      type: index === 0 ? 'trigger.manual' : 'logic.setFields',
      typeVersion: 1,
      name: key,
      position: { x: index * 300, y: 0 },
      config: {},
    })),
    edges: lines.map(([source, sourcePort, target]) => ({
      id: edgeId(source, sourcePort, target),
      source,
      sourcePort,
      target,
      targetPort: 'in' as const,
    })),
    notes: [],
  } as AutomationGraph;
}

function detail(graph: AutomationGraph, steps: RunStep[] = []): RunDetail {
  return {
    id: RUN_ID,
    automationId: 'wf-1',
    mode: 'TEST',
    status: 'RUNNING',
    triggerType: 'trigger.manual',
    options: { scope: { kind: 'run' }, sendForReal: [], triggerData: 'sample' },
    startedById: 'user-1',
    stepCount: 0,
    creditsUsed: 0,
    error: null,
    startedAt: new Date(START).toISOString(),
    finishedAt: null,
    createdAt: new Date(START).toISOString(),
    version: null,
    triggerSummary: null,
    triggerPayload: {},
    graph,
    steps,
  };
}

function row(nodeKey: string, status: AutomationStepStatus, extra: Partial<RunStep> = {}): RunStep {
  const finished = !['QUEUED', 'RUNNING', 'WAITING'].includes(status);
  return {
    id: `${nodeKey}-${extra.attempt ?? 1}`,
    nodeKey,
    nodeType: 'logic.setFields',
    nodeName: nodeKey,
    status,
    attempt: 1,
    attempts: 1,
    input: null,
    output: null,
    truncated: false,
    error: null,
    ports: status === 'SUCCEEDED' || status === 'DRY_RUN' ? ['out'] : [],
    startedAt: new Date(START).toISOString(),
    finishedAt: finished ? new Date(START + 1000).toISOString() : null,
    durationMs: finished ? 1200 : null,
    updatedAt: stamp(),
    ...extra,
  };
}

const step = (
  nodeKey: string,
  status: AutomationStepStatus,
  extra: Partial<RunStep> = {},
): RunStreamEvent => ({ type: 'step', ...row(nodeKey, status, extra) });

function runEvent(status: RunEvent['status'], extra: Partial<RunEvent> = {}): RunStreamEvent {
  const ended = isTerminalRun(status);
  return {
    type: 'run',
    id: RUN_ID,
    status,
    error: null,
    stepCount: 0,
    startedAt: new Date(START).toISOString(),
    finishedAt: ended ? new Date(START + 5000).toISOString() : null,
    ...extra,
  };
}

function play(model: RunModel, events: RunStreamEvent[]): RunModel {
  return events.reduce(applyRunEvent, model);
}

const sorted = (set: ReadonlySet<string>) => [...set].sort();

beforeEach(() => {
  clock = 0;
});

describe('run model, recorded sequences', () => {
  it('paints a linear run to success, the line into the running step flowing', () => {
    const graph = graphOf(
      ['trig', 'fields', 'bell'],
      [
        ['trig', 'out', 'fields'],
        ['fields', 'out', 'bell'],
      ],
    );
    let model = buildRunModel(detail(graph));
    expect(model.paint).toEqual({});
    expect(model.edgesTaken.size).toBe(0);

    model = play(model, [step('trig', 'SUCCEEDED'), step('fields', 'RUNNING')]);
    expect(model.paint.fields.state).toBe('running');
    expect(sorted(model.edgesTaken)).toEqual(['trig:out->fields']);
    expect(sorted(model.edgesActive)).toEqual(['trig:out->fields']);
    expect(model.edgesSkipped.size).toBe(0);

    model = play(model, [
      step('fields', 'SUCCEEDED'),
      step('bell', 'RUNNING'),
      step('bell', 'SUCCEEDED'),
      runEvent('SUCCEEDED'),
    ]);
    expect(model.runStatus).toBe('SUCCEEDED');
    expect(model.finishedAt).not.toBeNull();
    expect(sorted(model.edgesTaken)).toEqual(['fields:out->bell', 'trig:out->fields']);
    expect(model.edgesActive.size).toBe(0);
    expect(model.edgesSkipped.size).toBe(0);
    expect(Object.values(model.paint).map((paint) => paint.state)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(model.paint.bell.durationMs).toBe(1200);
  });

  it('takes the false path of an If / Else and fades the true one', () => {
    const graph = graphOf(
      ['trig', 'check', 'slack', 'bell'],
      [
        ['trig', 'out', 'check'],
        ['check', 'true', 'slack'],
        ['check', 'false', 'bell'],
      ],
    );
    const model = play(buildRunModel(detail(graph)), [
      step('trig', 'SUCCEEDED'),
      step('check', 'SUCCEEDED', { ports: ['false'] }),
      step('slack', 'SKIPPED', { output: { skipped: 'branchNotTaken' } }),
      step('bell', 'SUCCEEDED'),
      runEvent('SUCCEEDED'),
    ]);

    expect(sorted(model.edgesTaken)).toEqual(['check:false->bell', 'trig:out->check']);
    expect(sorted(model.edgesSkipped)).toEqual(['check:true->slack']);
    expect(model.paint.slack.state).toBe('skipped');
    expect(model.paint.bell.state).toBe('succeeded');
  });

  it('shows a handled failure in amber, with its attempts, and the run going on', () => {
    const graph = graphOf(
      ['trig', 'http', 'bell'],
      [
        ['trig', 'out', 'http'],
        ['http', 'out', 'bell'],
      ],
    );
    const firstAttempt = row('http', 'RUNNING');
    let model = play(buildRunModel(detail(graph)), [
      step('trig', 'SUCCEEDED'),
      { type: 'step', ...firstAttempt },
      step('http', 'RUNNING', { attempt: 2, attempts: 2 }),
      step('http', 'HANDLED_ERROR', {
        attempt: 2,
        attempts: 2,
        ports: ['out'],
        error: { message: 'The server said no.', code: 'http_500', retryable: true },
      }),
    ]);

    // A reconnect replays the first attempt: it must not paint over the second.
    model = applyRunEvent(model, { type: 'step', ...firstAttempt });
    expect(model.paint.http).toMatchObject({
      state: 'handled',
      attempt: 2,
      attempts: 2,
      error: 'The server said no.',
    });
    expect(stepBadgeText(model.paint.http)).toBe('Error Handled after 2 attempts');

    model = play(model, [step('bell', 'SUCCEEDED'), runEvent('SUCCEEDED')]);
    expect(sorted(model.edgesTaken)).toEqual(['http:out->bell', 'trig:out->http']);
    expect(model.runStatus).toBe('SUCCEEDED');
  });

  it('waits at a review, then follows the approved path once it is answered', () => {
    const graph = graphOf(
      ['trig', 'review', 'draft', 'bell'],
      [
        ['trig', 'out', 'review'],
        ['review', 'approved', 'draft'],
        ['review', 'rejected', 'bell'],
      ],
    );
    let model = play(buildRunModel(detail(graph)), [
      step('trig', 'SUCCEEDED'),
      step('review', 'WAITING', { input: { text: 'Hello', instructions: 'Check it' } }),
      runEvent('WAITING'),
    ]);

    expect(model.runStatus).toBe('WAITING');
    expect(isTerminalRun(model.runStatus)).toBe(false);
    expect(model.paint.review).toMatchObject({ state: 'waiting', waiting: true });
    expect(stepBadgeText(model.paint.review)).toBe('Waiting For Review');
    // Neither way out of the review is decided yet.
    expect(sorted(model.edgesTaken)).toEqual(['trig:out->review']);
    expect(model.edgesSkipped.size).toBe(0);

    model = play(model, [
      step('review', 'SUCCEEDED', { ports: ['approved'], output: { decision: 'approved' } }),
      runEvent('RUNNING'),
      step('draft', 'RUNNING'),
    ]);
    expect(model.runStatus).toBe('RUNNING');
    expect(model.paint.review.waiting).toBeUndefined();
    expect(sorted(model.edgesActive)).toEqual(['review:approved->draft']);

    model = play(model, [
      step('draft', 'SUCCEEDED'),
      step('bell', 'SKIPPED', { output: { skipped: 'branchNotTaken' } }),
      runEvent('SUCCEEDED'),
    ]);
    expect(sorted(model.edgesTaken)).toEqual(['review:approved->draft', 'trig:out->review']);
    expect(sorted(model.edgesSkipped)).toEqual(['review:rejected->bell']);
  });

  it('ends cancelled and never goes back to running on a late event', () => {
    const graph = graphOf(
      ['trig', 'wait', 'bell'],
      [
        ['trig', 'out', 'wait'],
        ['wait', 'out', 'bell'],
      ],
    );
    const model = play(buildRunModel(detail(graph)), [
      step('trig', 'SUCCEEDED'),
      step('wait', 'RUNNING'),
      runEvent('CANCELLED'),
      step('wait', 'CANCELLED'),
    ]);
    expect(model.runStatus).toBe('CANCELLED');
    expect(isTerminalRun(model.runStatus)).toBe(true);
    expect(model.paint.wait.state).toBe('cancelled');
    expect(model.paint.bell).toBeUndefined();
    // The cancelled step finished nothing: its line out is neither taken nor skipped.
    expect(model.edgesTaken.has('wait:out->bell')).toBe(false);
    expect(model.edgesSkipped.has('wait:out->bell')).toBe(false);
    expect(model.edgesActive.size).toBe(0);

    const late = applyRunEvent(model, runEvent('RUNNING'));
    expect(late).toBe(model);
  });
});

describe('run model, replays and other runs', () => {
  const graph = graphOf(['trig', 'bell'], [['trig', 'out', 'bell']]);

  it('keeps a newer row over an older replay, and returns the same model for an exact replay', () => {
    const older = row('bell', 'RUNNING');
    const newer = row('bell', 'SUCCEEDED');
    const model = play(buildRunModel(detail(graph)), [
      { type: 'step', ...newer },
      { type: 'step', ...older },
    ]);
    expect(model.paint.bell.state).toBe('succeeded');
    expect(applyRunEvent(model, { type: 'step', ...newer })).toBe(model);
  });

  it('ignores error frames and run events of another run', () => {
    const model = buildRunModel(detail(graph, [row('trig', 'SUCCEEDED')]));
    expect(applyRunEvent(model, { type: 'error', message: 'Live updates stopped.' })).toBe(model);
    expect(applyRunEvent(model, runEvent('FAILED', { id: 'run-2' }))).toBe(model);
  });

  it('builds the same model from the detail as from the stream', () => {
    const steps = [row('trig', 'SUCCEEDED'), row('bell', 'SUCCEEDED')];
    const fromDetail = buildRunModel({ ...detail(graph, steps), status: 'SUCCEEDED' });
    const fromStream = play(buildRunModel(detail(graph)), [
      { type: 'step', ...steps[0] },
      { type: 'step', ...steps[1] },
      runEvent('SUCCEEDED'),
    ]);
    expect(fromStream.paint).toEqual(fromDetail.paint);
    expect(sorted(fromStream.edgesTaken)).toEqual(sorted(fromDetail.edgesTaken));
  });
});

describe('run model, lines', () => {
  it('skips the lines of a failed step and of a filter that did not pass', () => {
    const graph = graphOf(
      ['trig', 'filter', 'slack', 'other', 'bell'],
      [
        ['trig', 'out', 'filter'],
        ['filter', 'out', 'slack'],
        ['trig', 'out', 'other'],
        ['other', 'out', 'bell'],
      ],
    );
    const model = buildRunModel(
      detail(graph, [
        row('trig', 'SUCCEEDED'),
        row('filter', 'SUCCEEDED', { ports: [] }),
        row('slack', 'SKIPPED'),
        row('other', 'FAILED', { error: { message: 'Nope.', code: 'x', retryable: false } }),
      ]),
    );
    expect(sorted(model.edgesSkipped)).toEqual(['filter:out->slack', 'other:out->bell']);
    expect(sorted(model.edgesTaken)).toEqual(['trig:out->filter', 'trig:out->other']);
    expect(model.paint.other.error).toBe('Nope.');
  });

  it('takes the error path of a step that handled its error on a branch', () => {
    const graph = graphOf(
      ['trig', 'http', 'ok', 'alert'],
      [
        ['trig', 'out', 'http'],
        ['http', 'out', 'ok'],
        ['http', 'error', 'alert'],
      ],
    );
    const model = buildRunModel(
      detail(graph, [
        row('trig', 'SUCCEEDED'),
        row('http', 'HANDLED_ERROR', { ports: ['error'] }),
        row('ok', 'SKIPPED'),
        row('alert', 'QUEUED'),
      ]),
    );
    expect(sorted(model.edgesTaken)).toEqual(['http:error->alert', 'trig:out->http']);
    expect(sorted(model.edgesActive)).toEqual(['http:error->alert']);
    expect(sorted(model.edgesSkipped)).toEqual(['http:out->ok']);
  });

  it('reads rows without ports (written before they existed) from what ran next', () => {
    const graph = graphOf(
      ['trig', 'fields', 'bell'],
      [
        ['trig', 'out', 'fields'],
        ['fields', 'out', 'bell'],
      ],
    );
    const legacy = (key: string, status: AutomationStepStatus) => {
      const { ports: _ports, ...rest } = row(key, status);
      return rest as RunStep;
    };
    const model = buildRunModel(
      detail(graph, [
        legacy('trig', 'SUCCEEDED'),
        legacy('fields', 'SUCCEEDED'),
        legacy('bell', 'SKIPPED'),
      ]),
    );
    expect(sorted(model.edgesTaken)).toEqual(['trig:out->fields']);
    expect(sorted(model.edgesSkipped)).toEqual(['fields:out->bell']);
  });

  it('has no lines without a graph', () => {
    const model = buildRunModel({ ...detail(graphOf(['trig'], [])), graph: null });
    expect(model.edgesTaken.size + model.edgesSkipped.size + model.edgesActive.size).toBe(0);
  });
});

describe('run words', () => {
  it('names the state and the attempts', () => {
    expect(stepBadgeText({ state: 'succeeded', attempts: 2 })).toBe('Succeeded after 2 attempts');
    expect(stepBadgeText({ state: 'succeeded', attempts: 1 })).toBe('Succeeded');
    expect(stepBadgeText({ state: 'dryRun', attempts: 1 })).toBe('Dry Run');
    expect(stepBadgeText({ state: 'failed', attempts: 3 })).toBe('Failed after 3 attempts');
    // A step still going says what it is doing, not how often it tried.
    expect(stepBadgeText({ state: 'running', attempts: 2 })).toBe('Running');
  });

  it('formats durations', () => {
    expect(formatDuration(420)).toBe('420 ms');
    expect(formatDuration(3100)).toBe('3.1 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(formatDuration(null)).toBe('');
  });
});
