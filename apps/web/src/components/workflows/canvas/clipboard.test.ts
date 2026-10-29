import {
  type AutomationGraph,
  emptyGraph,
  getTemplate,
  instantiateTemplate,
} from '@postgear/automation';
import { copySteps, PASTE_TRIGGER_LEFT_OUT, pasteSteps, readClipboard } from './clipboard';

function report(): AutomationGraph {
  const template = getTemplate('publishing-report');
  if (!template) throw new Error('missing template');
  return instantiateTemplate(template, (key) => key);
}

let counter = 0;
const makeKey = () => `new${String(counter++).padStart(7, '0')}`;

describe('clipboard', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('round trips steps and the lines between them only', () => {
    const graph = report();
    const text = copySteps(graph, ['fields', 'sheet']);
    expect(text).not.toBeNull();
    const data = readClipboard(text as string);
    expect(data?.nodes.map((node) => node.key)).toEqual(['fields', 'sheet']);
    expect(data?.edges.map((edge) => edge.id)).toEqual(['fields:out->sheet']);
  });

  it('refuses text PostGear did not copy', () => {
    expect(readClipboard('hello')).toBeNull();
    expect(readClipboard('{"kind":"postgear.steps","version":1,"nodes":[],"edges":[]}')).toBeNull();
    expect(
      readClipboard(
        JSON.stringify({
          kind: 'postgear.steps',
          version: 1,
          nodes: [{ key: 'x', type: 'notify.slack' }],
          edges: [],
        }),
      ),
    ).toBeNull();
    expect(readClipboard('{"kind":"postgear.steps", broken')).toBeNull();
  });

  it('re-keys, rewrites data chips between pasted steps and offsets by 48 px', () => {
    const graph = report();
    const slack = graph.nodes.find((node) => node.key === 'slack');
    const withChip: AutomationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.key === 'slack'
          ? {
              ...node,
              config: { ...node.config, message: 'Row {{ nodes.sheet.output.rowNumber }}' },
            }
          : node,
      ),
    };
    const data = readClipboard(copySteps(withChip, ['sheet', 'slack']) as string);
    if (!data) throw new Error('no data');

    const result = pasteSteps(data, withChip, { makeKey, connectionIds: new Set() });
    expect(result.nodes.map((node) => node.key)).toEqual(['new0000000', 'new0000001']);
    expect(result.nodes[1].config.message).toBe('Row {{ nodes.new0000000.output.rowNumber }}');
    expect(result.nodes[1].position).toEqual({
      x: (slack?.position.x ?? 0) + 48,
      y: (slack?.position.y ?? 0) + 48,
    });
    expect(result.nodes[1].name).toBe('Slack 2');
    expect(result.edges.map((edge) => edge.id)).toEqual(['new0000000:out->new0000001']);
    expect(result.note).toBeNull();
  });

  it('clears connection ids this workspace does not have', () => {
    const graph = report();
    const linked: AutomationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.key === 'slack'
          ? { ...node, config: { ...node.config, connectionId: 'theirs' } }
          : node,
      ),
    };
    const data = readClipboard(copySteps(linked, ['slack']) as string);
    if (!data) throw new Error('no data');
    expect(
      pasteSteps(data, emptyGraph(), { makeKey, connectionIds: new Set() }).nodes[0].config
        .connectionId,
    ).toBe('');
    expect(
      pasteSteps(data, emptyGraph(), { makeKey, connectionIds: new Set(['theirs']) }).nodes[0]
        .config.connectionId,
    ).toBe('theirs');
  });

  it('leaves out a second trigger and says so', () => {
    const graph = report();
    const data = readClipboard(copySteps(graph, ['published', 'fields']) as string);
    if (!data) throw new Error('no data');
    const result = pasteSteps(data, graph, { makeKey, connectionIds: new Set() });
    expect(result.nodes.map((node) => node.type)).toEqual(['logic.setFields']);
    expect(result.edges).toEqual([]);
    expect(result.note).toBe(PASTE_TRIGGER_LEFT_OUT);

    // Into an empty workflow the trigger comes along.
    const intoEmpty = pasteSteps(data, emptyGraph(), { makeKey, connectionIds: new Set() });
    expect(intoEmpty.nodes).toHaveLength(2);
    expect(intoEmpty.edges).toHaveLength(1);
  });
});
