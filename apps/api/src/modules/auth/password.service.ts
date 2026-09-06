import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * The only module in this codebase that handles a plaintext password.
 *
 * ## Algorithm
 *
 * argon2id at OWASP's minimum recommended configuration: 19 MiB of memory,
 * two iterations, one lane. Chosen over bcrypt (which the sprint document
 * names) because it is memory-hard — the cost of a GPU or ASIC cracking rig
 * scales with RAM rather than with cheap parallel cores, which is the whole
 * weakness of bcrypt's small fixed 4 KiB working set.
 *
 * The parameters are recorded *inside* the hash string
 * (`$argon2id$v=19$m=19456,t=2,p=1$...`), so raising them later is a matter of
 * changing {@link ARGON2_OPTIONS} and letting {@link needsRehash} migrate each
 * account on its next successful login. No mass re-hash, no forced reset.
 *
 * ## Comparison is never `===`
 *
 * `argon2.verify` performs its own constant-time comparison internally. The
 * legacy paths below use `timingSafeEqual`. There is no string equality on a
 * credential anywhere in this file, deliberately: `===` short-circuits on the
 * first differing byte, and the timing difference is measurable over enough
 * samples.
 */

export const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/**
 * How a stored password value is encoded. Everything that is not `argon2` has
 * to be migrated away from on sight.
 */
export type HashFormat = 'argon2' | 'bcrypt' | 'sha1' | 'md5' | 'plaintext';

/**
 * A dummy argon2id hash of a value nobody knows, used to burn the same CPU
 * time on a login for an address that does not exist as on one that does.
 *
 * Without it, "no such user" returns in microseconds while "wrong password"
 * takes ~50ms, and the difference is a reliable account-enumeration oracle
 * that no amount of careful error-message wording can close.
 *
 * Generated lazily on first use rather than at import so that module load
 * stays cheap, and cached because computing it is the same work it is meant
 * to simulate.
 */
let dummyHashPromise: Promise<string> | null = null;

@Injectable()
export class PasswordService {
  /** Hashes a new or changed password. */
  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, ARGON2_OPTIONS);
  }

  /**
   * Classifies a stored value by shape.
   *
   * Nothing in this database is currently anything but argon2 — `User.password`
   * was unset before this sprint. The legacy branches exist so that importing
   * users from another system, or discovering an old column, is a supported
   * path rather than an emergency. See `scripts/audit-password-hashes.ts` for
   * the report that shows what is actually stored.
   */
  detectFormat(stored: string): HashFormat {
    if (stored.startsWith('$argon2')) {
      return 'argon2';
    }
    // $2a$ (OpenBSD), $2b$ (current), $2y$ (PHP's variant) — all bcrypt.
    if (/^\$2[aby]\$\d{2}\$/.test(stored)) {
      return 'bcrypt';
    }
    if (/^[a-f0-9]{40}$/i.test(stored)) {
      return 'sha1';
    }
    if (/^[a-f0-9]{32}$/i.test(stored)) {
      return 'md5';
    }
    return 'plaintext';
  }

  /**
   * Verifies a password against a stored value of any supported format.
   *
   * Returns both the outcome and whether the stored value should be replaced,
   * so the caller can re-hash inside the same successful-login transaction —
   * which is the only moment the plaintext is available to re-hash *from*.
   */
  async verify(
    plaintext: string,
    stored: string,
  ): Promise<{ valid: boolean; format: HashFormat; needsRehash: boolean }> {
    const format = this.detectFormat(stored);

    if (format === 'argon2') {
      const valid = await this.safeArgonVerify(stored, plaintext);
      return { valid, format, needsRehash: valid && argon2.needsRehash(stored, ARGON2_OPTIONS) };
    }

    // Every legacy format is upgraded on any successful verify, regardless of
    // its own cost parameters. bcrypt at cost 14 is still not argon2id.
    const valid = this.verifyLegacy(plaintext, stored, format);
    return { valid, format, needsRehash: valid };
  }

  /**
   * Burns roughly one argon2 verification's worth of CPU without revealing
   * anything. Called on the "no such user" branch of login so that branch
   * costs the same as the "wrong password" branch.
   */
  async burnTime(plaintext: string): Promise<void> {
    if (!dummyHashPromise) {
      dummyHashPromise = argon2.hash(`dummy-${Date.now()}-${Math.random()}`, ARGON2_OPTIONS);
    }
    await this.safeArgonVerify(await dummyHashPromise, plaintext);
  }

  /**
   * `argon2.verify` throws — rather than returning false — on a malformed or
   * truncated hash. A corrupted row must read as "wrong password", not as a
   * 500 that tells the caller the row exists and is broken.
   */
  private async safeArgonVerify(stored: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(stored, plaintext);
    } catch {
      return false;
    }
  }

  /**
   * Constant-time comparison for the pre-argon2 formats.
   *
   * bcrypt is deliberately **not** verifiable here: this codebase has no
   * bcrypt dependency, and adding one solely to read hypothetical legacy rows
   * would be dead weight. A bcrypt row therefore fails to verify and the
   * account must go through password reset — which the audit script surfaces
   * before any user hits it, rather than after.
   */
  private verifyLegacy(plaintext: string, stored: string, format: HashFormat): boolean {
    if (format === 'bcrypt') {
      return false;
    }

    const candidate =
      format === 'plaintext'
        ? plaintext
        : createHash(format === 'sha1' ? 'sha1' : 'md5')
            .update(plaintext, 'utf8')
            .digest('hex');

    return constantTimeEquals(candidate.toLowerCase(), stored.toLowerCase());
  }
}

/**
 * Length-checked constant-time comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared
 * first. That comparison is not itself constant-time, but a length difference
 * is not secret — a hash of a given format always has a fixed length.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
