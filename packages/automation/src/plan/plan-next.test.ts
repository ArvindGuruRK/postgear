import type { NodeType } from '../catalog/types';
import type { AutomationGraph, GraphNode, PortId } from '../graph/schema';
import { graphOf, line, step } from '../testing/builders';
import {
  type PlanOutcome,
  type PlanStepState,
  planNext,
  type RunPlanState,
  type SkippedStep,
} from './plan-next';

const at = (x: number, y = 0) => ({ position: { x, y } });

/** A step placed on the canvas; position decides ties in run order. */
function s(key: string, type: NodeType, x: number, y = 0, extra: Partial<GraphNode> = {}) {
  return step(key, type, { ...at(x, y), ...extra });
}

interface Played {
  started: string[];
  skipped: SkippedStep[];
  bypassed: string[];
  outcome?: PlanOutcome;
  calls: number;
}

/**
 * Plays a whole run the way the run workflow will: start what is ready,
 * record what is skipped or turned off, and finish each started step with
 * what `results` says (succeeded through `out` by default).
 */
function play(graph: AutomationGraph, results: Record<string, PlanStepState> = {}): Played {
  const state: Record<string, PlanStepState> = {};
  const played: Played = { started: [], skipped: [], bypassed: [], calls: 0 };
  for (;;) {
    played.calls++;
    if (played.calls > 50) throw new Error('planNext did not finish');
    const next = planNext(graph, state);
    for (const skipped of next.skipped) state[skipped.key] = { status: 'skipped' };
    for (const key of next.bypassed) state[key] = { status: 'off', ports: ['out'] };
    played.skipped.push(...next.skipped);
    played.bypassed.push(...next.bypassed);
    if (next.finished) {
      played.outcome = next.outcome;
      return played;
    }
    for (const key of next.ready) {
      played.started.push(key);
      state[key] = results[key] ?? { status: 'succeeded', ports: ['out'] };
    }
  }
}

const ok = (...ports: PortId[]): PlanStepState => ({ status: 'succeeded', ports });

describe('planNext', () => {
  it('runs a straight line in order and succeeds', () => {
    const graph = graphOf(
      [
        s('trig01', 'trigger.manual', 0),
        s('aaaa01', 'logic.setFields', 300),
        s('bbbb01', 'notify.slack', 600),
      ],
      [line('trig01', 'aaaa01'), line('aaaa01', 'bbbb01')],
    );
    expect(play(graph)).toMatchObject({
      started: ['trig01', 'aaaa01', 'bbbb01'],
      skipped: [],
      outcome: 'succeeded',
    });
  });

  it('starts only the trigger first, and waits while a step is running', () => {
    const graph = graphOf(
      [s('trig01', 'trigger.manual', 0), s('aaaa01', 'notify.slack', 300)],
      [line('trig01', 'aaaa01')],
    );
    expect(planNext(graph, {})).toEqual({
      ready: ['trig01'],
      skipped: [],
      bypassed: [],
      finished: false,
    });
    expect(planNext(graph, { trig01: { status: 'running' } })).toEqual({
      ready: [],
      skipped: [],
      bypassed: [],
      finished: false,
    });
    expect(planNext(graph, { trig01: ok('out') }).ready).toEqual(['aaaa01']);
  });

  describe('If / Else', () => {
    const graph = graphOf(
      [
        s('trig01', 'trigger.manual', 0),
        s('iiii01', 'logic.ifElse', 300),
        s('yes001', 'notify.slack', 600, -100),
        s('yes002', 'notify.slack', 900, -100),
        s('no0001', 'notify.slack', 600, 100),
        s('no0002', 'notify.slack', 900, 100),
      ],
      [
        line('trig01', 'iiii01'),
        line('iiii01', 'yes001', 'true'),
        line('yes001', 'yes002'),
        line('iiii01', 'no0001', 'false'),
        line('no0001', 'no0002'),
      ],
    );

    it('runs the True side and skips the False side, and everything only reachable through it', () => {
      const played = play(graph, { iiii01: ok('true') });
      expect(played.started).toEqual(['trig01', 'iiii01', 'yes001', 'yes002']);
      expect(played.skipped).toEqual([
        { key: 'no0001', reason: 'branchNotTaken' },
        { key: 'no0002', reason: 'branchNotTaken' },
      ]);
      expect(played.outcome).toBe('succeeded');
    });

    it('runs the False side when the rules do not match', () => {
      const played = play(graph, { iiii01: ok('false') });
      expect(played.started).toEqual(['trig01', 'iiii01', 'no0001', 'no0002']);
      expect(played.skipped.map((skip) => skip.key)).toEqual(['yes001', 'yes002']);
    });

    it('runs a step where both sides rejoin, whichever side ran', () => {
      const rejoin = graphOf(
        [...graph.nodes, s('join01', 'notify.slack', 1200)],
        [...graph.edges, line('yes002', 'join01'), line('no0002', 'join01')],
      );
      expect(play(rejoin, { iiii01: ok('false') }).started).toEqual([
        'trig01',
        'iiii01',
        'no0001',
        'no0002',
        'join01',
      ]);
    });
  });

  it('sends Paths down the matching case, or Otherwise, and skips the rest', () => {
    const graph = graphOf(
      [
        s('trig01', 'trigger.manual', 0),
        s('path01', 'logic.switch', 300),
        s('casea1', 'notify.slack', 600, 0),
        s('caseb1', 'notify.slack', 600, 100),
        s('other1', 'notify.slack', 600, 200),
      ],
      [
        line('trig01', 'path01'),
        line('path01', 'casea1', 'case:a'),
        line('path01', 'caseb1', 'case:b'),
        line('path01', 'other1', 'fallback'),
      ],
    );
    expect(play(graph, { path01: ok('fallback') })).toMatchObject({
      started: ['trig01', 'path01', 'other1'],
      skipped: [
        { key: 'casea1', reason: 'branchNotTaken' },
        { key: 'caseb1', reason: 'branchNotTaken' },
      ],
      outcome: 'succeeded',
    });
    expect(play(graph, { path01: ok('case:b') }).started).toEqual(['trig01', 'path01', 'caseb1']);
  });

  it('ends only its own branch when a Filter does not pass', () => {
    const graph = graphOf(
      [
        s('trig01', 'trigger.manual', 0),
        s('filt01', 'logic.filter', 300, 0),
        s('after1', 'notify.slack', 600, 0),
        s('after2', 'notify.slack', 900, 0),
        s('other1', 'notify.slack', 300, 200),
      ],
      [
        line('trig01', 'filt01'),
        line('filt01', 'after1'),
        line('after1', 'after2'),
        line('trig01', 'other1'),
      ],
    );
    const played = play(graph, { filt01: ok() });
    expect(played.started).toEqual(['trig01', 'filt01', 'other1']);
    expect(played.skipped.map((skip) => skip.key)).toEqual(['after1', 'after2']);
    expect(played.outcome).toBe('succeeded');
  });

  describe('Manual Review', () => {
    const nodes = [
      s('trig01', 'trigger.manual', 0),
      s('revw01', 'logic.manualReview', 300),
      s('draft1', 'postgear.createDraft', 600, 0),
      s('sorry1', 'notify.inApp', 600, 200),
    ];

    it('goes on through Approved', () => {
      const graph = graphOf(nodes.slice(0, 3), [
        line('trig01', 'revw01'),
        line('revw01', 'draft1', 'approved'),
      ]);
      expect(play(graph, { revw01: ok('approved') })).toMatchObject({
        started: ['trig01', 'revw01', 'draft1'],
        outcome: 'succeeded',
      });
    });

    it('ends the run as Rejected when nothing is connected to Rejected', () => {
      const graph = graphOf(nodes.slice(0, 3), [
        line('trig01', 'revw01'),
        line('revw01', 'draft1', 'approved'),
      ]);
      expect(play(graph, { revw01: ok('rejected') })).toMatchObject({
        started: ['trig01', 'revw01'],
        skipped: [{ key: 'draft1', reason: 'branchNotTaken' }],
        outcome: 'rejected',
      });
    });

    it('follows the Rejected line when there is one, and succeeds', () => {
      const graph = graphOf(nodes, [
        line('trig01', 'revw01'),
        line('revw01', 'draft1', 'approved'),
        line('revw01', 'sorry1', 'rejected'),
      ]);
      expect(play(graph, { revw01: ok('rejected') })).toMatchObject({
        started: ['trig01', 'revw01', 'sorry1'],
        skipped: [{ key: 'draft1', reason: 'branchNotTaken' }],
        outcome: 'succeeded',
      });
    });
  });

  it('starts parallel branches together after a fan-out', () => {
    const graph = graphOf(
      [
        s('trig01', 'trigger.manual', 0),
        s('aaaa01', 'notify.slack', 300, 0),
        s('bbbb01', 'notify.discord', 300, 100),
        s('cccc01', 'notify.email', 300, 200),
      ],
      [line('trig01', 'aaaa01'), line('trig01', 'bbbb01'), line('trig01', 'cccc01')],
    );
    expect(planNext(graph, { trig01: ok('out') }).ready).toEqual(['aaaa01', 'bbbb01', 'cccc01']);
    expect(play(graph).outcome).toBe('succeeded');
  });

  describe('Merge', () => {
    const graph = graphOf(
      [
        s('trig01', 'trigger.manual', 0),
        s('left01', 'logic.setFields', 300, 0),
        s('filt01', 'logic.filter', 300, 200),
        s('rite01', 'logic.setFields', 600, 200),
        s('merg01', 'logic.merge', 900),
        s('done01', 'notify.slack', 1200),
      ],
      [
        line('trig01', 'left01'),
        line('trig01', 'filt01'),
        line('filt01', 'rite01'),
        line('left01', 'merg01'),
        line('rite01', 'merg01'),
        line('merg01', 'done01'),
      ],
    );

    it('waits for both branches when both run', () => {
      const midway = planNext(graph, {
        trig01: ok('out'),
        left01: ok('out'),
        filt01: ok('out'),
        rite01: { status: 'running' },
      });
      expect(midway.ready).toEqual([]);
      expect(midway.finished).toBe(false);
      expect(play(graph).started).toEqual([
        'trig01',
        'left01',
        'filt01',
        'rite01',
        'merg01',
        'done01',
      ]);
    });

    it('goes on with one branch when the other was skipped', () => {
      const played = play(graph, { filt01: ok() });
      expect(played.started).toEqual(['trig01', 'left01', 'filt01', 'merg01', 'done01']);
      expect(played.skipped).toEqual([{ key: 'rite01', reason: 'branchNotTaken' }]);
    });

    it('is skipped when no branch reaches it', () => {
      const played = play(graph, { left01: ok(), filt01: ok() });
      expect(played.skipped.map((skip) => skip.key)).toEqual(['rite01', 'merg01', 'done01']);
    });

    it('is skipped when a branch into it failed, and the run fails', () => {
      const played = play(graph, { left01: { status: 'failed' } });
      expect(played.started).toEqual(['trig01', 'left01', 'filt01', 'rite01']);
      expect(played.skipped).toEqual([
        { key: 'merg01', reason: 'upstreamFailed' },
        { key: 'done01', reason: 'upstreamFailed' },
      ]);
      expect(played.outcome).toBe('failed');
    });
  });

  it('passes through a turned-off step without running it', () => {
    const graph = graphOf(
      [
        s('trig01', 'trigger.manual', 0),
        s('off001', 'notify.slack', 300, 0, { disabled: true }),
        s('next01', 'notify.inApp', 600),
      ],
      [line('trig01', 'off001'), line('off001', 'next01')],
    );
    const played = play(graph);
    expect(played.started).toEqual(['trig01', 'next01']);
    expect(played.bypassed).toEqual(['off001']);
    expect(played.outcome).toBe('succeeded');
  });

  it('never bypasses a trigger, even one marked off', () => {
    const graph = graphOf([s('trig01', 'trigger.manual', 0, 0, { disabled: true })]);
    expect(planNext(graph, {}).ready).toEqual(['trig01']);
  });

  describe('On Error', () => {
    const graph = graphOf(
      [
        s('trig01', 'trigger.manual', 0),
        s('slck01', 'notify.slack', 300, 0, { onError: { mode: 'branch' } }),
        s('good01', 'notify.inApp', 600, 0),
        s('oops01', 'notify.email', 600, 200),
        s('para01', 'logic.setFields', 300, 400),
      ],
      [
        line('trig01', 'slck01'),
        line('slck01', 'good01'),
        line('slck01', 'oops01', 'error'),
        line('trig01', 'para01'),
      ],
    );

    it('a plain failure (stop) ends its branch, lets the others finish, and fails the run', () => {
      const played = play(graph, { slck01: { status: 'failed' } });
      expect(played.started).toEqual(['trig01', 'slck01', 'para01']);
      expect(played.skipped).toEqual([
        { key: 'good01', reason: 'upstreamFailed' },
        { key: 'oops01', reason: 'upstreamFailed' },
      ]);
      expect(played.outcome).toBe('failed');
    });

    it('continue: the failed step carries on through Out and the run succeeds', () => {
      const played = play(graph, { slck01: { status: 'handled', ports: ['out'] } });
      expect(played.started).toEqual(['trig01', 'slck01', 'para01', 'good01']);
      expect(played.skipped).toEqual([{ key: 'oops01', reason: 'branchNotTaken' }]);
      expect(played.outcome).toBe('succeeded');
    });

    it('branch: the error flows down On Error and the run succeeds', () => {
      const played = play(graph, { slck01: { status: 'handled', ports: ['error'] } });
      expect(played.started).toEqual(['trig01', 'slck01', 'para01', 'oops01']);
      expect(played.skipped).toEqual([{ key: 'good01', reason: 'branchNotTaken' }]);
      expect(played.outcome).toBe('succeeded');
    });
  });

  it('does not report a step it already reported as skipped', () => {
    const graph = graphOf(
      [
        s('trig01', 'trigger.manual', 0),
        s('iiii01', 'logic.ifElse', 300),
        s('no0001', 'notify.slack', 600),
      ],
      [line('trig01', 'iiii01'), line('iiii01', 'no0001', 'false')],
    );
    const state: RunPlanState = { trig01: ok('out'), iiii01: ok('true') };
    expect(planNext(graph, state).skipped).toEqual([{ key: 'no0001', reason: 'branchNotTaken' }]);
    expect(planNext(graph, { ...state, no0001: { status: 'skipped' } })).toEqual({
      ready: [],
      skipped: [],
      bypassed: [],
      finished: true,
      outcome: 'succeeded',
    });
  });

  it('treats omitted ports as Out, and keeps a recorded skip after a failure blocking', () => {
    const graph = graphOf(
      [
        s('trig01', 'trigger.manual', 0),
        s('aaaa01', 'notify.slack', 300),
        s('bbbb01', 'notify.slack', 600),
        s('cccc01', 'notify.slack', 900),
      ],
      [line('trig01', 'aaaa01'), line('aaaa01', 'bbbb01'), line('bbbb01', 'cccc01')],
    );
    expect(planNext(graph, { trig01: { status: 'succeeded' } }).ready).toEqual(['aaaa01']);
    const next = planNext(graph, {
      trig01: ok('out'),
      aaaa01: { status: 'failed' },
      bbbb01: { status: 'skipped' },
    });
    expect(next.skipped).toEqual([{ key: 'cccc01', reason: 'upstreamFailed' }]);
    expect(next.outcome).toBe('failed');
  });

  it('still ends on a graph with a loop or a stray step, skipping what cannot run', () => {
    const graph = graphOf(
      [
        s('trig01', 'trigger.manual', 0),
        s('loop01', 'logic.setFields', 300),
        s('loop02', 'logic.setFields', 600),
        s('stray1', 'notify.slack', 300, 300),
      ],
      [line('trig01', 'loop01'), line('loop01', 'loop02'), line('loop02', 'loop01')],
    );
    const played = play(graph);
    expect(played.started).toEqual(['trig01']);
    expect(played.skipped.map((skip) => skip.key).sort()).toEqual(['loop01', 'loop02', 'stray1']);
  });

  it('finishes at once with nothing to do when there is no trigger', () => {
    const graph = graphOf([s('aaaa01', 'notify.slack', 0)]);
    expect(planNext(graph, {})).toEqual({
      ready: [],
      skipped: [{ key: 'aaaa01', reason: 'branchNotTaken' }],
      bypassed: [],
      finished: true,
      outcome: 'succeeded',
    });
  });

  it('plans from a recorded trigger that failed', () => {
    const graph = graphOf(
      [s('trig01', 'trigger.manual', 0), s('aaaa01', 'notify.slack', 300)],
      [line('trig01', 'aaaa01')],
    );
    expect(planNext(graph, { trig01: { status: 'failed' } })).toMatchObject({
      skipped: [{ key: 'aaaa01', reason: 'upstreamFailed' }],
      finished: true,
      outcome: 'failed',
    });
  });
});
