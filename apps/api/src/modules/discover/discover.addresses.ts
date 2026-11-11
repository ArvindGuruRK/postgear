/**
 * Addresses a person typed, for the two parts of Discover that fetch them: a
 * competitor's website and feeds (Module 07) and the reader (Module 08).
 *
 * One reading of what counts as an address, and one way of asking the
 * private-network guard, so the two can never drift apart on what they refuse.
 */
import {
  isSeoCrawlError,
  normaliseUrl,
  type UrlRejectReason,
  type UrlSafetyResult,
} from '@postgear/seo-engine';
import { workspaceKeys } from './discover.keys';

export type UrlGuard = (url: string) => Promise<UrlSafetyResult>;

/** Addresses one workspace may have refused by the guard in a minute. */
export const ADDRESS_REFUSALS_PER_MINUTE = 30;
const ADDRESS_REFUSALS_WINDOW_SECONDS = 60;

/** The two Redis calls the refusal count needs, so a spec can hand in its fake. */
export interface RefusalStore {
  get(key: string): Promise<string | null>;
  incrementWithTtl(key: string, ttlSeconds: number): Promise<number>;
}

/**
 * Whether this workspace has had too many addresses refused lately to be
 * judged again just now.
 *
 * The guard looks a name up before it can say where it leads, and it runs
 * before every other limit, on purpose: a refused address costs no fetch and
 * no read. That left one thing free and uncounted, the lookups themselves, so
 * a script could walk made-up host names through us as fast as it could ask.
 * A person mistyping an address never gets near thirty refusals in a minute.
 *
 * It is a brake, not an exact meter: the count is read before the guard and
 * raised after it, so refusals asked for at the same moment can all pass the
 * read. The API's limit per caller is what bounds such a burst.
 */
export async function refusalsSpent(redis: RefusalStore, orgId: string): Promise<boolean> {
  const count = Number((await redis.get(workspaceKeys.addressRefusals(orgId))) ?? 0);
  return count >= ADDRESS_REFUSALS_PER_MINUTE;
}

/** Notes one address the guard refused. The workspace only: never the address or why. */
export async function countRefusal(redis: RefusalStore, orgId: string): Promise<void> {
  await redis.incrementWithTtl(
    workspaceKeys.addressRefusals(orgId),
    ADDRESS_REFUSALS_WINDOW_SECONDS,
  );
}

/**
 * An address as a person types it ("acme.com", "https://acme.com/blog") as the
 * address to read, or null when it cannot be one. Only http and https, never
 * credentials.
 */
export function addressOf(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  // Only `scheme://` counts as a scheme: `localhost:3000` is a host and a port.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    return normaliseUrl(withScheme);
  } catch {
    return null;
  }
}

/** The two refusals that mean "this points inside", whichever way the guard found out. */
export function isPrivate(reason: UrlRejectReason): boolean {
  return reason === 'private_address' || reason === 'host_forbidden';
}

/** The guard's own refusal of a redirect hop, as the reason it gave. Null for any other failure. */
export function hopRefusal(error: unknown): UrlRejectReason | null {
  return isSeoCrawlError(error) && error.kind === 'unsafe_url'
    ? (error.reason ?? 'private_address')
    : null;
}

/**
 * The guard's verdict, with one second look. The guard judges a port before it
 * judges an address literal, so `http://127.0.0.1:3000` would be refused for
 * its port. That is the wrong sentence for someone pointing at their own
 * machine, so a port refusal is judged again without the port, and a private
 * host says private. The second look can only turn one refusal into another.
 */
export async function judgeAddress(guard: UrlGuard, url: string): Promise<UrlSafetyResult> {
  const verdict = await guard(url);
  if (verdict.ok || verdict.reason !== 'port') return verdict;

  try {
    const bare = new URL(url);
    bare.port = '';
    const again = await guard(bare.toString());
    return !again.ok && isPrivate(again.reason) ? again : verdict;
  } catch {
    return verdict;
  }
}
