/**
 * The searches a person made lately, kept in this browser (2026-10-21).
 *
 * Per workspace, because what was searched for is about that workspace's
 * posts and channels, and per browser, because it is a convenience and not
 * data: storage can be empty, blocked or full (a private window, cleared
 * site data), so every read and write is guarded and the box works the same
 * without it.
 */

const KEY_PREFIX = 'pg:recent-searches:';

/** How many searches are kept. */
export const MAX_RECENT = 5;

function keyFor(orgId: string): string {
  return `${KEY_PREFIX}${orgId}`;
}

export function readRecent(orgId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(keyFor(orgId)) ?? '[]');

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function write(orgId: string, searches: string[]): void {
  try {
    window.localStorage.setItem(keyFor(orgId), JSON.stringify(searches));
  } catch {
    // Storage is a convenience; losing it changes nothing else.
  }
}

/** Puts `search` first, dropping an earlier copy of it (ignoring case). Returns the new list. */
export function rememberSearch(orgId: string, search: string): string[] {
  const text = search.trim().replace(/\s+/g, ' ');

  if (text === '') {
    return readRecent(orgId);
  }

  const next = [
    text,
    ...readRecent(orgId).filter((entry) => entry.toLowerCase() !== text.toLowerCase()),
  ].slice(0, MAX_RECENT);

  write(orgId, next);
  return next;
}

/** Forgets one search. Returns the new list. */
export function forgetSearch(orgId: string, search: string): string[] {
  const next = readRecent(orgId).filter((entry) => entry !== search);
  write(orgId, next);
  return next;
}

export function clearRecent(orgId: string): void {
  try {
    window.localStorage.removeItem(keyFor(orgId));
  } catch {
    // See `write`.
  }
}
