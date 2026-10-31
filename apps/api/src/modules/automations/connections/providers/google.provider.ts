/**
 * A Google account, for Google Sheets (Module 13). Set only by the OAuth
 * callback (`google/google-oauth.plugin.ts`), never typed into a form, or,
 * under `AUTOMATION_SIMULATION=true`, a simulated account made on the
 * Connections page (`{ simulated: true }`, masked "Simulated").
 *
 * Credentials: `{ refreshToken, accessToken, expiresAt, scope, email }`,
 * encrypted like every connection. The masked hint is the email with the
 * name hidden (`k***@gmail.com`).
 */
import { z } from 'zod';
import { CONNECTION_MESSAGES } from '../connections.messages';
import type { ConnectionProvider } from './provider.types';

export interface GoogleTokenCredentials {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
  /** The account's address, for the masked hint. */
  email?: string;
}

export interface SimulatedGoogleCredentials {
  simulated: true;
}

export type GoogleCredentials = GoogleTokenCredentials | SimulatedGoogleCredentials;

export const googleTokenCredentialsSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().int().nonnegative(),
    scope: z.string(),
    email: z.string().max(320).optional(),
  })
  .strict();

export const simulatedGoogleCredentialsSchema = z.object({ simulated: z.literal(true) }).strict();

export const googleCredentialsSchema = z.union([
  googleTokenCredentialsSchema,
  simulatedGoogleCredentialsSchema,
]);

export const SIMULATED_GOOGLE_EMAIL = 'simulated@postgear.local';

export function isSimulatedGoogle(credentials: unknown): credentials is SimulatedGoogleCredentials {
  return simulatedGoogleCredentialsSchema.safeParse(credentials).success;
}

/** `kim@gmail.com` as `k***@gmail.com`; anything that is not an address as "Google account". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return 'Google account';
  return `${email[0]}***${email.slice(at)}`;
}

export const googleProvider: ConnectionProvider<GoogleCredentials> = {
  kind: 'google',
  check: 'read',
  formEntry: false,
  helpLink: 'https://support.google.com/accounts/answer/3466521',
  judge: async (input) => {
    const parsed = googleCredentialsSchema.safeParse(input);
    return parsed.success
      ? { ok: true, credentials: parsed.data }
      : { ok: false, message: CONNECTION_MESSAGES.GOOGLE_INVALID };
  },
  mask: (credentials, meta) => {
    if (isSimulatedGoogle(credentials)) return 'Simulated';
    const email =
      'email' in credentials && credentials.email
        ? credentials.email
        : typeof meta?.email === 'string'
          ? meta.email
          : '';
    return email ? maskEmail(email) : 'Google account';
  },
};
