import {
  type AutomationGraph,
  aiScheduleLimit,
  edgeId,
  emptyGraph,
  FORM_TABS,
  fieldSpecFor,
  GRAPH_SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  getDefinition,
  type PortId,
  type ValidationContext,
  type ValidationIssue,
  validateGraph,
} from '@postgear/automation';
import { FIELD_PATH_ATTRIBUTE } from '../fields/contract';
import { findFieldElement, focusField, ISSUE_TARGETS, issuePlace } from './issue-focus';

function step(
  key: string,
  type: string,
  config: Record<string, unknown> = {},
  extra: Partial<GraphNode> = {},
): GraphNode {
  const def = getDefinition(type);
  const defaults = def ? (JSON.parse(JSON.stringify(def.defaultConfig)) as object) : {};
  return {
    key,
    type,
    typeVersion: def?.typeVersion ?? 1,
    name: key,
    position: { x: 0, y: 0 },
    config: { ...defaults, ...config },
    ...extra,
  };
}

function line(source: string, target: string, port: PortId = 'out'): GraphEdge {
  return { id: edgeId(source, port, target), source, sourcePort: port, target, targetPort: 'in' };
}

function graphOf(nodes: GraphNode[], edges: GraphEdge[] = []): AutomationGraph {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges, notes: [] };
}

const CONTEXT: ValidationContext = {
  connections: [
    { id: 'conn_ok', kind: 'slack', name: 'Marketing Slack', status: 'CONNECTED' },
    { id: 'conn_broken', kind: 'slack', name: 'Old Slack', status: 'NEEDS_RECONNECT' },
  ],
  channels: [{ id: 'ch_ig', provider: 'instagram', name: 'Bloom Bakery', status: 'active' }],
};

/** One workflow with most things wrong at once. */
function brokenWorkflow(): AutomationGraph {
  const rule = (left: string, operator: string, right?: string) => ({
    id: `r${left.length}${operator}`,
    left,
    operator,
    ...(right === undefined ? {} : { right }),
  });
  const nodes = [
    step('pub', 'trigger.postPublished', { channels: ['ch_gone'] }),
    step('pub2', 'trigger.manual'),
    step(
      'slack',
      'notify.slack',
      {
        connectionId: '',
        message:
          '{{ nodes.ghost.output.sent }} {{ nodes.later.output.sent }} {{ trigger.post.nope }} {{ trigger.post.url | shout }}',
      },
      { name: 'Slack' },
    ),
    step('later', 'notify.inApp', { title: '' }),
    step(
      'broken',
      'notify.slack',
      { connectionId: 'conn_broken', message: 'Hi' },
      { name: 'slack ' },
    ),
    step('lonely', 'notify.inApp', { title: 'Alone' }),
    step('iff', 'logic.ifElse'),
    step('filt', 'logic.filter', {
      condition: {
        match: 'all',
        rules: [rule('', 'is', 'x'), rule('{{ trigger.post.url }}', 'greaterThan', 'three')],
      },
    }),
    step('draft', 'postgear.createDraft', { channels: ['ch_gone'], text: 'Hello' }),
    step('pubx', 'postgear.publish', { provider: 'linkedin', channels: ['ch_ig'], text: 'Hi' }),
    step('video', 'ai.generateVideo', { prompt: 'A loaf' }),
    step('mystery', 'x.unknown'),
    step('bad', 'notify.slack', { connectionId: 'conn_ok', message: 42 }),
    step('c1', 'notify.inApp', { title: 'Loop' }),
    step('c2', 'notify.inApp', { title: 'Loop' }),
    step('off', 'notify.slack', { connectionId: 'conn_ok', message: 'Hi' }, { disabled: true }),
    step('reader', 'notify.inApp', { title: '{{ nodes.off.output.preview }}' }),
    step('a', 'notify.inApp', { title: 'A' }),
    step('b', 'notify.inApp', { title: 'B' }),
    step('join', 'notify.inApp', { title: 'Join' }),
    step('iff2', 'logic.ifElse', {
      condition: { match: 'all', rules: [rule('{{ trigger.post.text }}', 'isNotEmpty')] },
    }),
    step('yes', 'notify.inApp', { title: 'Yes' }),
    step('rejoin', 'notify.inApp', { title: '{{ nodes.yes.output.title }}' }),
    step('chatty', 'notify.inApp', {
      title: 'Many',
      message: Array.from({ length: 51 }, () => '{{ trigger.post.url }}').join(' '),
    }),
  ];
  const edges = [
    line('pub', 'slack'),
    line('slack', 'later'),
    line('pub', 'broken'),
    line('pub', 'iff'),
    line('pub', 'filt'),
    line('pub', 'draft'),
    line('pub', 'pubx'),
    line('pub', 'video'),
    line('pub', 'mystery'),
    line('pub', 'bad'),
    line('c1', 'c2'),
    line('c2', 'c1'),
    line('slack', 'lonely', 'true'),
    line('pub', 'off'),
    line('off', 'reader'),
    line('pub', 'a'),
    line('pub', 'b'),
    line('a', 'join'),
    line('b', 'join'),
    line('pub', 'iff2'),
    line('iff2', 'yes', 'true'),
    line('yes', 'rejoin'),
    line('iff2', 'rejoin', 'false'),
    line('pub', 'chatty'),
  ];
  return graphOf(nodes, edges);
}

function emitted(): { graph: AutomationGraph; issues: ValidationIssue[] }[] {
  const broken = brokenWorkflow();
  const keys = Array.from({ length: 51 }, (_, i) => `n${String(i).padStart(2, '0')}`);
  const big = graphOf(
    [
      step('start', 'trigger.manual'),
      ...keys.map((key) => step(key, 'notify.inApp', { title: 'x' }, { name: key })),
    ],
    [
      ...keys.map((key) => line('start', key)),
      ...keys.slice(1).map((key, i) => line(keys[i], key)),
      ...keys.slice(2).map((key, i) => line(keys[i], key)),
    ],
  );
  const scheduled = graphOf(
    [
      step('when', 'trigger.schedule', {
        frequency: 'hourly',
        everyHours: 1,
        time: '09:00',
        timeZone: 'UTC',
      }),
      step('write', 'ai.generateText', { prompt: 'Write a post' }),
    ],
    [line('when', 'write')],
  );
  return [
    { graph: emptyGraph(), issues: validateGraph(emptyGraph(), CONTEXT) },
    {
      graph: broken,
      issues: validateGraph(broken, { ...CONTEXT, availableTypes: new Set(['notify.inApp']) }),
    },
    { graph: big, issues: validateGraph(big, CONTEXT) },
    { graph: scheduled, issues: validateGraph(scheduled, CONTEXT, [aiScheduleLimit(24 * 60)]) },
    {
      graph: broken,
      issues: validateGraph(broken, CONTEXT, [
        () => {
          throw new Error('broken rule');
        },
      ]),
    },
  ];
}

describe('issuePlace', () => {
  it('lands every issue the validators emit somewhere, and they emit every code', () => {
    const seen = new Set<string>();
    for (const { graph, issues } of emitted()) {
      for (const issue of issues) {
        seen.add(issue.code);
        const place = issuePlace(graph, issue);
        expect(place).not.toBeNull();
        expect(place?.kind).toBe(ISSUE_TARGETS[issue.code]);
        if (place?.kind !== 'step') continue;
        expect(['setup', 'configure', 'settings', 'name']).toContain(place.place);

        // A field on a tab is one the form draws (or the connection or channels fallback).
        const node = graph.nodes.find((candidate) => candidate.key === place.nodeKey);
        const def = node ? getDefinition(node.type, node.typeVersion) : undefined;
        if (!def?.form || !issue.field || !FORM_TABS.includes(place.place as 'setup')) continue;
        const head = issue.field.split('.')[0];
        const drawn =
          fieldSpecFor(def, issue.field) !== undefined ||
          head === def.connection?.field ||
          head === 'channels';
        if (!drawn) throw new Error(`${node?.type} has no field for ${issue.field}`);
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(ISSUE_TARGETS).sort());
  });

  it('opens the tab that holds the field', () => {
    const graph = brokenWorkflow();
    expect(
      issuePlace(graph, {
        severity: 'error',
        code: 'node.connection_missing',
        message: 'Choose a Slack connection.',
        nodeKey: 'slack',
        field: 'connectionId',
      }),
    ).toEqual({ kind: 'step', nodeKey: 'slack', place: 'setup', field: 'connectionId' });
    expect(
      issuePlace(graph, {
        severity: 'error',
        code: 'token.unknown_node',
        message: 'This data is no longer available.',
        nodeKey: 'slack',
        field: 'message',
      }),
    ).toEqual({ kind: 'step', nodeKey: 'slack', place: 'configure', field: 'message' });
    expect(
      issuePlace(graph, {
        severity: 'error',
        code: 'node.duplicate_name',
        message: 'Rename this one.',
        nodeKey: 'broken',
        field: 'name',
      }),
    ).toMatchObject({ place: 'name' });
    expect(
      issuePlace(graph, {
        severity: 'error',
        code: 'node.config_invalid',
        message: 'Slack cannot have an On Error setting.',
        nodeKey: 'bad',
        field: 'onError',
      }),
    ).toMatchObject({ place: 'settings' });
  });

  it('selects the line for a loop, and opens the Steps panel when there is no trigger', () => {
    const graph = brokenWorkflow();
    const loop = validateGraph(graph, CONTEXT).find((issue) => issue.code === 'graph.cycle');
    expect(loop && issuePlace(graph, loop)).toMatchObject({ kind: 'line', edgeId: loop?.edgeId });
    const [none] = validateGraph(emptyGraph(), CONTEXT);
    expect(issuePlace(emptyGraph(), none)).toEqual({ kind: 'workflow', action: 'addTrigger' });
  });

  it('gives nothing for a step that is gone', () => {
    expect(
      issuePlace(emptyGraph(), {
        severity: 'error',
        code: 'node.required_missing',
        message: 'Write a title.',
        nodeKey: 'ghost',
        field: 'title',
      }),
    ).toBeNull();
  });
});

describe('focusField', () => {
  function panel(html: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.append(root);
    return root;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses the first thing to type in inside the field', () => {
    const root = panel(`
      <div ${FIELD_PATH_ATTRIBUTE}="title"><label>Title</label><input id="title" /></div>
      <div ${FIELD_PATH_ATTRIBUTE}="message"><div id="message" contenteditable="true"></div></div>`);
    expect(focusField(root, 'message')).toBe(true);
    expect(document.activeElement?.id).toBe('message');
    expect(focusField(root, 'title')).toBe(true);
    expect(document.activeElement?.id).toBe('title');
  });

  it('falls back to the nearest field above the path, then the whole-config field', () => {
    const root = panel(`
      <div ${FIELD_PATH_ATTRIBUTE}="cases"><button id="cases">Add Path</button></div>
      <div ${FIELD_PATH_ATTRIBUTE}=""><select id="whole"></select></div>`);
    expect(
      findFieldElement(root, 'cases.0.condition.rules.1.left')?.getAttribute(FIELD_PATH_ATTRIBUTE),
    ).toBe('cases');
    expect(focusField(root, 'everyHours')).toBe(true);
    expect(document.activeElement?.id).toBe('whole');
  });

  it('says so when the field is not drawn yet', () => {
    const root = panel('<p>Nothing here</p>');
    expect(focusField(root, 'message')).toBe(false);
  });
});
