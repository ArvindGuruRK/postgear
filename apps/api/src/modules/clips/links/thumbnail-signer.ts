/**
 * Signed thumbnail links (Module 03, section 4).
 *
 * A probe answer never hands the browser the platform's picture address:
 * it gets `GET /clips/links/thumbnail?u=<token>`, and the API fetches the
 * picture itself. The token names the address and an expiry, signed with
 * HMAC-SHA256 and checked in constant time, so the route can only ever fetch
 * an address a probe answer produced, for as long as the page that shows it
 * is likely open (six hours).
 *
 * The key is derived from `CLIPS_URL_SECRET` with a label of its own, so a
 * thumbnail token can never pass as a private file token (which the same
 * secret signs) or the other way round. Without the secret (development
 * only; boot refuses production without it) a random key is made per
 * process, and links simply stop working across a restart.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const THUMBNAIL_LINK_TTL_MS = 6 * 60 * 60 * 1000;
const KEY_LABEL = 'postgear:clips:thumbnail:v1';
/** Pictures are fetched over https only, and the address must be one a person could not stretch. */
const MAX_ADDRESS_LENGTH = 2_048;
/** base64url payload, one dot, a 43 character base64url signature. */
const TOKEN = /^[A-Za-z0-9_-]{8,3000}\.[A-Za-z0-9_-]{43}$/;

export type ThumbnailCheck = { ok: true; url: string } | { ok: false };

export class ThumbnailSigner {
  private readonly key: Buffer;

  constructor(
    secret: string | undefined,
    private readonly now: () => number = Date.now,
  ) {
    const root = secret && secret.length > 0 ? Buffer.from(secret, 'utf8') : randomBytes(32);
    this.key = createHmac('sha256', root).update(KEY_LABEL).digest();
  }

  /** A token for `address`, or null when it is not an https address we would fetch. */
  sign(address: string): string | null {
    if (!isFetchableAddress(address)) return null;
    const payload = Buffer.from(
      JSON.stringify({ u: address, e: Math.floor((this.now() + THUMBNAIL_LINK_TTL_MS) / 1000) }),
      'utf8',
    ).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  /** The address a token names, when the token is ours, intact and not expired. */
  verify(token: unknown): ThumbnailCheck {
    if (typeof token !== 'string' || !TOKEN.test(token)) return { ok: false };
    const [payload, signature] = token.split('.');
    const expected = Buffer.from(this.mac(payload), 'utf8');
    const given = Buffer.from(signature, 'utf8');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false };

    let claims: { u?: unknown; e?: unknown };
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return { ok: false };
    }
    if (typeof claims.u !== 'string' || typeof claims.e !== 'number') return { ok: false };
    if (claims.e * 1000 <= this.now()) return { ok: false };
    return isFetchableAddress(claims.u) ? { ok: true, url: claims.u } : { ok: false };
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}

/** An https address on the default port with no login in it: the only kind the route fetches. */
export function isFetchableAddress(address: string): boolean {
  if (typeof address !== 'string' || address.length === 0 || address.length > MAX_ADDRESS_LENGTH) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '';
}
