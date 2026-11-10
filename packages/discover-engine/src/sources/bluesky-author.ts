/**
 * What a competitor posted on Bluesky, from the public AppView's author feed
 * (research 01, section 3.6). Their own posts only: the request leaves replies
 * out, and a repost (an entry with a `reason`) is someone else's words, so it is
 * skipped here.
 *
 * The handle ends up inside two addresses, the request and each post's link, so
 * it is checked for being a plain host name first. A post's link is built from
 * that handle and the record key at the end of the post's `at://` address, and
 * the key is checked too: nothing the answer says can send Open anywhere but
 * bsky.app.
 */
import type { SourceItem } from '../types';
import {
  type CompetitorSource,
  type CompetitorSourceOptions,
  emptyResult,
  excerpt,
  failedRead,
  isHostName,
  isoDate,
  isRecord,
  newest,
  parseJson,
  readBody,
  unreadable,
} from './competitor';
import { safeHttpUrl, stripHtml } from './html-text';

const NAME = 'Bluesky';
const HOME = 'https://bsky.app';
const RECORD_KEY = /^[A-Za-z0-9._~-]{1,64}$/;

/** `@Acme.bsky.social` as people paste it, to the handle itself. */
export function blueskyHandle(value: string): string | null {
  const handle = value.trim().replace(/^@/, '').toLowerCase();
  return isHostName(handle) ? handle : null;
}

export function blueskyAuthorFeedUrl(handle: string): string {
  return `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${handle}&limit=10&filter=posts_no_replies`;
}

function recordKey(uri: unknown): string | null {
  if (typeof uri !== 'string') return null;
  const match = /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri);
  return match && RECORD_KEY.test(match[1]) ? match[1] : null;
}

/** The first picture of a post, when it has one. */
function imageOf(post: Record<string, unknown>): string | undefined {
  const embed = isRecord(post.embed) ? post.embed : null;
  const first = embed && Array.isArray(embed.images) ? embed.images[0] : null;
  return isRecord(first) && typeof first.thumb === 'string' ? safeHttpUrl(first.thumb) : undefined;
}

function toItem(entry: unknown, handle: string): SourceItem | null {
  // A repost is in the feed with a reason. It is not theirs.
  if (!isRecord(entry) || entry.reason !== undefined || !isRecord(entry.post)) return null;
  const { post } = entry;
  const record = isRecord(post.record) ? post.record : null;
  const key = recordKey(post.uri);
  if (!record || !key || typeof record.text !== 'string') return null;

  const title = excerpt(stripHtml(record.text));
  if (!title) return null;

  return {
    kind: 'competitor',
    source: { id: 'bluesky', name: NAME, url: `${HOME}/profile/${handle}` },
    title,
    url: `${HOME}/profile/${handle}/post/${key}`,
    image: imageOf(post),
    publishedAt: isoDate(record.createdAt) ?? isoDate(post.indexedAt),
  };
}

export function createBlueskyAuthorSource(options: CompetitorSourceOptions): CompetitorSource {
  const attribution = { name: NAME, url: HOME };

  return {
    id: 'bluesky',
    name: NAME,

    read: async (reference, signal) => {
      const handle = blueskyHandle(reference);
      if (!handle) {
        return emptyResult(attribution, 'not_found', {
          warnings: ['That is not a Bluesky handle.'],
        });
      }

      const read = await readBody(
        options.fetch,
        blueskyAuthorFeedUrl(handle),
        'application/json',
        signal,
      );
      if (!read.ok) return failedRead(attribution, read);

      const body = parseJson(read.body);
      const feed = isRecord(body) && Array.isArray(body.feed) ? body.feed : null;
      if (!feed) return unreadable(attribution, 'Bluesky answered in a shape this cannot read.');

      const items = feed.flatMap((entry) => toItem(entry, handle) ?? []);
      return { items: newest(items, options), attribution, warnings: [] };
    },
  };
}
