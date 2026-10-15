/**
 * The concurrency gate: the global cap, one run per workspace, and a
 * release that is safe to call twice.
 */
import { SeoGate } from './seo.gate';

describe('SeoGate', () => {
  it('refuses a width that is not a positive integer', () => {
    expect(() => new SeoGate(0)).toThrow();
    expect(() => new SeoGate(1.5)).toThrow();
    expect(new SeoGate(2).maxConcurrent).toBe(2);
  });

  it('hands out slots up to the cap and refuses the next', () => {
    const gate = new SeoGate(2);
    const a = gate.tryAcquire('org_a');
    const b = gate.tryAcquire('org_b');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(gate.running).toBe(2);
    expect(gate.tryAcquire('org_c')).toBeNull();

    a?.();
    expect(gate.running).toBe(1);
    expect(gate.tryAcquire('org_c')).not.toBeNull();
  });

  it('allows one run per workspace even when slots are free', () => {
    const gate = new SeoGate(5);
    const release = gate.tryAcquire('org_a');
    expect(release).not.toBeNull();
    expect(gate.isBusy('org_a')).toBe(true);
    expect(gate.tryAcquire('org_a')).toBeNull();
    expect(gate.running).toBe(1);

    release?.();
    expect(gate.isBusy('org_a')).toBe(false);
    expect(gate.tryAcquire('org_a')).not.toBeNull();
  });

  it('ignores a second release of the same slot', () => {
    const gate = new SeoGate(1);
    const release = gate.tryAcquire('org_a');
    release?.();
    release?.();
    expect(gate.running).toBe(0);
    expect(gate.tryAcquire('org_b')).not.toBeNull();
    // A stale double release must not free a slot someone else now holds.
    release?.();
    expect(gate.running).toBe(1);
  });
});
