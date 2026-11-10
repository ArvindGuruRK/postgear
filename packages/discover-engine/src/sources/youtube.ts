/**
 * The most popular videos in a country, from the YouTube Data API (research 01,
 * section 3.8). The one source that needs a key, so it is optional: without
 * `YOUTUBE_API_KEY` the API never builds it and the Videos tab says so.
 *
 * The key travels in the address, which is how this API takes it. So the address
 * is never put in a warning, an error or a log line: the prefix below is the most
 * that may ever be quoted.
 *
 * ## Every request costs a unit
 *
 * The project gets 10,000 quota units a day and one call is one unit, whether it
 * works or not. So every answer that a request stood behind carries
 * `unitsUsed`, the failures too, and the API keeps the day's budget from it. No
 * country means no request and no unit.
 *
 * ## A refused key is trouble, not "nothing here"
 *
 * A 403 is a spent quota, a restricted key or a switched-off API, and a 400 that
 * names the API key is a wrong one (Google's documented error body; never seen
 * live here, because there is no key to try). Both would fail the same way for
 * every country, so they count as the service being down. Any other 4xx is about
 * this one country (YouTube has no chart for some) and is a plain not-found.
 */
import type {
  DiscoverFetch,
  DiscoverSource,
  SourceFailure,
  SourceInput,
  SourceItem,
  SourceResult,
} from '../types';
import { safeHttpUrl, stripHtml } from './html-text';

const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

/** Everything before the key. Simulation matches its sample on this. */
export function youtubePopularPrefix(countryCode: string): string {
  const query = new URLSearchParams({
    part: 'snippet,statistics',
    chart: 'mostPopular',
    regionCode: countryCode,
    maxResults: '25',
  });
  return `${VIDEOS_URL}?${query}&key=`;
}

export function youtubePopularUrl(countryCode: string, apiKey: string): string {
  return `${youtubePopularPrefix(countryCode)}${encodeURIComponent(apiKey)}`;
}

const ATTRIBUTION = { name: 'YouTube', url: 'https://www.youtube.com' };
/** What one `videos.list` call costs, per Google's quota table. */
const UNITS_PER_CALL = 1;
/** The request asks for 25, and the answer is held to it. */
const MAX_ITEMS = 25;
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1024 * 1024;

/** The shape of every video id YouTube has issued, with room to spare. Nothing else goes into a watch address. */
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

const PLAIN_COUNT = new Intl.NumberFormat('en');
const COMPACT_COUNT = new Intl.NumberFormat('en', { notation: 'compact' });

/** `8,421` under ten thousand, `56K` and `1.2M` from there up. */
function countLabel(count: number): string {
  return (count < 10_000 ? PLAIN_COUNT : COMPACT_COUNT).format(count);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? stripHtml(value) : '';
}

function isoDate(value: unknown): string | undefined {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** The count arrives as a string of digits, and not at all when the uploader hides it. */
function viewsOf(statistics: unknown): number | undefined {
  const raw = isRecord(statistics) ? statistics.viewCount : undefined;
  if (typeof raw === 'string' && !/^\d+$/.test(raw)) return undefined;
  const views = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : Number.NaN;
  return Number.isFinite(views) && views >= 0 ? views : undefined;
}

/** The 320 pixel picture suits a card. The larger and the smaller one stand in when it is missing. */
function thumbnailOf(thumbnails: unknown): string | undefined {
  if (!isRecord(thumbnails)) return undefined;
  for (const size of ['medium', 'high', 'default']) {
    const picture = thumbnails[size];
    const url =
      isRecord(picture) && typeof picture.url === 'string' ? safeHttpUrl(picture.url) : undefined;
    if (url) return url;
  }
  return undefined;
}

function toItem(entry: unknown): SourceItem | null {
  if (!isRecord(entry) || !isRecord(entry.snippet)) return null;
  const { id, snippet } = entry;
  if (typeof id !== 'string' || !VIDEO_ID.test(id)) return null;

  // YouTube's terms: the title is shown as it was given. Only markup comes out.
  const title = textOf(snippet.title);
  if (!title) return null;

  const views = viewsOf(entry.statistics);

  return {
    kind: 'video',
    source: { id: 'youtube', name: ATTRIBUTION.name, url: ATTRIBUTION.url },
    title,
    summary: textOf(snippet.channelTitle) || undefined,
    url: `${ATTRIBUTION.url}/watch?v=${id}`,
    image: thumbnailOf(snippet.thumbnails),
    publishedAt: isoDate(snippet.publishedAt),
    signal:
      views === undefined
        ? undefined
        : { label: `${countLabel(views)} ${views === 1 ? 'view' : 'views'}`, views },
  };
}

export function createYoutubeSource(options: {
  fetch: DiscoverFetch;
  apiKey: string;
}): DiscoverSource {
  const { fetch: sourceFetch, apiKey } = options;

  return {
    id: 'youtube',
    name: ATTRIBUTION.name,

    fetch: async ({ locality, signal }: SourceInput): Promise<SourceResult> => {
      const country = locality.countryCode;
      if (!country) {
        return {
          items: [],
          attribution: ATTRIBUTION,
          warnings: ['YouTube has no worldwide chart.'],
          failed: 'not_found',
        };
      }

      // From here on a request is sent, so every way out carries its cost.
      const failed = (failure: SourceFailure, warning: string): SourceResult => ({
        items: [],
        attribution: ATTRIBUTION,
        warnings: [warning],
        failed: failure,
        unitsUsed: UNITS_PER_CALL,
      });

      let body: unknown;
      try {
        const response = await sourceFetch(youtubePopularUrl(country, apiKey), {
          accept: 'application/json',
          signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
          maxBytes: MAX_BYTES,
        });

        if (response.status !== 200) {
          const refused =
            response.status === 403 ||
            (response.status === 400 && /API[ _]key/i.test(response.body));
          if (refused) return failed('upstream', 'YouTube refused the key or the quota is spent.');
          if (response.status === 429 || response.status >= 500) {
            return failed('upstream', `YouTube answered ${response.status}.`);
          }
          return failed('not_found', `YouTube has no chart for ${country}.`);
        }

        body = JSON.parse(response.body);
      } catch {
        // Nothing of the error is kept: it can quote the address, and the address holds the key.
        return failed('upstream', 'YouTube did not answer.');
      }

      const videos = isRecord(body) && Array.isArray(body.items) ? body.items : null;
      const items = (videos ?? []).flatMap((entry) => toItem(entry) ?? []);
      // Rows, and not one of them readable, is a changed shape rather than an empty chart.
      if (!videos || (videos.length > 0 && items.length === 0)) {
        return failed('upstream', 'YouTube answered in a shape this cannot read.');
      }

      return {
        items: items.slice(0, MAX_ITEMS),
        attribution: ATTRIBUTION,
        warnings: [],
        unitsUsed: UNITS_PER_CALL,
      };
    },
  };
}
