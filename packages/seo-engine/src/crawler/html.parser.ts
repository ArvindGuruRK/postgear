/**
 * Turns one HTML document into the {@link ParsedPage} the evaluators score.
 *
 * It is a pure function of the markup and the base URL (no DOM, no network)
 * and it is deliberately not a full HTML5 parser. The page is read through a
 * small tokenizer that understands exactly what SEO extraction needs: tags
 * with attributes in either quote style or none, self-closing tags, comments,
 * CDATA, the raw-text bodies of `<script>`/`<style>` (so a `<` in a script
 * never opens a tag), and character entities. That is enough to be right on
 * real pages while staying a few hundred lines that are easy to test and
 * impossible to make issue a request, which is why the package has no
 * `cheerio`/`jsdom` dependency: nothing the crawled page contains can run.
 *
 * Everything "visible text" derived (word count, sentences, readability,
 * keywords, text-to-HTML ratio) is a heuristic, and the heuristics are
 * documented at the function that implements them so the content evaluator's
 * thresholds can be read against them.
 */
import type { Heading, ParsedPage, SeoKeyword } from '../types';

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '\u2014',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  deg: '°',
  times: '×',
  divide: '÷',
  para: '¶',
  sect: '§',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  iexcl: '¡',
  iquest: '¿',
  shy: '­',
  micro: 'µ',
  sup2: '²',
  sup3: '³',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  hearts: '♥',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  atilde: 'ã',
  auml: 'ä',
  aring: 'å',
  aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  ouml: 'ö',
  oslash: 'ø',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  yacute: 'ý',
  yuml: 'ÿ',
  szlig: 'ß',
  Agrave: 'À',
  Aacute: 'Á',
  Auml: 'Ä',
  Eacute: 'É',
  Ntilde: 'Ñ',
  Ouml: 'Ö',
  Uuml: 'Ü',
};

/** Decodes the named entities above plus every numeric form (`&#169;`, `&#xA9;`). */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '�';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '�';
      }
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

export type HtmlToken =
  | { type: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: 'close'; name: string }
  | { type: 'text'; text: string }
  /** `<script>` / `<style>`: the body is kept verbatim and never tokenized. */
  | { type: 'raw'; name: string; attrs: Record<string, string>; content: string };

const RAW_TEXT_TAGS = new Set(['script', 'style']);
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';
}

function isNameStart(ch: string | undefined): boolean {
  return ch !== undefined && /[a-zA-Z]/.test(ch);
}

/**
 * Reads attributes from just after the tag name up to the closing `>`.
 * Returns the attributes, whether the tag self-closed, and the index after `>`.
 */
function readAttributes(
  html: string,
  from: number,
): { attrs: Record<string, string>; selfClosing: boolean; end: number } {
  const attrs: Record<string, string> = {};
  let i = from;
  let selfClosing = false;
  const length = html.length;

  while (i < length) {
    while (i < length && isSpace(html[i])) i += 1;
    if (i >= length) break;
    const ch = html[i];
    if (ch === '>') {
      i += 1;
      return { attrs, selfClosing, end: i };
    }
    if (ch === '/') {
      if (html[i + 1] === '>') {
        selfClosing = true;
        return { attrs, selfClosing, end: i + 2 };
      }
      i += 1;
      continue;
    }

    let nameEnd = i;
    while (nameEnd < length) {
      const c = html[nameEnd];
      if (isSpace(c) || c === '=' || c === '>' || (c === '/' && html[nameEnd + 1] === '>')) break;
      nameEnd += 1;
    }
    const name = html.slice(i, nameEnd).toLowerCase();
    i = nameEnd;
    while (i < length && isSpace(html[i])) i += 1;

    let value = '';
    if (html[i] === '=') {
      i += 1;
      while (i < length && isSpace(html[i])) i += 1;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        value = html.slice(i + 1, close === -1 ? length : close);
        i = close === -1 ? length : close + 1;
      } else {
        let valueEnd = i;
        while (valueEnd < length && !isSpace(html[valueEnd]) && html[valueEnd] !== '>') {
          valueEnd += 1;
        }
        value = html.slice(i, valueEnd);
        i = valueEnd;
      }
    }
    if (name !== '' && !(name in attrs)) attrs[name] = decodeEntities(value);
  }

  return { attrs, selfClosing, end: length };
}

export function tokenize(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const length = html.length;
  let i = 0;

  const pushText = (text: string) => {
    if (text.length > 0) tokens.push({ type: 'text', text });
  };

  while (i < length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      pushText(html.slice(i));
      break;
    }
    pushText(html.slice(i, lt));
    const next = html[lt + 1];

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? length : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9);
      i = end === -1 ? length : end + 3;
      continue;
    }
    if (next === '!' || next === '?') {
      const end = html.indexOf('>', lt + 2);
      i = end === -1 ? length : end + 1;
      continue;
    }
    if (next === '/') {
      if (!isNameStart(html[lt + 2])) {
        pushText('<');
        i = lt + 1;
        continue;
      }
      let nameEnd = lt + 2;
      while (nameEnd < length && !isSpace(html[nameEnd]) && html[nameEnd] !== '>') nameEnd += 1;
      const name = html.slice(lt + 2, nameEnd).toLowerCase();
      const end = html.indexOf('>', nameEnd);
      tokens.push({ type: 'close', name });
      i = end === -1 ? length : end + 1;
      continue;
    }
    if (!isNameStart(next)) {
      pushText('<');
      i = lt + 1;
      continue;
    }

    let nameEnd = lt + 1;
    while (nameEnd < length) {
      const c = html[nameEnd];
      if (isSpace(c) || c === '>' || c === '/') break;
      nameEnd += 1;
    }
    const name = html.slice(lt + 1, nameEnd).toLowerCase();
    const { attrs, selfClosing, end } = readAttributes(html, nameEnd);

    if (RAW_TEXT_TAGS.has(name) && !selfClosing) {
      const closeTag = new RegExp(`</${name}\\s*>`, 'i');
      closeTag.lastIndex = 0;
      const rest = html.slice(end);
      const match = closeTag.exec(rest);
      const content = match ? rest.slice(0, match.index) : rest;
      tokens.push({ type: 'raw', name, attrs, content });
      i = match ? end + match.index + match[0].length : length;
      continue;
    }

    tokens.push({ type: 'open', name, attrs, selfClosing: selfClosing || VOID_TAGS.has(name) });
    i = end;
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Text statistics
// ---------------------------------------------------------------------------

/**
 * A plain English stop-word list. Keyword density is only meaningful once
 * "the", "and" and "of" are out of the way; this is the usual ~120-word set
 * (articles, pronouns, prepositions, auxiliaries, common adverbs).
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'about',
  'above',
  'after',
  'again',
  'against',
  'all',
  'also',
  'and',
  'any',
  'are',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'can',
  'cannot',
  'could',
  'did',
  'does',
  'doing',
  'dont',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'get',
  'had',
  'has',
  'have',
  'having',
  'her',
  'here',
  'hers',
  'herself',
  'him',
  'himself',
  'his',
  'how',
  'into',
  'its',
  'itself',
  'just',
  'like',
  'may',
  'might',
  'more',
  'most',
  'much',
  'must',
  'myself',
  'new',
  'nor',
  'not',
  'now',
  'off',
  'once',
  'one',
  'only',
  'other',
  'our',
  'ours',
  'ourselves',
  'out',
  'over',
  'own',
  'per',
  'same',
  'shall',
  'she',
  'should',
  'since',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'too',
  'under',
  'until',
  'use',
  'very',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'within',
  'without',
  'would',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
]);

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'br',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'option',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);

/** Elements whose text a reader never sees. `head` is closed by `<body>`. */
const INVISIBLE_TAGS = new Set(['head', 'noscript', 'template', 'svg', 'iframe', 'object', 'math']);

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function countWords(text: string): number {
  return splitWords(text).length;
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
}

/**
 * Sentences end at `.`, `!` or `?` followed by whitespace, or at a block
 * boundary (a heading or a list item is a sentence of its own). Only
 * segments with a word count.
 */
export function countSentences(text: string): number {
  return text.split(/[.!?]+(?=\s|$)|\n+/).filter((segment) => /[\p{L}\p{N}]/u.test(segment)).length;
}

/**
 * The usual vowel-group heuristic: count vowel runs, drop a silent trailing
 * `e` (`-es`/`-ed` included), never fewer than one. Off by one on some
 * words, which is fine: the Flesch formula averages it out over a page.
 */
export function countSyllables(word: string): number {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '');
  if (letters.length === 0) return 0;
  if (letters.length <= 3) return 1;
  const trimmed = letters.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/**
 * Flesch reading ease: 206.835 − 1.015 × (words / sentences) − 84.6 ×
 * (syllables / words), clamped to 0–100. Null under 100 words, too little
 * text for the averages to mean anything.
 */
export function fleschReadingEase(text: string): number | null {
  const words = splitWords(text);
  if (words.length < 100) return null;
  const sentences = Math.max(1, countSentences(text));
  const syllables = words.reduce((sum, word) => sum + Math.max(1, countSyllables(word)), 0);
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
  return Math.round(Math.min(100, Math.max(0, score)) * 10) / 10;
}

/** Top 10 non-stop-word alphabetic tokens (≥ 3 letters) with their density. */
export function topKeywords(text: string, totalWords: number, limit = 10): SeoKeyword[] {
  const tokens =
    text
      .toLowerCase()
      .replace(/['’]/g, '')
      .match(/[a-z]{3,}/g) ?? [];
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const denominator = Math.max(1, totalWords);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({
      term,
      count,
      density: Math.round((count / denominator) * 10_000) / 100,
    }));
}

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

function collectTypes(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, into);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  const type = record['@type'];
  if (typeof type === 'string') into.add(type);
  else if (Array.isArray(type)) {
    for (const item of type) if (typeof item === 'string') into.add(item);
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === '@type' || key === '@context') continue;
    if (typeof value === 'object' && value !== null) collectTypes(value, into);
  }
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const SKIPPED_HREF = /^(mailto|tel|javascript|data|sms|ftp):/i;

/** `example.com` and `www.example.com` are one site; nothing else is folded. */
export function siteKey(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.startsWith('www.') ? lower.slice(4) : lower;
}

function relTokens(attrs: Record<string, string>): string[] {
  return (attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

/**
 * One pass over the tokens. Visible text is accumulated with a newline at
 * every block boundary; headings and `<p>` bodies are captured as they are
 * walked; everything in `<head>` (and the other invisible elements) is
 * read for metadata but never counted as text.
 */
export function parseHtml(html: string, baseUrl: string): ParsedPage {
  const tokens = tokenize(html);
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    base = new URL('http://invalid.invalid/');
  }
  let baseSet = false;

  let title: string | null = null;
  let titleParts: string[] | null = null;
  let metaDescription: string | null = null;
  let canonical: string | null = null;
  let robotsMeta: string | null = null;
  let viewport: string | null = null;
  let lang: string | null = null;
  let charset: string | null = null;
  const headings: Heading[] = [];
  const openGraph: Record<string, string> = {};
  const twitterCard: Record<string, string> = {};
  let imageCount = 0;
  let missingAlt = 0;
  const internal = new Set<string>();
  const external = new Set<string>();
  let nofollow = 0;
  let structuredCount = 0;
  let structuredInvalid = 0;
  const structuredTypes = new Set<string>();
  let hreflang = 0;
  let favicon = false;

  const text: string[] = [];
  const hidden = new Map<string, number>();
  let heading: { level: number; parts: string[] } | null = null;
  let paragraph: string[] | null = null;
  let paragraphCount = 0;

  const isVisible = () => {
    for (const depth of hidden.values()) if (depth > 0) return false;
    return true;
  };
  const enter = (name: string) => hidden.set(name, (hidden.get(name) ?? 0) + 1);
  const leave = (name: string) => hidden.set(name, Math.max(0, (hidden.get(name) ?? 0) - 1));
  const finishHeading = () => {
    if (!heading) return;
    const content = collapseWhitespace(heading.parts.join(''));
    if (content) headings.push({ level: heading.level, text: content });
    heading = null;
  };
  const finishParagraph = () => {
    if (paragraph && collapseWhitespace(paragraph.join('')).length > 0) paragraphCount += 1;
    paragraph = null;
  };
  const resolve = (href: string): URL | null => {
    try {
      return new URL(href.trim(), base);
    } catch {
      return null;
    }
  };
  const metaName = (attrs: Record<string, string>) =>
    (attrs.name ?? attrs.property ?? attrs['http-equiv'] ?? '').trim().toLowerCase();

  for (const token of tokens) {
    if (token.type === 'text') {
      const decoded = decodeEntities(token.text);
      if (titleParts) titleParts.push(decoded);
      if (!isVisible()) continue;
      text.push(decoded);
      if (heading) heading.parts.push(decoded);
      if (paragraph) paragraph.push(decoded);
      continue;
    }

    if (token.type === 'raw') {
      if (token.name === 'script') {
        const type = (token.attrs.type ?? '').trim().toLowerCase();
        if (type === 'application/ld+json') {
          structuredCount += 1;
          try {
            collectTypes(JSON.parse(token.content.trim()), structuredTypes);
          } catch {
            structuredInvalid += 1;
          }
        }
      }
      continue;
    }

    if (token.type === 'close') {
      const name = token.name;
      if (name === 'title') {
        if (titleParts && title === null) {
          const content = collapseWhitespace(titleParts.join(''));
          title = content.length > 0 ? content : null;
        }
        titleParts = null;
      } else if (/^h[1-6]$/.test(name)) finishHeading();
      else if (name === 'p') finishParagraph();
      if (INVISIBLE_TAGS.has(name)) leave(name);
      if (BLOCK_TAGS.has(name)) text.push('\n');
      continue;
    }

    const { name, attrs } = token;
    if (name === 'body') hidden.set('head', 0);
    if (INVISIBLE_TAGS.has(name) && !token.selfClosing) enter(name);
    if (BLOCK_TAGS.has(name)) text.push('\n');

    switch (name) {
      case 'html':
        if (lang === null && attrs.lang?.trim()) lang = attrs.lang.trim();
        break;
      case 'base':
        if (!baseSet && attrs.href) {
          const resolved = resolve(attrs.href);
          if (resolved) base = resolved;
          baseSet = true;
        }
        break;
      case 'title':
        if (title === null) titleParts = [];
        break;
      case 'meta': {
        const key = metaName(attrs);
        const content = attrs.content ?? '';
        if (attrs.charset && charset === null) charset = attrs.charset.trim();
        else if (key === 'content-type' && charset === null) {
          const match = /charset=([^;\s]+)/i.exec(content);
          if (match) charset = match[1].trim();
        }
        if (key === 'description' && metaDescription === null) {
          const value = collapseWhitespace(content);
          metaDescription = value.length > 0 ? value : null;
        } else if (key === 'robots' && robotsMeta === null)
          robotsMeta = collapseWhitespace(content);
        else if (key === 'viewport' && viewport === null) viewport = collapseWhitespace(content);
        else if (key.startsWith('og:')) {
          const short = key.slice(3);
          if (!(short in openGraph)) openGraph[short] = collapseWhitespace(content);
        } else if (key.startsWith('twitter:')) {
          const short = key.slice(8);
          if (!(short in twitterCard)) twitterCard[short] = collapseWhitespace(content);
        }
        break;
      }
      case 'link': {
        const rels = relTokens(attrs);
        if (rels.includes('canonical') && canonical === null && attrs.href) {
          const resolved = resolve(attrs.href);
          if (resolved) {
            resolved.hash = '';
            canonical = resolved.toString();
          }
        }
        if (rels.includes('alternate') && attrs.hreflang) hreflang += 1;
        if (rels.includes('icon')) favicon = true;
        break;
      }
      case 'img':
        imageCount += 1;
        if (!('alt' in attrs) || attrs.alt.trim() === '') missingAlt += 1;
        break;
      case 'a': {
        const href = attrs.href;
        if (!href || href.trim() === '' || href.trim().startsWith('#')) break;
        if (SKIPPED_HREF.test(href.trim())) break;
        const resolved = resolve(href);
        if (!resolved || (resolved.protocol !== 'http:' && resolved.protocol !== 'https:')) break;
        resolved.hash = '';
        if (relTokens(attrs).includes('nofollow')) nofollow += 1;
        if (siteKey(resolved.hostname) === siteKey(base.hostname))
          internal.add(resolved.toString());
        else external.add(resolved.toString());
        break;
      }
      default:
        if (/^h[1-6]$/.test(name)) {
          finishHeading();
          if (isVisible()) heading = { level: Number(name[1]), parts: [] };
        } else if (name === 'p') {
          finishParagraph();
          if (isVisible()) paragraph = [];
        }
    }
  }
  finishHeading();
  finishParagraph();

  const rawText = text.join('');
  const content = rawText
    .split('\n')
    .map((line) => collapseWhitespace(line))
    .filter((line) => line.length > 0)
    .join('\n');
  const wordCount = countWords(content);
  const sentenceCount = countSentences(content);
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  const textBytes = Buffer.byteLength(content, 'utf8');

  // Pages built from <div>s have no <p>; a block with at least eight words
  // reads like a paragraph, a shorter one like a label or a menu item.
  const blockParagraphs = content.split('\n').filter((line) => countWords(line) >= 8).length;

  return {
    title,
    metaDescription,
    canonical,
    robotsMeta,
    viewport,
    lang,
    charset,
    headings,
    openGraph,
    twitterCard,
    images: { count: imageCount, missingAlt },
    links: { internal: [...internal], external: [...external], nofollow },
    structuredData: {
      count: structuredCount,
      types: [...structuredTypes],
      invalid: structuredInvalid,
    },
    hreflang,
    favicon,
    text: {
      content,
      wordCount,
      sentenceCount,
      paragraphCount: paragraphCount > 0 ? paragraphCount : blockParagraphs,
      readability: fleschReadingEase(content),
      textToHtmlRatio:
        htmlBytes === 0 ? 0 : Math.round(Math.min(1, textBytes / htmlBytes) * 10_000) / 10_000,
      topKeywords: topKeywords(content, wordCount),
    },
  };
}
