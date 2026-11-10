/**
 * Turning feed text into plain text.
 *
 * Feeds carry HTML in their descriptions and stray entities in their titles, and
 * a feed is a stranger's input: nothing here may let markup reach the web app or
 * the model. The tokenizer and `decodeEntities` are small copies of the ones in
 * `packages/seo-engine/src/crawler/html.parser.ts`, because this engine imports
 * no other workspace package. They are cut down to what a feed needs: no raw-text
 * script bodies to keep, and only the entities that really show up in headlines.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: String.fromCodePoint(0x2026),
  ndash: String.fromCodePoint(0x2013),
  mdash: String.fromCodePoint(0x2014),
  lsquo: String.fromCodePoint(0x2018),
  rsquo: String.fromCodePoint(0x2019),
  ldquo: String.fromCodePoint(0x201c),
  rdquo: String.fromCodePoint(0x201d),
  laquo: String.fromCodePoint(0xab),
  raquo: String.fromCodePoint(0xbb),
};

/** Decodes the named entities above plus every numeric form. An unknown name is left alone. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export type HtmlToken =
  | { type: 'open'; name: string; attrs: Record<string, string> }
  | { type: 'close'; name: string }
  | { type: 'text'; text: string };

const SKIPPED_BODIES = new Set(['script', 'style']);

/** Tags with attributes in either quote style or none, comments, CDATA, and script bodies dropped. */
export function tokenize(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const length = html.length;
  let i = 0;

  while (i < length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      tokens.push({ type: 'text', text: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ type: 'text', text: html.slice(i, lt) });

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? length : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9);
      tokens.push({ type: 'text', text: html.slice(lt + 9, end === -1 ? length : end) });
      i = end === -1 ? length : end + 3;
      continue;
    }

    const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (!match) {
      // A bare `<` in a headline ("a < b") is text, not a tag.
      tokens.push({ type: 'text', text: '<' });
      i = lt + 1;
      continue;
    }

    const name = match[2].toLowerCase();
    const end = endOfTag(html, lt + match[0].length);
    if (match[1] === '/') {
      tokens.push({ type: 'close', name });
      i = end;
      continue;
    }

    tokens.push({
      type: 'open',
      name,
      attrs: readAttributes(html.slice(lt + match[0].length, end)),
    });
    i = end;

    if (SKIPPED_BODIES.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, i);
      i = close === -1 ? length : close;
    }
  }

  return tokens;
}

/** The index after a tag's closing `>`, stepping over quoted attribute values. */
function endOfTag(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i + 1;
    }
  }
  return html.length;
}

function readAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

/**
 * C0 and C1 controls, bidirectional overrides and isolates, the left and right
 * marks, a stray BOM and the zero-width space. A headline can use the overrides
 * to read as something other than what it says.
 *
 * The zero-width joiner and non-joiner (U+200C, U+200D) are kept on purpose,
 * unlike `stripControlChars` in the API: Malayalam, Sinhala and Persian text
 * needs them to spell words correctly, and those are exactly the headlines this
 * module exists to carry.
 */
const CONTROL_CHARS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point.
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u{200B}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{FEFF}]/gu;

export function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHARS, '');
}

/** Control characters out, whitespace (non-breaking spaces too) collapsed, ends trimmed. */
export function cleanText(text: string): string {
  return stripControlChars(text).replace(/\s+/g, ' ').trim();
}

const SPACING_TAGS = new Set(['br', 'p', 'li', 'div']);

/** Plain text from feed text: tags out, entities decoded, cleaned. */
export function stripHtml(text: string): string {
  const parts: string[] = [];
  for (const token of tokenize(text)) {
    if (token.type === 'text') parts.push(decodeEntities(token.text));
    // A block or line break separates words; an inline tag does not.
    else if (token.type === 'open' && SPACING_TAGS.has(token.name)) parts.push(' ');
  }
  return cleanText(parts.join(''));
}

/** Only `http:` and `https:` survive: a feed can put `javascript:` in any link. */
export function safeHttpUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
