import {
  type AutomationGraph,
  emptyGraph,
  getTemplate,
  instantiateTemplate,
} from '@postgear/automation';
import {
  type BuilderAction,
  type BuilderState,
  builderReducer,
  COALESCE_MS,
  HISTORY_LIMIT,
  initialState,
} from './builder-state';

function report(): AutomationGraph {
  const template = getTemplate('publishing-report');
  if (!template) throw new Error('missing template');
  return instantiateTemplate(template, (key) => key);
}

function run(state: BuilderState, ...actions: BuilderAction[]): BuilderState {
  return actions.reduce(builderReducer, state);
}

let counter = 0;
const makeKey = () => `k${String(counter++).padStart(9, '0')}`;

describe('builderReducer', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('adds a trigger, then a step after it, connected and selected', () => {
    const state = run(
      initialState(emptyGraph(), 'Untitled Workflow'),
      { type: 'addStep', stepType: 'trigger.manual', key: 'trigger001' },
      {
        type: 'addStep',
        stepType: 'notify.slack',
        key: 'slackstep1',
        from: { source: 'trigger001', sourcePort: 'out' },
      },
    );
    expect(state.graph.nodes.map((node) => node.key)).toEqual(['trigger001', 'slackstep1']);
    expect(state.graph.edges).toEqual([
      {
        id: 'trigger001:out->slackstep1',
        source: 'trigger001',
        sourcePort: 'out',
        target: 'slackstep1',
        targetPort: 'in',
      },
    ]);
    expect(state.graph.nodes[1].position).toEqual({ x: 276, y: 0 });
    expect(state.selection.nodes).toEqual(['slackstep1']);
    expect(state.past).toHaveLength(2);
  });

  it('refuses a second trigger and a loop', () => {
    const graph = report();
    const state = initialState(graph, 'Report');
    expect(run(state, { type: 'addStep', stepType: 'trigger.manual', key: 'another01' })).toBe(
      state,
    );
    // slack -> published would loop back to the trigger; fields -> published leads into it.
    expect(
      run(state, { type: 'connect', source: 'slack', sourcePort: 'out', target: 'fields' }),
    ).toBe(state);
  });

  it('inserts a step on a line, splitting it in two', () => {
    const state = run(initialState(report(), 'Report'), {
      type: 'insertOnEdge',
      edgeId: 'fields:out->sheet',
      stepType: 'logic.filter',
      key: 'filter0001',
    });
    const ids = state.graph.edges.map((edge) => edge.id);
    expect(ids).not.toContain('fields:out->sheet');
    expect(ids).toContain('fields:out->filter0001');
    expect(ids).toContain('filter0001:out->sheet');
  });

  it('undoes a delete with the step, its settings and its lines, then redoes it', () => {
    let state = initialState(report(), 'Report');
    state = run(
      state,
      { type: 'stepSettings', key: 'sheet', notes: 'Monthly tab', now: 0 },
      { type: 'select', selection: { nodes: ['sheet'], edges: [], notes: [] } },
      { type: 'deleteSelection' },
    );
    expect(state.graph.nodes.some((node) => node.key === 'sheet')).toBe(false);
    expect(
      state.graph.edges.some((edge) => edge.source === 'sheet' || edge.target === 'sheet'),
    ).toBe(false);

    const undone = run(state, { type: 'undo' });
    const sheet = undone.graph.nodes.find((node) => node.key === 'sheet');
    expect(sheet?.notes).toBe('Monthly tab');
    expect(undone.graph.edges.map((edge) => edge.id)).toEqual(
      report().edges.map((edge) => edge.id),
    );

    const redone = run(undone, { type: 'redo' });
    expect(redone.graph).toBe(state.graph);
  });

  it('folds typing in one field into one undo step, but not after a pause', () => {
    const base = initialState(report(), 'Report');
    const typed = run(
      base,
      { type: 'updateConfig', key: 'slack', path: 'message', value: 'H', now: 0 },
      { type: 'updateConfig', key: 'slack', path: 'message', value: 'Hi', now: 500 },
      { type: 'updateConfig', key: 'slack', path: 'message', value: 'Hi!', now: 900 },
    );
    expect(typed.past).toHaveLength(1);
    expect(typed.graph.nodes.find((node) => node.key === 'slack')?.config.message).toBe('Hi!');
    expect(run(typed, { type: 'undo' }).graph).toBe(base.graph);

    const paused = run(typed, {
      type: 'updateConfig',
      key: 'slack',
      path: 'message',
      value: 'Hi!!',
      now: 900 + COALESCE_MS + 1,
    });
    expect(paused.past).toHaveLength(2);

    const otherField = run(typed, {
      type: 'updateConfig',
      key: 'slack',
      path: 'footer',
      value: false,
      now: 950,
    });
    expect(otherField.past).toHaveLength(2);
    expect(otherField.graph.nodes.find((node) => node.key === 'slack')?.config).toMatchObject({
      message: 'Hi!',
      footer: false,
    });
  });

  it('writes one config path at a time, leaving the rest of the config as it was', () => {
    const base = initialState(report(), 'Report');
    const before = base.graph.nodes.find((node) => node.key === 'slack')?.config ?? {};
    const state = run(base, {
      type: 'updateConfig',
      key: 'slack',
      path: 'includeLink',
      value: 'https://bloom.example/report',
      now: 0,
    });
    const after = state.graph.nodes.find((node) => node.key === 'slack')?.config ?? {};
    expect(after).toEqual({ ...before, includeLink: 'https://bloom.example/report' });
    // The original graph is untouched (undo depends on it).
    expect(base.graph.nodes.find((node) => node.key === 'slack')?.config).toBe(before);

    // Clearing an optional field removes its key.
    const cleared = run(state, {
      type: 'updateConfig',
      key: 'slack',
      path: 'includeLink',
      value: undefined,
      now: 100,
    });
    expect(cleared.graph.nodes.find((node) => node.key === 'slack')?.config).toEqual(before);
  });

  it('writes inside lists by index and folds edits to that one path', () => {
    const graph = report();
    const fields = graph.nodes.find((node) => node.key === 'fields');
    expect(Array.isArray(fields?.config.fields)).toBe(true);
    const state = run(
      initialState(graph, 'Report'),
      { type: 'updateConfig', key: 'fields', path: 'fields.0.name', value: 'n', now: 0 },
      { type: 'updateConfig', key: 'fields', path: 'fields.0.name', value: 'note', now: 300 },
    );
    const list = state.graph.nodes.find((node) => node.key === 'fields')?.config.fields as Record<
      string,
      unknown
    >[];
    expect(list[0].name).toBe('note');
    expect(state.past).toHaveLength(1);
  });

  it('ignores an edit that changes nothing, so it adds no undo step', () => {
    const base = initialState(report(), 'Report');
    const message = base.graph.nodes.find((node) => node.key === 'slack')?.config.message;
    const same = run(base, {
      type: 'updateConfig',
      key: 'slack',
      path: 'message',
      value: message,
      now: 0,
    });
    expect(same).toBe(base);
  });

  it('replaces the whole config for the empty path (the schedule builder)', () => {
    const base = initialState(report(), 'Report');
    const state = run(base, {
      type: 'updateConfig',
      key: 'slack',
      path: '',
      value: { connectionId: 'c1', message: 'All new', footer: false },
      now: 0,
    });
    expect(state.graph.nodes.find((node) => node.key === 'slack')?.config).toEqual({
      connectionId: 'c1',
      message: 'All new',
      footer: false,
    });
  });

  it('sees the latest config in the next action (no stale closure)', () => {
    const state = run(
      initialState(report(), 'Report'),
      { type: 'updateConfig', key: 'slack', path: 'message', value: 'Fresh text', now: 0 },
      { type: 'select', selection: { nodes: ['slack'], edges: [], notes: [] } },
      { type: 'duplicateSelection', makeKey },
    );
    const copy = state.graph.nodes.find((node) => node.key === 'k000000000');
    expect(copy?.config.message).toBe('Fresh text');
    expect(copy?.name).toBe('Slack 2');
    expect(state.selection.nodes).toEqual(['k000000000']);
  });

  it('moves on drag stop as one step, snapped to the grid', () => {
    const state = run(initialState(report(), 'Report'), {
      type: 'moveNodes',
      nodes: { slack: { x: 1001, y: 13 } },
    });
    expect(state.graph.nodes.find((node) => node.key === 'slack')?.position).toEqual({
      x: 996,
      y: 12,
    });
    expect(state.past).toHaveLength(1);
    // Dropping a step where it already was is not a change.
    expect(run(state, { type: 'moveNodes', nodes: { slack: { x: 996, y: 12 } } })).toBe(state);
  });

  it('turns several steps off together, then on again', () => {
    const off = run(initialState(report(), 'Report'), {
      type: 'toggleDisabled',
      keys: ['sheet', 'slack'],
    });
    expect(off.graph.nodes.filter((node) => node.disabled).map((node) => node.key)).toEqual([
      'sheet',
      'slack',
    ]);
    const on = run(off, { type: 'toggleDisabled', keys: ['sheet', 'slack'] });
    expect(on.graph.nodes.some((node) => 'disabled' in node)).toBe(false);
  });

  it('drops the error line when On Error stops using the error path', () => {
    let state = run(
      initialState(report(), 'Report'),
      { type: 'stepSettings', key: 'sheet', onError: { mode: 'branch' }, now: 0 },
      {
        type: 'addStep',
        stepType: 'notify.inApp',
        key: 'tellme0001',
        from: { source: 'sheet', sourcePort: 'error' },
      },
    );
    expect(state.graph.edges.some((edge) => edge.sourcePort === 'error')).toBe(true);
    state = run(state, { type: 'stepSettings', key: 'sheet', onError: null, now: 5_000 });
    expect(state.graph.edges.some((edge) => edge.sourcePort === 'error')).toBe(false);
  });

  it('keeps at most 100 undo steps', () => {
    let state = initialState(report(), 'Report');
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) {
      state = run(state, { type: 'moveNodes', nodes: { slack: { x: i * 12, y: 600 } } });
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT);
  });

  it('applies select changes to the selection as it is now', () => {
    const base = initialState(report(), 'Report');
    const state = run(
      base,
      { type: 'selectChanges', nodes: { slack: true } },
      { type: 'selectChanges', nodes: { sheet: true } },
      { type: 'selectChanges', nodes: { slack: false }, edges: { 'fields:out->sheet': true } },
      { type: 'selectChanges', nodes: { gone000001: true } },
    );
    expect(state.selection).toEqual({ nodes: ['sheet'], edges: ['fields:out->sheet'], notes: [] });
    expect(state.past).toHaveLength(0);
    expect(run(state, { type: 'selectChanges', nodes: { sheet: true } })).toBe(state);
  });

  it('adds and edits sticky notes, which are undoable too', () => {
    const note = {
      id: 'note000001',
      position: { x: 0, y: -200 },
      size: { w: 240, h: 120 },
      text: '',
      colour: 'yellow' as const,
    };
    const state = run(
      initialState(report(), 'Report'),
      { type: 'addNote', note },
      { type: 'updateNote', id: note.id, patch: { text: 'Check **Monday**' }, now: 0 },
    );
    expect(state.graph.notes[0].text).toBe('Check **Monday**');
    expect(run(state, { type: 'undo' }, { type: 'undo' }).graph.notes).toHaveLength(0);
  });

  it('loads a draft the server swapped in (restore, discard) as a fresh start', () => {
    const edited = run(
      initialState(emptyGraph(), 'Untitled Workflow'),
      { type: 'addStep', stepType: 'trigger.manual', key: 'trigger001' },
      { type: 'select', selection: { nodes: ['trigger001'], edges: [], notes: [] } },
    );
    expect(edited.past).toHaveLength(1);

    const restored = report();
    const state = builderReducer(edited, { type: 'load', graph: restored, name: 'Report v2' });
    expect(state.graph).toBe(restored);
    expect(state.name).toBe('Report v2');
    // Undo never walks back across a restore into a draft the server replaced.
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
    expect(state.selection).toEqual({ nodes: [], edges: [], notes: [] });
    expect(builderReducer(state, { type: 'undo' })).toBe(state);
  });
});
