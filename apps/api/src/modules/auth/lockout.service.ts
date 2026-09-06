import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@postgear/db';
import { securityLogger } from '../../common/logging/security-logger';
import { RedisService } from '../redis/redis.service';

/**
 * Account lockout and the progressive delay that precedes it.
 *
 * ## Two stores, on purpose
 *
 * | State | Lives in | Why |
 * |---|---|---|
 * | Consecutive failures, `lockedUntil` | **Postgres**, on `User` | Must survive a Redis eviction or restart. If it did not, bouncing Redis would be a lockout bypass. |
 * | Progressive delay counter | **Redis** | Per-IP-and-account, short-lived, and losing it costs nothing worse than one un-delayed attempt. |
 *
 * ## The delay is capped
 *
 * "Each failed attempt increases the wait time" is implemented as
 * `250ms * 2^(n-1)`, capped at 4 seconds. The cap is not a shortcut. An
 * uncapped exponential backoff that holds the HTTP connection open while it
 * sleeps is itself a denial-of-service vector: an attacker who deliberately
 * fails can pin one server worker per request for as long as the delay lasts,
 * and the longer the delay grows the cheaper the attack gets. Four seconds
 * times the ten-per-minute IP limit bounds the damage.
 *
 * ## Nothing here is visible to the caller
 *
 * `isLocked` returns a boolean, and the login route turns it into the same
 * "Incorrect email or password" as a wrong password. The user is told what
 * actually happened by email — see `MailService.sendAccountLocked`.
 */

const DELAY_BASE_MS = 250;
const DELAY_CAP_MS = 4_000;
const DELAY_WINDOW_SECONDS = 900; // matches the default lockout duration

@Injectable()
export class LockoutService {
  private readonly threshold: number;
  private readonly lockoutMinutes: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.threshold = config.get<number>('LOCKOUT_THRESHOLD', 5);
    this.lockoutMinutes = config.get<number>('LOCKOUT_MINUTES', 15);
  }

  /**
   * True while the account is inside its lockout window.
   *
   * Takes the already-loaded user row rather than re-querying: the login path
   * has it in hand, and a second round-trip on every attempt is wasted work.
   */
  isLocked(user: { lockedUntil: Date | null }): boolean {
    return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
  }

  /**
   * Sleeps for the progressive delay owed to this identity.
   *
   * Keyed by IP *and* email so that one attacker cycling through addresses
   * still accumulates delay, and one user fumbling their password does not
   * slow down an unrelated user behind the same corporate NAT.
   *
   * Called before the password is even checked, so the delay applies to a
   * wrong email exactly as it applies to a wrong password. Applying it only
   * on failure would leak — a fast response would mean "that address is not
   * registered".
   */
  async applyProgressiveDelay(ip: string, email: string): Promise<void> {
    const raw = await this.redis.get(this.delayKey(ip, email));
    const previousFailures = raw ? Number(raw) : 0;

    if (previousFailures <= 0) {
      return;
    }

    const delayMs = Math.min(DELAY_BASE_MS * 2 ** (previousFailures - 1), DELAY_CAP_MS);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  /**
   * Records a failed attempt.
   *
   * Returns whether this attempt crossed the threshold, so the caller can send
   * the notification email exactly once rather than on every subsequent
   * attempt against an already-locked account.
   */
  async recordFailure(
    userId: string,
    ip: string,
    email: string,
  ): Promise<{ justLocked: boolean; attempts: number }> {
    await this.redis.incrementWithTtl(this.delayKey(ip, email), DELAY_WINDOW_SECONDS);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 }, lastFailedLoginAt: new Date() },
      select: { failedLoginAttempts: true, lockedUntil: true },
    });

    const wasAlreadyLocked = user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();

    if (user.failedLoginAttempts < this.threshold || wasAlreadyLocked) {
      return { justLocked: false, attempts: user.failedLoginAttempts };
    }

    const lockedUntil = new Date(Date.now() + this.lockoutMinutes * 60_000);
    await prisma.user.update({ where: { id: userId }, data: { lockedUntil } });

    securityLogger.warn('login.locked', {
      userId,
      email,
      ip,
      attempts: user.failedLoginAttempts,
      lockedUntil: lockedUntil.toISOString(),
    });

    return { justLocked: true, attempts: user.failedLoginAttempts };
  }

  /**
   * Clears every counter after a successful sign-in.
   *
   * "Consecutive" in "5 consecutive failed attempts" is what this enforces —
   * without it the counter would be cumulative and a user who mistypes once a
   * month would eventually lock themselves out for no reason.
   */
  async recordSuccess(userId: string, ip: string, email: string): Promise<void> {
    await this.redis.delete(this.delayKey(ip, email));
    await prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lastFailedLoginAt: null, lockedUntil: null },
    });
  }

  /**
   * Records a failure for an address with no account behind it.
   *
   * There is no row to increment, but the Redis-side delay still has to grow —
   * otherwise attempts against non-existent addresses stay fast forever, and
   * the response time distinguishes them from real ones.
   */
  async recordUnknownEmailFailure(ip: string, email: string): Promise<void> {
    await this.redis.incrementWithTtl(this.delayKey(ip, email), DELAY_WINDOW_SECONDS);
  }

  /** Exposed for the delay calculation's own test. */
  static delayForAttempt(previousFailures: number): number {
    if (previousFailures <= 0) {
      return 0;
    }
    return Math.min(DELAY_BASE_MS * 2 ** (previousFailures - 1), DELAY_CAP_MS);
  }

  private delayKey(ip: string, email: string): string {
    return `login:delay:${ip}:${email}`;
  }
}
