import type { AutomationPreview } from '@/types/workflows';
import { orderSteps, previewFromGraph, stepLabel } from './workflow-preview';

const step = (key: string, x: number, y: number, name = key, type = 'logic.setFields') => ({
  key,
  type,
  name,
  x,
  y,
});

describe('previewFromGraph', () => {
  it('keeps names, positions, kinds and links, and counts every step', () => {
    const graph = {
      schemaVersion: 1,
      nodes: [
        { key: 'a', type: 'trigger.manual', name: 'Start', position: { x: 1, y: 2 } },
        {
          key: 'b',
          type: 'notify.slack',
          name: 'Tell The Team',
          position: { x: 3, y: 4 },
          disabled: true,
        },
      ],
      edges: [{ id: 'e', source: 'a', sourcePort: 'out', target: 'b', targetPort: 'in' }],
      notes: [],
    };
    expect(previewFromGraph(graph as never)).toEqual({
      nodes: [
        { key: 'a', type: 'trigger.manual', name: 'Start', x: 1, y: 2 },
        { key: 'b', type: 'notify.slack', name: 'Tell The Team', x: 3, y: 4, disabled: true },
      ],
      edges: [{ source: 'a', target: 'b' }],
      stepCount: 2,
    });
  });

  it('holds a long flow to 40 steps and still counts them all', () => {
    const nodes = Array.from({ length: 45 }, (_, index) => ({
      key: `n${index}`,
      type: 'logic.setFields',
      name: `Step ${index}`,
      position: { x: index, y: 0 },
    }));
    const preview = previewFromGraph({ schemaVersion: 1, nodes, edges: [], notes: [] } as never);
    expect(preview.nodes).toHaveLength(40);
    expect(preview.stepCount).toBe(45);
  });
});

describe('orderSteps', () => {
  it('reads left to right, then top to bottom', () => {
    const steps: AutomationPreview['nodes'] = [
      step('late', 640, 0),
      step('low', 320, 120),
      step('high', 320, -120),
      step('first', 0, 0),
    ];
    expect(orderSteps(steps).map((entry) => entry.key)).toEqual(['first', 'high', 'low', 'late']);
  });

  it('leaves the list it was given as it was', () => {
    const steps = [step('b', 320, 0), step('a', 0, 0)];
    orderSteps(steps);
    expect(steps.map((entry) => entry.key)).toEqual(['b', 'a']);
  });
});

describe('stepLabel', () => {
  it('uses the step name, and the kind of step when it has none', () => {
    expect(stepLabel(step('a', 0, 0, 'Weekly Digest'))).toBe('Weekly Digest');
    expect(stepLabel(step('a', 0, 0, '  ', 'notify.slack'))).toBe('Slack');
    expect(stepLabel(step('a', 0, 0, '', 'nope.unknown'))).toBe('nope.unknown');
  });
});
