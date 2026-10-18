/**
 * Browser-side Sentry for the web app (Sprint 8, PRD 5.12).
 *
 * Next loads this file before the app hydrates, so errors thrown during the
 * first render are seen: the reference initialises in a `useEffect`, after
 * hydration, and misses them. Initialised only with `NEXT_PUBLIC_SENTRY_DSN`
 * (public by necessity: the browser reports its own errors). No session
 * replay, no PII: the free tier is for the stack traces.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
