/**
 * The Share dialog's wording and list keeping (DS-9.1), kept pure so it can
 * be tested without a browser: the expiry choices, when a link was created
 * and last opened, the new link's address, and the list of active links
 * after what the dialog itself did while a fetch was on its way.
 */
import { ApiError } from '@/lib/api';
import type { ShareView } from '@/types/studio';
import { expiryLabel, sinceLabel } from './studio-view-model';

export const NOT_VIEWED = 'Not viewed yet';

export const UNREACHABLE = 'PostGear could not be reached. Check your connection and try again.';

/** "1 day", "7 days": a choice in the expiry select. */
export function dayLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

/** "Created 2 days ago". */
export function createdLabel(iso: string, now: Date): string {
  return `Created ${sinceLabel(iso, now)}`;
}

/** "Last viewed 5 minutes ago"; a link nobody has opened is `NOT_VIEWED`. */
export function viewedLabel(iso: string, now: Date): string {
  return `Last viewed ${sinceLabel(iso, now)}`;
}

/**
 * A Revoke button's name for a screen reader, which hears every row's
 * button as "Revoke" otherwise: "Revoke the link that expires in 3 days".
 */
export function revokeLabel(expiresAt: string, now: Date): string {
  const expiry = expiryLabel(expiresAt, now);
  return `Revoke the link that ${expiry.charAt(0).toLowerCase()}${expiry.slice(1)}`;
}

function isWebAddress(address: string): boolean {
  try {
    const { protocol } = new URL(address);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The new link's address, from the one answer that carries it: the API's
 * own, or, should that be missing or not a web address, the share page on
 * this app built from the token. Null when neither is usable.
 */
export function shareLinkOf(
  share: Pick<ShareView, 'token' | 'url'>,
  origin: string,
): string | null {
  const built = share.token
    ? `${origin}/share/design/${encodeURIComponent(share.token)}`
    : undefined;

  return [share.url, built].find((address) => address && isWebAddress(address)) ?? null;
}

/** A link as the list keeps it: never its token or address. */
export function listedShare(share: ShareView): ShareView {
  return {
    id: share.id,
    expiresAt: share.expiresAt,
    createdAt: share.createdAt,
    lastViewedAt: share.lastViewedAt,
  };
}

/**
 * The list as fetched, corrected by what the dialog did while it was on its
 * way: links made here go first (they are the newest, as the API orders
 * them) unless the fetch already has them, and links revoked here are left
 * out even when the fetch still had them.
 */
export function mergeShares(
  fetched: readonly ShareView[],
  made: readonly ShareView[],
  revoked: ReadonlySet<string>,
): ShareView[] {
  const known = new Set(fetched.map((share) => share.id));

  return [...made.filter((share) => !known.has(share.id)), ...fetched].filter(
    (share) => !revoked.has(share.id),
  );
}

/**
 * What a failed request says: the API's own sentence when it answered,
 * `UNREACHABLE` when it never did (`fetch` rejects with a TypeError then),
 * and `fallback` for anything else.
 */
export function problemOf(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) return cause.message;
  if (cause instanceof TypeError) return UNREACHABLE;
  return fallback;
}
