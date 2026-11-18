/**
 * Small HTTP helpers shared by the two private bindings and the API's files
 * route, so a signed S3 download and a local one send the same headers.
 */

/** An inclusive byte range, as in `Range: bytes=start-end`. */
export interface ByteRange {
  start: number;
  /** Inclusive. Absent means "to the end of the object". */
  end?: number;
}

/** A range resolved against a known object size. Both ends inclusive. */
export interface ResolvedRange {
  start: number;
  end: number;
}

/**
 * Resolves a range against an object's size. Null for a range no byte of the
 * object can satisfy (the caller answers 416).
 */
export function resolveRange(range: ByteRange, totalBytes: number): ResolvedRange | null {
  const { start } = range;

  if (!Number.isSafeInteger(start) || start < 0 || start >= totalBytes) return null;
  if (range.end !== undefined && (!Number.isSafeInteger(range.end) || range.end < start)) {
    return null;
  }

  return { start, end: Math.min(range.end ?? totalBytes - 1, totalBytes - 1) };
}

/**
 * Reads a `Range` request header for the files route.
 *
 * Answers the resolved range, `'unsatisfiable'` (send 416 with
 * `Content-Range: bytes * /<total>`), or null when the header is absent,
 * malformed or asks for several ranges, in which case the whole file is sent,
 * as RFC 9110 allows. Players only ever ask for one range.
 */
export function parseRangeHeader(
  header: string | undefined,
  totalBytes: number,
): ResolvedRange | 'unsatisfiable' | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, from, to] = match;
  if (from === '' && to === '') return null;

  if (from === '') {
    // A suffix: the last N bytes.
    const length = Number(to);
    if (!Number.isSafeInteger(length) || length === 0 || totalBytes === 0) return 'unsatisfiable';
    return { start: Math.max(totalBytes - length, 0), end: totalBytes - 1 };
  }

  const resolved = resolveRange(
    { start: Number(from), end: to === '' ? undefined : Number(to) },
    totalBytes,
  );
  return resolved ?? 'unsatisfiable';
}

const MAX_DOWNLOAD_NAME = 150;

/**
 * Cleans a download name: no path separators, quotes, control characters or
 * leading dots, at most 150 characters. Falls back to `download`.
 */
export function safeDownloadName(name: string): string {
  const cleaned = Array.from(name.normalize('NFC'))
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .replace(/[\\/:*?"<>|;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .slice(0, MAX_DOWNLOAD_NAME)
    .trim();

  return cleaned === '' ? 'download' : cleaned;
}

/**
 * A `Content-Disposition: attachment` value that works in every browser: an
 * ASCII fallback in `filename` and the exact name in `filename*` (RFC 6266).
 */
export function contentDispositionFor(downloadName: string): string {
  const name = safeDownloadName(downloadName);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
