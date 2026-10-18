/**
 * Sentry for the API (Sprint 8, PRD 5.12).
 *
 * Imported as the very first line of `main.ts`, before Nest, so the SDK can
 * patch the HTTP and framework internals it instruments. Reads the raw
 * environment rather than the validated config because it runs before the
 * config module exists; the env schema still validates `SENTRY_DSN` for the
 * rest of the app.
 *
 * ## No DSN, no Sentry
 *
 * The local default. `Sentry.init` is never called, so every `captureException`
 * elsewhere is a no-op: the SDK is designed for exactly that, and the
 * exception filter does not need to know whether a client exists.
 *
 * ## What is deliberately off
 *
 * Tracing is sampled at `SENTRY_TRACES_SAMPLE_RATE`, default 0: the free
 * tier is for errors, and a trace of every request is quota spent on nothing
 * actionable. Request headers and cookies, the session token among them,
 * are never attached (the SDK default), so nothing secret leaves the process. The reference
 * implementation records prompt contents and samples everything; see the
 * Sprint 8 contract §0 for why PostGear does not.
 */
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN?.trim();
const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0');

/** Whether `Sentry.init` ran: what `/health` reports. */
export const SENTRY_ENABLED = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? Math.min(1, Math.max(0, tracesSampleRate)) : 0,
  });
}
