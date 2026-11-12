/**
 * One-click unsubscribe (RFC 8058) for notification email.
 *
 * Each notification carries `List-Unsubscribe: <API_URL/mail/unsubscribe?token=...>`
 * and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Gmail and Apple
 * Mail then show their own Unsubscribe button, which POSTs to that address
 * with no session. The token is the only proof, so it is signed: an HMAC over
 * the address, the kind of email and the workspace, keyed from JWT_SECRET
 * with a purpose label so it can never pass for a session token.
 *
 * It turns off exactly one of the person's existing preferences (the same
 * switches as Settings, Notifications), so it can always be turned back on
 * there. Security mail and billing mail to admins carry no such header.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const UNSUBSCRIBE_TOPICS = ['success', 'failure', 'digest'] as const;
export type UnsubscribeTopic = (typeof UNSUBSCRIBE_TOPICS)[number];

/** The `User` column each topic switches off. */
export const TOPIC_COLUMN = {
  success: 'sendSuccessEmails',
  failure: 'sendFailureEmails',
  digest: 'sendDigestEmails',
} as const satisfies Record<UnsubscribeTopic, string>;

export interface UnsubscribePayload {
  email: string;
  topic: UnsubscribeTopic;
  orgId: string;
}

const PURPOSE = 'postgear:mail-unsubscribe:v1';

function key(secret: string): Buffer {
  return createHmac('sha256', secret).update(PURPOSE).digest();
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', key(secret)).update(body).digest('base64url');
}

export function signUnsubscribe(secret: string, payload: UnsubscribePayload): string {
  const body = Buffer.from(
    JSON.stringify({ e: payload.email.trim().toLowerCase(), t: payload.topic, o: payload.orgId }),
  ).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

/** The payload, or null for anything not signed by us (or not well formed). */
export function verifyUnsubscribe(secret: string, token: unknown): UnsubscribePayload | null {
  if (typeof token !== 'string' || token.length > 1_000) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const { e, t, o } = parsed;
    if (
      typeof e !== 'string' ||
      typeof o !== 'string' ||
      !(UNSUBSCRIBE_TOPICS as readonly unknown[]).includes(t)
    ) {
      return null;
    }
    return { email: e, topic: t as UnsubscribeTopic, orgId: o };
  } catch {
    return null;
  }
}
