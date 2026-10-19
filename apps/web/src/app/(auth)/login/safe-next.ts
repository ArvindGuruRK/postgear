/**
 * Where to go after signing in, from a `?next=` parameter (2026-10-19, for
 * the invitation page: "Sign in to join" comes back to the invitation).
 *
 * Only a path on this site is honoured: one leading `/`, then anything but a
 * second `/` or a `\`. That refuses every way an attacker could turn the
 * sign-in page into an open redirect: `https://evil.test` (an absolute URL),
 * `//evil.test` (protocol-relative), `/\evil.test` (which browsers normalise
 * to `//evil.test`), and anything with a control character or whitespace a
 * browser might strip before resolving. Anything refused means "no next",
 * and the caller falls back to `/`, which routes as it always has.
 *
 * A plain module, not part of the `'use client'` form, so the server pages
 * can call it: a function exported from a client module is a reference on
 * the server, not something it can run.
 */
const MAX_LENGTH = 512;

export function safeNextPath(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) {
    return null;
  }

  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return null;
  }

  // Control characters and whitespace: browsers drop tabs and newlines from
  // URLs, which can turn a harmless-looking value into `//host`.
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) {
      return null;
    }
  }

  return raw;
}

/** `/login?next=...` or `/register?next=...`, carrying a destination that passed. */
export function withNext(path: '/login' | '/register', next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
