import type { ConnectionKind } from '@postgear/automation';
import type { UrlGuardOptions } from '@postgear/seo-engine';

/** How links are judged: the public-address guard, or anything when `WEBHOOK_ALLOW_PRIVATE_URLS=true`. */
export interface JudgeOptions {
  allowPrivate: boolean;
  resolve?: UrlGuardOptions['resolve'];
}

export type CredentialsVerdict<C> = { ok: true; credentials: C } | { ok: false; message: string };

/**
 * One outside app a workspace can connect.
 *
 * `judge` is the only place a pasted value is accepted: the strict schema,
 * then the app's own rules (host, path, header names), then the public
 * address check. It runs at save and again on Check Connection, so a stored
 * value is always one that would be accepted today.
 */
export interface ConnectionProvider<C = unknown> {
  kind: ConnectionKind;
  /**
   * `send`: the only real check is sending a message (incoming webhooks), so
   * the UI says "Saved, not checked". `read`: a read-only call can check it
   * (Google, Module 13). `none`: there is nothing to check (secret headers).
   */
  check: 'send' | 'read' | 'none';
  /** False when only the OAuth callback may set the credentials (Google). */
  formEntry: boolean;
  /** The app's own instructions, linked from the connect dialog. */
  helpLink: string;
  judge(input: unknown, options: JudgeOptions): Promise<CredentialsVerdict<C>>;
  /** Safe to show and to log: never more than the last 4 characters of a secret. */
  mask(credentials: C, meta: Record<string, unknown> | null): string;
}
