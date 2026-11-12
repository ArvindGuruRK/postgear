/**
 * Stories about a place from the GDELT Project's DOC 2.0 API: free, keyless,
 * and in 65 languages, which is what makes it a second opinion next to Google
 * News for places Google's editions cover thinly.
 *
 * ## What is asked
 *
 * One article list: the newest 20 of the last 24 hours that name the place. The
 * place is the city when there is one, else the region, else the country, as a
 * quoted phrase so a two-word name is looked for as one. Two filters narrow it,
 * each only when GDELT has a name for what is asked (see `gdelt-codes.ts`):
 * outlets based in the country (`sourcecountry:`, a FIPS code, never the ISO
 * one), and stories first written in the reader's language (`sourcelang:`).
 * GDELT searches the English translation of every story, so an English city
 * name finds a Tamil story about it.
 *
 * Worldwide has no place to name, so nothing is asked.
 *
 * ## How it answers when it is unhappy
 *
 * GDELT asks for one request every five seconds from an address, and says so
 * with a 429 and a sentence. It also answers some refusals with a 200 and a
 * plain sentence instead of JSON, and an empty list as `{}` or an empty body.
 * So:
 *
 * - a 429, a 5xx, a dropped connection, or a 200 that is neither JSON nor a
 *   sentence about the query is `upstream` trouble, which counts towards the
 *   breaker;
 * - a sentence about the query itself (a phrase too short, say) is `not_found`:
 *   asking again would get the same answer, and one place with an awkward name
 *   must not switch the source off for every other workspace;
 * - no articles is a quiet day, an empty answer and no failure at all.
 *
 * Its JSON has been seen to carry stray backslashes and raw control characters
 * inside titles, which `JSON.parse` refuses. A body that fails is tidied once and
 * read again before it counts as trouble.
 *
 * ## What is kept
 *
 * Every article address is checked to be `http` or `https`, and so is its
 * picture. A publisher is named by its domain only when the domain is a plain
 * host name; otherwise by the host of the article's own address.
 */
import type {
  DiscoverFetch,
  DiscoverSource,
  Locality,
  SourceFailure,
  SourceInput,
  SourceItem,
  SourceResult,
} from '../types';
import { isHostName } from './competitor';
import { gdeltCountry, gdeltLanguage, languageTagOf } from './gdelt-codes';
import { searchPhrase } from './google-news';
import { safeHttpUrl, stripHtml } from './html-text';

export const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

const ATTRIBUTION = { name: 'GDELT Project', url: 'https://www.gdeltproject.org' };
const MAX_RECORDS = 20;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1024 * 1024;
/** GDELT stamps when it saw a story. Much later than now is a broken stamp, not news. */
const FUTURE_SLACK_MS = 60 * 60 * 1000;

/**
 * What a refusal about the query says, rather than about the service. Anything
 * else in plain text is treated as the service being in trouble.
 */
const QUERY_COMPLAINT =
  /\b(phrase|keyword|query|queries|search term|too short|too long|invalid)\b/i;
const RATE_COMPLAINT = /\blimit requests\b|\btoo many\b|\brate\b/i;

/**
 * The query for a place in a language, or null when there is nothing to ask:
 * Worldwide, or a place whose every name is empty once cleaned.
 *
 * `"Chennai" sourcecountry:IN sourcelang:tamil`
 */
export function gdeltQuery(
  locality: Pick<Locality, 'countryCode' | 'countryName' | 'regionName' | 'city'>,
  language: string,
): string | null {
  if (!locality.countryCode) return null;

  const phrase = [locality.city, locality.regionName, locality.countryName]
    .map((name) => searchPhrase(name ?? ''))
    .find((name) => name !== '');
  if (!phrase) return null;

  const country = gdeltCountry(locality.countryCode);
  const lang = gdeltLanguage(language);
  return [
    `"${phrase}"`,
    country ? `sourcecountry:${country}` : '',
    lang ? `sourcelang:${lang}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The article list for a query, newest first, from the last 24 hours. */
export function gdeltDocUrl(query: string): string {
  return `${GDELT_DOC_URL}?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${MAX_RECORDS}&timespan=24h&sort=datedesc`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: raw control characters are what breaks the JSON.
const RAW_CONTROL = /[\x00-\x1F]/g;
/**
 * JSON's escapes, or a lone backslash. Read left to right so `\\` is taken as
 * one escape and never split; only a backslash that starts no escape is doubled,
 * so it reads as itself.
 */
const BACKSLASH = /\\(["\\/bfnrt]|u[0-9a-fA-F]{4})?/g;

function escapeStrayBackslashes(text: string): string {
  return text.replace(BACKSLASH, (sequence, valid: string | undefined) =>
    valid === undefined ? '\\\\' : sequence,
  );
}

type ParsedBody =
  | { kind: 'json'; value: unknown }
  | { kind: 'empty' }
  | { kind: 'text'; text: string };

/**
 * The body as JSON, tidied once when it will not parse as it is; an empty body;
 * or the plain sentence GDELT answered with instead. Never throws.
 */
export function parseGdeltBody(body: string): ParsedBody {
  const trimmed = body.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return { kind: 'text', text: trimmed };

  try {
    return { kind: 'json', value: JSON.parse(trimmed) };
  } catch {
    // Control characters are only legal between tokens as whitespace, and a space
    // is as good as any of them there, so every one becomes a space.
    const tidied = escapeStrayBackslashes(trimmed.replace(RAW_CONTROL, ' '));
    try {
      return { kind: 'json', value: JSON.parse(tidied) };
    } catch {
      return { kind: 'text', text: '' };
    }
  }
}

const SEEN_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

/** `20261111T063000Z` to `2026-11-11T06:30:00.000Z`, and undefined for anything else. */
export function seenDateIso(value: unknown): string | undefined {
  const match = typeof value === 'string' ? SEEN_DATE.exec(value.trim()) : null;
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const time = Date.UTC(year, month - 1, day, hour, minute, second);
  const back = new Date(time);
  // 31 February rolls into March. A real stamp comes back as itself.
  const isReal =
    back.getUTCMonth() === month - 1 && back.getUTCDate() === day && back.getUTCHours() === hour;
  return isReal ? back.toISOString() : undefined;
}

/** The publisher's host: the answer's `domain` when it is a plain host name, else the article's. */
function publisherHost(domain: unknown, url: string): string | null {
  const given = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
  if (isHostName(given)) return given;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return isHostName(host) ? host : null;
  } catch {
    return null;
  }
}

/**
 * GDELT stores titles split into words, so they come back with a space before
 * each comma and full stop ("Blotzheim . Au casino , une saison"). Those two are
 * put back against their word. Nothing else is touched: a space before a colon
 * or a question mark is correct French, and a spaced hyphen may be a real dash.
 */
export function tidyGdeltTitle(title: string): string {
  return stripHtml(title).replace(/\s+([,.])(?=\s|$)/g, '$1');
}

function toItem(entry: unknown, now: number): SourceItem | null {
  if (!isRecord(entry)) return null;

  const url = safeHttpUrl(typeof entry.url === 'string' ? entry.url : undefined);
  const title = typeof entry.title === 'string' ? tidyGdeltTitle(entry.title) : '';
  if (!url || !title) return null;

  const publishedAt = seenDateIso(entry.seendate);
  if (publishedAt && Date.parse(publishedAt) > now + FUTURE_SLACK_MS) return null;

  const host = publisherHost(entry.domain, url);
  return {
    kind: 'news',
    source: host
      ? { id: 'gdelt', name: host, url: `https://${host}` }
      : { id: 'gdelt', name: ATTRIBUTION.name },
    title,
    url,
    image: safeHttpUrl(typeof entry.socialimage === 'string' ? entry.socialimage : undefined),
    publishedAt,
    language: languageTagOf(entry.language),
  };
}

/** One row per address and per title: GDELT lists a syndicated story once for every site that ran it. */
function distinct(items: SourceItem[]): SourceItem[] {
  const urls = new Set<string>();
  const titles = new Set<string>();
  return items.filter((item) => {
    const titleKey = item.title.toLowerCase();
    if ((item.url && urls.has(item.url)) || titles.has(titleKey)) return false;
    if (item.url) urls.add(item.url);
    titles.add(titleKey);
    return true;
  });
}

export function createGdeltSource(options: {
  fetch: DiscoverFetch;
  now?: () => Date;
}): DiscoverSource {
  const { fetch: sourceFetch, now = () => new Date() } = options;

  const empty = (warnings: string[], failed?: SourceFailure): SourceResult => ({
    items: [],
    attribution: ATTRIBUTION,
    warnings,
    ...(failed ? { failed } : {}),
  });

  return {
    id: 'gdelt',
    name: ATTRIBUTION.name,

    fetch: async ({ locality, language, signal }: SourceInput): Promise<SourceResult> => {
      const query = gdeltQuery(locality, language);
      if (!query) return empty(['GDELT has nothing to ask for without a country.'], 'not_found');

      const warnings = gdeltLanguage(language)
        ? []
        : [`GDELT does not sort stories by ${language}, so these are in any language.`];

      let body: string;
      try {
        const response = await sourceFetch(gdeltDocUrl(query), {
          accept: 'application/json',
          signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
          maxBytes: MAX_BYTES,
        });
        if (response.status !== 200) {
          const isTrouble = response.status === 429 || response.status >= 500;
          return empty(warnings, isTrouble ? 'upstream' : 'not_found');
        }
        body = response.body;
      } catch {
        // The request never completed.
        return empty(warnings, 'upstream');
      }

      const parsed = parseGdeltBody(body);
      if (parsed.kind === 'empty') return empty(warnings);
      if (parsed.kind === 'text') {
        const aboutTheQuery =
          !RATE_COMPLAINT.test(parsed.text) && QUERY_COMPLAINT.test(parsed.text);
        return empty(
          [...warnings, 'GDELT answered with a sentence instead of a list.'],
          aboutTheQuery ? 'not_found' : 'upstream',
        );
      }

      const value = parsed.value;
      // `{}` is how it says "no articles". A list under another name is a changed shape.
      if (!isRecord(value)) {
        return empty([...warnings, 'GDELT answered in a shape this cannot read.'], 'upstream');
      }
      if (value.articles === undefined) return empty(warnings);
      if (!Array.isArray(value.articles)) {
        return empty([...warnings, 'GDELT answered in a shape this cannot read.'], 'upstream');
      }

      const clock = now().getTime();
      const items = distinct(value.articles.flatMap((entry) => toItem(entry, clock) ?? []));
      // Rows, and not one of them readable, is a changed shape rather than a quiet day.
      if (value.articles.length > 0 && items.length === 0) {
        return empty([...warnings, 'GDELT answered in a shape this cannot read.'], 'upstream');
      }

      return { items: items.slice(0, MAX_RECORDS), attribution: ATTRIBUTION, warnings };
    },
  };
}
