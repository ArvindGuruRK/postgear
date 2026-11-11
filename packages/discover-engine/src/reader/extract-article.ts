/**
 * The article inside a web page, for the reader sheet (Module 08): its title,
 * who wrote it and where, when, a picture, and the text as plain paragraphs.
 *
 * Mozilla's Readability does the finding, on a DOM built in memory by linkedom.
 * Nothing here fetches: the page arrives as a string the caller already read
 * through the guarded fetch.
 *
 * ## Plain text only
 *
 * A page is a stranger's markup. What leaves this file is text: the article's
 * HTML is walked with the engine's own tokenizer and only its words are kept, in
 * paragraphs. No tag, no attribute and no script body survives, so the web app
 * has nothing to render but text, and what Create Post hands the AI is text too.
 *
 * ## An article, or not
 *
 * A front page has plenty of words and no story. So a page counts as an article
 * when Readability finds a body of text and either the page reads like an
 * article or the body is long. When it finds nothing but the page is long anyway
 * (a layout it does not understand), the page's visible text is used as it is.
 * A short page with no article is `null`, and the caller says "This page is not
 * an article."
 *
 * ## A hostile page
 *
 * Parsing is synchronous, so nothing can interrupt it, and Readability's cost
 * grows with the number of elements and, much faster, with how deeply they nest:
 * forty chains of two hundred nested `div`s, a 50 KB page, held it for eleven
 * seconds here. Its own element limit does not work on this DOM (the count it
 * asks for comes back as zero), so the page is measured here first, in one
 * linear walk, and a page past any of four limits is never handed over:
 * {@link PageTooComplexError}. The caller caps the page at 1 MiB as well.
 *
 * **The limits are a first filter and not a guarantee.** A page built to sit
 * just under them (a few thousand elements in chains twenty deep) was measured
 * at about two seconds, and a review found three more shapes they did not see.
 * Limits by shape will always miss one. So this function must never run on a
 * thread that serves requests: the API runs it in a worker thread and kills the
 * worker after two seconds (`reader.extractor.ts`). {@link EXTRACT_ARTICLE_FILE}
 * is how it finds this file.
 */
import { isProbablyReaderable, Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { isoDate, resolveHttpUrl } from '../sources/competitor';
import { cleanText, decodeEntities, tokenize } from '../sources/html-text';

export interface Article {
  title: string;
  byline: string | null;
  siteName: string | null;
  /** BCP-47, as the page declares it. */
  language: string | null;
  /** The first 400 characters of the text. */
  excerpt: string;
  /** Plain paragraphs, a blank line between them. At most 20,000 characters. */
  text: string;
  image: string | null;
  /** ISO 8601. */
  publishedAt: string | null;
  wordCount: number;
  readMinutes: number;
}

export const ARTICLE_TEXT_MAX_CHARS = 20_000;
export const ARTICLE_EXCERPT_CHARS = 400;
/** Below this, a page with no article in it is not worth reading as one. */
export const ARTICLE_MIN_WORDS = 300;
export const WORDS_PER_MINUTE = 200;

/** Readability's own floor for a body of text. */
const CHAR_THRESHOLD = 500;

/** More tags than this in the raw page, and it is not even made into a DOM. */
export const MAX_PAGE_TAGS = 30_000;
/** What is left after the parts no article lives in are taken out. */
export const MAX_PAGE_ELEMENTS = 5_000;
/** Links are what Readability spends longest on: it weighs every one against the text around it. */
export const MAX_PAGE_LINKS = 1_500;
export const MAX_PAGE_DEPTH = 60;
/**
 * The sum of every element's depth squared, which is what Readability's time
 * follows. A real article page of 4,000 elements nested 20 deep is about a
 * quarter of this.
 */
export const MAX_PAGE_COST = 2_000_000;
/** One tag with a hundred thousand attributes cost Readability twenty seconds. */
export const MAX_ELEMENT_ATTRIBUTES = 200;
export const MAX_PAGE_ATTRIBUTES = 40_000;

/**
 * This file's own path, for whoever runs {@link extractArticle} somewhere it can
 * be stopped (the API runs it in a worker thread with a kill timer). The source
 * file under ts-node and Jest, the compiled one after a build.
 */
export const EXTRACT_ARTICLE_FILE: string = __filename;

/** Whole subtrees no article is ever in, removed before the page is measured or read. */
const NOT_THE_ARTICLE =
  'script, style, noscript, template, svg, iframe, nav, footer, form, select, button';

/** The page was read, and is too big or too deeply nested to look for an article in. */
export class PageTooComplexError extends Error {
  constructor() {
    super('The page is too complex to read.');
    this.name = 'PageTooComplexError';
  }
}
const TITLE_MAX_CHARS = 300;
const NAME_MAX_CHARS = 120;

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** Tags that end a paragraph. Everything else is part of the line it sits in. */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'br',
  'li',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'dl',
  'dt',
  'dd',
  'section',
  'article',
  'header',
  'footer',
  'figure',
  'figcaption',
  'table',
  'tr',
  'td',
  'th',
  'hr',
  'nav',
  'aside',
  'main',
]);

function capped(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join('').trimEnd();
}

/** The words of a piece of markup, as paragraphs. Tags, comments and script bodies are gone. */
export function paragraphsOf(html: string): string[] {
  const paragraphs: string[] = [];
  let line: string[] = [];

  const flush = () => {
    const text = cleanText(line.join(''));
    if (text) paragraphs.push(text);
    line = [];
  };

  for (const token of tokenize(html)) {
    if (token.type === 'text') line.push(decodeEntities(token.text));
    else if (BLOCK_TAGS.has(token.name)) flush();
  }
  flush();

  return paragraphs;
}

/**
 * How many words a text has. By the language's own word boundaries where the
 * runtime knows them, so Japanese, which writes no spaces, is not one word.
 */
export function countWords(text: string): number {
  if (typeof Intl.Segmenter === 'function') {
    let words = 0;
    for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
      if (part.isWordLike) words += 1;
    }
    return words;
  }
  return text.split(/\s+/).filter(Boolean).length;
}

export function readMinutesOf(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}

function nameOf(value: string | null | undefined): string | null {
  const text = capped(cleanText(value ?? ''), NAME_MAX_CHARS);
  return text || null;
}

/** "By A. Reporter" to "A. Reporter". */
function bylineOf(value: string | null | undefined): string | null {
  return nameOf((value ?? '').replace(/^\s*by\s+/i, ''));
}

function languageOf(value: string | null | undefined): string | null {
  const tag = (value ?? '').trim();
  return LANGUAGE_TAG.test(tag) ? tag : null;
}

/** What the page says about itself in its head, read before Readability rearranges the document. */
interface PageFacts {
  title: string;
  siteName: string | null;
  author: string | null;
  image: string | null;
  publishedAt: string | null;
  language: string | null;
}

function factsOf(document: Document, url: string): PageFacts {
  const meta = (...selectors: string[]): string | null => {
    for (const selector of selectors) {
      const content = document.querySelector(selector)?.getAttribute('content');
      if (content?.trim()) return content.trim();
    }
    return null;
  };

  return {
    title: cleanText(document.querySelector('title')?.textContent ?? ''),
    siteName: nameOf(meta('meta[property="og:site_name"]', 'meta[name="application-name"]')),
    author: bylineOf(meta('meta[name="author"]', 'meta[property="article:author"]')),
    image:
      resolveHttpUrl(meta('meta[property="og:image"]', 'meta[name="twitter:image"]'), url) ?? null,
    publishedAt:
      isoDate(
        meta(
          'meta[property="article:published_time"]',
          'meta[name="date"]',
          'meta[itemprop="datePublished"]',
        ) ?? document.querySelector('time[datetime]')?.getAttribute('datetime'),
      ) ?? null,
    language: languageOf(document.documentElement?.getAttribute('lang')),
  };
}

/** The first picture inside the article's own markup. */
function firstImage(html: string, url: string): string | null {
  for (const token of tokenize(html)) {
    if (token.type === 'open' && token.name === 'img') {
      const image = resolveHttpUrl(token.attrs.src, url);
      if (image) return image;
    }
  }
  return null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function articleFrom(
  parts: {
    title: string;
    byline: string | null;
    siteName: string | null;
    language: string | null;
    image: string | null;
    publishedAt: string | null;
  },
  paragraphs: string[],
): Article {
  const text = capped(paragraphs.join('\n\n'), ARTICLE_TEXT_MAX_CHARS);
  const wordCount = countWords(text);

  return {
    ...parts,
    title: capped(parts.title, TITLE_MAX_CHARS),
    excerpt: capped(paragraphs.join(' '), ARTICLE_EXCERPT_CHARS),
    text,
    wordCount,
    readMinutes: readMinutesOf(wordCount),
  };
}

/**
 * Whether a document is small and shallow enough to hand to Readability. One
 * walk with a stack of its own, so a page nested ten thousand deep cannot
 * overflow anything, and it stops at the first limit it passes.
 */
function isReadableShape(document: Document): boolean {
  // Every top-level element, not only `html`. This DOM does not rebuild a page
  // the way a browser does: markup after `</html>`, or a page with no `html` tag
  // at all, sits beside the root, and Readability walks it all the same.
  const stack: [Element, number][] = Array.from(document.children, (element) => [element, 1]);
  let elements = 0;
  let links = 0;
  let attributes = 0;
  let cost = 0;

  for (let next = stack.pop(); next; next = stack.pop()) {
    const [element, depth] = next;
    const own = element.attributes.length;
    elements += 1;
    attributes += own;
    cost += depth * depth;
    if (element.localName === 'a') links += 1;
    if (
      elements > MAX_PAGE_ELEMENTS ||
      links > MAX_PAGE_LINKS ||
      depth > MAX_PAGE_DEPTH ||
      cost > MAX_PAGE_COST ||
      own > MAX_ELEMENT_ATTRIBUTES ||
      attributes > MAX_PAGE_ATTRIBUTES
    ) {
      return false;
    }
    for (const child of Array.from(element.children)) stack.push([child, depth + 1]);
  }
  return true;
}

/**
 * The page from its `body` on, for the fallback: without this the doctype (which
 * the tokenizer reads as text, since it is not a tag) and the words of the
 * `title` would open the article. Found by position, not by pattern, so it costs
 * one pass whatever the page holds.
 */
function bodyMarkup(html: string): string {
  const lower = html.toLowerCase();
  const body = lower.indexOf('<body');
  if (body !== -1) return html.slice(body);

  // No `body` tag, which HTML allows: after the head, or failing that after the title.
  for (const end of ['</head>', '</title>']) {
    const at = lower.indexOf(end);
    if (at !== -1) return html.slice(at + end.length);
  }
  return html.replace(/^\s*<!doctype[^>]*>/i, '');
}

function tagCount(html: string): number {
  let count = 0;
  for (let at = html.indexOf('<'); at !== -1; at = html.indexOf('<', at + 1)) count += 1;
  return count;
}

/**
 * The article in a page, or null when the page has none. `url` is where the
 * page was read. Throws {@link PageTooComplexError}, and nothing else, for a
 * page it will not look for an article in.
 */
export function extractArticle(html: string, url: string): Article | null {
  if (tagCount(html) > MAX_PAGE_TAGS) throw new PageTooComplexError();

  let document: Document;
  let facts: PageFacts;
  try {
    ({ document } = parseHTML(html) as unknown as { document: Document });
    facts = factsOf(document, url);
    for (const element of Array.from(document.querySelectorAll(NOT_THE_ARTICLE))) element.remove();
  } catch {
    return null;
  }

  if (!isReadableShape(document)) throw new PageTooComplexError();

  let readerable = false;
  let parsed: ReturnType<Readability['parse']> = null;
  try {
    readerable = isProbablyReaderable(document);
    parsed = new Readability(document, { charThreshold: CHAR_THRESHOLD }).parse();
  } catch {
    // Markup the two libraries cannot walk: a page with a head and no `body` tag,
    // which is valid HTML, is one. Nothing was found, and the page's own text
    // below may still be worth reading.
    parsed = null;
  }

  const common = {
    siteName: nameOf(parsed?.siteName) ?? facts.siteName ?? hostOf(url),
    language: languageOf(parsed?.lang) ?? facts.language,
    publishedAt: isoDate(parsed?.publishedTime) ?? facts.publishedAt,
  };

  const found = paragraphsOf(parsed?.content ?? '');
  // Only "is there enough": measured on the part that can be shown, never on a
  // megabyte of words, which took the word counter two seconds by itself.
  const foundText = found.join(' ').slice(0, ARTICLE_TEXT_MAX_CHARS);
  const isArticle =
    Array.from(foundText).length >= CHAR_THRESHOLD &&
    (readerable || countWords(foundText) >= ARTICLE_MIN_WORDS);

  if (isArticle) {
    const byline = bylineOf(parsed?.byline) ?? facts.author;
    // "By A. Reporter, 4 November 2026" is already in the header: it is not the story's first line.
    const opensWithByline =
      byline !== null && /^by\s/i.test(found[0]) && found[0].length <= 160 && found.length > 1;

    return articleFrom(
      {
        ...common,
        title: cleanText(parsed?.title ?? '') || facts.title,
        byline,
        image: facts.image ?? firstImage(parsed?.content ?? '', url),
      },
      opensWithByline ? found.slice(1) : found,
    );
  }

  // Readability found no article. A long page is read as it is; a short one is not an article.
  const visible = paragraphsOf(bodyMarkup(html));
  const visibleText = visible.join(' ').slice(0, ARTICLE_TEXT_MAX_CHARS);
  if (countWords(visibleText) < ARTICLE_MIN_WORDS) return null;

  return articleFrom(
    { ...common, title: facts.title, byline: facts.author, image: facts.image },
    visible,
  );
}
