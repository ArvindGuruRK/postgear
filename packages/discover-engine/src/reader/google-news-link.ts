/**
 * From a Google News link to the publisher's own address (Module 08, research 02
 * section 4). Best effort, behind a flag in the API, and only ever run when a
 * person presses Read on a story: Open always works with the link as it is.
 *
 * A link such as `https://news.google.com/rss/articles/CBMi...?oc=5` carries an
 * id, not an address. Three steps, cheapest first:
 *
 * 1. Older ids are the address itself, base64 encoded behind a short prefix. That
 *    costs nothing, so it is tried first.
 * 2. Otherwise the article's page on Google News is fetched, for a signature and
 *    a timestamp it carries in two attributes.
 * 3. Those go, with the id, in one POST to Google's own `batchexecute`, and the
 *    answer holds the address.
 *
 * Steps 2 and 3 are unofficial and will change one day. Any surprise, at any
 * step, is a {@link LinkUnresolvedError} and nothing else: no retry, no second
 * guess. The address that comes out is still a stranger's, so it survives only as
 * `http` or `https`, never as another Google News link, and the API runs it
 * through the private-network guard before it reads it.
 *
 * Written from the two open-source decoders the research names and from samples
 * shaped like their inputs. It has never been run against Google.
 */
import type { DiscoverFetch } from '../types';
import { safeHttpUrl, tokenize } from '../sources/html-text';

export const GOOGLE_NEWS_HOST = 'news.google.com';
export const GOOGLE_NEWS_BATCH_URL = `https://${GOOGLE_NEWS_HOST}/_/DotsSplashUi/data/batchexecute`;

const ARTICLE_PATH = /^\/(?:rss\/)?(?:articles|read)\/([A-Za-z0-9_-]{8,2048})$/;
const SIGNATURE = /^[A-Za-z0-9_-]{8,512}$/;
const TIMESTAMP = /^\d{6,16}$/;

const TIMEOUT_MS = 8_000;
const PAGE_MAX_BYTES = 1024 * 1024;
const ANSWER_MAX_BYTES = 256 * 1024;
const FORM = 'application/x-www-form-urlencoded;charset=UTF-8';

/** What every decoded id starts with, and what the older ones end with. */
const ID_PREFIX = [0x08, 0x13, 0x22];
const ID_SUFFIX = [0xd2, 0x01, 0x00];
/** How a newer id's payload starts: a token for step 3, not an address. */
const OPAQUE_MARK = 'AU_yqL';

export type LinkUnresolvedReason = 'not_a_link' | 'page' | 'answer';

/** The one failure this file has. The reason is for a log line, never for a person. */
export class LinkUnresolvedError extends Error {
  constructor(readonly reason: LinkUnresolvedReason) {
    super('The story link could not be resolved.');
    this.name = 'LinkUnresolvedError';
  }
}

/** The id inside a Google News article link, or null for any other address. */
export function googleNewsArticleId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.hostname.toLowerCase() !== GOOGLE_NEWS_HOST) return null;
    return ARTICLE_PATH.exec(parsed.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function isGoogleNewsLink(url: string): boolean {
  return googleNewsArticleId(url) !== null;
}

export function googleNewsArticleUrl(id: string): string {
  return `https://${GOOGLE_NEWS_HOST}/rss/articles/${id}`;
}

/** A publisher's address: a web address, and not one that leads straight back to Google News. */
function publisherUrl(value: unknown): string | null {
  const url = typeof value === 'string' ? safeHttpUrl(value) : undefined;
  if (!url) return null;
  return new URL(url).hostname.toLowerCase() === GOOGLE_NEWS_HOST ? null : url;
}

function startsWith(bytes: Uint8Array, start: readonly number[]): boolean {
  return start.every((byte, index) => bytes[index] === byte);
}

function endsWith(bytes: Uint8Array, end: readonly number[]): boolean {
  const from = bytes.length - end.length;
  return from >= 0 && end.every((byte, index) => bytes[from + index] === byte);
}

/**
 * Step 1: the address inside an older id, or null when this id does not hold
 * one. The id is base64 of a small record: a prefix, the address's length, the
 * address. Newer ids hold a token there instead, which only Google can turn back.
 */
export function decodeLocally(id: string): string | null {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(id, 'base64url'));
  } catch {
    return null;
  }
  if (!startsWith(bytes, ID_PREFIX)) return null;

  let body = bytes.subarray(ID_PREFIX.length);
  if (endsWith(body, ID_SUFFIX)) body = body.subarray(0, body.length - ID_SUFFIX.length);
  if (body.length < 2) return null;

  // The length is one byte, or two when the address is 128 bytes or longer.
  const isLong = body[0] >= 0x80;
  const length = isLong ? (body[0] & 0x7f) | (body[1] << 7) : body[0];
  const start = isLong ? 2 : 1;
  if (length === 0 || start + length > body.length) return null;

  const text = Buffer.from(body.subarray(start, start + length)).toString('utf8');
  return text.startsWith(OPAQUE_MARK) ? null : publisherUrl(text);
}

/** Step 2's two values, read off the article page. Null when either is missing or odd. */
export function readDecodingParams(html: string): { signature: string; timestamp: string } | null {
  for (const token of tokenize(html)) {
    if (token.type !== 'open') continue;
    const signature = token.attrs['data-n-a-sg'];
    const timestamp = token.attrs['data-n-a-ts'];
    if (signature === undefined || timestamp === undefined) continue;

    return SIGNATURE.test(signature) && TIMESTAMP.test(timestamp) ? { signature, timestamp } : null;
  }
  return null;
}

/** Step 3's form: the id, the timestamp and the signature in the envelope the endpoint reads. */
export function batchRequestBody(id: string, timestamp: string, signature: string): string {
  const request = [
    'garturlreq',
    [
      [
        'X',
        'X',
        ['X', 'X'],
        null,
        null,
        1,
        1,
        'US:en',
        null,
        1,
        null,
        null,
        null,
        null,
        null,
        0,
        1,
      ],
      'X',
      'X',
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    id,
    Number(timestamp),
    signature,
  ];
  const envelope = [[['Fbv4je', JSON.stringify(request)]]];
  return `f.req=${encodeURIComponent(JSON.stringify(envelope))}`;
}

/**
 * The address in step 3's answer: after a guard line, a list whose first row
 * holds a string that is itself a list, `["garturlres", "<address>", ...]`.
 * Null for any other shape.
 */
export function readBatchAnswer(body: string): string | null {
  try {
    // A blank line after the guard, in either line ending: a checkout on Windows rewrites the sample's.
    const rows: unknown = JSON.parse(body.split(/\r?\n\r?\n/)[1] ?? '');
    const first = Array.isArray(rows) ? rows[0] : null;
    const inner: unknown = Array.isArray(first) && typeof first[2] === 'string' ? first[2] : null;
    if (inner === null) return null;

    const answer: unknown = JSON.parse(inner as string);
    return Array.isArray(answer) && answer[0] === 'garturlres' ? publisherUrl(answer[1]) : null;
  } catch {
    return null;
  }
}

export interface DecodeOptions {
  fetch: DiscoverFetch;
  signal?: AbortSignal;
}

/**
 * The publisher's address for a Google News article id. Throws
 * {@link LinkUnresolvedError} for every failure, and makes at most two requests.
 */
export async function decodeGoogleNewsLink(id: string, options: DecodeOptions): Promise<string> {
  if (!ARTICLE_PATH.test(`/articles/${id}`)) throw new LinkUnresolvedError('not_a_link');

  const local = decodeLocally(id);
  if (local) return local;

  const signal = options.signal ?? AbortSignal.timeout(TIMEOUT_MS);

  let params: ReturnType<typeof readDecodingParams>;
  try {
    const page = await options.fetch(googleNewsArticleUrl(id), {
      accept: 'text/html',
      signal,
      maxBytes: PAGE_MAX_BYTES,
    });
    params = page.status === 200 ? readDecodingParams(page.body) : null;
  } catch {
    params = null;
  }
  if (!params) throw new LinkUnresolvedError('page');

  let resolved: string | null;
  try {
    const answer = await options.fetch(GOOGLE_NEWS_BATCH_URL, {
      accept: '*/*',
      signal,
      maxBytes: ANSWER_MAX_BYTES,
      post: { body: batchRequestBody(id, params.timestamp, params.signature), contentType: FORM },
    });
    resolved = answer.status === 200 ? readBatchAnswer(answer.body) : null;
  } catch {
    resolved = null;
  }
  if (!resolved) throw new LinkUnresolvedError('answer');

  return resolved;
}
