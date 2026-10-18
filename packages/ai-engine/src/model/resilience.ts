/**
 * Fault tolerance for every provider call the engine makes.
 *
 * A generation is three to five model calls, a web search and an image call,
 * each against a service that rate-limits, hiccups and occasionally hangs.
 * Without a shared policy every call site would improvise its own, and the
 * API's SSE stream would see raw SDK errors, some of which echo request
 * headers, i.e. the key. So all of it lives here:
 *
 * - {@link classifyError} turns anything a provider throws into an
 *   {@link AiProviderError} with a `kind` the UI can act on and a `retryable`
 *   flag the retry loop obeys. Provider messages are redacted before they are
 *   kept, so a key never reaches a log line or the browser.
 * - {@link withRetry} retries only the kinds where a second try can plausibly
 *   succeed (`rate_limited`, `unavailable`, `timeout`): exponential backoff
 *   with jitter, so a burst of users does not retry in lockstep. A bad key, a
 *   policy refusal, malformed output or a cancelled request never retry.
 * - {@link withTimeout} / {@link withDeadline} bound every call. The deadline
 *   variant also hands the callee a linked `AbortSignal`, so a timed-out
 *   request is actually cancelled rather than left running in the background.
 *
 * `sleep` and `random` are injectable so the tests run under fake timers with
 * exact delays.
 */
import { type AiErrorKind, AiProviderError, isAiProviderError } from '../types';

export const RETRYABLE_KINDS: ReadonlySet<AiErrorKind> = new Set<AiErrorKind>([
  'rate_limited',
  'unavailable',
  'timeout',
]);

export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_MS = 500;
export const DEFAULT_RETRY_MAX_MS = 8_000;

export interface RetryOptions {
  /** Total attempts, including the first. Default 3. */
  attempts?: number;
  /** Delay before the second attempt; doubles from there. Default 500 ms. */
  baseMs?: number;
  /** Ceiling for one delay. Default 8 s. */
  maxMs?: number;
  signal?: AbortSignal;
  /** Injected for tests. */
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const MESSAGES: Record<AiErrorKind, string> = {
  not_configured: 'The AI provider is not configured.',
  invalid_key: 'The AI provider rejected the API key.',
  rate_limited: 'The AI provider is rate limiting requests.',
  unavailable: 'The AI provider is unavailable.',
  timeout: 'The AI provider took too long to answer.',
  bad_output: 'The model returned output that could not be used.',
  content_policy: 'The AI provider declined this request under its content policy.',
  aborted: 'The request was cancelled.',
};

/**
 * Strips anything that looks like a credential from a provider message. The
 * patterns cover OpenAI (`sk-…`), Tavily (`tvly-…`) and bearer headers, which
 * is every secret this package is ever handed.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|tvly)-[A-Za-z0-9_-]{4,}/g, '$1-[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}

export function isRetryableKind(kind: AiErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind);
}

export function providerError(
  kind: AiErrorKind,
  options?: { message?: string; cause?: unknown },
): AiProviderError {
  const detail = options?.message ? redactSecrets(options.message) : undefined;
  const message = detail ? `${MESSAGES[kind]} ${detail}` : MESSAGES[kind];
  return new AiProviderError(kind, message, isRetryableKind(kind), { cause: options?.cause });
}

export function abortError(cause?: unknown): AiProviderError {
  return providerError('aborted', { cause });
}

interface ErrorShape {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  cause?: unknown;
  error?: unknown;
  issues?: unknown;
}

function shapeOf(error: unknown): ErrorShape {
  return typeof error === 'object' && error !== null ? (error as ErrorShape) : {};
}

function statusOf(shape: ErrorShape): number | null {
  for (const candidate of [shape.status, shape.statusCode]) {
    if (typeof candidate === 'number') return candidate;
  }
  return null;
}

function codeOf(shape: ErrorShape): string {
  if (typeof shape.code === 'string') return shape.code;
  const nested = shapeOf(shape.error);
  return typeof nested.code === 'string' ? nested.code : '';
}

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Normalises any thrown value to an {@link AiProviderError}.
 *
 * The mapping follows the providers' documented behaviour: 401/403 is a key
 * problem, 429 a rate limit, 5xx or a dropped socket an outage, an abort is an
 * abort, a timeout a timeout, and OpenAI's content filter a policy refusal.
 * A Zod validation failure is `bad_output`. Anything else is reported as
 * `unavailable` but **not** retryable: an error the mapping does not
 * recognise is more likely a bug than a transient fault, and retrying a bug
 * three times only delays the report.
 */
export function classifyError(error: unknown): AiProviderError {
  if (isAiProviderError(error)) return error;

  const shape = shapeOf(error);
  const name = typeof shape.name === 'string' ? shape.name : '';
  const message = typeof shape.message === 'string' ? shape.message : String(error ?? '');
  const code = codeOf(shape);
  const status = statusOf(shape);
  const lower = `${code} ${message}`.toLowerCase();

  if (name === 'AbortError' || name === 'APIUserAbortError' || code === 'ABORT_ERR') {
    return providerError('aborted', { cause: error });
  }
  if (
    name === 'TimeoutError' ||
    name === 'APIConnectionTimeoutError' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    /\btimed? ?out\b/.test(lower)
  ) {
    return providerError('timeout', { cause: error });
  }
  if (
    /content[_ ]policy|content[_ ]filter|safety system|moderation/.test(lower) ||
    code === 'content_policy_violation'
  ) {
    return providerError('content_policy', { cause: error });
  }
  if (status === 401 || status === 403 || code === 'invalid_api_key') {
    return providerError('invalid_key', { cause: error });
  }
  if (status === 429 || code === 'rate_limit_exceeded' || code === 'insufficient_quota') {
    return providerError('rate_limited', { cause: error });
  }
  if ((status !== null && status >= 500) || NETWORK_CODES.has(code) || /fetch failed/.test(lower)) {
    return providerError('unavailable', { message: redactSecrets(message), cause: error });
  }
  if (
    name === 'ZodError' ||
    name === 'OutputParserException' ||
    name === 'ToolInputParsingException' ||
    Array.isArray(shape.issues)
  ) {
    return providerError('bad_output', { message: redactSecrets(message), cause: error });
  }
  if (status !== null && status >= 400) {
    // A 4xx the mapping does not know (400 bad request, 404 unknown model…) is
    // something we sent, so retrying unchanged cannot help.
    return new AiProviderError(
      'unavailable',
      `${MESSAGES.unavailable} ${redactSecrets(message)}`,
      false,
      { cause: error },
    );
  }

  return new AiProviderError(
    'unavailable',
    `${MESSAGES.unavailable} ${redactSecrets(message)}`,
    false,
    {
      cause: error,
    },
  );
}

/**
 * Whatever escaped a graph run becomes an {@link AiProviderError}. An abort
 * is reported as `aborted` even when a provider threw something else first,
 * because from the caller's side the cancel is the cause; an error a graph
 * wrapped is unwrapped through `cause`.
 */
export function normaliseRunError(error: unknown, signal?: AbortSignal): AiProviderError {
  if (signal?.aborted) return abortError(signal.reason);
  if (isAiProviderError(error)) return error;
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (isAiProviderError(cause)) return cause;
  return classifyError(error);
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

/** A cancellable sleep: rejects with `aborted` as soon as the signal fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal.reason));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal?.reason));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Exponential backoff with "equal jitter": half the slot is fixed, half is
 * random, so retries spread out without any of them firing immediately.
 */
export function backoffDelay(
  attempt: number,
  baseMs = DEFAULT_RETRY_BASE_MS,
  maxMs = DEFAULT_RETRY_MAX_MS,
  random: () => number = Math.random,
): number {
  const slot = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(slot / 2 + (slot / 2) * random());
}

/**
 * Runs `fn` up to `attempts` times. Every failure is classified first; only a
 * retryable kind earns another attempt, and the last error is what the
 * caller sees. `fn` receives the 1-based attempt number.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_RETRY_ATTEMPTS);
  const baseMs = options.baseMs ?? DEFAULT_RETRY_BASE_MS;
  const maxMs = options.maxMs ?? DEFAULT_RETRY_MAX_MS;
  const wait = options.sleep ?? sleep;
  let lastError: AiProviderError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      return await fn(attempt);
    } catch (error) {
      const classified = classifyError(error);
      lastError = classified;
      if (!classified.retryable || attempt === attempts) throw classified;
      await wait(backoffDelay(attempt, baseMs, maxMs, options.random), options.signal);
    }
  }

  throw lastError ?? providerError('unavailable');
}

/**
 * Rejects with `timeout` if the promise has not settled after `ms`, or with
 * `aborted` when the signal fires first. The underlying work is not cancelled
 * by this alone: pair it with a linked signal (see {@link withDeadline}).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal.reason));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(abortError(signal?.reason)));
    const timer = setTimeout(() => finish(() => reject(providerError('timeout'))), ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

/**
 * Runs `fn` with a signal that fires when the caller's signal does **or** when
 * `timeoutMs` elapses, and maps the outcome: the caller's abort wins as
 * `aborted`, the timer as `timeout`, anything else goes through
 * {@link classifyError}. This is what every SDK call in the package is wrapped
 * in, so a hung request is cancelled at the socket rather than abandoned.
 */
export async function withDeadline<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<T> {
  throwIfAborted(options.signal);
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    return await withTimeout(fn(controller.signal), options.timeoutMs, options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal.reason);
    throw classifyError(error);
  } finally {
    options.signal?.removeEventListener('abort', onParentAbort);
    if (!controller.signal.aborted) controller.abort();
  }
}
