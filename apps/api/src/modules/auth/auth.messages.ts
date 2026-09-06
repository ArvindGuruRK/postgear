/**
 * The canonical catalogue of every user-facing authentication message.
 *
 * ## Why one file
 *
 * Auth messages leak information when they are written ad hoc at each throw
 * site. "No user with that email" and "Wrong password" are individually
 * reasonable and jointly an account-enumeration oracle: an attacker learns
 * which addresses are registered by reading the difference. Centralising them
 * makes the property testable — `auth.messages.spec.ts` asserts that no string
 * in this file contains a banned phrase, so a future leak fails CI rather than
 * shipping.
 *
 * ## The rules these encode
 *
 * - Login failure is **one** message for every cause: unknown email, wrong
 *   password, unactivated account, and locked account. All four return
 *   {@link AUTH_MESSAGES.INVALID_CREDENTIALS}, with the same HTTP status.
 * - Registration never confirms whether an address is already in use.
 * - Password reset never confirms whether an address is registered.
 * - Validation failures never name the field that failed.
 *
 * ## The cost, stated plainly
 *
 * A locked-out user cannot tell why they are being refused. That is the point
 * — but it means the lockout notification email is not a nicety, it is the
 * only channel through which the real account owner learns what happened. If
 * mail delivery breaks, users are locked out with no explanation. See
 * `lockout.service.ts`.
 */
export const AUTH_MESSAGES = {
  /**
   * Wrong email, wrong password, unknown account, unactivated account, and
   * locked account. One string, one status code, one response shape.
   */
  INVALID_CREDENTIALS: 'Incorrect email or password',

  /**
   * Every validation and sanitization failure, on every auth route. Names no
   * field. The precise cause goes to `securityLogger`, never to the client.
   */
  INVALID_INPUT: 'Invalid input',

  /** Returned whether or not the address is registered. */
  PASSWORD_RESET_SENT: "If that email is registered, you'll receive a reset link",

  /** Returned whether or not the address is already taken. */
  REGISTRATION_ACCEPTED: 'Check your email to confirm your account',

  /** Expired, already-used, or entirely unknown reset token — indistinguishable. */
  RESET_LINK_INVALID: 'That reset link is no longer valid',

  /** Expired, already-used, or unknown activation token. */
  ACTIVATION_LINK_INVALID: 'That confirmation link is no longer valid',

  /** A missing or expired session on a protected route. */
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',

  /** Authenticated, but the role on the active workspace is insufficient. */
  FORBIDDEN: 'You do not have permission to do that',

  /** No active workspace could be resolved for the request. */
  NO_ACTIVE_ORG: 'Select a workspace first',

  /** IP-level throttle. Says nothing about any account. */
  TOO_MANY_REQUESTS: 'Too many requests. Please try again shortly.',

  /** Generic 500 body. Never carries an exception message. */
  UNEXPECTED: 'Something went wrong. Please try again.',

  /** OAuth handshake failed for any reason — bad state, provider error, denial. */
  OAUTH_FAILED: 'We could not complete that sign-in',
} as const;

export type AuthMessage = (typeof AUTH_MESSAGES)[keyof typeof AUTH_MESSAGES];

/**
 * Phrases that must never appear in a user-facing auth message, because each
 * one confirms or denies the existence of an account.
 *
 * Exported so the spec can assert against the same list the documentation
 * cites, rather than a copy that can drift.
 */
export const BANNED_MESSAGE_PHRASES = [
  'not found',
  "doesn't exist",
  'does not exist',
  'no such user',
  'no account',
  'wrong password',
  'incorrect password',
  'invalid email',
  'invalid password',
  'already registered',
  'already exists',
  'already taken',
  'email is taken',
  'unknown user',
  'user does not',
  'account is locked',
  'locked out',
  'too many failed',
  'not activated',
  'not verified',
] as const;
