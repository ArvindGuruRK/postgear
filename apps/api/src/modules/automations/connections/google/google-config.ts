/**
 * Which Google OAuth client the Sheets connection uses (Module 13).
 *
 * `GOOGLE_AUTOMATION_CLIENT_ID` and `_SECRET` when both are set, else the
 * sign-in app's `GOOGLE_CLIENT_ID` and `_SECRET` (one Google Cloud project
 * is fine; its OAuth client needs the redirect URI
 * `${API_URL}/automation-connections/oauth/google/callback`). The values
 * `.env.example` ships with (`google-client-id`, `google-client-secret`)
 * count as not set, so a fresh local `.env` says "not set up" honestly.
 * The worker reads the same variables in `providers/google-auth.ts`.
 */
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../../config/env';

const PLACEHOLDERS = new Set(['google-client-id', 'google-client-secret']);

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
}

/** The variables this reads, by name. */
export type GoogleEnv = Partial<
  Record<
    | 'GOOGLE_AUTOMATION_CLIENT_ID'
    | 'GOOGLE_AUTOMATION_CLIENT_SECRET'
    | 'GOOGLE_CLIENT_ID'
    | 'GOOGLE_CLIENT_SECRET',
    string | undefined
  >
>;

function real(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && !PLACEHOLDERS.has(trimmed) ? trimmed : null;
}

export function googleClientFrom(env: GoogleEnv): GoogleClientConfig | null {
  const automationId = real(env.GOOGLE_AUTOMATION_CLIENT_ID);
  const automationSecret = real(env.GOOGLE_AUTOMATION_CLIENT_SECRET);
  if (automationId && automationSecret) {
    return { clientId: automationId, clientSecret: automationSecret };
  }
  const id = real(env.GOOGLE_CLIENT_ID);
  const secret = real(env.GOOGLE_CLIENT_SECRET);
  return id && secret ? { clientId: id, clientSecret: secret } : null;
}

export function googleClientFromConfig(
  config: ConfigService<Env, true>,
): GoogleClientConfig | null {
  return googleClientFrom({
    GOOGLE_AUTOMATION_CLIENT_ID: config.get('GOOGLE_AUTOMATION_CLIENT_ID', { infer: true }),
    GOOGLE_AUTOMATION_CLIENT_SECRET: config.get('GOOGLE_AUTOMATION_CLIENT_SECRET', { infer: true }),
    GOOGLE_CLIENT_ID: config.get('GOOGLE_CLIENT_ID', { infer: true }),
    GOOGLE_CLIENT_SECRET: config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
  });
}

/** True when a real Google client id and secret are configured. */
export function googleReadyFrom(env: GoogleEnv): boolean {
  return googleClientFrom(env) !== null;
}
