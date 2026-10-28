import { graphOf, line, step } from '../testing/builders';
import {
  automationGraphSchema,
  edgeId,
  emptyGraph,
  GRAPH_SCHEMA_VERSION,
  uniqueNodeName,
  upgradeGraph,
} from './schema';

const valid = graphOf(
  [step('trig01', 'trigger.manual'), step('slack1', 'notify.slack')],
  [line('trig01', 'slack1')],
);

describe('graph schema', () => {
  it('accepts a well-formed graph and an empty one', () => {
    expect(automationGraphSchema.safeParse(valid).success).toBe(true);
    expect(automationGraphSchema.safeParse(emptyGraph()).success).toBe(true);
  });

  it('refuses unknown keys on the graph, a step, a line and a note, so nothing rides along', () => {
    const cases = [
      { ...valid, extra: true },
      { ...valid, nodes: [{ ...valid.nodes[0], webhookUrl: 'https://hooks.slack.com/x' }] },
      { ...valid, edges: [{ ...valid.edges[0], label: 'x' }] },
      {
        ...valid,
        notes: [
          {
            id: 'note01',
            position: { x: 0, y: 0 },
            size: { w: 200, h: 100 },
            text: 'Hi',
            colour: 'yellow',
            secret: 'x',
          },
        ],
      },
      { ...valid, nodes: [{ ...valid.nodes[0], onError: { mode: 'stop', why: 'x' } }] },
    ];
    for (const candidate of cases) {
      expect(automationGraphSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it('refuses two steps with the same key', () => {
    const twin = { ...valid, nodes: [valid.nodes[0], { ...valid.nodes[1], key: 'trig01' }] };
    expect(automationGraphSchema.safeParse(twin).success).toBe(false);
  });

  it('refuses a line whose id does not match its ends, a duplicate line, and a dangling line', () => {
    const wrongId = { ...valid, edges: [{ ...valid.edges[0], id: 'whatever' }] };
    const duplicate = { ...valid, edges: [valid.edges[0], valid.edges[0]] };
    const dangling = { ...valid, edges: [line('trig01', 'ghost1')] };
    for (const candidate of [wrongId, duplicate, dangling]) {
      expect(automationGraphSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it('refuses two notes with the same id', () => {
    const note = {
      id: 'note01',
      position: { x: 0, y: 0 },
      size: { w: 200, h: 100 },
      text: '',
      colour: 'blue' as const,
    };
    expect(automationGraphSchema.safeParse({ ...valid, notes: [note, note] }).success).toBe(false);
  });

  it('refuses a port that does not exist and a target port other than in', () => {
    const badPort = { ...valid, edges: [{ ...valid.edges[0], sourcePort: 'sideways' }] };
    const badTarget = { ...valid, edges: [{ ...valid.edges[0], targetPort: 'out' }] };
    expect(automationGraphSchema.safeParse(badPort).success).toBe(false);
    expect(automationGraphSchema.safeParse(badTarget).success).toBe(false);
  });

  it('keeps step config open, since each type validates its own', () => {
    const custom = {
      ...valid,
      nodes: [{ ...valid.nodes[0], config: { anything: 1 } }, valid.nodes[1]],
    };
    expect(automationGraphSchema.safeParse(custom).success).toBe(true);
  });

  it('derives line ids from their ends, Paths cases included', () => {
    expect(edgeId('a1b2', 'out', 'c3d4')).toBe('a1b2:out->c3d4');
    expect(edgeId('a1b2', 'case:x1', 'c3d4')).toBe('a1b2:case:x1->c3d4');
  });
});

describe('upgradeGraph', () => {
  it('returns a version 1 graph as it is', () => {
    expect(upgradeGraph(valid)).toEqual(valid);
    expect(upgradeGraph(emptyGraph())).toEqual(emptyGraph());
  });

  it('refuses a graph from a newer PostGear with a sentence', () => {
    expect(() => upgradeGraph({ ...valid, schemaVersion: GRAPH_SCHEMA_VERSION + 1 })).toThrow(
      /newer version of PostGear/,
    );
  });

  it('refuses data that is not a graph', () => {
    expect(() => upgradeGraph(null)).toThrow();
    expect(() => upgradeGraph({ nodes: [] })).toThrow();
  });
});

describe('uniqueNodeName', () => {
  it('keeps a free name and numbers a taken one, ignoring case', () => {
    expect(uniqueNodeName('Filter', valid)).toBe('Filter');
    const named = graphOf([step('a1b2', 'notify.slack', { name: 'Slack' })]);
    expect(uniqueNodeName('slack', named)).toBe('slack 2');
    const two = graphOf([
      step('a1b2', 'notify.slack', { name: 'Slack' }),
      step('c3d4', 'notify.slack', { name: 'Slack 2' }),
    ]);
    expect(uniqueNodeName('Slack', two)).toBe('Slack 3');
    expect(uniqueNodeName('   ', emptyGraph())).toBe('Step');
  });
});
