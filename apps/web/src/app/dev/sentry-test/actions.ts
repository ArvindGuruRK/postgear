'use server';

/**
 * A server function that fails on purpose (Sprint 8): the way to prove the
 * server half of the web app's Sentry wiring. Excluded from production
 * builds like the rest of `/dev`, so there is nothing here to abuse.
 */
export async function throwOnServer(): Promise<never> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Not available');
  }

  throw new Error(`Sentry test error from apps/web (server, ${new Date().toISOString()})`);
}
