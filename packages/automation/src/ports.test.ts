import { CONNECT_REASONS, canConnect } from './ports';
import { graphOf, line, step } from './testing/builders';

const base = graphOf(
  [
    step('trig01', 'trigger.manual'),
    step('aaaa01', 'logic.setFields'),
    step('bbbb01', 'logic.filter'),
    step('cccc01', 'notify.slack'),
    step('iiii01', 'logic.ifElse'),
    step('pppp01', 'logic.switch'),
  ],
  [line('trig01', 'aaaa01'), line('aaaa01', 'bbbb01'), line('bbbb01', 'cccc01')],
);

describe('canConnect', () => {
  it('allows a line from an output to a step that takes input', () => {
    expect(canConnect(base, { source: 'cccc01', sourcePort: 'out', target: 'iiii01' })).toEqual({
      ok: true,
    });
  });

  it('refuses a line into a trigger', () => {
    expect(canConnect(base, { source: 'cccc01', sourcePort: 'out', target: 'trig01' })).toEqual({
      ok: false,
      reason: CONNECT_REASONS.intoTrigger,
    });
  });

  it('refuses a step connecting to itself', () => {
    expect(canConnect(base, { source: 'aaaa01', sourcePort: 'out', target: 'aaaa01' })).toEqual({
      ok: false,
      reason: CONNECT_REASONS.self,
    });
  });

  it('refuses a line back to the step before it (a direct loop)', () => {
    expect(canConnect(base, { source: 'bbbb01', sourcePort: 'out', target: 'aaaa01' })).toEqual({
      ok: false,
      reason: CONNECT_REASONS.cycle,
    });
  });

  it('refuses a line that closes a three-step loop', () => {
    expect(canConnect(base, { source: 'cccc01', sourcePort: 'out', target: 'aaaa01' })).toEqual({
      ok: false,
      reason: CONNECT_REASONS.cycle,
    });
  });

  it('refuses a second identical line', () => {
    expect(canConnect(base, { source: 'aaaa01', sourcePort: 'out', target: 'bbbb01' })).toEqual({
      ok: false,
      reason: CONNECT_REASONS.duplicate,
    });
  });

  it('allows fan-out: one output to several steps', () => {
    expect(canConnect(base, { source: 'aaaa01', sourcePort: 'out', target: 'cccc01' }).ok).toBe(
      true,
    );
    expect(canConnect(base, { source: 'aaaa01', sourcePort: 'out', target: 'iiii01' }).ok).toBe(
      true,
    );
  });

  it('allows two lines into one step; joining without a Merge is a validation issue instead', () => {
    expect(canConnect(base, { source: 'trig01', sourcePort: 'out', target: 'cccc01' }).ok).toBe(
      true,
    );
  });

  it('only allows outputs the step really has', () => {
    expect(canConnect(base, { source: 'cccc01', sourcePort: 'true', target: 'iiii01' })).toEqual({
      ok: false,
      reason: CONNECT_REASONS.badOutput,
    });
    expect(canConnect(base, { source: 'iiii01', sourcePort: 'false', target: 'cccc01' }).ok).toBe(
      true,
    );
    expect(canConnect(base, { source: 'pppp01', sourcePort: 'case:a', target: 'cccc01' }).ok).toBe(
      true,
    );
    expect(canConnect(base, { source: 'pppp01', sourcePort: 'case:zz', target: 'cccc01' }).ok).toBe(
      false,
    );
    expect(canConnect(base, { source: 'cccc01', sourcePort: 'error', target: 'iiii01' }).ok).toBe(
      false,
    );
  });

  it('allows the On Error output once the step branches on errors', () => {
    const branching = graphOf(
      [
        ...base.nodes.filter((n) => n.key !== 'cccc01'),
        { ...base.nodes[3], onError: { mode: 'branch' } },
      ],
      base.edges,
    );
    expect(
      canConnect(branching, { source: 'cccc01', sourcePort: 'error', target: 'iiii01' }).ok,
    ).toBe(true);
  });

  it('refuses any input but in, and steps that are not in the workflow', () => {
    expect(
      canConnect(base, { source: 'aaaa01', sourcePort: 'out', target: 'iiii01', targetPort: 'x' }),
    ).toEqual({ ok: false, reason: CONNECT_REASONS.badInput });
    expect(canConnect(base, { source: 'ghost1', sourcePort: 'out', target: 'iiii01' })).toEqual({
      ok: false,
      reason: CONNECT_REASONS.missing,
    });
  });
});
