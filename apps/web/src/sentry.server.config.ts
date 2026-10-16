/**
 * Sentry on the Next server runtime. Initialised only with a DSN; traces off
 * unless asked; no default PII (cookies, headers) — the same choices as the
 * API's `instrument.ts`, for the same reasons.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0') || 0,
  });
}
