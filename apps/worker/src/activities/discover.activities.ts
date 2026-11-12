/**
 * Discover's background jobs (Sprint 11 Module 10): pre-warm the places
 * people look at, refresh competitors nobody has looked at today, and send
 * Monday's digests.
 *
 * The work itself lives in the API (`internal/discover/*`), next to the
 * cache, the gate, the breakers and the budgets it must go through, so the
 * worker only asks for it, the same way workflow steps ask the automation
 * gateway: `${API_URL}` with `X-PostGear-Internal: AUTOMATION_INTERNAL_TOKEN`.
 *
 * One job's failure never stops the others, and none of them throws: a job
 * that could not run is tried again at the next maintenance pass, 15 minutes
 * later, and every job is safe to repeat (each holds its own lock in the API,
 * and the digest claims its week before it sends).
 */
import { Context } from '@temporalio/activity';
import type { ActivityDeps } from './deps';

export const DISCOVER_JOBS = ['prewarm', 'competitors/refresh', 'digest'] as const;
export type DiscoverJob = (typeof DISCOVER_JOBS)[number];

/** The API stops starting new work after four minutes; this leaves it room to answer. */
export const DISCOVER_JOB_TIMEOUT_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 10_000;

export interface DiscoverJobResult {
  ran: boolean;
  checked: number;
  done: number;
}

export type DiscoverMaintenanceReport = Record<DiscoverJob, DiscoverJobResult | { failed: string }>;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function heartbeat(): void {
  try {
    Context.current().heartbeat();
  } catch {
    // Outside an activity (a test): nothing to tell.
  }
}

/** Exported for tests. */
export async function runDiscoverJob(
  job: DiscoverJob,
  config: { apiUrl: string; token: string; fetch?: FetchLike },
): Promise<DiscoverJobResult> {
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  const beat = setInterval(heartbeat, HEARTBEAT_MS);
  try {
    const response = await doFetch(`${config.apiUrl.replace(/\/+$/, '')}/internal/discover/${job}`, {
      method: 'POST',
      headers: { 'x-postgear-internal': config.token, 'content-type': 'application/json' },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(DISCOVER_JOB_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`The API answered ${response.status}.`);
    const body = (await response.json()) as Partial<DiscoverJobResult>;
    return {
      ran: body.ran === true,
      checked: typeof body.checked === 'number' ? body.checked : 0,
      done: typeof body.done === 'number' ? body.done : 0,
    };
  } finally {
    clearInterval(beat);
  }
}

export function createDiscoverActivities(deps: ActivityDeps, fetchImpl?: FetchLike) {
  return {
    async discoverMaintenance(): Promise<DiscoverMaintenanceReport> {
      const config = {
        apiUrl: deps.env.API_URL,
        token: deps.env.AUTOMATION_INTERNAL_TOKEN,
        fetch: fetchImpl,
      };
      const report = {} as DiscoverMaintenanceReport;
      for (const job of DISCOVER_JOBS) {
        try {
          report[job] = await runDiscoverJob(job, config);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          report[job] = { failed: reason };
          try {
            Context.current().log.warn('discover job failed', { job, reason });
          } catch {
            // Outside an activity (a test): the report says it.
          }
        }
      }
      return report;
    },
  };
}

export type DiscoverActivities = ReturnType<typeof createDiscoverActivities>;
