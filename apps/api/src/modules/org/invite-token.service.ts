import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@postgear/db';
import { z } from 'zod';

/**
 * Signed workspace invitations (Settings > Team, 2026-10-19).
 *
 * An invitation is a link, not a row: the token carries everything accepting
 * it needs (a random id, the workspace, the role, optionally the invitee's
 * address, and an expiry), signed so it cannot be edited. That is why this
 * works without a migration, and it is the same mechanism Postiz uses: the
 * admin either has the link emailed or copies it, and whoever opens it joins.
 *
 * ## Format
 *
 * `<payload>.<signature>`, both base64url: the payload is JSON, the signature
 * HMAC-SHA256 over the payload's encoded form. The payload is readable by
 * whoever holds the link, which is fine: it names the workspace they were
 * invited to and, at most, their own address.
 *
 * ## The key
 *
 * Derived from `JWT_SECRET` rather than a new variable, so nothing has to be
 * configured for invitations to work. It is not the secret itself: the key is
 * `HMAC(JWT_SECRET, "postgear:workspace-invite:v1")`, so an invitation's
 * signature and a session token's are computed under different keys and one
 * can never be passed off as the other. Rotating `JWT_SECRET` signs everyone
 * out and voids every outstanding invitation, which is the right pairing.
 *
 * ## Single use is not this class's job
 *
 * A signature proves the link was issued; it cannot prove it was not already
 * used. `OrgService` claims the token's `id` in Redis when it is accepted.
 */

/** How long an invitation stays usable. Mentioned in the email and the dialog. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 16 bytes: unguessable, and short enough to keep the link readable. */
const ID_BYTES = 16;

/** The longest token worth parsing: a 254-character address encodes to well under this. */
const MAX_TOKEN_LENGTH = 2048;

const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Separates this key from every other use of `JWT_SECRET`. */
const KEY_CONTEXT = 'postgear:workspace-invite:v1';

export type InviteRole = typeof Role.ADMIN | typeof Role.USER;

export interface InvitePayload {
  /** Random; what single use is keyed on. */
  id: string;
  orgId: string;
  role: InviteRole;
  /** Lower-cased. When present, only this address may accept. */
  email?: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

/**
 * Checked after the signature, so it only ever sees payloads this server
 * wrote. It still runs: a payload from an older version of this file, or a
 * bug in `sign`, should fail as "not valid" rather than as a 500.
 */
const payloadSchema = z
  .object({
    v: z.literal(1),
    id: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
    orgId: z.string().min(1).max(128),
    role: z.enum([Role.ADMIN, Role.USER]),
    email: z.string().min(3).max(254).optional(),
    exp: z.number().int().positive(),
  })
  .strict();

export type InviteVerification =
  | { ok: true; payload: InvitePayload }
  | { ok: false; reason: 'invalid' | 'expired' };

@Injectable()
export class InviteTokenService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = createHmac('sha256', config.getOrThrow<string>('JWT_SECRET'))
      .update(KEY_CONTEXT)
      .digest();
  }

  /** Mints a link token. `now` is injectable so the expiry can be tested. */
  sign(
    input: { orgId: string; role: InviteRole; email?: string },
    now: number = Date.now(),
  ): { token: string; payload: InvitePayload } {
    const payload: InvitePayload = {
      id: randomBytes(ID_BYTES).toString('base64url'),
      orgId: input.orgId,
      role: input.role,
      ...(input.email ? { email: input.email.toLowerCase() } : {}),
      exp: now + INVITE_TTL_MS,
    };

    const body = Buffer.from(JSON.stringify({ v: 1, ...payload }), 'utf8').toString('base64url');

    return { token: `${body}.${this.signature(body).toString('base64url')}`, payload };
  }

  /**
   * Reads a token back, or says why it cannot be used.
   *
   * Only two outcomes reach the caller. Malformed, tampered and unparseable
   * are all "invalid": telling them apart would only help someone forging
   * one. Expired is its own answer because the person holding a genuine but
   * old link deserves to be told to ask for a new one.
   */
  verify(token: unknown, now: number = Date.now()): InviteVerification {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !TOKEN_SHAPE.test(token)) {
      return { ok: false, reason: 'invalid' };
    }

    const [body, signature] = token.split('.') as [string, string];
    const expected = this.signature(body);
    const given = Buffer.from(signature, 'base64url');

    // `timingSafeEqual` throws on a length mismatch, so lengths first; the
    // length of an HMAC is public anyway.
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return { ok: false, reason: 'invalid' };
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'invalid' };
    }

    const parsed = payloadSchema.safeParse(decoded);
    if (!parsed.success) {
      return { ok: false, reason: 'invalid' };
    }

    if (parsed.data.exp <= now) {
      return { ok: false, reason: 'expired' };
    }

    const { v: _version, ...payload } = parsed.data;
    return { ok: true, payload };
  }

  private signature(body: string): Buffer {
    return createHmac('sha256', this.key).update(body, 'utf8').digest();
  }
}
