/**
 * The one place the API reports an unexpected error to Sentry (Sprint 8).
 *
 * A thin wrapper rather than `Sentry.captureException` at the call site, so
 * the exception filter's test can assert *what* was reported without a DSN,
 * and so the rule of what gets reported lives in one sentence: anything that
 * was not deliberately thrown as an `HttpException`. A 404 or a 422 is the
 * API answering as designed; a `TypeError` in a handler is a bug, and bugs
 * are what the dashboard is for.
 */
import * as Sentry from '@sentry/nestjs';
import { SENTRY_ENABLED } from '../../instrument';

export interface ErrorReportContext {
  method?: string;
  url?: string;
  /** Who was signed in, as an id only, never an email. */
  userId?: string;
  orgId?: string;
}

export function isSentryEnabled(): boolean {
  return SENTRY_ENABLED;
}

/** Reports to Sentry when there is a client; a no-op otherwise. Returns the event id. */
export function reportUnexpectedError(error: unknown, context: ErrorReportContext = {}): string | null {
  if (!SENTRY_ENABLED) {
    return null;
  }

  return Sentry.captureException(error, {
    tags: {
      ...(context.method ? { method: context.method } : {}),
      ...(context.orgId ? { orgId: context.orgId } : {}),
    },
    extra: { url: context.url },
    user: context.userId ? { id: context.userId } : undefined,
  });
}
