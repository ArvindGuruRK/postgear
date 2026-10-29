import { directiveApplies, parseSimulationDirective, simulatedOutcome } from './simulation-markers';

describe('parseSimulationDirective', () => {
  it('reads the publisher markers exactly as before', () => {
    expect(parseSimulationDirective('Hello [simulate:429]')).toEqual({ kind: '429' });
    expect(parseSimulationDirective('[simulate:429x2]')).toEqual({ kind: '429', untilAttempt: 2 });
    expect(parseSimulationDirective('[simulate:5xx]')).toEqual({ kind: '5xx' });
    expect(parseSimulationDirective('[SIMULATE:401]')).toEqual({ kind: '401' });
    expect(parseSimulationDirective('[simulate:slow:3]')).toEqual({ kind: 'slow', seconds: 3 });
    expect(parseSimulationDirective('[simulate:slow]')).toEqual({ kind: 'slow', seconds: 5 });
    expect(parseSimulationDirective('plain text')).toBeNull();
    expect(parseSimulationDirective('[simulate:418]')).toBeNull();
  });

  it('treats [simulate:500] as a server error', () => {
    expect(parseSimulationDirective('[simulate:500]')).toEqual({ kind: '5xx' });
    expect(parseSimulationDirective('[simulate:500x1]')).toEqual({ kind: '5xx', untilAttempt: 1 });
  });
});

describe('directiveApplies', () => {
  it('fails every attempt without a bound, and up to the bound with one', () => {
    expect(directiveApplies({ kind: '429' }, 9)).toBe(true);
    expect(directiveApplies({ kind: '429', untilAttempt: 2 }, 2)).toBe(true);
    expect(directiveApplies({ kind: '429', untilAttempt: 2 }, 3)).toBe(false);
  });
});

describe('simulatedOutcome', () => {
  it('maps each marker to what a workflow step does with it', () => {
    expect(simulatedOutcome('Hi [simulate:429]', 1)).toEqual({ kind: 'retryable', status: 429 });
    expect(simulatedOutcome('Hi [simulate:500]', 1)).toEqual({ kind: 'retryable', status: 500 });
    expect(simulatedOutcome('Hi [simulate:5xx]', 1)).toEqual({ kind: 'retryable', status: 500 });
    expect(simulatedOutcome('Hi [simulate:401]', 1)).toEqual({
      kind: 'connectionBroken',
      status: 401,
    });
    expect(simulatedOutcome('Hi [simulate:403]', 1)).toEqual({
      kind: 'connectionBroken',
      status: 403,
    });
    expect(simulatedOutcome('Hi [simulate:400]', 1)).toEqual({ kind: 'permanent', status: 400 });
    expect(simulatedOutcome('Hi [simulate:slow:2]', 1)).toEqual({ kind: 'slow', seconds: 2 });
  });

  it('lets the attempt after the bound through', () => {
    expect(simulatedOutcome('[simulate:429x1]', 1)).not.toBeNull();
    expect(simulatedOutcome('[simulate:429x1]', 2)).toBeNull();
    expect(simulatedOutcome('no marker here', 1)).toBeNull();
  });
});
