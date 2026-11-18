/**
 * The cursor the web pages a channel list with. Opaque to the web; inside it
 * is where the next page continues (`PagePosition`): which binding, that
 * binding's own cursor, and the page number.
 *
 * The page number is what holds a session to 20 pages of 50 (1,000 items,
 * research 11 section 7) whatever the binding's cursors look like: a cursor
 * is never made for the 21st page, and one that claims to be is refused.
 * Nothing in it is trusted beyond its shape; a binding re-checks its own
 * cursor, and the cache key carries a hash of it, never the text.
 */
import { createHash } from 'node:crypto';
import { MAX_LIST_ITEMS, MAX_LIST_PAGE } from '@postgear/video-engine';
import type { PagePosition } from './channel-lister.selector';

/** Pages a session may load: 20. */
export const MAX_LIST_PAGES = MAX_LIST_ITEMS / MAX_LIST_PAGE;
/** Long enough for any binding's cursor, short enough to sit in a query string. */
export const CURSOR_MAX_LENGTH = 1_024;
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/;

export function encodeCursor(position: PagePosition): string {
  return Buffer.from(
    JSON.stringify({ p: position.page, s: position.source, c: position.cursor }),
    'utf8',
  ).toString('base64url');
}

/** The position a cursor names, or null when it is not one of ours or is past the last page. */
export function decodeCursor(text: string): PagePosition | null {
  if (!CURSOR.test(text)) return null;
  let value: { p?: unknown; s?: unknown; c?: unknown };
  try {
    value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { p, s, c } = value;
  if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p >= MAX_LIST_PAGES) return null;
  if (s !== 'official' && s !== 'flat') return null;
  if (typeof c !== 'string' || c.length === 0 || c.length > 512) return null;
  return { page: p, source: s, cursor: c };
}

/** The cursor's part of a cache key: empty for the first page, else a short hash. */
export function cursorKeyPart(position: PagePosition | null): string {
  if (position === null) return '';
  return createHash('sha256').update(encodeCursor(position)).digest('hex').slice(0, 24);
}
