/**
 * What people read yesterday on one language's Wikipedia, from Wikimedia's
 * pageviews API (research 01, section 3.3). Free, keyless, CC BY-SA, and the one
 * Trending signal that works per language without Google.
 *
 * An edition stands for its readers everywhere, not for a region: `ta.wikipedia`
 * is Tamil readers, not Tamil Nadu. The heading says so.
 *
 * ## Yesterday, or the day before
 *
 * A day's numbers are published some hours into the next UTC day, so early in
 * the day yesterday is a 404 and the day before is the newest there is. Only a
 * 404 moves on to it: a 429 or a 5xx means Wikimedia wants fewer requests, not
 * one more. `answeredDay` is the day that was asked for and answered, never the
 * one written inside the body: simulation serves one recording whatever the day,
 * and it has to keep reading as "yesterday" long after it was made.
 *
 * ## What is not an article
 *
 * The list counts every page, so the search box, the main page and housekeeping
 * pages sit among the articles. Namespace names are translated per edition
 * (`Special:`, `சிறப்பு:`, `Spécial:`, `Wikipédia:`), so no list of prefixes can
 * be complete. The rule that holds in every edition: a namespace page has no
 * space after its colon, and an article with a colon in its name has one
 * (`Ramayana:_Part_1`). It costs the rare article spelt without that space
 * (`Re:Zero`), which is a row we do not show, never a wrong row shown.
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

const TOP_BASE = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/top';

/** Editions whose address is not their language's primary subtag. */
const PROJECT_OVERRIDES: Record<string, string> = {
  // Norwegian Bokmal lives at no.wikipedia.org, Filipino at tl.wikipedia.org.
  nb: 'no',
  fil: 'tl',
};

/**
 * `ta` to `ta.wikipedia`, and `es-419`, `pt-419`, `zh-Hans` to their primary
 * subtag. Anything that is not a language tag reads English, so a made-up value
 * can never become part of an address.
 */
export function wikipediaProject(language: string): string {
  const primary = language.trim().toLowerCase().split('-')[0] ?? '';
  const edition = /^[a-z]{2,3}$/.test(primary) ? (PROJECT_OVERRIDES[primary] ?? primary) : 'en';
  return `${edition}.wikipedia`;
}

/** Everything before the day. Simulation matches a recording on this, since the day moves. */
export function wikipediaTopPrefix(project: string): string {
  return `${TOP_BASE}/${project}/all-access/`;
}

/** `day` is a UTC date, `YYYY-MM-DD`. */
export function wikipediaTopUrl(project: string, day: string): string {
  return `${wikipediaTopPrefix(project)}${day.replace(/-/g, '/')}`;
}

const NAME = 'Wikipedia';
const TOP_ITEMS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1024 * 1024;

/**
 * Main pages that live among the articles, by edition, spelt as the list spells
 * them. An edition that keeps its main page in a namespace needs no row here
 * (`Wikipédia:Accueil_principal`, `Wikipedia:Hauptseite`, `Wikipedia:Portada`):
 * the colon rule already drops it.
 *
 * English and Tamil are checked against the recordings. The others are each
 * edition's well-known main page title, written from knowledge and not yet seen
 * in a recording: a wrong one would only leave that edition's main page in the
 * list. So would an edition that is missing from this table.
 */
const MAIN_PAGES: Readonly<Record<string, string>> = {
  en: 'Main_Page',
  // The languages of India.
  ta: 'முதற்பக்கம்',
  hi: 'मुखपृष्ठ',
  mr: 'मुखपृष्ठ',
  bn: 'প্রধান_পাতা',
  te: 'మొదటి_పేజీ',
  ml: 'പ്രധാന_താൾ',
  kn: 'ಮುಖ್ಯ_ಪುಟ',
  gu: 'મુખપૃષ્ઠ',
  pa: 'ਮੁੱਖ_ਸਫ਼ਾ',
  ur: 'صفحۂ_اول',
  // The larger editions elsewhere.
  ar: 'الصفحة_الرئيسية',
  cs: 'Hlavní_strana',
  he: 'עמוד_ראשי',
  hu: 'Kezdőlap',
  id: 'Halaman_Utama',
  it: 'Pagina_principale',
  ja: 'メインページ',
  ms: 'Laman_Utama',
  nl: 'Hoofdpagina',
  ro: 'Pagina_principală',
  ru: 'Заглавная_страница',
  th: 'หน้าหลัก',
  tr: 'Anasayfa',
  uk: 'Головна_сторінка',
  vi: 'Trang_Chính',
};

/** A colon with no space after it. The list writes a space as an underscore. */
const NAMESPACE_COLON = /:(?![_ ])/;

/**
 * Whether a title from the list is an article, and not the edition's main page
 * or a namespace page (which covers the search page: it is `Special:Search`).
 * `edition` is the part of the address before `.wikipedia.org`.
 */
export function isWikipediaArticle(article: string, edition: string): boolean {
  if (NAMESPACE_COLON.test(article)) return false;
  if (!Object.hasOwn(MAIN_PAGES, edition)) return true;
  // Compared in one normal form: the same letters can be stored two ways.
  return article.normalize('NFC') !== MAIN_PAGES[edition].normalize('NFC');
}

const PLAIN_COUNT = new Intl.NumberFormat('en');
const COMPACT_COUNT = new Intl.NumberFormat('en', { notation: 'compact' });

/** `1,627` under ten thousand, `11K` and `1.2M` from there up. */
function countLabel(count: number): string {
  return (count < 10_000 ? PLAIN_COUNT : COMPACT_COUNT).format(count);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type JsonRead =
  | { ok: true; value: unknown }
  /** `status` is absent when the request never completed or the body was not JSON. */
  | { ok: false; failure: SourceFailure; status?: number };

/** Fetches and parses, and never throws. A body that is not JSON is trouble, like a 429 or a 5xx. */
async function readJson(
  sourceFetch: DiscoverFetch,
  url: string,
  signal: AbortSignal | undefined,
): Promise<JsonRead> {
  try {
    const response = await sourceFetch(url, {
      accept: 'application/json',
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
      maxBytes: MAX_BYTES,
    });

    if (response.status !== 200) {
      const isTrouble = response.status === 429 || response.status >= 500;
      return {
        ok: false,
        failure: isTrouble ? 'upstream' : 'not_found',
        status: response.status,
      };
    }

    return { ok: true, value: JSON.parse(response.body) as unknown };
  } catch {
    return { ok: false, failure: 'upstream' };
  }
}

/** The UTC day `daysBack` days before `now`, as `YYYY-MM-DD`. */
function utcDay(now: Date, daysBack: number): string {
  return new Date(now.getTime() - daysBack * DAY_MS).toISOString().slice(0, 10);
}

function editionHome(edition: string): string {
  return `https://${edition}.wikipedia.org`;
}

function articleUrl(edition: string, article: string): string | undefined {
  try {
    return safeHttpUrl(`${editionHome(edition)}/wiki/${encodeURIComponent(article)}`);
  } catch {
    // Half of a surrogate pair cannot be encoded, and a title like that has no address.
    return undefined;
  }
}

/** `{ items: [{ articles: [...] }] }`, or null when the answer is some other shape. */
function articlesOf(value: unknown): unknown[] | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const day: unknown = value.items[0];
  return isRecord(day) && Array.isArray(day.articles) ? day.articles : null;
}

interface TopArticle {
  article: string;
  views: number;
}

function readArticle(entry: unknown): TopArticle | null {
  if (!isRecord(entry)) return null;
  const { article, views } = entry;
  if (typeof article !== 'string' || typeof views !== 'number') return null;
  return Number.isFinite(views) && views >= 0 ? { article, views } : null;
}

/**
 * The first ten articles, ranked as they are shown rather than as the list
 * numbers them, because the pages dropped above them leave gaps. Null when the
 * list has rows and not one of them can be read: the shape has changed.
 */
function topItems(articles: unknown[], edition: string): SourceItem[] | null {
  const home = editionHome(edition);
  const items: SourceItem[] = [];
  let readable = 0;

  for (const entry of articles) {
    const top = readArticle(entry);
    if (!top) continue;
    readable += 1;
    if (!isWikipediaArticle(top.article, edition)) continue;

    const title = stripHtml(top.article.replace(/_/g, ' '));
    const url = articleUrl(edition, top.article);
    if (!title || !url) continue;

    items.push({
      kind: 'wiki',
      source: { id: 'wikipedia', name: NAME, url: home },
      title,
      url,
      language: edition,
      signal: {
        label: `${countLabel(top.views)} ${top.views === 1 ? 'read' : 'reads'}`,
        rank: items.length + 1,
        views: top.views,
      },
    });
    if (items.length === TOP_ITEMS) break;
  }

  return articles.length > 0 && readable === 0 ? null : items;
}

export function createWikipediaSource(options: {
  fetch: DiscoverFetch;
  now?: () => Date;
}): DiscoverSource {
  const { fetch: sourceFetch, now = () => new Date() } = options;

  return {
    id: 'wikipedia',
    name: NAME,

    fetch: async ({ language, signal }: SourceInput): Promise<SourceResult> => {
      const project = wikipediaProject(language);
      const edition = project.slice(0, project.indexOf('.'));
      const attribution = { name: NAME, url: editionHome(edition) };

      const empty = (warnings: string[], failed: SourceFailure): SourceResult => ({
        items: [],
        attribution,
        warnings,
        failed,
      });

      const today = now();
      const yesterday = utcDay(today, 1);
      const dayBefore = utcDay(today, 2);

      let answeredDay = yesterday;
      let read = await readJson(sourceFetch, wikipediaTopUrl(project, yesterday), signal);
      if (!read.ok && read.status === 404) {
        answeredDay = dayBefore;
        read = await readJson(sourceFetch, wikipediaTopUrl(project, dayBefore), signal);
      }

      const fellBack = answeredDay === dayBefore;
      if (!read.ok) {
        const warnings =
          fellBack && read.status === 404
            ? [`Wikipedia has nothing for ${project} on ${yesterday} or ${dayBefore}.`]
            : [];
        return empty(warnings, read.failure);
      }

      const articles = articlesOf(read.value);
      const items = articles ? topItems(articles, edition) : null;
      if (!items) return empty(['Wikipedia answered in a shape this cannot read.'], 'upstream');

      return {
        items,
        attribution,
        warnings: fellBack
          ? [`Wikipedia has not published ${yesterday} yet, so this is ${dayBefore}.`]
          : [],
        answeredDay,
      };
    },
  };
}
