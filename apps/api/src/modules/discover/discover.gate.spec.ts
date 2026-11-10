/**
 * A short wait, in order, with an end to it. The end is what matters: a stuck
 * upstream must not be able to pile up requests behind it.
 */
import { DiscoverGate, type Release } from './discover.gate';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function take(gate: DiscoverGate, count: number): Promise<Release[]> {
  const releases: Release[] = [];
  for (let index = 0; index < count; index += 1) {
    releases.push((await gate.acquire()) as Release);
  }
  return releases;
}

describe('DiscoverGate', () => {
  it('grants slots straight away up to its limit', async () => {
    const gate = new DiscoverGate(2, 1000);

    await take(gate, 2);

    expect(gate.running).toBe(2);
  });

  it('makes the next caller wait for a slot, then grants it', async () => {
    const gate = new DiscoverGate(1, 1000);
    const [release] = await take(gate, 1);

    const waiting = gate.acquire();
    await jest.advanceTimersByTimeAsync(500);
    release();

    await expect(waiting).resolves.toEqual(expect.any(Function));
    expect(gate.running).toBe(1);
  });

  it('serves waiters first come, first served', async () => {
    const gate = new DiscoverGate(1, 1000);
    const [release] = await take(gate, 1);
    const order: string[] = [];

    const first = gate.acquire().then((slot) => {
      order.push('first');
      return slot;
    });
    const second = gate.acquire().then((slot) => {
      order.push('second');
      return slot;
    });

    release();
    (await first)?.();
    (await second)?.();

    expect(order).toEqual(['first', 'second']);
  });

  it('gives up after the wait, and answers null rather than throwing', async () => {
    const gate = new DiscoverGate(1, 1000);
    await take(gate, 1);

    const waiting = gate.acquire();
    await jest.advanceTimersByTimeAsync(1000);

    await expect(waiting).resolves.toBeNull();
  });

  it('forgets a caller that gave up, so a later slot goes to someone still there', async () => {
    const gate = new DiscoverGate(1, 1000);
    const [release] = await take(gate, 1);

    const gaveUp = gate.acquire();
    await jest.advanceTimersByTimeAsync(600);
    const stillThere = gate.acquire();
    await jest.advanceTimersByTimeAsync(400);
    await expect(gaveUp).resolves.toBeNull();

    release();

    await expect(stillThere).resolves.toEqual(expect.any(Function));
    expect(gate.running).toBe(1);
  });

  it('does not time out a caller who was given a slot', async () => {
    const gate = new DiscoverGate(1, 1000);
    const [release] = await take(gate, 1);

    const waiting = gate.acquire();
    release();
    const slot = await waiting;
    await jest.advanceTimersByTimeAsync(5000);

    expect(slot).toEqual(expect.any(Function));
    expect(gate.running).toBe(1);
  });

  it('counts a release once, however many times it is called', async () => {
    const gate = new DiscoverGate(2, 1000);
    const [release] = await take(gate, 2);

    release();
    release();

    expect(gate.running).toBe(1);
  });

  it('refuses a limit that makes no sense', () => {
    expect(() => new DiscoverGate(0, 1000)).toThrow(/positive integer/);
    expect(() => new DiscoverGate(1.5, 1000)).toThrow(/positive integer/);
  });
});
