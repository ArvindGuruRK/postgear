import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { AUTH_MESSAGES } from '../../modules/auth/auth.messages';
import { securityLogger } from '../logging/security-logger';

/**
 * Validates a request body against a Zod schema.
 *
 * Used per-route as `@Body(new ZodBody(someSchema))` rather than registered
 * globally, because a global pipe has no way to know which schema belongs to
 * which handler — Zod schemas are values, not decorator metadata attached to
 * a DTO class.
 *
 * ## Why the client is told so little
 *
 * On failure this throws a `BadRequestException` carrying only
 * {@link AUTH_MESSAGES.INVALID_INPUT} — "Invalid input", naming no field and
 * giving no reason. The requirement is that a validation error must not
 * reveal which field failed, because on an auth form "the email is invalid"
 * versus "the password is invalid" is itself a small oracle.
 *
 * The real cost is honest to state: a user who mistypes their email on signup
 * is told only "Invalid input". The client keeps its own field-level hints so
 * the common case is still guided; the server refuses to confirm them.
 *
 * The precise failure — path, code, message — goes to `securityLogger`, which
 * is where field-level detail is *supposed* to live. That is what makes the
 * generic response monitorable rather than a black hole.
 */
export class ZodBody<T> implements PipeTransform<unknown, T> {
  constructor(
    private readonly schema: ZodSchema<T>,
    /** Appears in the log line only, to tell one route's failures from another's. */
    private readonly label: string,
  ) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    // Field paths and codes only. Never `issue.received` or the input itself —
    // for a login body that would write the attempted password to the log.
    securityLogger.warn('validation.failed', {
      route: this.label,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });

    throw new BadRequestException(AUTH_MESSAGES.INVALID_INPUT);
  }
}

/**
 * The same validation for a query string or route parameters.
 *
 * Separate class purely so the log line distinguishes "a malformed body" from
 * "a tampered URL" — the second is far more likely to be an attack than a typo.
 */
export class ZodQuery<T> implements PipeTransform<unknown, T> {
  constructor(
    private readonly schema: ZodSchema<T>,
    private readonly label: string,
  ) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    securityLogger.warn('validation.failed', {
      route: this.label,
      source: 'query',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
      })),
    });

    throw new BadRequestException(AUTH_MESSAGES.INVALID_INPUT);
  }
}
