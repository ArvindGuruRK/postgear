import { graphOf, line, step } from '../testing/builders';
import { buildIndex, edgesFrom, reaches } from './build-index';
import { areExclusive, branchConditions, exclusiveGroups } from './exclusive';
import { topologicalOrder, upstreamOf } from './order';

const at = (x: number, y: number) => ({ position: { x, y } });

describe('topologicalOrder', () => {
  it('puts every step after the steps it depends on', () => {
    const graph = graphOf(
      [
        step('cccc01', 'notify.slack', at(600, 0)),
        step('trig01', 'trigger.manual', at(0, 0)),
        step('bbbb01', 'logic.filter', at(300, 0)),
      ],
      [line('bbbb01', 'cccc01'), line('trig01', 'bbbb01')],
    );
    expect(topologicalOrder(graph)).toEqual(['trig01', 'bbbb01', 'cccc01']);
  });

  it('breaks ties by canvas y, then x, then key', () => {
    const graph = graphOf(
      [
        step('trig01', 'trigger.manual', at(0, 100)),
        step('low001', 'logic.setFields', at(300, 300)),
        step('high01', 'logic.setFields', at(300, 0)),
        step('left01', 'logic.setFields', at(100, 200)),
        step('rite01', 'logic.setFields', at(500, 200)),
        step('same02', 'logic.setFields', at(700, 400)),
        step('same01', 'logic.setFields', at(700, 400)),
      ],
      ['low001', 'high01', 'left01', 'rite01', 'same02', 'same01'].map((key) =>
        line('trig01', key),
      ),
    );
    expect(topologicalOrder(graph)).toEqual([
      'trig01',
      'high01',
      'left01',
      'rite01',
      'low001',
      'same01',
      'same02',
    ]);
  });

  it('gives the same order whatever order the arrays were saved in', () => {
    const nodes = [
      step('trig01', 'trigger.manual', at(0, 0)),
      step('iiii01', 'logic.ifElse', at(300, 0)),
      step('aaaa01', 'logic.setFields', at(600, -100)),
      step('bbbb01', 'logic.setFields', at(600, 100)),
      step('mmmm01', 'logic.setFields', at(900, 0)),
    ];
    const edges = [
      line('trig01', 'iiii01'),
      line('iiii01', 'aaaa01', 'true'),
      line('iiii01', 'bbbb01', 'false'),
      line('aaaa01', 'mmmm01'),
      line('bbbb01', 'mmmm01'),
    ];
    const expected = topologicalOrder(graphOf(nodes, edges));
    for (let shift = 1; shift < 5; shift++) {
      const rotated = <T>(list: T[]) => [...list.slice(shift), ...list.slice(0, shift)];
      expect(topologicalOrder(graphOf(rotated(nodes), rotated(edges).reverse()))).toEqual(expected);
    }
    expect(expected).toEqual(['trig01', 'iiii01', 'aaaa01', 'bbbb01', 'mmmm01']);
  });

  it('leaves out steps in or after a loop', () => {
    const graph = graphOf(
      [
        step('trig01', 'trigger.manual'),
        step('aaaa01', 'logic.setFields'),
        step('bbbb01', 'logic.setFields'),
        step('cccc01', 'logic.setFields'),
      ],
      [
        line('trig01', 'aaaa01'),
        line('aaaa01', 'bbbb01'),
        line('bbbb01', 'aaaa01'),
        line('bbbb01', 'cccc01'),
      ],
    );
    expect(topologicalOrder(graph)).toEqual(['trig01']);
    expect(buildIndex(graph).cyclic).toEqual(['aaaa01', 'bbbb01', 'cccc01']);
  });

  it('ignores a dangling line in an unsaved graph', () => {
    const graph = graphOf([step('trig01', 'trigger.manual')], [line('trig01', 'ghost1')]);
    expect(buildIndex(graph).edges.size).toBe(0);
    expect(topologicalOrder(graph)).toEqual(['trig01']);
  });
});

describe('upstreamOf', () => {
  const graph = graphOf(
    [
      step('trig01', 'trigger.manual', at(0, 0)),
      step('aaaa01', 'logic.setFields', at(300, 0)),
      step('bbbb01', 'logic.setFields', at(300, 200)),
      step('cccc01', 'logic.merge', at(600, 0)),
      step('dddd01', 'notify.slack', at(900, 0)),
      step('side01', 'notify.slack', at(600, 400)),
    ],
    [
      line('trig01', 'aaaa01'),
      line('trig01', 'bbbb01'),
      line('aaaa01', 'cccc01'),
      line('bbbb01', 'cccc01'),
      line('cccc01', 'dddd01'),
      line('bbbb01', 'side01'),
    ],
  );

  it('lists every ancestor in run order, and nothing downstream or beside', () => {
    expect(upstreamOf(graph, 'dddd01')).toEqual(['trig01', 'aaaa01', 'bbbb01', 'cccc01']);
    expect(upstreamOf(graph, 'side01')).toEqual(['trig01', 'bbbb01']);
    expect(upstreamOf(graph, 'trig01')).toEqual([]);
    expect(upstreamOf(buildIndex(graph), 'aaaa01')).toEqual(['trig01']);
  });

  it('still answers inside a loop', () => {
    const loop = graphOf(
      [step('aaaa01', 'logic.setFields'), step('bbbb01', 'logic.setFields')],
      [line('aaaa01', 'bbbb01'), line('bbbb01', 'aaaa01')],
    );
    expect(upstreamOf(loop, 'aaaa01')).toEqual(['bbbb01']);
  });
});

describe('graph index helpers', () => {
  it('finds lines by port and follows lines', () => {
    const graph = graphOf(
      [step('iiii01', 'logic.ifElse'), step('aaaa01', 'notify.slack')],
      [line('iiii01', 'aaaa01', 'true')],
    );
    const index = buildIndex(graph);
    expect(edgesFrom(index, 'iiii01', 'true')).toHaveLength(1);
    expect(edgesFrom(index, 'iiii01', 'false')).toHaveLength(0);
    expect(reaches(index, 'iiii01', 'aaaa01')).toBe(true);
    expect(reaches(index, 'aaaa01', 'iiii01')).toBe(false);
  });
});

describe('mutually exclusive branches', () => {
  const graph = graphOf(
    [
      step('trig01', 'trigger.manual', at(0, 0)),
      step('iiii01', 'logic.ifElse', at(200, 0)),
      step('yes001', 'logic.setFields', at(400, -100)),
      step('no0001', 'logic.setFields', at(400, 100)),
      step('join01', 'notify.slack', at(600, 0)),
      step('after1', 'notify.slack', at(800, 0)),
      step('fan001', 'logic.setFields', at(200, 300)),
      step('fan002', 'logic.setFields', at(200, 400)),
      step('filt01', 'logic.filter', at(400, 300)),
      step('rev001', 'logic.manualReview', at(200, 600)),
      step('slk001', 'notify.slack', { ...at(200, 800), onError: { mode: 'branch' } }),
    ],
    [
      line('trig01', 'iiii01'),
      line('iiii01', 'yes001', 'true'),
      line('iiii01', 'no0001', 'false'),
      line('yes001', 'join01'),
      line('no0001', 'join01'),
      line('join01', 'after1'),
      line('trig01', 'fan001'),
      line('trig01', 'fan002'),
      line('fan001', 'filt01'),
      line('trig01', 'rev001'),
      line('trig01', 'slk001'),
    ],
  );

  it('treats the two sides of one If / Else as exclusive, right next to it and further along', () => {
    expect(areExclusive(graph, 'iiii01:true->yes001', 'iiii01:false->no0001')).toBe(true);
    expect(areExclusive(graph, 'yes001:out->join01', 'no0001:out->join01')).toBe(true);
  });

  it('lets a rejoin run unconditionally again', () => {
    expect([...(branchConditions(graph).get('join01') ?? [])]).toEqual([['trig01', 'out']]);
    expect([...(branchConditions(graph).get('yes001') ?? [])]).toEqual([
      ['trig01', 'out'],
      ['iiii01', 'true'],
    ]);
  });

  it('never treats parallel fan-out or a Filter as exclusive', () => {
    expect(areExclusive(graph, 'trig01:out->fan001', 'trig01:out->fan002')).toBe(false);
    expect(areExclusive(graph, 'fan001:out->filt01', 'trig01:out->fan002')).toBe(false);
    expect(areExclusive(graph, 'trig01:out->fan001', 'trig01:out->fan001')).toBe(false);
    expect(areExclusive(graph, 'trig01:out->fan001', 'nope')).toBe(false);
  });

  it('groups the lines of every step with more than one output', () => {
    expect(exclusiveGroups(graph)).toEqual([
      {
        nodeKey: 'iiii01',
        branches: [
          { port: 'true', edgeIds: ['iiii01:true->yes001'] },
          { port: 'false', edgeIds: ['iiii01:false->no0001'] },
        ],
      },
      {
        nodeKey: 'rev001',
        branches: [
          { port: 'approved', edgeIds: [] },
          { port: 'rejected', edgeIds: [] },
        ],
      },
      {
        nodeKey: 'slk001',
        branches: [
          { port: 'out', edgeIds: [] },
          { port: 'error', edgeIds: [] },
        ],
      },
    ]);
  });
});
