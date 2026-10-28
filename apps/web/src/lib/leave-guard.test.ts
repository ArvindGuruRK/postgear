import { type LeaveGuard, leaveThen, mayLeave, registerLeaveGuard } from './leave-guard';

/** Lets `leaveThen`'s promise chain run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('leave guards', () => {
  const removers: (() => void)[] = [];
  const add = (guard: LeaveGuard) => removers.push(registerLeaveGuard(guard));

  afterEach(() => {
    for (const remove of removers.splice(0)) remove();
  });

  it('lets the person go when no page holds unsaved work', async () => {
    await expect(mayLeave()).resolves.toBe(true);
  });

  it('keeps the person when a guard says stay, and lets them go when it says go', async () => {
    let answer = false;
    add(async () => answer);

    await expect(mayLeave()).resolves.toBe(false);
    answer = true;
    await expect(mayLeave()).resolves.toBe(true);
  });

  it('asks the guards one at a time and stops at the first stay', async () => {
    const asked: string[] = [];
    add(async () => {
      asked.push('first');
      return false;
    });
    add(async () => {
      asked.push('second');
      return true;
    });

    await expect(mayLeave()).resolves.toBe(false);
    expect(asked).toEqual(['first']);
  });

  it('keeps nobody on the page when a guard fails', async () => {
    add(() => Promise.reject(new Error('the save could not be checked')));
    add(() => {
      throw new Error('thrown before any promise');
    });

    await expect(mayLeave()).resolves.toBe(true);
  });

  it('forgets a guard once it is removed', async () => {
    const remove = registerLeaveGuard(async () => false);
    await expect(mayLeave()).resolves.toBe(false);

    remove();
    await expect(mayLeave()).resolves.toBe(true);
  });

  it('moves only when leaving is allowed', async () => {
    const go = jest.fn();
    let answer = false;
    add(async () => answer);

    leaveThen(go);
    await settle();
    expect(go).not.toHaveBeenCalled();

    answer = true;
    leaveThen(go);
    await settle();
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('waits for a guard that is still asking before it moves', async () => {
    const go = jest.fn();
    let choose: (allowed: boolean) => void = () => undefined;
    add(() => new Promise<boolean>((resolve) => (choose = resolve)));

    leaveThen(go);
    await settle();
    expect(go).not.toHaveBeenCalled();

    choose(true);
    await settle();
    expect(go).toHaveBeenCalledTimes(1);
  });
});
