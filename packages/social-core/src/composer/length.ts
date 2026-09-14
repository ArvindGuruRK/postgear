/**
 * How long a post is, as each platform counts it.
 *
 * Every count here is taken from **rendered** text (`render.ts`), never from
 * the editor, because styled letters and link expansion change the length.
 *
 * ## The rule every approximation below follows
 *
 * **Over-count, never under-count.** A counter that reads a little high makes
 * a user trim a post that would have fit — mildly annoying. One that reads low
 * lets a post be queued that the platform then rejects at publish time, hours
 * later, with the user gone. So wherever a platform's exact algorithm is not
 * reproduced, the estimate errs high.
 */

export type LengthMethod = 'utf16' | 'x-weighted';

export function measureLength(text: string, method: LengthMethod): number {
  return method === 'x-weighted' ? xWeightedLength(text) : utf16Length(text);
}

/**
 * Where `text` stops fitting within `max`, as a string index — or null when it fits.
 *
 * Previews use it to mark the part a platform would refuse, rather than only
 * saying the post is too long. It is the end of the longest prefix that fits,
 * found by binary search over code point boundaries, so a cut never splits a
 * surrogate pair.
 *
 * X's weighting is not perfectly monotonic across a prefix — `https:/` counts
 * 7 but `https://a` counts 23 — so near a link the mark can land a few
 * characters from the exact boundary. It is a pointer for the eye; the count
 * itself always comes from `measureLength`.
 */
export function overflowIndex(text: string, max: number, method: LengthMethod): number | null {
  if (measureLength(text, method) <= max) {
    return null;
  }

  const boundaries = [0];

  for (const character of text) {
    boundaries.push(boundaries[boundaries.length - 1] + character.length);
  }

  let fits = 0;
  let overflows = boundaries.length - 1;

  while (overflows - fits > 1) {
    const middle = (fits + overflows) >> 1;

    if (measureLength(text.slice(0, boundaries[middle]), method) <= max) {
      fits = middle;
    } else {
      overflows = middle;
    }
  }

  return boundaries[fits];
}

/**
 * UTF-16 code units — what `String.prototype.length` returns.
 *
 * Used for every platform that documents a "character" limit without saying
 * how it counts. It is the most conservative of the reasonable readings: an
 * emoji or a styled letter counts as two, where a code-point count would say
 * one. A platform counting code points accepts everything this accepts.
 */
export function utf16Length(text: string): number {
  return text.length;
}

/** Every URL counts as this many, however long it really is — X wraps them all in t.co. */
export const X_URL_LENGTH = 23;

/**
 * Code point ranges X weighs as 1. Everything outside them weighs 2.
 *
 * Latin through Georgian and Hangul Jamo (0–4351), plus the general
 * punctuation spans X treats as light: spaces and joiners, dashes and quotes,
 * primes. CJK, emoji, and the Unicode bold/italic letters all fall outside, so
 * they weigh 2 — which is why a 140-character Japanese post is already full.
 */
const X_LIGHT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

/**
 * Top-level domains recognised in a bare domain (`example.com`, no scheme).
 *
 * The country codes are the complete ISO 3166 set (plus `eu`, `su`, `ac` and
 * `uk`). They are listed rather than matched as "any two letters" because tech
 * writing is full of `Node.js` and `Next.js`: `js` is not a domain, and X does
 * not count those as links.
 *
 * The generic list covers the common ones. A bare domain on an unlisted generic
 * TLD is the one case that can under-count, and only when it is shorter than 23
 * characters; writing the scheme (`https://`) always counts correctly.
 */
const COUNTRY_TLDS =
  'ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw'.split(
    ' ',
  );

const GENERIC_TLDS = [
  'academy',
  'agency',
  'app',
  'art',
  'asia',
  'bio',
  'biz',
  'blog',
  'cafe',
  'capital',
  'care',
  'center',
  'club',
  'cloud',
  'com',
  'company',
  'design',
  'dev',
  'digital',
  'edu',
  'email',
  'finance',
  'fit',
  'fun',
  'games',
  'global',
  'gov',
  'group',
  'health',
  'info',
  'int',
  'jobs',
  'life',
  'link',
  'live',
  'marketing',
  'media',
  'mil',
  'mobi',
  'money',
  'name',
  'net',
  'network',
  'news',
  'online',
  'org',
  'page',
  'photo',
  'photography',
  'pro',
  'run',
  'services',
  'shop',
  'site',
  'social',
  'solutions',
  'space',
  'store',
  'studio',
  'tech',
  'today',
  'travel',
  'ventures',
  'website',
  'wiki',
  'work',
  'world',
  'xyz',
  'zone',
];

/** Longest first, so `company` is tried before `co` and the alternation never settles early. */
const TLD_ALTERNATION = [...GENERIC_TLDS, ...COUNTRY_TLDS]
  .sort((a, b) => b.length - a.length)
  .join('|');

const URL_PATTERN = new RegExp(
  [
    // Scheme URLs.
    String.raw`\bhttps?:\/\/[^\s<>"]+`,
    // www. without a scheme.
    String.raw`\bwww\.[^\s<>"]+`,
    // Bare domains, optionally followed by a path. Not after `@`: the domain of
    // an email address is not a link to X.
    String.raw`(?<!@)\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:${TLD_ALTERNATION})\b(?:\/[^\s<>"]*)?`,
  ].join('|'),
  'giu',
);

/**
 * Punctuation that ends a sentence rather than a URL.
 *
 * "See https://example.com." — X does not count the full stop as part of the
 * link, so it must be counted as a character of its own. Leaving it inside the
 * URL would absorb it into the fixed 23 and under-count by one.
 */
const TRAILING_PUNCTUATION = /[.,!?;:'")\]]+$/u;

const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/**
 * X's weighted length.
 *
 * X publishes this algorithm as `twitter-text` (version 3 configuration): text
 * is NFC-normalised; every URL counts 23; each emoji counts 2 however many code
 * points its sequence spans; every other code point counts 1 inside the light
 * ranges above and 2 outside them. The limit is 280.
 *
 * Reimplemented here rather than depending on `twitter-text`, whose last release
 * predates several Unicode versions and which would ship a large TLD table to
 * every browser that opens the composer. The one deliberate simplification is
 * the TLD list, and its direction is safe — see `GENERIC_TLDS`.
 */
export function xWeightedLength(text: string): number {
  const normalized = text.normalize('NFC');
  let weight = 0;
  let remainder = '';
  let lastIndex = 0;

  for (const match of normalized.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const trailing = match[0].match(TRAILING_PUNCTUATION)?.[0] ?? '';

    remainder += normalized.slice(lastIndex, start) + trailing;
    weight += X_URL_LENGTH;
    lastIndex = start + match[0].length;
  }

  remainder += normalized.slice(lastIndex);

  for (const grapheme of graphemes(remainder)) {
    if (EMOJI_PATTERN.test(grapheme)) {
      weight += 2;
      continue;
    }

    for (const character of grapheme) {
      weight += isLight(character.codePointAt(0) ?? 0) ? 1 : 2;
    }
  }

  return weight;
}

function isLight(codePoint: number): boolean {
  return X_LIGHT_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);
}

/**
 * Splits text into user-perceived characters.
 *
 * `Intl.Segmenter` is what makes a family emoji — five code points joined by
 * zero-width joiners — one unit rather than five. Without it (only very old
 * runtimes), each code point stands alone; an emoji sequence then counts 2 per
 * pictograph plus 1 per joiner, which over-counts, and so is still safe.
 */
function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }

  return Array.from(text);
}
