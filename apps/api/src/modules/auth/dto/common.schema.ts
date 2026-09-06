import { z } from 'zod';
import { normalizeEmail, sanitizeText } from '../../../common/sanitize';

/**
 * Field-level schemas shared by every auth and onboarding DTO.
 *
 * Each one pairs a **transform** (sanitize/normalize) with a **check** that
 * runs afterwards. The ordering is the important part: sanitizing first and
 * validating second means a value that sanitizes down to nothing — a name
 * consisting only of `<b></b>`, say — is *rejected*, not silently stored as
 * an empty string. Validating first would pass it, and the transform would
 * then quietly empty it out.
 */

/** RFC 5321's limit on a full address. */
const EMAIL_MAX = 254;

/**
 * Deliberately stricter than the RFC. The full grammar permits quoted local
 * parts, comments and IP-literal domains, none of which any real signup needs
 * and all of which are awkward to handle safely downstream. Requiring a dotted
 * domain with a 2+ character TLD rejects `bob@localhost` too, which is correct
 * for an address we intend to actually deliver mail to.
 */
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export const emailSchema = z
  .string()
  .max(EMAIL_MAX * 2, 'too long') // cheap bound before any work is done
  .transform(normalizeEmail)
  .refine((value) => value.length > 0 && value.length <= EMAIL_MAX, 'invalid length')
  .refine((value) => EMAIL_PATTERN.test(value), 'invalid format');

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/**
 * **Never transformed.** No trim, no sanitize, no character filtering — see
 * the header comment in `common/sanitize.ts` for why. The raw string is
 * validated for length and composition and then handed to argon2id verbatim.
 *
 * The upper bound is not cosmetic: argon2 will happily hash a megabyte of
 * input, and an unbounded password field is a CPU-exhaustion vector.
 *
 * The composition rule (must contain a digit) matches the helper text already
 * shown on the register screen, so the server is not enforcing a rule the UI
 * never mentioned.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, 'too short')
  .max(PASSWORD_MAX, 'too long')
  .refine((value) => /[0-9]/.test(value), 'needs a digit');

export const NAME_MAX = 80;

/**
 * A human display name. This is the field the security brief calls
 * "username" — the schema has no `username` column; `User.name` and
 * `User.lastName` are what a person is shown as.
 */
export const nameSchema = z
  .string()
  .max(NAME_MAX * 4, 'too long')
  .transform(sanitizeText)
  .refine((value) => value.length >= 1, 'empty after sanitization')
  .refine((value) => value.length <= NAME_MAX, 'too long');

/** Same treatment, longer bound. */
export const ORG_NAME_MAX = 100;

export const orgNameSchema = z
  .string()
  .max(ORG_NAME_MAX * 4, 'too long')
  .transform(sanitizeText)
  .refine((value) => value.length >= 1, 'empty after sanitization')
  .refine((value) => value.length <= ORG_NAME_MAX, 'too long');

/**
 * An opaque token from an emailed link. Hex or base64url only, bounded — this
 * rejects a path-traversal or SQL-shaped value before it reaches a lookup.
 */
export const tokenSchema = z
  .string()
  .min(16, 'too short')
  .max(256, 'too long')
  .regex(/^[A-Za-z0-9_-]+$/, 'invalid format');

/**
 * `User.timezone` is a **UTC offset in minutes**, not an IANA zone name — see
 * SCHEMA_NOTES. -720..+840 covers every real offset (UTC-12 to UTC+14).
 */
export const timezoneSchema = z.coerce.number().int().min(-720).max(840).default(0);
