/**
 * The error taxonomy every provider throws, and every caller branches on.
 *
 * These are plain `Error` subclasses on purpose. The reference implementation
 * derives its equivalents from Temporal's `ApplicationFailure`, which couples
 * the whole provider layer to a workflow engine — but PostGear calls these
 * providers from the API process (Sprint 3) well before the worker exists
 * (Sprint 5), and `@postgear/social-core` must stay importable from both.
 * Sprint 5 maps these onto Temporal failures at the activity boundary, which is
 * the one place that actually knows about Temporal.
 *
 * The split is not cosmetic. Sprint 5's publishing workflow branches on exactly
 * this distinction: `RetryableError` retries with backoff, `RefreshTokenError`
 * diverts to the token-refresh workflow, and `BadBodyError` fails the post
 * immediately because retrying an malformed request just wastes attempts.
 */

/** How much of a provider's response body is worth keeping on an error. */
const MAX_BODY_LENGTH = 4_000;

/**
 * Provider error bodies are genuinely unbounded — full HTML error pages, echoed
 * base64 media, stack traces. Sprint 5 puts these into a durable Temporal
 * history that ships over gRPC with a hard frame limit, so the cap belongs here
 * rather than being remembered at each call site.
 */
export function truncateBody(value: unknown, max: number = MAX_BODY_LENGTH): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text = typeof value === 'string' ? value : safeStringify(value);

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}

/** `JSON.stringify` that survives circular references instead of throwing. */
export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  return (
    JSON.stringify(value, (_key, current) => {
      if (typeof current === 'object' && current !== null) {
        if (seen.has(current)) {
          return '[Circular]';
        }
        seen.add(current);
      }
      return current;
    }) ?? ''
  );
}

/**
 * Base for every failure raised by a provider.
 *
 * `identifier` is the provider that failed, so a log line or a stored error
 * says which platform broke without the caller having to thread that through.
 */
export class ProviderError extends Error {
  readonly identifier: string;
  /** The platform's own response body, truncated. Diagnostic only — never shown to a user. */
  readonly providerBody: string;
  readonly status?: number;

  constructor(message: string, identifier: string, providerBody: unknown = '', status?: number) {
    super(message);
    this.name = new.target.name;
    this.identifier = identifier;
    this.providerBody = truncateBody(providerBody);
    this.status = status;
  }
}

/**
 * The stored credentials are dead — expired, revoked, or scope-reduced.
 *
 * The only cure is a new token: either a successful `refreshToken()`, or the
 * user re-running the OAuth handshake. Callers must **not** retry the original
 * request unchanged, and must set `Integration.refreshNeeded` when refreshing
 * also fails, since that is the flag the UI reads to offer "Reconnect".
 */
export class RefreshTokenError extends ProviderError {}

/**
 * The request itself was wrong — too long, unsupported media, duplicate
 * content, a rule the platform enforces.
 *
 * Retrying is pointless; the post must change. This is the branch whose
 * `message` is worth surfacing to the user, so provider `handleErrors()`
 * implementations should map opaque platform strings into something actionable
 * here rather than passing the raw body through.
 */
export class BadBodyError extends ProviderError {}

/**
 * The user completed consent but granted fewer scopes than the provider needs.
 *
 * Distinct from `RefreshTokenError` because the fix is different: re-running the
 * same handshake produces the same result until the user actually approves the
 * missing permissions.
 */
export class NotEnoughScopesError extends ProviderError {
  readonly missingScopes: string[];

  constructor(identifier: string, missingScopes: string[] = [], message?: string) {
    super(
      message ??
        (missingScopes.length > 0
          ? `Missing required permissions: ${missingScopes.join(', ')}`
          : 'The account did not grant all the permissions PostGear needs.'),
      identifier,
    );
    this.missingScopes = missingScopes;
  }
}

/**
 * A transient failure — rate limit, 5xx, a platform having a bad minute.
 *
 * `SocialAbstract.fetch` already retries these a bounded number of times; this
 * escapes only once those are exhausted, at which point Sprint 5's activity
 * retry policy takes over with a longer horizon.
 */
export class RetryableError extends ProviderError {}

/**
 * Raised before any network call when a provider is missing its client id or
 * secret.
 *
 * A deployment gap, not a user error — the connect button should not have been
 * offered. Kept separate so the log can say so while the user still sees a
 * generic message.
 */
export class ProviderNotConfiguredError extends ProviderError {
  constructor(identifier: string) {
    super(`Provider ${identifier} is not configured`, identifier);
  }
}
