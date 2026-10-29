/** @jest-environment node */
import {
  type AutomationGraph,
  emptyGraph,
  getTemplate,
  instantiateTemplate,
} from '@postgear/automation';
import { CARD_HEIGHT, CARD_WIDTH, createStep, makeEdge } from '../builder/graph-ops';
import { tidyPositions } from './tidy-up';

function template(id: string): AutomationGraph {
  const found = getTemplate(id);
  if (!found) throw new Error(`missing template ${id}`);
  return instantiateTemplate(found, (key) => key);
}

function scramble(graph: AutomationGraph): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node, index) =>
      index === 0 ? node : { ...node, position: { x: 900 - index * 120, y: index * 300 } },
    ),
  };
}

function overlap(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < CARD_WIDTH && Math.abs(a.y - b.y) < CARD_HEIGHT;
}

describe('tidyPositions', () => {
  it.each(['publishing-report', 'ai-weekly-post', 'failed-post-alert'])(
    'lays out %s the same way every time, left to right, without overlaps',
    (id) => {
      const graph = scramble(template(id));
      const first = tidyPositions(graph);
      expect(tidyPositions(graph)).toEqual(first);
      expect(tidyPositions({ ...graph, nodes: [...graph.nodes].reverse() })).toEqual(first);

      // The trigger is the anchor.
      expect(first[graph.nodes[0].key]).toEqual(graph.nodes[0].position);
      for (const edge of graph.edges) {
        expect(first[edge.target].x).toBeGreaterThan(first[edge.source].x);
      }
      const keys = Object.keys(first);
      for (let i = 0; i < keys.length; i += 1) {
        expect(first[keys[i]].x % 12).toBe(0);
        for (let j = i + 1; j < keys.length; j += 1) {
          expect(overlap(first[keys[i]], first[keys[j]])).toBe(false);
        }
      }
    },
  );

  it('keeps True above False', () => {
    let graph = emptyGraph();
    const add = (type: string, key: string, y: number) => {
      const step = createStep(graph, type, key, { x: 0, y });
      if (!step) throw new Error(type);
      graph = { ...graph, nodes: [...graph.nodes, step] };
    };
    add('trigger.manual', 'start0001', 0);
    add('logic.ifElse', 'check0001', 0);
    // Saved the wrong way round on purpose.
    add('notify.inApp', 'nope00001', -400);
    add('notify.inApp', 'yes000001', 400);
    graph = {
      ...graph,
      edges: [
        makeEdge('start0001', 'out', 'check0001'),
        makeEdge('check0001', 'false', 'nope00001'),
        makeEdge('check0001', 'true', 'yes000001'),
      ],
    };
    const positions = tidyPositions(graph);
    expect(positions.yes000001.y).toBeLessThan(positions.nope00001.y);
  });

  it('does nothing to an empty canvas', () => {
    expect(tidyPositions(emptyGraph())).toEqual({});
  });
});
