/**
 * Google access tokens for the Sheets step (Sprint 10, Module 13).
 *
 * A Google connection stores `{ refreshToken, accessToken, expiresAt, scope,
 * email }`, encrypted (the API's OAuth callback wrote it). Access tokens
 * live an hour, so before each call:
 *
 * - **Still good for more than 60 s**: use it as is.
 * - **Expiring or expired**: refresh it at `oauth2.googleapis.com` through
 *   `safeHttpRequest` (one path for every outside call), and write the new
 *   token back with `saveConnectionCredentials`, which encrypts it. Two runs
 *   refreshing at once both get a valid token; the last write wins, and
 *   either token works until it expires.
 * - **`invalid_grant`**: the person revoked access, changed their password,
 *   or (while the Google app is in testing mode) the 7 days ran out. The
 *   connection needs a reconnect: the result is `connectionBroken`, which
 *   `providerExecutor` turns into Needs Reconnect on the Connections page and
 *   a stopped run with "Google Sheets is disconnected. Reconnect it in
 *   Connections."
 *
 * The OAuth client is the same one the API's connection uses: the
 * automation client when set, else the sign-in client. A client id or
 * secret still holding the `.env.example` placeholder counts as not set.
 */
import type { safeHttpRequest } from '../../lib/safe-http';
import type { ProviderResult } from './types';

export type ProviderFailure = Extract<ProviderResult, { ok: false }>;
export type SafeHttp = typeof safeHttpRequest;

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Refresh when the token has less than this left. */
export const GOOGLE_REFRESH_MARGIN_MS = 60_000;
export const GOOGLE_TIMEOUT_MS = 15_000;

export const GOOGLE_DISCONNECTED_MESSAGE =
  'Google Sheets is disconnected. Reconnect it in Connections.';
export const GOOGLE_NOT_SET_UP_MESSAGE = 'Ask a workspace admin to set up Google.';
export const GOOGLE_UNAVAILABLE_MESSAGE = 'Google is not answering right now.';

/** Values `.env.example` ships with: not a real client. */
const PLACEHOLDERS = new Set(['google-client-id', 'google-client-secret']);

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export interface GoogleCredentials {
  refreshToken: string;
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
  email?: string;
}

function real(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && !PLACEHOLDERS.has(trimmed) ? trimmed : null;
}

/** The automation client, else the sign-in client; null when neither is really set. */
export function googleClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): GoogleClient | null {
  const automationId = real(env.GOOGLE_AUTOMATION_CLIENT_ID);
  const automationSecret = real(env.GOOGLE_AUTOMATION_CLIENT_SECRET);
  if (automationId && automationSecret) {
    return { clientId: automationId, clientSecret: automationSecret };
  }
  const signInId = real(env.GOOGLE_CLIENT_ID);
  const signInSecret = real(env.GOOGLE_CLIENT_SECRET);
  return signInId && signInSecret ? { clientId: signInId, clientSecret: signInSecret } : null;
}

/** A simulated connection (`AUTOMATION_SIMULATION`, made on the Connections page). */
export function isSimulatedGoogle(credentials: unknown): boolean {
  return (
    typeof credentials === 'object' &&
    credentials !== null &&
    (credentials as { simulated?: unknown }).simulated === true
  );
}

/** The stored credentials, or null when they are not a Google token set. */
export function readGoogleCredentials(value: unknown): GoogleCredentials | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.refreshToken !== 'string' || record.refreshToken === '') return null;
  return {
    refreshToken: record.refreshToken,
    accessToken: typeof record.accessToken === 'string' ? record.accessToken : '',
    expiresAt: typeof record.expiresAt === 'number' ? record.expiresAt : 0,
    scope: typeof record.scope === 'string' ? record.scope : '',
    ...(typeof record.email === 'string' ? { email: record.email } : {}),
  };
}

export const disconnected = (): ProviderFailure => ({
  ok: false,
  retryable: false,
  connectionBroken: true,
  code: 'google_disconnected',
  message: GOOGLE_DISCONNECTED_MESSAGE,
});

function parseJson(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface AccessTokenInput {
  credentials: unknown;
  client: GoogleClient | null;
  now: Date;
  http: SafeHttp;
  signal?: AbortSignal;
  /** Writes refreshed credentials back (encrypted by the store). */
  save(credentials: GoogleCredentials): Promise<void>;
}

/** A usable access token, refreshing (and saving) it when it expires within 60 s. */
export async function googleAccessToken(
  input: AccessTokenInput,
): Promise<{ ok: true; accessToken: string } | ProviderFailure> {
  const stored = readGoogleCredentials(input.credentials);
  if (!stored) return disconnected();

  const now = input.now.getTime();
  if (stored.accessToken && stored.expiresAt - now > GOOGLE_REFRESH_MARGIN_MS) {
    return { ok: true, accessToken: stored.accessToken };
  }
  if (!input.client) {
    return {
      ok: false,
      retryable: false,
      code: 'google_not_set_up',
      message: GOOGLE_NOT_SET_UP_MESSAGE,
    };
  }

  const outcome = await input.http({
    method: 'POST',
    url: GOOGLE_TOKEN_URL,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
      client_id: input.client.clientId,
      client_secret: input.client.clientSecret,
    }).toString(),
    timeoutMs: GOOGLE_TIMEOUT_MS,
    keepBody: true,
    signal: input.signal,
  });

  if (outcome.outcome === 'ok') {
    const body = parseJson(outcome.body);
    const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    if (!accessToken) {
      return {
        ok: false,
        retryable: true,
        code: 'google_unavailable',
        message: GOOGLE_UNAVAILABLE_MESSAGE,
      };
    }
    const refreshed: GoogleCredentials = {
      ...stored,
      accessToken,
      expiresAt: now + expiresIn * 1000,
      scope: typeof body.scope === 'string' ? body.scope : stored.scope,
      // Google rarely rotates refresh tokens; keep a new one when it does.
      refreshToken:
        typeof body.refresh_token === 'string' && body.refresh_token
          ? body.refresh_token
          : stored.refreshToken,
    };
    await input.save(refreshed);
    return { ok: true, accessToken };
  }

  if (outcome.outcome === 'rejected') {
    const error = parseJson(outcome.body).error;
    if (error === 'invalid_grant') return disconnected();
    // invalid_client and friends: PostGear's own Google set-up is wrong.
    return {
      ok: false,
      retryable: false,
      code: 'google_not_set_up',
      message: GOOGLE_NOT_SET_UP_MESSAGE,
      details: { status: outcome.statusCode, error: typeof error === 'string' ? error : null },
    };
  }

  if (outcome.outcome === 'retry') {
    return {
      ok: false,
      retryable: true,
      code: outcome.statusCode === 429 ? 'rate_limited' : 'google_unavailable',
      message: GOOGLE_UNAVAILABLE_MESSAGE,
    };
  }

  return {
    ok: false,
    retryable: false,
    code: 'google_unavailable',
    message: GOOGLE_UNAVAILABLE_MESSAGE,
  };
}
