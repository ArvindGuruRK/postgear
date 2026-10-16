/**
 * What a failed call throws. The API answers every error as
 * `{ error, statusCode }`; the SDK surfaces that message, the status, and —
 * for a 429 — how long to wait, read from `Retry-After`.
 */
export class PostGearError extends Error {
  readonly status: number;
  /** Seconds to wait before trying again; set on a 429 when the API said. */
  readonly retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'PostGearError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** A request that never reached the API, or was cut off by the timeout. */
export class PostGearNetworkError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'PostGearNetworkError';
  }
}
