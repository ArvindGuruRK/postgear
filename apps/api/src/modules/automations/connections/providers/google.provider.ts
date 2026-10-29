/**
 * A Google account, for Google Sheets (Module 13). Set only by the OAuth
 * callback, never typed into a form; Module 13 adds the OAuth plug-in and
 * the read-only check.
 */
import { z } from 'zod';
import { CONNECTION_MESSAGES } from '../connections.messages';
import type { ConnectionProvider } from './provider.types';

export interface GoogleCredentials {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
}

export const googleCredentialsSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().int().nonnegative(),
    scope: z.string(),
  })
  .strict();

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
  mask: (_credentials, meta) =>
    typeof meta?.email === 'string' && meta.email ? meta.email : 'Google account',
};
