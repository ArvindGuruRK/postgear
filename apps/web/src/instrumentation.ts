/**
 * Server-side Sentry for the web app (Sprint 8, PRD 5.12).
 *
 * Next calls `register` once per server start; the Sentry config is imported
 * inside it, per runtime, so the edge bundle never loads the Node SDK.
 * `onRequestError` is Next's hook for errors thrown while rendering or in
 * server functions: Sentry's `captureRequestError` turns them into events.
 * Both are no-ops without `NEXT_PUBLIC_SENTRY_DSN` (see the config files).
 */
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
