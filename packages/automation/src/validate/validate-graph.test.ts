import { NODE_TYPES } from '../catalog/types';
import { LIMITS } from '../limits';
import { graphOf, line, READY_CONTEXT, readySlack, step } from '../testing/builders';
import type { ValidationContext, ValidationIssue } from './types';
import { hasBlockingIssues, validateGraph } from './validate-graph';

const ALL_TYPES = new Set<string>(NODE_TYPES);
const ctx = (extra: Partial<ValidationContext> = {}): ValidationContext => ({
  ...READY_CONTEXT,
  availableTypes: ALL_TYPES,
  ...extra,
});

/** Issues with the given code, reduced to what a test cares about. */
function only(issues: ValidationIssue[], code: ValidationIssue['code']) {
  return issues
    .filter((issue) => issue.code === code)
    .map(({ severity, message, nodeKey, edgeId, field }) => ({
      severity,
      message,
      ...(nodeKey ? { nodeKey } : {}),
      ...(edgeId ? { edgeId } : {}),
      ...(field ? { field } : {}),
    }));
}

const rule = (id: string) => ({
  id,
  left: '{{ trigger.post.channel.provider }}',
  operator: 'is' as const,
  right: 'instagram',
});

/** Post Published, Set Fields, If / Else to Slack or an in-app notification. */
function cleanGraph() {
  return graphOf(
    [
      step('trig01', 'trigger.postPublished', { config: { channels: ['ch_ig'] } }),
      step('setf01', 'logic.setFields', {
        position: { x: 300, y: 0 },
        config: { fields: [{ name: 'link', type: 'text', value: '{{ trigger.post.url }}' }] },
      }),
      step('ifel01', 'logic.ifElse', {
        position: { x: 600, y: 0 },
        config: { condition: { match: 'all', rules: [rule('r1')] } },
      }),
      readySlack('slck01', { position: { x: 900, y: -100 } }),
      step('note01', 'notify.inApp', {
        position: { x: 900, y: 100 },
        config: { title: 'Posted somewhere else' },
      }),
    ],
    [
      line('trig01', 'setf01'),
      line('setf01', 'ifel01'),
      line('ifel01', 'slck01', 'true'),
      line('ifel01', 'note01', 'false'),
    ],
  );
}

describe('validateGraph', () => {
  it('finds nothing wrong with a finished workflow', () => {
    expect(validateGraph(cleanGraph(), ctx())).toEqual([]);
  });

  it('says to add a trigger when there is none', () => {
    const issues = validateGraph(graphOf([readySlack('slck01')]), ctx());
    expect(only(issues, 'graph.no_trigger')).toEqual([
      { severity: 'error', message: 'Add a trigger to choose what starts this workflow.' },
    ]);
    expect(only(issues, 'graph.unreachable')).toEqual([]);
  });

  it('allows only one trigger, flagging every one after the first', () => {
    const graph = graphOf([
      step('trig01', 'trigger.manual'),
      step('trig02', 'trigger.schedule', { position: { x: 0, y: 200 } }),
    ]);
    expect(only(validateGraph(graph, ctx()), 'graph.many_triggers')).toEqual([
      { severity: 'error', message: 'A workflow can have only one trigger.', nodeKey: 'trig02' },
    ]);
  });

  it('flags a step that is not connected to the trigger', () => {
    const graph = graphOf([step('trig01', 'trigger.manual'), readySlack('slck01')]);
    expect(only(validateGraph(graph, ctx()), 'graph.unreachable')).toEqual([
      {
        severity: 'error',
        message: 'This step is not connected to the trigger.',
        nodeKey: 'slck01',
      },
    ]);
  });

  it('flags the line that loops back, once per loop', () => {
    const graph = graphOf(
      [
        step('trig01', 'trigger.manual'),
        step('aaaa01', 'logic.setFields', { position: { x: 300, y: 0 } }),
        step('bbbb01', 'logic.setFields', { position: { x: 600, y: 0 } }),
        step('cccc01', 'logic.setFields', { position: { x: 900, y: 0 } }),
      ],
      [
        line('trig01', 'aaaa01'),
        line('aaaa01', 'bbbb01'),
        line('bbbb01', 'cccc01'),
        line('cccc01', 'aaaa01'),
      ],
    );
    expect(only(validateGraph(graph, ctx()), 'graph.cycle')).toEqual([
      {
        severity: 'error',
        message: 'Workflows cannot loop back to an earlier step.',
        nodeKey: 'cccc01',
        edgeId: 'cccc01:out->aaaa01',
      },
    ]);
  });

  it('flags a line from an output that is gone, and a line into a trigger', () => {
    const graph = graphOf(
      [
        step('trig01', 'trigger.manual'),
        step('path01', 'logic.switch', { position: { x: 300, y: 0 } }),
        readySlack('slck01', { position: { x: 600, y: 0 } }),
        step('trig02', 'trigger.webhook', { position: { x: 900, y: 0 } }),
      ],
      [line('trig01', 'path01'), line('path01', 'slck01', 'case:gone'), line('slck01', 'trig02')],
    );
    expect(only(validateGraph(graph, ctx()), 'graph.bad_port')).toEqual([
      {
        severity: 'error',
        message: 'This line starts from an output the step does not have any more.',
        nodeKey: 'path01',
        edgeId: 'path01:case:gone->slck01',
      },
      {
        severity: 'error',
        message: 'A trigger starts the workflow, so nothing can lead into it.',
        nodeKey: 'trig02',
        edgeId: 'slck01:out->trig02',
      },
    ]);
  });

  it('needs a Merge where two branches that both run join', () => {
    const graph = graphOf(
      [
        step('trig01', 'trigger.manual'),
        step('aaaa01', 'logic.setFields', { position: { x: 300, y: 0 } }),
        step('bbbb01', 'logic.setFields', { position: { x: 300, y: 200 } }),
        readySlack('slck01', { position: { x: 600, y: 0 } }),
      ],
      [
        line('trig01', 'aaaa01'),
        line('trig01', 'bbbb01'),
        line('aaaa01', 'slck01'),
        line('bbbb01', 'slck01'),
      ],
    );
    expect(only(validateGraph(graph, ctx()), 'graph.needs_merge')).toEqual([
      {
        severity: 'error',
        message: 'Two branches that both run need a Merge step to join.',
        nodeKey: 'slck01',
      },
    ]);

    const merged = graphOf(
      graph.nodes.map((node) =>
        node.key === 'slck01' ? step('slck01', 'logic.merge', { position: node.position }) : node,
      ),
      graph.edges,
    );
    expect(only(validateGraph(merged, ctx()), 'graph.needs_merge')).toEqual([]);
  });

  it('lets the two sides of an If / Else rejoin without a Merge', () => {
    const graph = cleanGraph();
    graph.nodes.push(
      step('join01', 'notify.inApp', { position: { x: 1200, y: 0 }, config: { title: 'Done' } }),
    );
    graph.edges.push(line('slck01', 'join01'), line('note01', 'join01'));
    expect(validateGraph(graph, ctx())).toEqual([]);
  });

  it('allows up to 50 steps and 120 lines', () => {
    const steps = [
      step('trig01', 'trigger.manual'),
      ...Array.from({ length: LIMITS.maxNodes }, (_, i) =>
        step(`step${String(i).padStart(2, '0')}`, 'logic.setFields'),
      ),
    ];
    const issues = validateGraph(graphOf(steps), ctx());
    expect(only(issues, 'graph.too_many_nodes')).toEqual([
      { severity: 'error', message: 'Workflows can have up to 50 steps.' },
    ]);
    expect(only(validateGraph(graphOf(steps.slice(0, 50)), ctx()), 'graph.too_many_nodes')).toEqual(
      [],
    );

    const many = graphOf(
      steps.slice(0, 2),
      Array.from({ length: 121 }, () => line('trig01', 'step00')),
    );
    expect(only(validateGraph(many, ctx()), 'graph.too_many_edges')).toEqual([
      { severity: 'error', message: 'Workflows can have up to 120 lines between steps.' },
    ]);
  });

  it('flags a step type that does not exist, or a version this code does not have', () => {
    const graph = cleanGraph();
    graph.nodes[3] = { ...graph.nodes[3], type: 'notify.pager' };
    graph.nodes[4] = { ...graph.nodes[4], typeVersion: 9 };
    expect(only(validateGraph(graph, ctx()), 'node.unknown_type')).toEqual([
      {
        severity: 'error',
        message: 'This step type is not available any more.',
        nodeKey: 'slck01',
      },
      {
        severity: 'error',
        message: 'This step type is not available any more.',
        nodeKey: 'note01',
      },
    ]);
  });

  it('flags a Coming Soon step', () => {
    const graph = graphOf(
      [step('trig01', 'trigger.manual'), step('wapp01', 'notify.whatsapp')],
      [line('trig01', 'wapp01')],
    );
    expect(only(validateGraph(graph, ctx()), 'node.coming_soon')).toEqual([
      {
        severity: 'error',
        message: 'WhatsApp is coming soon, so it cannot run yet.',
        nodeKey: 'wapp01',
      },
    ]);
  });

  it('flags a step the worker cannot run yet, unless it is off or nobody asked', () => {
    const graph = cleanGraph();
    const noSlack = new Set([...ALL_TYPES].filter((type) => type !== 'notify.slack'));
    expect(
      only(validateGraph(graph, ctx({ availableTypes: noSlack })), 'node.not_runnable'),
    ).toEqual([
      {
        severity: 'error',
        message: 'Slack cannot run yet in this version of PostGear.',
        nodeKey: 'slck01',
      },
    ]);
    expect(only(validateGraph(graph, { ...READY_CONTEXT }), 'node.not_runnable')).toEqual([]);
    graph.nodes[3] = { ...graph.nodes[3], disabled: true };
    expect(
      only(validateGraph(graph, ctx({ availableTypes: noSlack })), 'node.not_runnable'),
    ).toEqual([]);
  });

  it('lists each config problem in plain words, with the field to focus', () => {
    const graph = cleanGraph();
    graph.nodes[3] = {
      ...graph.nodes[3],
      config: { connectionId: 'conn_slack', message: 7, footer: true, colour: 'red' },
    };
    graph.nodes[1] = {
      ...graph.nodes[1],
      config: { fields: [{ name: 'has space', type: 'text', value: '' }] },
    };
    const issues = only(validateGraph(graph, ctx()), 'node.config_invalid');
    expect(issues).toEqual([
      {
        severity: 'error',
        message: 'Use letters, numbers and _ only.',
        nodeKey: 'setf01',
        field: 'fields.0.name',
      },
      {
        severity: 'error',
        message: 'This value is not valid here.',
        nodeKey: 'slck01',
        field: 'message',
      },
      {
        severity: 'error',
        message: 'This step has settings this version of PostGear does not know.',
        nodeKey: 'slck01',
      },
    ]);
  });

  it('refuses On Error on a trigger and Turn Off on an If / Else', () => {
    const graph = cleanGraph();
    graph.nodes[0] = { ...graph.nodes[0], onError: { mode: 'continue' } };
    graph.nodes[2] = { ...graph.nodes[2], disabled: true };
    expect(only(validateGraph(graph, ctx()), 'node.config_invalid')).toEqual([
      {
        severity: 'error',
        message: 'Post Published cannot have an On Error setting.',
        nodeKey: 'trig01',
        field: 'onError',
      },
      {
        severity: 'error',
        message: 'If / Else cannot be turned off.',
        nodeKey: 'ifel01',
        field: 'disabled',
      },
    ]);
  });

  it('asks for required fields, including ones that depend on another choice', () => {
    const graph = graphOf(
      [
        step('trig01', 'trigger.manual'),
        step('slck01', 'notify.slack', { config: { connectionId: 'conn_slack' } }),
        step('wait01', 'logic.delay', { config: { mode: 'until', until: '' } }),
        step('wait02', 'logic.delay', { config: { mode: 'for', until: '' } }),
      ],
      [line('trig01', 'slck01'), line('slck01', 'wait01'), line('wait01', 'wait02')],
    );
    expect(only(validateGraph(graph, ctx()), 'node.required_missing')).toEqual([
      {
        severity: 'error',
        message: 'Write the message to send.',
        nodeKey: 'slck01',
        field: 'message',
      },
      { severity: 'error', message: 'Choose when to go on.', nodeKey: 'wait01', field: 'until' },
    ]);
  });

  it('asks to connect an app, or to choose one of the connections there are', () => {
    const graph = graphOf(
      [
        step('trig01', 'trigger.manual'),
        step('slck01', 'notify.slack', { config: { message: 'Hi' } }),
      ],
      [line('trig01', 'slck01')],
    );
    expect(only(validateGraph(graph, ctx({ connections: [] })), 'node.connection_missing')).toEqual(
      [
        {
          severity: 'error',
          message: 'Connect a Slack account to use this step.',
          nodeKey: 'slck01',
          field: 'connectionId',
        },
      ],
    );
    expect(only(validateGraph(graph, ctx()), 'node.connection_missing')).toEqual([
      {
        severity: 'error',
        message: 'Choose a Slack connection.',
        nodeKey: 'slck01',
        field: 'connectionId',
      },
    ]);
  });

  it('flags a connection that was removed, or belongs to another app', () => {
    const graph = graphOf(
      [
        step('trig01', 'trigger.manual'),
        step('slck01', 'notify.slack', { config: { connectionId: 'conn_gone', message: 'Hi' } }),
        step('disc01', 'notify.discord', { config: { connectionId: 'conn_slack', message: 'Hi' } }),
      ],
      [line('trig01', 'slck01'), line('slck01', 'disc01')],
    );
    expect(only(validateGraph(graph, ctx()), 'node.connection_missing')).toEqual([
      {
        severity: 'error',
        message: 'This Slack connection was removed. Choose another one.',
        nodeKey: 'slck01',
        field: 'connectionId',
      },
      {
        severity: 'error',
        message: 'This Discord connection was removed. Choose another one.',
        nodeKey: 'disc01',
        field: 'connectionId',
      },
    ]);
  });

  it('runs HTTP Request without its optional secret headers connection', () => {
    const graph = graphOf(
      [
        step('trig01', 'trigger.manual'),
        step('http01', 'data.httpRequest', { config: { url: 'https://api.example.com' } }),
      ],
      [line('trig01', 'http01')],
    );
    expect(validateGraph(graph, ctx())).toEqual([]);
  });

  it('flags a connection that needs reconnecting', () => {
    const broken = ctx({
      connections: [{ ...READY_CONTEXT.connections[0], status: 'NEEDS_RECONNECT' }],
    });
    expect(only(validateGraph(cleanGraph(), broken), 'node.connection_broken')).toEqual([
      {
        severity: 'error',
        message: 'Marketing Slack needs to be reconnected.',
        nodeKey: 'slck01',
        field: 'connectionId',
      },
    ]);
  });

  it('flags a channel a step posts to when it was removed or is disconnected', () => {
    const graph = graphOf(
      [
        step('trig01', 'trigger.manual'),
        step('drft01', 'postgear.createDraft', {
          config: { channels: ['ch_gone', 'ch_ig'], text: 'Hi' },
        }),
      ],
      [line('trig01', 'drft01')],
    );
    const disconnected = ctx({
      channels: [
        { id: 'ch_ig', provider: 'instagram', name: 'Bloom Bakery', status: 'needsReconnect' },
      ],
    });
    expect(only(validateGraph(graph, disconnected), 'node.channel_missing')).toEqual([
      {
        severity: 'error',
        message: 'A channel in this step was removed.',
        nodeKey: 'drft01',
        field: 'channels',
      },
      {
        severity: 'error',
        message: 'Bloom Bakery is disconnected. Reconnect it on the Channels page.',
        nodeKey: 'drft01',
        field: 'channels',
      },
    ]);
  });

  it('keeps a Publish step to channels of its own platform, LinkedIn Pages included', () => {
    const publish = (provider: string) =>
      graphOf(
        [
          step('trig01', 'trigger.manual'),
          step('publ01', 'postgear.publish', {
            config: { provider, channels: ['ch_li'], text: 'Hi' },
          }),
        ],
        [line('trig01', 'publ01')],
      );
    expect(only(validateGraph(publish('instagram'), ctx()), 'node.channel_wrong_platform')).toEqual(
      [
        {
          severity: 'error',
          message: 'Bloom Ltd is not an Instagram channel.',
          nodeKey: 'publ01',
          field: 'channels',
        },
      ],
    );
    expect(validateGraph(publish('linkedin'), ctx())).toEqual([]);
  });

  it('only warns about a removed channel in a trigger filter, and allows one needing a reconnect', () => {
    const graph = graphOf([
      step('trig01', 'trigger.postFailed', { config: { channels: ['ch_gone', 'ch_ig'] } }),
    ]);
    const reconnect = ctx({
      channels: [
        { id: 'ch_ig', provider: 'instagram', name: 'Bloom Bakery', status: 'needsReconnect' },
      ],
    });
    const issues = validateGraph(graph, reconnect);
    expect(issues).toEqual([
      {
        severity: 'warning',
        code: 'node.filter_channel_missing',
        message: 'A channel in this filter was removed. Take it out of the filter.',
        nodeKey: 'trig01',
        field: 'channels',
      },
    ]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('wants every step name to be unique, ignoring case', () => {
    const graph = cleanGraph();
    graph.nodes[4] = { ...graph.nodes[4], name: ' SLCK01 ' };
    expect(only(validateGraph(graph, ctx()), 'node.duplicate_name')).toEqual([
      {
        severity: 'error',
        message: 'Another step is already called "SLCK01". Rename this one.',
        nodeKey: 'note01',
        field: 'name',
      },
    ]);
  });

  it('warns when data comes from a step that is turned off', () => {
    const graph = graphOf(
      [
        step('trig01', 'trigger.manual'),
        readySlack('slck01', { name: 'Slack', disabled: true }),
        step('note01', 'notify.inApp', {
          config: {
            title: 'Sent {{ nodes.slck01.output.preview }}',
            message: '{{nodes.slck01.output}} and {{ nodes.slck01.output.nope | upper }}',
          },
        }),
      ],
      [line('trig01', 'slck01'), line('slck01', 'note01')],
    );
    expect(only(validateGraph(graph, ctx()), 'node.disabled_output_used')).toEqual([
      {
        severity: 'warning',
        message: "Slack is turned off, so 'Message Preview' will be empty.",
        nodeKey: 'note01',
        field: 'title',
      },
      {
        severity: 'warning',
        message: 'Slack is turned off, so its data will be empty.',
        nodeKey: 'note01',
        field: 'message',
      },
      {
        severity: 'warning',
        message: 'Slack is turned off, so its data will be empty.',
        nodeKey: 'note01',
        field: 'message',
      },
    ]);
  });

  it('does not ask a turned-off step for its fields, connection or channels', () => {
    const graph = graphOf(
      [
        step('trig01', 'trigger.manual'),
        step('slck01', 'notify.slack', { disabled: true }),
        step('drft01', 'postgear.createDraft', {
          disabled: true,
          config: { channels: ['ch_gone'] },
        }),
      ],
      [line('trig01', 'slck01'), line('slck01', 'drft01')],
    );
    expect(validateGraph(graph, ctx())).toEqual([]);
  });

  it('warns when one side of an If / Else leads nowhere', () => {
    const graph = cleanGraph();
    graph.edges = graph.edges.filter((edge) => edge.sourcePort !== 'false');
    graph.nodes = graph.nodes.filter((node) => node.key !== 'note01');
    expect(only(validateGraph(graph, ctx()), 'graph.dead_end_output')).toEqual([
      { severity: 'warning', message: 'Nothing happens when this is False.', nodeKey: 'ifel01' },
    ]);
  });

  it('never throws: a broken rule becomes one issue', () => {
    const boom = () => {
      throw new Error('bug');
    };
    expect(validateGraph(cleanGraph(), ctx(), [boom, boom])).toEqual([
      {
        severity: 'error',
        code: 'graph.check_failed',
        message: 'PostGear could not check part of this workflow. Reload the page and try again.',
      },
    ]);
  });

  it('copes with config that is not an object in an unsaved graph', () => {
    const graph = cleanGraph();
    graph.nodes[3] = { ...graph.nodes[3], config: null as unknown as Record<string, unknown> };
    const issues = validateGraph(graph, ctx());
    expect(issues.some((issue) => issue.code === 'graph.check_failed')).toBe(false);
    expect(only(issues, 'node.config_invalid')).toHaveLength(1);
  });

  it('writes every message as a plain sentence without builder jargon', () => {
    const bad = graphOf(
      [
        step('trig01', 'trigger.manual', { onError: { mode: 'stop' } }),
        step('trig02', 'trigger.manual'),
        step('wapp01', 'notify.whatsapp'),
        step('slck01', 'notify.slack', { config: { connectionId: 'x' } }),
        step('ifel01', 'logic.ifElse', { disabled: true, name: 'slck01' }),
        step('lone01', 'notify.email'),
        step('drft01', 'postgear.createDraft', { config: { channels: ['gone'] } }),
      ],
      [
        line('trig01', 'wapp01'),
        line('wapp01', 'slck01'),
        line('trig01', 'slck01'),
        line('slck01', 'ifel01'),
      ],
    );
    const messages = validateGraph(bad, ctx({ availableTypes: new Set() })).map((i) => i.message);
    expect(messages.length).toBeGreaterThan(10);
    for (const message of messages) {
      expect(message).toMatch(/^[A-Z].*[.]$/);
      expect(message).not.toMatch(/\b(node|payload|json|cron|execution|edge|port|schema)\b/i);
    }
  });
});
