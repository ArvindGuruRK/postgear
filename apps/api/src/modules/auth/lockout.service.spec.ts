import { LockoutService } from './lockout.service';

/**
 * The delay curve is pure arithmetic, so it is tested directly rather than
 * through a mocked clock. The stateful half of LockoutService talks to Prisma
 * and is covered by the end-to-end checks in the completion checklist.
 */
describe('LockoutService.delayForAttempt', () => {
  it('does not delay the first attempt', () => {
    // A user who has never failed must not be slowed down at all.
    expect(LockoutService.delayForAttempt(0)).toBe(0);
    expect(LockoutService.delayForAttempt(-1)).toBe(0);
  });

  it('doubles with each consecutive failure', () => {
    expect(LockoutService.delayForAttempt(1)).toBe(250);
    expect(LockoutService.delayForAttempt(2)).toBe(500);
    expect(LockoutService.delayForAttempt(3)).toBe(1000);
    expect(LockoutService.delayForAttempt(4)).toBe(2000);
  });

  it('caps at 4 seconds', () => {
    // The cap is a security control, not a convenience. An uncapped delay lets
    // an attacker pin a server worker per deliberately-failed request, so the
    // backoff meant to slow them down becomes their DoS lever.
    expect(LockoutService.delayForAttempt(5)).toBe(4000);
    expect(LockoutService.delayForAttempt(20)).toBe(4000);
    expect(LockoutService.delayForAttempt(1000)).toBe(4000);
  });

  it('never returns a non-finite value for an absurd input', () => {
    // 2 ** 1024 overflows to Infinity; Math.min pins it to the cap. Guarding
    // this because the exponent comes from a Redis counter an attacker drives.
    expect(Number.isFinite(LockoutService.delayForAttempt(1024))).toBe(true);
    expect(LockoutService.delayForAttempt(1024)).toBe(4000);
  });

  it('increases monotonically up to the cap', () => {
    let previous = -1;
    for (let attempt = 0; attempt <= 10; attempt += 1) {
      const delay = LockoutService.delayForAttempt(attempt);
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });
});

describe('LockoutService.isLocked', () => {
  const service = Object.create(LockoutService.prototype) as LockoutService;

  it('is false when the account has never been locked', () => {
    expect(service.isLocked({ lockedUntil: null })).toBe(false);
  });

  it('is true inside the window', () => {
    expect(service.isLocked({ lockedUntil: new Date(Date.now() + 60_000) })).toBe(true);
  });

  it('is false once the window has passed, without needing a cleanup job', () => {
    // Expiry is evaluated on read, so a lapsed lockout self-heals on the next
    // login attempt rather than waiting for a scheduled sweep.
    expect(service.isLocked({ lockedUntil: new Date(Date.now() - 1) })).toBe(false);
  });
});
