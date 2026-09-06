import { Logger } from '@nestjs/common';

/**
 * Structured logging for security-relevant events, with a hard guarantee that
 * no secret is ever written.
 *
 * Two jobs:
 *
 *  1. **Monitoring.** Validation failures, failed logins, lockouts and
 *     throttle trips are invisible to the client by design — every one of
 *     them returns a deliberately generic message. Without a server-side
 *     record there would be no way to tell a typo from a credential-stuffing
 *     run, so the detail the response withholds is written here instead.
 *
 *  2. **Redaction.** Every value passed through `redact()` is filtered
 *     against a key denylist before it reaches the log. This is the mechanism
 *     behind "never log a password": the rule is enforced by the logging
 *     helper rather than left to each call site to remember.
 */

/**
 * Keys whose values are replaced with `[REDACTED]`, matched case-insensitively
 * as substrings — so `password`, `newPassword`, `passwordHash` and
 * `PASSWORD_CONFIRM` are all caught by the single entry `password`.
 */
const REDACTED_KEYS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'credential',
  'refreshtoken',
  'clientsecret',
];

const REDACTION_PLACEHOLDER = '[REDACTED]';

/** Depth cap, so a self-referential object cannot spin here forever. */
const MAX_DEPTH = 6;

function isRedactedKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return REDACTED_KEYS.some((needle) => lowered.includes(needle));
}

/**
 * Deep-copies a value, replacing any property whose key looks secret.
 *
 * Exported for its own test: the denylist is the thing that has to be right,
 * so it is asserted directly rather than only through the logger.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return '[TRUNCATED]';
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isRedactedKey(key) ? REDACTION_PLACEHOLDER : redact(entry, depth + 1);
  }
  return out;
}

/**
 * Truncates and hashes nothing — emails are logged in full on purpose. They
 * are the only usable correlation key when investigating an attack, and they
 * are not a secret in the way a password is.
 */
export type SecurityEvent =
  | 'validation.failed'
  | 'login.failed'
  | 'login.succeeded'
  | 'login.locked'
  | 'login.throttled'
  | 'register.duplicate'
  | 'register.succeeded'
  | 'password.reset_requested'
  | 'password.reset_completed'
  | 'password.rehashed'
  | 'activation.failed'
  | 'activation.succeeded'
  | 'oauth.state_mismatch'
  | 'oauth.succeeded'
  | 'rbac.denied';

export class SecurityLogger {
  private readonly logger = new Logger('Security');

  /**
   * Records an event. `context` is redacted before it is written, so callers
   * may pass a whole request body without auditing it first.
   */
  log(event: SecurityEvent, context: Record<string, unknown> = {}): void {
    this.logger.log(JSON.stringify({ event, ...(redact(context) as object) }));
  }

  /** For events that indicate an active attack rather than a user mistake. */
  warn(event: SecurityEvent, context: Record<string, unknown> = {}): void {
    this.logger.warn(JSON.stringify({ event, ...(redact(context) as object) }));
  }
}

/**
 * Module-level singleton. Deliberately not a Nest provider: guards, pipes and
 * plain functions all need it, and threading DI through every one of them buys
 * nothing when the logger holds no state worth swapping in a test.
 */
export const securityLogger = new SecurityLogger();
