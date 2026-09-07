/**
 * The base class every provider extends.
 *
 * Its whole job is to make one HTTP call correctly, so that thirty-odd call
 * sites across seven providers don't each reinvent timeouts, rate-limit
 * handling, and error classification. A provider that just calls `this.fetch`
 * gets all of it.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BadBodyError,
  NotEnoughScopesError,
  type ProviderError,
  RefreshTokenError,
  RetryableError,
  safeStringify,
} from './errors';
import type { PostDetails } from './social.provider.interface';

/**
 * How a provider classifies a platform's error response.
 *
 * `value` is the message a user will see for `bad-body`, so it should say what
 * to change, not repeat the platform's jargon.
 */
export interface HandledError {
  type: 'refresh-token' | 'bad-body' | 'retry';
  value: string;
}

export interface FetchOptions extends RequestInit {
  /** Abandon the request after this long. */
  timeoutMs?: number;
  /** Retries already spent. Callers leave this alone; the retry path increments it. */
  attempt?: number;
}

/** Status codes that are always worth retrying regardless of body. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;

/**
 * Backoff is capped, and the cap is a real control rather than a nicety.
 *
 * An uncapped exponential delay that holds a connection open while it sleeps is
 * itself a denial-of-service surface — the same reasoning Sprint 2 applied to
 * login throttling in `lockout.service.ts`.
 */
const MAX_BACKOFF_MS = 8_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export abstract class SocialAbstract {
  abstract readonly identifier: string;

  /**
   * Maps a platform's error response onto an action.
   *
   * Overridden per provider — this is where each platform's opaque strings
   * ("You are not permitted to perform this action") become something a user
   * can act on. Returning `undefined` falls back to status-code classification.
   */
  protected handleErrors(_body: string, _status: number): HandledError | undefined {
    return undefined;
  }

  /**
   * One HTTP call, with timeout, bounded retry, and typed failures.
   *
   * Returns only on 2xx. Everything else either retries or throws one of the
   * error classes, so callers never have to check `response.ok`.
   */
  protected async fetch(url: string, options: FetchOptions = {}): Promise<Response> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, attempt = 0, ...init } = options;

    let response: Response;

    try {
      response = await globalThis.fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // A network-level failure (DNS, connection reset, timeout) is transient by
      // nature, so it takes the same bounded-retry path as a 503 rather than
      // failing the post outright.
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(this.backoffFor(attempt));
        return this.fetch(url, { ...options, attempt: attempt + 1 });
      }

      throw new RetryableError(
        `${this.identifier} could not be reached. Please try again shortly.`,
        this.identifier,
        error instanceof Error ? error.message : String(error),
      );
    }

    if (response.ok) {
      return response;
    }

    // Read the body once — it is both the retry signal and the error detail,
    // and a Response body can only be consumed a single time.
    const body = await response.text().catch(() => '');
    const handled = this.handleErrors(body, response.status);

    const shouldRetry =
      handled?.type === 'retry' ||
      (!handled && RETRYABLE_STATUSES.has(response.status)) ||
      (!handled && response.status >= 500);

    if (shouldRetry && attempt < MAX_ATTEMPTS - 1) {
      await sleep(this.backoffFor(attempt, response));
      return this.fetch(url, { ...options, attempt: attempt + 1 });
    }

    throw this.toError(handled, response.status, body);
  }

  /** Convenience wrapper for the common case of a JSON response. */
  protected async fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
    const response = await this.fetch(url, options);
    const text = await response.text();

    if (!text) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new BadBodyError(
        `${this.identifier} returned a response PostGear could not read.`,
        this.identifier,
        text,
        response.status,
      );
    }
  }

  /** Turns a classified (or unclassified) failure into the right error type. */
  private toError(handled: HandledError | undefined, status: number, body: string): ProviderError {
    if (handled?.type === 'refresh-token' || (!handled && status === 401)) {
      return new RefreshTokenError(
        handled?.value ??
          `Your ${this.identifier} connection has expired. Please reconnect the channel.`,
        this.identifier,
        body,
        status,
      );
    }

    if (handled?.type === 'retry' || RETRYABLE_STATUSES.has(status) || status >= 500) {
      return new RetryableError(
        handled?.value ?? `${this.identifier} is temporarily unavailable.`,
        this.identifier,
        body,
        status,
      );
    }

    // 403 is deliberately *not* a refresh signal. A valid token can still be
    // refused for a permission the user never granted, and refreshing it would
    // return an equally powerless token — the user has to re-consent.
    if (!handled && status === 403) {
      return new NotEnoughScopesError(
        this.identifier,
        [],
        `Your ${this.identifier} account has not granted PostGear permission to do that.`,
      );
    }

    return new BadBodyError(
      handled?.value ?? `${this.identifier} rejected the request.`,
      this.identifier,
      body,
      status,
    );
  }

  /**
   * Exponential backoff, capped, and respecting `Retry-After` when the platform
   * sends one — a server telling us when to come back beats guessing, and
   * ignoring it is how an integration earns a longer ban.
   */
  private backoffFor(attempt: number, response?: Response): number {
    const retryAfter = response?.headers.get('retry-after');

    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1_000, MAX_BACKOFF_MS);
      }
    }

    return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  }

  /**
   * Verifies the platform granted everything we asked for.
   *
   * Providers return granted scopes inconsistently — an array, a
   * space-delimited string, a comma-delimited one, sometimes URL-encoded — so
   * this normalizes before comparing.
   */
  protected checkScopes(required: string[], granted: string | string[] | undefined): void {
    if (required.length === 0) {
      return;
    }

    // A platform that doesn't report scopes isn't evidence of a problem; the
    // first real API call will fail with a 403 if something is genuinely
    // missing, and that path already produces NotEnoughScopesError.
    if (granted === undefined || granted === null || granted === '') {
      return;
    }

    const grantedList = Array.isArray(granted)
      ? granted
      : decodeURIComponent(granted)
          .split(/[\s,]+/)
          .filter(Boolean);

    const missing = required.filter((scope) => !grantedList.includes(scope));

    if (missing.length > 0) {
      throw new NotEnoughScopesError(this.identifier, missing);
    }
  }

  /**
   * PKCE pair generation.
   *
   * Shared rather than per-provider because X, LinkedIn, TikTok and Pinterest
   * all use it and the construction is fixed by RFC 7636 — S256, base64url, no
   * padding. Getting it subtly wrong in one provider would be an obscure bug.
   */
  protected generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
    // 32 random bytes → 43 base64url chars, comfortably inside the RFC's 43-128.
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  /** A random opaque value for the OAuth `state` parameter. */
  protected generateState(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * The empty token that signals "this provider cannot refresh".
   *
   * Callers test `accessToken` rather than catching, so a provider without a
   * refresh mechanism returns this instead of throwing.
   */
  protected cannotRefresh(): {
    id: string;
    accessToken: string;
    name: string;
  } {
    return { id: '', accessToken: '', name: '' };
  }

  /** Default: nothing to check. Providers with real media rules override. */
  async checkValidity(_posts: PostDetails[]): Promise<string | true> {
    return true;
  }

  /** Coerces the loosely-typed values that arrive from stored JSON settings. */
  protected asBoolean(value: unknown): boolean {
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return Boolean(value);
  }

  /** Constant-time compare, for any provider that must verify a signature. */
  protected safeCompare(a: string, b: string): boolean {
    const bufferA = Buffer.from(a, 'utf8');
    const bufferB = Buffer.from(b, 'utf8');

    if (bufferA.length !== bufferB.length) {
      return false;
    }

    return timingSafeEqual(bufferA, bufferB);
  }

  /** Stringify that survives circular references, for error payloads. */
  protected stringify(value: unknown): string {
    return safeStringify(value);
  }
}
