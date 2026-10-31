/**
 * The worker's side of the internal step gateway (Sprint 10, Module 10).
 *
 * Steps that need API services (Create Draft, Add To Queue, Publish To, Get
 * Post, the AI steps, Email) do not copy those services into the worker:
 * they call `${API_URL}/internal/automation/<path>` with the shared
 * `AUTOMATION_INTERNAL_TOKEN`, and the API runs the same code the composer
 * and the copilot use. Every body carries `{ runId, nodeKey, organizationId }`
 * so the API can bind the call to a live run, and the API's effect ledger
 * makes a retried call return the first result instead of acting twice.
 *
 * This is the one place in `automation/` that calls `fetch` directly: the
 * address is the API's own, from configuration, never from a step's data.
 *
 * Outcomes, as `StepFailure`s the activity understands:
 * - 2xx: `{ output, credits }`.
 * - 409 `in_progress`, 408, 429, 5xx, a timeout or a network error:
 *   retryable (the API may simply be restarting).
 * - 400 and 422: the API's own sentence, permanent; `out_of_credits` is
 *   `outOfCredits`, `not_connected` is `notConnected`, `limit_reached` is
 *   `limit`.
 * - 401, 403 and 404: "This step could not be authorised." and a security
 *   log line.
 */
import type { ExecContext, ExecLog } from './executors/types';
import { StepFailure } from './failures';

export const GATEWAY_UNAUTHORISED_MESSAGE = 'This step could not be authorised.';
export const GATEWAY_UNAVAILABLE_MESSAGE =
  'PostGear could not finish this step just now. It will try again.';
export const GATEWAY_NOT_SET_UP_MESSAGE =
  'This step cannot run because the worker is not set up to reach PostGear. Ask your admin to set AUTOMATION_INTERNAL_TOKEN.';

/** Most gateway routes answer in well under a minute. */
export const GATEWAY_TIMEOUT_MS = 60_000;
/** AI routes can take 30 to 90 seconds (Module 11). */
export const GATEWAY_AI_TIMEOUT_MS = 150_000;
/** How often a waiting call heartbeats, so a slow step is not taken for a dead worker. */
export const GATEWAY_HEARTBEAT_MS = 10_000;

export interface GatewayResult<T = unknown> {
  output: T;
  /** AI credits the call used, net of refunds. */
  credits: number;
}

export interface GatewayCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  heartbeat?: () => void;
}

export interface GatewayClient {
  /** `path` is relative to `/internal/automation`, for example `/posts/draft`. */
  call<T = unknown>(
    path: string,
    body: Record<string, unknown>,
    options?: GatewayCallOptions,
  ): Promise<GatewayResult<T>>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const PERMANENT_KINDS: Record<string, 'outOfCredits' | 'notConnected' | 'limit'> = {
  out_of_credits: 'outOfCredits',
  not_connected: 'notConnected',
  limit_reached: 'limit',
};

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sentence(body: Record<string, unknown> | null): string | null {
  const message = body?.message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return null;
}

/** Turns one gateway answer into a result or a typed failure. Exported for tests. */
export async function gatewayOutcome<T>(
  response: Response,
  path: string,
  log: ExecLog,
): Promise<GatewayResult<T>> {
  const body = await readJson(response);
  const status = response.status;

  if (status >= 200 && status < 300) {
    if (!body || !('output' in body)) {
      throw new StepFailure('retryable', GATEWAY_UNAVAILABLE_MESSAGE, 'gateway_bad_answer');
    }
    const credits = typeof body.credits === 'number' && body.credits > 0 ? body.credits : 0;
    return { output: body.output as T, credits };
  }

  const code = typeof body?.code === 'string' ? body.code : undefined;

  if (status === 409 && code === 'in_progress') {
    throw new StepFailure(
      'retryable',
      sentence(body) ?? GATEWAY_UNAVAILABLE_MESSAGE,
      'in_progress',
    );
  }
  if (status === 408 || status === 429 || status >= 500) {
    throw new StepFailure('retryable', GATEWAY_UNAVAILABLE_MESSAGE, 'gateway_unavailable', {
      status,
    });
  }
  if (status === 401 || status === 403 || status === 404) {
    log.warn('automation.gateway_unauthorised', { path, status });
    throw new StepFailure('permanent', GATEWAY_UNAUTHORISED_MESSAGE, 'not_authorised', { status });
  }

  const message = sentence(body) ?? 'PostGear refused this step.';
  const kind = code ? PERMANENT_KINDS[code] : undefined;
  // What the API adds for support or for the alert (out of credits carries
  // `resetsAt`, Module 11) is kept with the step's error.
  const extra =
    typeof body?.details === 'object' && body.details !== null && !Array.isArray(body.details)
      ? (body.details as Record<string, unknown>)
      : {};
  throw new StepFailure(kind ?? 'permanent', message, code ?? `gateway_${status}`, {
    ...extra,
    status,
  });
}

export function createGatewayClient(config: {
  apiUrl: string;
  token: string | undefined;
  log: ExecLog;
  fetch?: FetchLike;
}): GatewayClient {
  const base = `${config.apiUrl.replace(/\/+$/, '')}/internal/automation`;
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));

  return {
    async call<T>(path: string, body: Record<string, unknown>, options: GatewayCallOptions = {}) {
      if (!config.token) {
        throw new StepFailure('permanent', GATEWAY_NOT_SET_UP_MESSAGE, 'gateway_not_set_up');
      }

      const timeout = AbortSignal.timeout(options.timeoutMs ?? GATEWAY_TIMEOUT_MS);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      const beat = options.heartbeat
        ? setInterval(() => options.heartbeat?.(), GATEWAY_HEARTBEAT_MS)
        : undefined;

      let response: Response;
      try {
        response = await doFetch(`${base}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-postgear-internal': config.token,
          },
          body: JSON.stringify(body),
          signal,
          redirect: 'error',
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        throw new StepFailure('retryable', GATEWAY_UNAVAILABLE_MESSAGE, 'gateway_unreachable', {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (beat) clearInterval(beat);
      }

      return gatewayOutcome<T>(response, path, config.log);
    },
  };
}

/** A client for tests and for a worker built without the API: every call fails plainly. */
export const UNAVAILABLE_GATEWAY: GatewayClient = {
  async call() {
    throw new StepFailure('permanent', GATEWAY_NOT_SET_UP_MESSAGE, 'gateway_not_set_up');
  },
};

/**
 * Calls the gateway for the step `ctx` runs: adds the binding, the run's
 * cancel signal and heartbeats.
 */
export function callGateway<T = unknown>(
  ctx: ExecContext<unknown>,
  path: string,
  body: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<GatewayResult<T>> {
  return ctx.deps.gateway.call<T>(
    path,
    {
      runId: ctx.run.id,
      nodeKey: ctx.node.key,
      organizationId: ctx.run.organizationId,
      ...body,
    },
    { timeoutMs: options.timeoutMs, signal: ctx.signal, heartbeat: ctx.heartbeat },
  );
}
