/**
 * A preflight that warns, before the first test, when the API was not
 * started with `npm run dev:api:e2e`.
 *
 * ## Why it reads `X-RateLimit-Limit` from `/health`
 *
 * The suite signs in about a dozen times a minute, which is over the login
 * throttle of 10/IP/minute, so against `npm run dev:api` the later sign-ins
 * get a 429 ("Too many requests") and fail for a reason that has nothing to
 * do with what they assert. The login throttle itself sends no rate-limit
 * headers (on purpose: they would hand an attacker a scheduling hint), and
 * measuring it directly would spend the very sign-ins the suite is short of.
 *
 * The global per-address throttle does send `X-RateLimit-Limit` on every
 * route it covers, the public `GET /health` included, and `dev:api:e2e`
 * raises it together with the login limits (`RATE_LIMIT_PER_MIN=3000`
 * against a default of 300). So one health check tells which script started
 * the API, costs one request from a budget of hundreds, and reads nothing the
 * API does not already send to every caller.
 *
 * It only warns: a single spec signs in once or twice and passes under the
 * normal limits. It never throws, so the probe itself can never block a run.
 */

/** `RATE_LIMIT_PER_MIN` as `dev:api:e2e` in the root package.json sets it. */
const E2E_RATE_LIMIT = 3000;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default async function globalSetup(): Promise<void> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5_000) });
  } catch {
    warn([
      `The API did not answer at ${API_URL}/health.`,
      'Start it with `npm run dev:api:e2e`, or every signed-in test lands on /login.',
    ]);
    return;
  }

  // Absent when the throttler is off; nothing can be told then, so say nothing.
  const limit = Number(response.headers.get('x-ratelimit-limit'));

  if (limit > 0 && limit < E2E_RATE_LIMIT) {
    warn([
      `The API is running with the normal rate limits (X-RateLimit-Limit: ${limit}).`,
      'The suite signs in faster than the login throttle allows, so later sign-ins',
      'will fail with "Too many requests" (HTTP 429).',
      'Stop `npm run dev:api` (or `npm run dev`) and start `npm run dev:api:e2e`.',
      'See "Running the e2e suite" in docs/local-testing-guide.md.',
    ]);
  }
}

function warn(lines: string[]): void {
  const rule = '!'.repeat(80);
  console.warn(['', rule, ...lines.map((line) => `  ${line}`), rule, ''].join('\n'));
}
