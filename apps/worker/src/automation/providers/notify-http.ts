/**
 * The Notify providers' shared send path (Module 12): one JSON POST through
 * `safeHttpRequest` (address check, pinned DNS, no redirects, capped body)
 * and the retry table every chat app follows:
 *
 * | Answer                                         | Result                                   |
 * |------------------------------------------------|------------------------------------------|
 * | the app's own success signal (each provider)   | Succeeded                                |
 * | 408, 429, 5xx, a timeout, a network error      | retryable; `Retry-After` capped at 60 s  |
 * | 400 or another 4xx                             | permanent, in the app's own words        |
 * | 401, 403, 404, 410 (and app codes that mean    | connection broken: "{App} is             |
 * | the same, like Slack's `no_service`)           | disconnected. Reconnect it in            |
 * |                                                | Connections." and Needs Reconnect        |
 * | the address fails the safety guard             | "This link is not allowed." and a        |
 * |                                                | security log line                        |
 */
import { type SafeHttpOutcome, safeHttpRequest } from '../../lib/safe-http';
import { permanent } from '../failures';
import type { ProviderResult, ProviderSendOptions } from './types';

/** One message send; the apps answer in well under this. */
export const NOTIFY_TIMEOUT_MS = 10_000;
/** The app's answer is short (`ok`, a small JSON); a little room for error text. */
export const NOTIFY_MAX_RESPONSE_BYTES = 16 * 1024;
/** The longest wait an app's `Retry-After` may ask for. */
export const RETRY_AFTER_CAP_MS = 60_000;

export const UNSAFE_LINK_MESSAGE = 'This link is not allowed.';

export function disconnectedMessage(app: string): string {
  return `${app} is disconnected. Reconnect it in Connections.`;
}

const BROKEN_STATUSES = new Set([401, 403, 404, 410]);

/** A wait in milliseconds, capped at 60 s; undefined when the app named none. */
export function capRetryAfter(ms: number | undefined): number | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  return Math.min(Math.max(ms, 1_000), RETRY_AFTER_CAP_MS);
}

/** The webhook link stored on the connection, or null when it holds none. */
export function webhookUrlOf(credentials: unknown): string | null {
  if (typeof credentials !== 'object' || credentials === null) return null;
  const link = (credentials as { webhookUrl?: unknown }).webhookUrl;
  return typeof link === 'string' && link.trim() !== '' ? link.trim() : null;
}

/** POSTs JSON to `url`, keeping the (capped) answer for the app's own words. */
export function postJson(
  url: string,
  body: unknown,
  opts: ProviderSendOptions,
): Promise<SafeHttpOutcome> {
  return safeHttpRequest({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', 'user-agent': 'PostGear-Workflows/1.0' },
    body: JSON.stringify(body),
    timeoutMs: NOTIFY_TIMEOUT_MS,
    maxResponseBytes: NOTIFY_MAX_RESPONSE_BYTES,
    keepBody: true,
    allowPrivate: opts.allowPrivate === true,
    signal: opts.signal,
  });
}

export interface FailureWords {
  /** The app's own error text, already cleaned (`appWords`). */
  appSays?: string | null;
  /** The app's answer means the link no longer works, whatever the status. */
  broken?: boolean;
  /** A wait the app named in its body (Discord's `retry_after`), in ms. */
  retryAfterMs?: number;
}

export const BUTTON_LINK_MESSAGE = "'Button link' needs a full link that starts with https://.";

/**
 * A step's button link when it is a full http(s) link, null when empty.
 * Anything else fails the step (permanent): the app would refuse the whole
 * message over it.
 */
export function buttonLink(raw: string | undefined): string | null {
  const link = (raw ?? '').trim();
  if (!link) return null;
  let url: URL | null = null;
  try {
    url = new URL(link);
  } catch {
    // Falls through to the refusal below.
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || link.length > 3_000) {
    throw permanent(BUTTON_LINK_MESSAGE, 'invalid_button_link');
  }
  return url.toString();
}

/** A link with no usable webhook address: the connection must be set up again. */
export function missingLink(app: string): ProviderResult {
  return {
    ok: false,
    retryable: false,
    connectionBroken: true,
    code: 'connection_missing_link',
    message: disconnectedMessage(app),
  };
}

/** The result for anything but the app's success signal. */
export function failureFor(
  app: string,
  outcome: Exclude<SafeHttpOutcome, { outcome: 'ok' }>,
  words: FailureWords = {},
): ProviderResult {
  if (outcome.outcome === 'unsafe') {
    // A security event: the stored link now points somewhere it must not
    // (a private address, a changed DNS answer). The link itself is never logged.
    console.warn('automation.unsafe_link', { app, reason: outcome.error });
    return {
      ok: false,
      retryable: false,
      code: 'unsafe_link',
      message: UNSAFE_LINK_MESSAGE,
      details: { reason: outcome.error },
    };
  }

  const status = outcome.statusCode;
  const details = { status, ...(words.appSays ? { app: words.appSays } : {}) };

  if (outcome.outcome === 'retry' && !words.broken) {
    const retryAfterMs = capRetryAfter(words.retryAfterMs ?? outcome.retryAfterMs);
    const wait = retryAfterMs === undefined ? {} : { retryAfterMs };
    if (status === 429) {
      return {
        ok: false,
        retryable: true,
        code: 'rate_limited',
        message: `${app} asked PostGear to slow down. PostGear will try again.`,
        details,
        ...wait,
      };
    }
    if (status === null) {
      return {
        ok: false,
        retryable: true,
        code: 'unreachable',
        message: `PostGear could not reach ${app}. It will try again.`,
        details: { status, reason: outcome.error },
      };
    }
    return {
      ok: false,
      retryable: true,
      code: 'unavailable',
      message: `${app} is not answering right now. PostGear will try again.`,
      details,
      ...wait,
    };
  }

  if (words.broken || (status !== null && BROKEN_STATUSES.has(status))) {
    return {
      ok: false,
      retryable: false,
      connectionBroken: true,
      code: 'connection_refused',
      message: disconnectedMessage(app),
      details,
    };
  }

  return {
    ok: false,
    retryable: false,
    code: 'rejected',
    message: words.appSays
      ? `${app} refused the message: ${words.appSays}${/[.!?]$/.test(words.appSays) ? '' : '.'}`
      : `${app} refused the message.`,
    details,
  };
}

/** The one line a simulated send prints on the worker console. */
export function logSimulatedSend(
  kind: string,
  to: { name: string; hint?: string },
  text: string,
): void {
  const where = to.hint ? `${to.name} (${to.hint})` : to.name;
  console.log(
    `[automation:simulate] ${kind} to ${where}: "${Array.from(text).slice(0, 80).join('')}"`,
  );
}
