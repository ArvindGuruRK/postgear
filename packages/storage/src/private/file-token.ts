/**
 * Signed tokens for the local private binding's files route,
 * `${API_URL}/clips/files/<token>`.
 *
 * The token is the authority: the route is public (a `<video>` element sends
 * no session), so everything it may do is inside the token and covered by an
 * HMAC-SHA256 with `CLIPS_URL_SECRET`. A token is
 * `<base64url payload>.<base64url signature>`; the payload names the purpose,
 * the key, the expiry in Unix seconds and, for a download, the file name (or,
 * for a part upload, the upload id and part number). Changing any character
 * breaks the signature; the signature is compared in constant time and checked
 * before the payload is even parsed.
 *
 * S3 does not use these: its binding hands out presigned URLs instead.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isValidClipKey } from '../clip-keys';

/** What a token lets its bearer do. */
export type FileTokenClaims =
  | {
      /** Read one file, with Range support. */
      purpose: 'get';
      key: string;
      /** Unix seconds. */
      expiresAt: number;
      /** When set, served as an attachment with this name. */
      downloadName?: string;
    }
  | {
      /** Upload one part of a multipart upload (the browser's PUT). */
      purpose: 'part';
      key: string;
      /** Unix seconds. */
      expiresAt: number;
      uploadId: string;
      partNumber: number;
    };

/** Why a token was refused; the route maps each to a status. */
export type FileTokenFailure = 'malformed' | 'signature' | 'expired';

/** The outcome of `verifyFileToken`. */
export type FileTokenResult =
  | { ok: true; claims: FileTokenClaims }
  | { ok: false; reason: FileTokenFailure };

/** Signed links last at most a week, which is also S3's own ceiling. */
export const MAX_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;

/** The shortest secret accepted, matching the API's env rule. */
export const MIN_URL_SECRET_LENGTH = 32;

const DOMAIN = 'postgear.clips.file.v1.';
const MAX_TOKEN_LENGTH = 4096;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UPLOAD_ID = /^[A-Za-z0-9._~-]{1,1024}$/;

interface WirePayload {
  v: 1;
  p: 'get' | 'part';
  k: string;
  e: number;
  d?: string;
  u?: string;
  n?: number;
}

function assertSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.length < MIN_URL_SECRET_LENGTH) {
    throw new Error(`CLIPS_URL_SECRET must be at least ${MIN_URL_SECRET_LENGTH} characters`);
  }
}

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(DOMAIN).update(payload).digest();
}

/**
 * The expiry, in Unix seconds, for a link that should last `seconds` from
 * `now`. Refuses a lifetime that is not a whole number from 1 to a week.
 */
export function expiryFrom(seconds: number, now: number = Date.now()): number {
  assertSignedUrlSeconds(seconds);
  return Math.floor(now / 1000) + seconds;
}

/** Refuses a link lifetime that is not a whole number of seconds from 1 to a week. */
export function assertSignedUrlSeconds(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SIGNED_URL_SECONDS) {
    throw new Error(`A signed link lasts from 1 to ${MAX_SIGNED_URL_SECONDS} seconds`);
  }
}

/** Signs claims into a token. The key must be a valid private key. */
export function signFileToken(claims: FileTokenClaims, secret: string): string {
  assertSecret(secret);

  if (!isValidClipKey(claims.key)) {
    throw new Error('Refusing to sign a private key PostGear did not generate');
  }
  if (!Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= 0) {
    throw new Error('A signed link needs an expiry in whole Unix seconds');
  }

  const wire: WirePayload =
    claims.purpose === 'get'
      ? {
          v: 1,
          p: 'get',
          k: claims.key,
          e: claims.expiresAt,
          ...(claims.downloadName ? { d: claims.downloadName } : {}),
        }
      : {
          v: 1,
          p: 'part',
          k: claims.key,
          e: claims.expiresAt,
          u: claims.uploadId,
          n: claims.partNumber,
        };

  if (wire.p === 'part' && (!isUploadId(wire.u) || !isPartNumber(wire.n))) {
    throw new Error('A part token needs an upload id and a part number from 1 to 10000');
  }

  const payload = Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url');
  return `${payload}.${signature(payload, secret).toString('base64url')}`;
}

/**
 * Checks a token: shape, signature (constant time), payload, key, expiry.
 * Never throws for a bad token, so the route answers rather than erroring.
 */
export function verifyFileToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): FileTokenResult {
  assertSecret(secret);

  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'malformed' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };

  const [payload, sent] = parts;
  if (!payload || !sent || !BASE64URL.test(payload) || !BASE64URL.test(sent)) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = signature(payload, secret);
  const given = Buffer.from(sent, 'base64url');

  // Re-encoding catches a signature with stray trailing bits that would decode
  // to the same bytes: a token has exactly one valid spelling.
  if (
    given.length !== expected.length ||
    given.toString('base64url') !== sent ||
    !timingSafeEqual(given, expected)
  ) {
    return { ok: false, reason: 'signature' };
  }

  const claims = parsePayload(payload);
  if (!claims) return { ok: false, reason: 'malformed' };

  if (claims.expiresAt * 1000 <= now) return { ok: false, reason: 'expired' };

  return { ok: true, claims };
}

function parsePayload(payload: string): FileTokenClaims | null {
  let wire: unknown;

  try {
    wire = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof wire !== 'object' || wire === null) return null;
  const { v, p, k, e, d, u, n } = wire as Record<string, unknown>;

  if (v !== 1 || typeof k !== 'string' || !isValidClipKey(k)) return null;
  if (typeof e !== 'number' || !Number.isSafeInteger(e) || e <= 0) return null;

  if (p === 'get') {
    if (d !== undefined && (typeof d !== 'string' || d.length === 0 || d.length > 512)) return null;
    return { purpose: 'get', key: k, expiresAt: e, ...(d ? { downloadName: d } : {}) };
  }

  if (p === 'part' && isUploadId(u) && isPartNumber(n)) {
    return { purpose: 'part', key: k, expiresAt: e, uploadId: u, partNumber: n };
  }

  return null;
}

function isUploadId(value: unknown): value is string {
  return typeof value === 'string' && UPLOAD_ID.test(value);
}

/** True for an S3 part number: a whole number from 1 to 10000. */
export function isPartNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10_000;
}
