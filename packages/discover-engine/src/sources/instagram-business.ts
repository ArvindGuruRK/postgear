/**
 * A competitor's Instagram, read through Business Discovery (Module 10).
 *
 * Instagram has no public feed. Business Discovery is the one sanctioned way in:
 * the workspace's own connected Instagram business or creator account asks the
 * Graph API about another public business or creator account by its username,
 * and gets its recent posts back. So this source needs what the others do not:
 * the workspace's Instagram user id and the token it was connected with (PostGear
 * connects Instagram through Facebook Login, so that is the Page token the channel
 * keeps for publishing). A personal account cannot be looked up at all, and Meta
 * returns nothing for an age-gated one.
 *
 * ## The token travels in the address
 *
 * Graph takes it as `access_token`, last in the query. So the address is never
 * put in a warning or a returned field, Meta's own error message is never
 * repeated (nothing promises it leaves the token out), and a thrown fetch error
 * is dropped unread. {@link instagramBusinessPrefix} is the most of the address
 * that may ever be quoted.
 *
 * ## Whose trouble it is
 *
 * Graph names the problem with a numeric code, and the code decides whose it is:
 *
 * - 110: Instagram cannot find that username as a business or creator account
 *   (subcode 2207013, "Cannot find User", seen in Meta's forums rather than its
 *   error table). The request was fine, so `not_found` and `unreadable`.
 * - 190 or 102 (the token expired or was revoked), 10 or 200 to 299 (a permission
 *   is missing): `failed: 'upstream'` with `reconnect`, because the trouble is this
 *   workspace's connection, not Instagram, and a breaker every workspace shares
 *   must not count it.
 * - 4, 17, 32, 613 and 80002 (Graph's rate limits), 1 and 2 (Meta's own trouble),
 *   anything Meta marks transient, a 429 and a 5xx: upstream trouble.
 */
import type { DiscoverFetchResponse, SourceAttribution, SourceItem, SourceResult } from '../types';
import {
  COMPETITOR_MAX_ITEMS,
  type CompetitorSourceOptions,
  emptyResult,
  excerpt,
  isoDate,
  isRecord,
  newest,
  parseJson,
  unreadable,
} from './competitor';
import { safeHttpUrl, stripHtml } from './html-text';

/**
 * The Graph version PostGear's Instagram provider uses
 * (`packages/social-core/src/providers/meta/meta.graph.ts`), copied because this
 * package imports no other. Meta keeps v21.0 until 21 January 2027; the API can
 * pass the provider's own constant as `graphVersion` so the two move together.
 */
export const INSTAGRAM_GRAPH_VERSION = 'v21.0';

const NAME = 'Instagram';
const HOME = 'https://www.instagram.com';
const GRAPH_HOST = 'https://graph.facebook.com';
const ATTRIBUTION: SourceAttribution = { name: NAME, url: HOME };
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1024 * 1024;

const GRAPH_VERSION = /^v\d{1,3}\.\d{1,2}$/;
/** Instagram user ids are long numbers. Nothing else goes into the path. */
const IG_USER_ID = /^\d{1,32}$/;
/** 1 to 30 letters, digits, periods and underscores; no period first, last, or twice in a row. */
const USERNAME = /^(?!\.)(?!.*\.\.)(?!.*\.$)[A-Za-z0-9._]{1,30}$/;
const PROFILE_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
/** The first part of an address that is a page of Instagram's own, never a profile. */
const NOT_PROFILES = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'stories',
  'explore',
  'accounts',
  'direct',
  'about',
  'developer',
  'legal',
]);

const MEDIA_FIELDS =
  'caption,permalink,timestamp,media_type,media_url,thumbnail_url,like_count,comments_count';

/** What Graph calls each kind of post, as a title says it when there is no caption. */
const MEDIA_WORDS: Record<string, string> = {
  IMAGE: 'photo',
  VIDEO: 'video',
  CAROUSEL_ALBUM: 'carousel',
};

const RECONNECT = 'The connected Instagram account needs to be reconnected.';
const RECONNECT_PERMISSION =
  'The connected Instagram account needs to be reconnected, with permission to look up other accounts.';
const SHAPE = 'Instagram answered in a shape this cannot read.';

const RATE_LIMITS = new Set([4, 17, 32, 613, 80002]);
const META_TROUBLE = new Set([1, 2]);

export function isInstagramUsername(value: string): boolean {
  return USERNAME.test(value);
}

function profileFromAddress(value: string): string | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!PROFILE_HOSTS.has(url.hostname)) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  return parts.length === 1 && !NOT_PROFILES.has(parts[0].toLowerCase()) ? parts[0] : null;
}

/**
 * `@Acme.Sample` or `https://www.instagram.com/acme.sample/` as people paste them,
 * to the bare username Instagram keeps (always lower case). Null for anything
 * else, a post's address included.
 */
export function instagramUsername(input: string): string | null {
  const value = input.trim();
  const looksLikeAddress = /^(?:https?:\/\/)?(?:[a-z]+\.)?instagram\.com(?:[/?#]|$)/i.test(value);
  const candidate = looksLikeAddress ? profileFromAddress(value) : value.replace(/^@/, '');
  const username = candidate?.toLowerCase() ?? '';
  return isInstagramUsername(username) ? username : null;
}

/** What the workspace asks with, and whom it asks about. */
export interface InstagramBusinessReference {
  /** The competitor, as a person typed it: a username, `@name` or a profile address. */
  username: string;
  /** The workspace's own connected Instagram business or creator account. */
  igUserId: string;
  /** That account's token. Never quoted anywhere. */
  accessToken: string;
}

export interface InstagramBusinessSourceOptions extends CompetitorSourceOptions {
  /** Defaults to {@link INSTAGRAM_GRAPH_VERSION}. */
  graphVersion?: string;
}

/** Never throws: a failure comes back as an empty {@link SourceResult} with `failed` set. */
export interface InstagramBusinessSource {
  readonly id: 'instagram';
  readonly name: string;
  readonly read: (
    reference: InstagramBusinessReference,
    signal?: AbortSignal,
  ) => Promise<SourceResult>;
}

/** The `fields` Business Discovery is asked for: the profile, and the newest ten posts. */
export function businessDiscoveryFields(username: string): string {
  return `business_discovery.username(${username}){username,name,profile_picture_url,followers_count,media_count,media.limit(${COMPETITOR_MAX_ITEMS}){${MEDIA_FIELDS}}}`;
}

/** Everything before the token. Simulation and any log line stop here. */
export function instagramBusinessPrefix(
  account: { igUserId: string; username: string },
  graphVersion: string = INSTAGRAM_GRAPH_VERSION,
): string {
  const fields = encodeURIComponent(businessDiscoveryFields(account.username));
  return `${GRAPH_HOST}/${graphVersion}/${account.igUserId}?fields=${fields}&access_token=`;
}

export function instagramBusinessUrl(
  reference: InstagramBusinessReference,
  graphVersion: string = INSTAGRAM_GRAPH_VERSION,
): string {
  return `${instagramBusinessPrefix(reference, graphVersion)}${encodeURIComponent(reference.accessToken)}`;
}

/**
 * The username a Business Discovery address asks about, at any Graph version and
 * for any account, or null when the address is not one. Simulation answers by it.
 */
export function businessDiscoveryUsername(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== GRAPH_HOST || !/^\/v\d+\.\d+\/\d+$/.test(parsed.pathname)) return null;

  const match = /^business_discovery\.username\(([^)]*)\)\{/.exec(
    parsed.searchParams.get('fields') ?? '',
  );
  return match ? match[1].toLowerCase() : null;
}

const PLAIN_COUNT = new Intl.NumberFormat('en');
const COMPACT_COUNT = new Intl.NumberFormat('en', { notation: 'compact' });

/** `8,421 likes` under ten thousand, `56K likes` from there up, as the YouTube cards count. */
function counted(count: number, word: string): string {
  const number = (count < 10_000 ? PLAIN_COUNT : COMPACT_COUNT).format(count);
  return `${number} ${word}${count === 1 ? '' : 's'}`;
}

/** A count Meta sent. It leaves one out when the owner hides it, and then so do we. */
function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Only a link on Instagram itself: nothing in the answer can send Open anywhere else. */
function permalinkOf(value: unknown): string | undefined {
  const url = typeof value === 'string' ? safeHttpUrl(value) : undefined;
  if (!url) return undefined;
  const host = new URL(url).hostname;
  return host === 'instagram.com' || host.endsWith('.instagram.com') ? url : undefined;
}

function toItem(entry: unknown, username: string): SourceItem | null {
  if (!isRecord(entry)) return null;

  const type = typeof entry.media_type === 'string' ? entry.media_type : '';
  const caption = typeof entry.caption === 'string' ? entry.caption : '';
  // Split first: cleaning the caption folds its lines into one.
  const firstLine = caption.split(/\r?\n/).map(stripHtml).find(Boolean) ?? '';
  const whole = stripHtml(caption);

  // A video's `media_url` is the video itself; its picture is the thumbnail.
  const picture =
    type === 'VIDEO'
      ? entry.thumbnail_url
      : type === 'IMAGE' || type === 'CAROUSEL_ALBUM'
        ? entry.media_url
        : undefined;

  const likes = countOf(entry.like_count);
  const comments = countOf(entry.comments_count);
  const counts = [
    likes === undefined ? '' : counted(likes, 'like'),
    comments === undefined ? '' : counted(comments, 'comment'),
  ].filter(Boolean);

  return {
    kind: 'competitor',
    source: { id: 'instagram', name: NAME, url: `${HOME}/${username}/` },
    title: firstLine ? excerpt(firstLine) : `A ${MEDIA_WORDS[type] ?? 'post'} on Instagram`,
    // Only when it says more than the title does.
    summary: whole && whole !== firstLine ? excerpt(whole) : undefined,
    url: permalinkOf(entry.permalink),
    image: typeof picture === 'string' ? safeHttpUrl(picture) : undefined,
    publishedAt: isoDate(entry.timestamp),
    signal: counts.length > 0 ? { label: counts.join(', ') } : undefined,
  };
}

interface GraphError {
  code?: number;
  transient: boolean;
}

function graphErrorOf(body: unknown): GraphError | null {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (!error) return null;
  const code = Number(error.code);
  return {
    code: Number.isInteger(code) ? code : undefined,
    transient: error.is_transient === true,
  };
}

function upstream(warning: string, reconnect = false): SourceResult {
  return {
    ...emptyResult(ATTRIBUTION, 'upstream', { warnings: [warning] }),
    ...(reconnect ? { reconnect: true } : {}),
  };
}

/** A refusal, in the words of whoever has to act on it. Meta's own message is never kept. */
function refusal(status: number, error: GraphError | null): SourceResult {
  const code = error?.code;

  if (code === 110) {
    return unreadable(ATTRIBUTION, 'Instagram has no business or creator account by that name.');
  }
  if (code === 190 || code === 102 || (code === undefined && status === 401)) {
    return upstream(RECONNECT, true);
  }
  if (
    code === 10 ||
    (code !== undefined && code >= 200 && code <= 299) ||
    (code === undefined && status === 403)
  ) {
    return upstream(RECONNECT_PERMISSION, true);
  }
  if (code !== undefined && RATE_LIMITS.has(code)) {
    return upstream('Instagram is limiting requests for now.');
  }
  if (
    status === 429 ||
    status >= 500 ||
    error?.transient === true ||
    (code !== undefined && META_TROUBLE.has(code))
  ) {
    return upstream('Instagram did not answer.');
  }
  // Anything else is about this one request, and says nothing about Instagram's health.
  return emptyResult(ATTRIBUTION, 'not_found', {
    warnings: ['Instagram could not look up that account.'],
  });
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createInstagramBusinessSource(
  options: InstagramBusinessSourceOptions,
): InstagramBusinessSource {
  const graphVersion = options.graphVersion ?? INSTAGRAM_GRAPH_VERSION;
  if (!GRAPH_VERSION.test(graphVersion)) {
    throw new Error('The Instagram source was given something that is not a Graph version.');
  }

  return {
    id: 'instagram',
    name: NAME,

    read: async (reference, signal) => {
      const username = instagramUsername(textOf(reference?.username));
      if (!username) {
        return emptyResult(ATTRIBUTION, 'not_found', {
          warnings: ['That is not an Instagram username.'],
        });
      }

      // No usable account of our own: nothing is asked, and nothing counts as trouble.
      const igUserId = textOf(reference.igUserId);
      const accessToken = textOf(reference.accessToken);
      if (!IG_USER_ID.test(igUserId) || !accessToken) {
        return {
          ...emptyResult(ATTRIBUTION, 'not_found', { warnings: [RECONNECT] }),
          reconnect: true,
        };
      }

      let response: DiscoverFetchResponse;
      try {
        response = await options.fetch(
          instagramBusinessUrl({ username, igUserId, accessToken }, graphVersion),
          {
            accept: 'application/json',
            signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
            maxBytes: MAX_BYTES,
          },
        );
      } catch (error) {
        // Nothing of the error is kept: it can quote the address, and the address holds the token.
        const kind = isRecord(error) ? error.kind : undefined;
        return kind === 'too_large' || kind === 'unsafe_url'
          ? unreadable(ATTRIBUTION, SHAPE)
          : upstream('Instagram did not answer.');
      }

      const body = parseJson(response.body);
      const error = graphErrorOf(body);
      if (response.status !== 200 || error) return refusal(response.status, error);

      const discovery =
        isRecord(body) && isRecord(body.business_discovery) ? body.business_discovery : null;
      if (!discovery) return unreadable(ATTRIBUTION, SHAPE);

      // An account with no posts may come back with no `media` at all.
      const media =
        discovery.media === undefined
          ? []
          : isRecord(discovery.media) && Array.isArray(discovery.media.data)
            ? discovery.media.data
            : null;
      if (!media) return unreadable(ATTRIBUTION, SHAPE);

      const items = media.flatMap((entry) => toItem(entry, username) ?? []);
      return { items: newest(items, options), attribution: ATTRIBUTION, warnings: [] };
    },
  };
}
