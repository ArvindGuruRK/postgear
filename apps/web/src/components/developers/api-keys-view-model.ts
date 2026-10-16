/**
 * The API-keys page's judgements, as pure functions so they can be pinned:
 * which keys are live, when the ceiling is reached, how a timestamp reads,
 * and the two strings the page shows a developer — the docs URL and the
 * first `curl`.
 */
import type { BadgeProps } from '@postgear/ui';
import type { ApiKeyView } from '@/types/developers';
import { formatRelative } from '../posts/post-status';

/** Mirrors `MAX_LIVE_API_KEYS` in the API; the page only uses it to explain a disabled button. */
export const MAX_LIVE_KEYS = 10;

export type ApiKeyStatus = 'live' | 'revoked';

export interface StatusBadge {
  label: string;
  variant: NonNullable<BadgeProps['variant']>;
}

export function keyStatus(key: Pick<ApiKeyView, 'revokedAt'>): ApiKeyStatus {
  return key.revokedAt ? 'revoked' : 'live';
}

/** Live is the one good state a key can be in; revoked is the outline sticker, not a danger. */
export function statusBadge(status: ApiKeyStatus): StatusBadge {
  return status === 'live'
    ? { label: 'Live', variant: 'success' }
    : { label: 'Revoked', variant: 'outline' };
}

export function liveKeyCount(keys: ApiKeyView[]): number {
  return keys.filter((key) => keyStatus(key) === 'live').length;
}

export function atKeyLimit(keys: ApiKeyView[]): boolean {
  return liveKeyCount(keys) >= MAX_LIVE_KEYS;
}

/** "Never", or how long ago. */
export function formatLastUsed(iso: string | null, now: Date): string {
  if (!iso) {
    return 'Never';
  }

  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? 'Never' : formatRelative(date, now);
}

/** A short absolute date, with the year only when it is not this one. */
export function formatCreated(iso: string, now: Date): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function docsUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/api/docs`;
}

/** The first call an integrator makes: proves the key and names the workspace. */
export function curlExample(apiUrl: string, secret: string): string {
  return `curl -H "Authorization: Bearer ${secret}" ${apiUrl.replace(/\/+$/, '')}/v1/me`;
}
