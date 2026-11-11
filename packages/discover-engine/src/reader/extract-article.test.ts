import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARTICLE_EXCERPT_CHARS,
  ARTICLE_MIN_WORDS,
  ARTICLE_TEXT_MAX_CHARS,
  countWords,
  EXTRACT_ARTICLE_FILE,
  extractArticle,
  MAX_ELEMENT_ATTRIBUTES,
  MAX_PAGE_ATTRIBUTES,
  MAX_PAGE_DEPTH,
  MAX_PAGE_ELEMENTS,
  MAX_PAGE_LINKS,
  MAX_PAGE_TAGS,
  PageTooComplexError,
  paragraphsOf,
  readMinutesOf,
} from './extract-article';

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'reader');

function sample(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

const ENGLISH = sample('article-en.sample.html');
const TAMIL = sample('article-ta.sample.html');
const FRONT_PAGE = sample('not-article.sample.html');

const ENGLISH_URL = 'https://reader.example/articles/harbour-market';
const TAMIL_URL = 'https://reader.example/articles/coimbatore-rain';
/** Where the made-up pages below are read. A path two levels down, and a `www` to drop. */
const PAGE_URL = 'https://www.x.example/a/b';

const FIRST_PARAGRAPH =
  "The old harbour market opened its gates again on Wednesday morning, two years after a winter storm tore away most of its roof. By seven o'clock a queue had formed along the quay, and the first loaves were sold before the ribbon had been cut. This is a sample article, written for tests and simulation, and nothing in it happened.";

/** `n` different-looking words in a row. */
function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index % 7}`).join(' ');
}

function paragraph(count: number): string {
  return `<p>${words(count)}.</p>`;
}

/** Eight paragraphs of sixty words: an article by any measure. */
const BODY = Array.from({ length: 8 }, () => paragraph(60)).join('');

function page(head: string, body: string, lang = 'en'): string {
  return `<!doctype html><html lang="${lang}"><head><title>A Page Title</title>${head}</head><body>${body}</body></html>`;
}

function article(inner: string, head = ''): string {
  return page(head, `<article><h1>Heading Of It</h1>${inner}</article>`);
}

/** A page of nothing but short links, which Readability finds no article in. Six words a link. */
function linkList(links: number): string {
  return Array.from(
    { length: links },
    (_, index) => `<div><a href="/x${index}">a link with three words ${index}</a></div>`,
  ).join('');
}

/** The article, for a test that knows there is one. */
function read(html: string, url = PAGE_URL) {
  const found = extractArticle(html, url);
  if (!found) throw new Error('Expected an article, and the page had none.');
  return found;
}

/** No half of a surrogate pair left on its own, anywhere in the text. */
function isWellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** What the page did, and how long it took: a hostile page must be refused quickly. */
function timed(html: string): { outcome: unknown; ms: number } {
  const started = Date.now();
  let outcome: unknown;
  try {
    outcome = extractArticle(html, PAGE_URL);
  } catch (error) {
    outcome = error;
  }
  return { outcome, ms: Date.now() - started };
}

function wrap(body: string): string {
  return `<html><body>${body}</body></html>`;
}

function nested(depth: number, inside = 'x'): string {
  return `${'<div>'.repeat(depth)}${inside}${'</div>'.repeat(depth)}`;
}

describe('extractArticle, on the English sample', () => {
  const found = read(ENGLISH, ENGLISH_URL);
  const paragraphs = found.text.split('\n\n');

  it('reads what the page says about itself', () => {
    expect(found).toMatchObject({
      title: 'Harbour market reopens after two years of repairs',
      siteName: 'The Sample Courier',
      byline: 'A. Reporter',
      language: 'en-GB',
      publishedAt: '2026-11-04T06:30:00.000Z',
      image: 'https://reader.example/images/harbour-market.jpg',
    });
  });

  it('leaves the site name out of the title', () => {
    expect(found.title).not.toContain('Sample Courier');
    expect(found.title).not.toContain('|');
  });

  it('gives the story as plain paragraphs with a blank line between them', () => {
    expect(paragraphs).toHaveLength(7);
    expect(paragraphs[0]).toBe(FIRST_PARAGRAPH);
    expect(paragraphs[6].endsWith('for what the traders are calling the long market.')).toBe(true);
    // One blank line, never two, and no line break inside a paragraph.
    expect(found.text).not.toMatch(/\n{3,}/);
    for (const line of paragraphs) {
      expect(line).not.toContain('\n');
      expect(line).toBe(line.trim());
    }
  });

  it('drops the byline line that opens the story: it is already in the header', () => {
    expect(found.text).not.toContain('By A. Reporter');
    expect(found.text).not.toContain('4 November 2026');
    expect(found.text.startsWith('The old harbour market')).toBe(true);
  });

  it('keeps nothing of the menu, the side column, the footer or a script', () => {
    for (const unwanted of [
      'Most Read',
      'A sample headline that is not part of the story',
      'Another sample headline in the side column',
      'invented newspaper',
      'window.sample',
      'A script that must never reach the reader',
      'Home',
      'Contact',
    ]) {
      expect([unwanted, found.text.includes(unwanted)]).toEqual([unwanted, false]);
    }
  });

  it('keeps no tag and no entity, only what they stood for', () => {
    expect(found.text).not.toMatch(/[<>]/);
    expect(found.text).not.toMatch(/&[a-z]+;/);
    // The quotation in the fourth paragraph keeps its own marks.
    expect(paragraphs[3].startsWith('"We lost two winters of trade')).toBe(true);
  });

  it('makes the excerpt from the first 400 characters of the story', () => {
    const start = Array.from(paragraphs.join(' ')).slice(0, ARTICLE_EXCERPT_CHARS).join('');

    expect(found.excerpt).toBe(start.trimEnd());
    expect(Array.from(found.excerpt).length).toBeLessThanOrEqual(ARTICLE_EXCERPT_CHARS);
    expect(Array.from(found.excerpt).length).toBeGreaterThan(ARTICLE_EXCERPT_CHARS - 20);
    expect(found.excerpt.startsWith('The old harbour market opened its gates again')).toBe(true);
  });

  it('counts its words, and says two minutes', () => {
    expect(found.wordCount).toBe(countWords(found.text));
    expect(found.wordCount).toBeGreaterThan(380);
    expect(found.wordCount).toBeLessThan(440);
    expect(found.readMinutes).toBe(2);
  });

  it('answers the same for the same page, and is plain data', () => {
    expect(read(ENGLISH, ENGLISH_URL)).toEqual(found);
    expect(JSON.parse(JSON.stringify(found))).toEqual(found);
  });
});

describe('extractArticle, on the Tamil sample, which has no article tag', () => {
  const found = read(TAMIL, TAMIL_URL);
  // Read from the file itself, so not one letter of it is retyped here.
  const written = [...TAMIL.matchAll(/<p>([^<]+)<\/p>/g)].map((match) => match[1]);
  const metaOf = (name: string) =>
    new RegExp(`<meta (?:property|name)="${name}" content="([^"]+)">`).exec(TAMIL)?.[1];

  it('keeps the Tamil text exactly as it was written, paragraph by paragraph', () => {
    expect(written).toHaveLength(6);
    expect(found.text.split('\n\n')).toEqual(written);
    expect(found.text).toMatch(/\p{Script=Tamil}/u);
    // Vowel signs and viramas are marks: none may be lost or reordered.
    expect(found.text.normalize('NFC')).toBe(found.text);
  });

  it('reads the Tamil headline, site name and byline', () => {
    const headline = /<h1>([^<]+)<\/h1>/.exec(TAMIL)?.[1];

    expect(headline).toMatch(/\p{Script=Tamil}/u);
    expect(found.title).toBe(headline);
    expect(found.siteName).toBe(metaOf('og:site_name'));
    expect(found.byline).toBe(metaOf('author'));
    expect(found.siteName).toMatch(/\p{Script=Tamil}/u);
    expect(found.byline).toMatch(/\p{Script=Tamil}/u);
  });

  it('knows its language, its picture and its time, moved to UTC', () => {
    expect(found.language).toBe('ta');
    expect(found.image).toBe('https://reader.example/images/coimbatore-rain.jpg');
    // Written as 03:15 at +05:30.
    expect(found.publishedAt).toBe('2026-11-03T21:45:00.000Z');
  });

  it('leaves out the menu and the footer', () => {
    const menu = [...TAMIL.matchAll(/<a href="[^"]*">([^<]+)<\/a>/g)].map((match) => match[1]);
    const footer = /<div class="footer">([^<]+)<\/div>/.exec(TAMIL)?.[1] ?? '';

    expect(menu).toHaveLength(3);
    expect(footer).not.toBe('');
    for (const unwanted of [...menu, footer]) {
      expect([unwanted, found.text.includes(unwanted)]).toEqual([unwanted, false]);
    }
  });

  it('is a one minute read', () => {
    expect(found.wordCount).toBe(countWords(found.text));
    expect(found.wordCount).toBeGreaterThan(100);
    expect(found.wordCount).toBeLessThan(200);
    expect(found.readMinutes).toBe(1);
  });
});

describe('extractArticle, on a page with no article', () => {
  it('answers null for the front page sample: links and headings, and no story', () => {
    expect(extractArticle(FRONT_PAGE, 'https://reader.example/')).toBeNull();
  });

  it.each([
    ['nothing at all', ''],
    ['only spaces', '  \n\t  '],
    ['plain words with no markup', 'just some words with no markup at all'],
    ['an empty document', '<!doctype html><html><head></head><body></body></html>'],
    ['a short page', page('', '<h1>Hello</h1><p>Two lines and no more.</p>')],
    ['a short list of links', page('', linkList(40))],
  ])('answers null for %s', (_what, html) => {
    expect(extractArticle(html, PAGE_URL)).toBeNull();
  });

  it('never throws for markup that is not a page', () => {
    for (const html of [
      '<',
      '<<<>>>',
      '</div></div>',
      '<p',
      '<!---->',
      '<![CDATA[x]]>',
      '\u0000',
    ]) {
      expect([html, extractArticle(html, PAGE_URL)]).toEqual([html, null]);
    }
  });
});

describe('extractArticle, when Readability finds nothing in a long page', () => {
  const html = page(
    '<meta name="author" content="By Jane Doe"><meta property="og:image" content="/pic.png">',
    linkList(150),
  );
  const found = read(html);

  it("reads the page's visible text as it is, a line for each block", () => {
    const lines = found.text.split('\n\n');

    expect(lines).toHaveLength(150);
    expect(lines[0]).toBe('a link with three words 0');
    expect(lines[149]).toBe('a link with three words 149');
    expect(found.wordCount).toBe(900);
    expect(found.readMinutes).toBe(5);
  });

  it('takes the title from the title tag, and the rest from the head', () => {
    expect(found).toMatchObject({
      title: 'A Page Title',
      byline: 'Jane Doe',
      image: 'https://www.x.example/pic.png',
      siteName: 'x.example',
      language: 'en',
      publishedAt: null,
    });
  });

  it('opens with the page, not with its doctype or its title', () => {
    expect(found.text).not.toContain('doctype');
    expect(found.text).not.toContain('A Page Title');
    expect(found.excerpt.startsWith('a link with three words 0 a link')).toBe(true);
  });

  it(`needs ${ARTICLE_MIN_WORDS} words to be worth reading that way`, () => {
    // Six words a link.
    expect(extractArticle(page('', linkList(ARTICLE_MIN_WORDS / 6 - 1)), PAGE_URL)).toBeNull();
    expect(read(page('', linkList(ARTICLE_MIN_WORDS / 6))).wordCount).toBe(ARTICLE_MIN_WORDS);
  });

  it('reads a page that leaves its body tag out, which HTML allows', () => {
    const noBody = `<!DOCTYPE html><html lang="en"><head><title>A Page Title</title></head><article><h1>Heading Of It</h1>${BODY}</article></html>`;
    const bare = read(noBody);

    expect(bare.title).toBe('A Page Title');
    expect(bare.text.startsWith('Heading Of It\n\nword0 word1')).toBe(true);
    expect(bare.text).not.toContain('A Page Title');
    expect(bare.text).not.toContain('DOCTYPE');
    expect(bare.wordCount).toBeGreaterThan(480);
  });

  it('reads a page with no html, head or body tag, without its title in the text', () => {
    const bare = read(
      `<!DOCTYPE html><title>A Page Title</title><article><h1>Heading Of It</h1>${BODY}</article>`,
    );

    expect(bare.title).toBe('A Page Title');
    expect(bare.text.startsWith('Heading Of It\n\nword0 word1')).toBe(true);
    expect(bare.text).not.toContain('A Page Title');
  });
});

describe('extractArticle, the facts of a page', () => {
  it('resolves a relative og:image against the address the page was read at', () => {
    const found = read(article(BODY, '<meta property="og:image" content="/img/a.png">'));

    expect(found.image).toBe('https://www.x.example/img/a.png');
  });

  it("falls back to the story's first picture, resolved the same way", () => {
    const found = read(article(`<img src="pics/b.jpg" alt="A picture.">${BODY}`));

    expect(found.image).toBe('https://www.x.example/a/pics/b.jpg');
  });

  it('prefers og:image to a picture in the story, and twitter:image when there is no og', () => {
    const picture = '<img src="/in-story.png">';

    expect(
      read(
        article(picture + BODY, '<meta property="og:image" content="https://cdn.example/og.png">'),
      ).image,
    ).toBe('https://cdn.example/og.png');
    expect(
      read(article(BODY, '<meta name="twitter:image" content="https://cdn.example/tw.png">')).image,
    ).toBe('https://cdn.example/tw.png');
  });

  it.each([
    ['a script', 'javascript:alert(1)'],
    ['a data address', 'data:image/png;base64,AAAA'],
    ['a file', 'file:///etc/passwd'],
  ])('drops an image that is %s', (_what, address) => {
    const head = `<meta property="og:image" content="${address}">`;

    expect(read(article(BODY, head)).image).toBeNull();
    // And the story's own picture is used instead, when it has one.
    expect(read(article(`<p><img src="../c.png"></p>${BODY}`, head)).image).toBe(
      'https://www.x.example/c.png',
    );
    expect(read(article(`<img src="${address}">${BODY}`)).image).toBeNull();
  });

  it('has no image when the page names none', () => {
    expect(read(article(BODY)).image).toBeNull();
  });

  it.each([
    ['words', 'not a date'],
    ['an empty value', ''],
    ['a month that does not exist', '2026-13-45T99:00:00Z'],
  ])('has no date when the page gives %s', (_what, value) => {
    const head = `<meta property="article:published_time" content="${value}">`;

    expect(read(article(BODY, head)).publishedAt).toBeNull();
  });

  it('reads a date from the head, or from a time tag when the head has none', () => {
    expect(
      read(article(BODY, '<meta property="article:published_time" content="2026-11-01T10:00:00Z">'))
        .publishedAt,
    ).toBe('2026-11-01T10:00:00.000Z');
    expect(read(article(BODY, '<meta name="date" content="2026-11-02">')).publishedAt).toBe(
      '2026-11-02T00:00:00.000Z',
    );
    expect(
      read(article(`<time datetime="2026-11-03T08:30:00+05:30">3 Nov</time>${BODY}`)).publishedAt,
    ).toBe('2026-11-03T03:00:00.000Z');
  });

  it.each([
    ['a sentence', 'not a tag!'],
    ['markup', '<b>en</b>'],
    ['a number', '12'],
    ['nothing', ''],
  ])('has no language when lang is %s', (_what, lang) => {
    const html = page('', `<article>${BODY}</article>`, lang.replace(/"/g, ''));

    expect(read(html).language).toBeNull();
  });

  it('has no language when the page declares none, and keeps a tag as written', () => {
    const bare = `<html><head><title>T</title></head><body><article>${BODY}</article></body></html>`;

    expect(read(bare).language).toBeNull();
    expect(read(page('', `<article>${BODY}</article>`, 'pt-BR')).language).toBe('pt-BR');
    expect(read(page('', `<article>${BODY}</article>`, 'zh-Hant')).language).toBe('zh-Hant');
  });

  it('names the site by its host, without www, when the page gives no name', () => {
    expect(read(article(BODY)).siteName).toBe('x.example');
    expect(read(article(BODY), 'https://news.sub.example.org/story').siteName).toBe(
      'news.sub.example.org',
    );
  });

  it("uses the site's own name when it gives one, as plain text on one line", () => {
    const head = '<meta property="og:site_name" content="  The   Daily\n Example ">';

    expect(read(article(BODY, head)).siteName).toBe('The Daily Example');
  });

  it('reads the author from the head, without the "By"', () => {
    expect(read(article(BODY, '<meta name="author" content="By Jane Doe">')).byline).toBe(
      'Jane Doe',
    );
    expect(read(article(BODY, '<meta name="author" content="jane doe">')).byline).toBe('jane doe');
    expect(read(article(BODY)).byline).toBeNull();
  });

  it('caps a title at 300 characters', () => {
    const long = article(BODY).replace('A Page Title', `T ${'long '.repeat(100)}`);
    const { title } = read(long);

    expect(Array.from(title).length).toBeLessThanOrEqual(300);
    expect(Array.from(title).length).toBeGreaterThan(290);
    expect(title.startsWith('T long long')).toBe(true);
    expect(title).toBe(title.trim());
  });

  it('keeps a title to one line of plain text', () => {
    const odd = article(BODY).replace('A Page Title', 'Fish &amp; chips\n   on  the quay');

    expect(read(odd).title).toBe('Fish & chips on the quay');
  });
});

describe('extractArticle, the size of what it hands on', () => {
  const face = String.fromCodePoint(0x1f600);
  // Forty faces and a word, eight times a paragraph: far more than the cap, and every
  // face two UTF-16 units, so a cut by units would land inside one.
  const fat = Array.from(
    { length: 80 },
    (_, index) => `<p>${`${face.repeat(40)} word `.repeat(8)}number ${index}.</p>`,
  ).join('');
  const found = read(article(fat));

  it(`caps the text at ${ARTICLE_TEXT_MAX_CHARS} characters, counted by code point`, () => {
    expect(Array.from(found.text).length).toBe(ARTICLE_TEXT_MAX_CHARS);
    // Well past 20,000 UTF-16 units: it was not cut by units.
    expect(found.text.length).toBeGreaterThan(ARTICLE_TEXT_MAX_CHARS * 1.5);
  });

  it('never leaves half a character at the end of the text or the excerpt', () => {
    expect(isWellFormed(found.text)).toBe(true);
    expect(isWellFormed(found.excerpt)).toBe(true);
    expect(Array.from(found.excerpt).length).toBeLessThanOrEqual(ARTICLE_EXCERPT_CHARS);
    expect(found.excerpt.length).toBeGreaterThan(ARTICLE_EXCERPT_CHARS);
  });

  it('counts the words of what it kept, not of the whole page', () => {
    expect(found.wordCount).toBe(countWords(found.text));
    expect(found.readMinutes).toBe(readMinutesOf(found.wordCount));
  });

  it('leaves a short article whole', () => {
    const short = read(article(BODY));

    expect(Array.from(short.text).length).toBeLessThan(ARTICLE_TEXT_MAX_CHARS);
    expect(short.text.endsWith('.')).toBe(true);
    expect(short.text.split('\n\n')).toHaveLength(9);
  });
});

describe('readMinutesOf', () => {
  it.each([
    [0, 1],
    [1, 1],
    [100, 1],
    [200, 1],
    [299, 1],
    [300, 2],
    [400, 2],
    [499, 2],
    [500, 3],
    [1_000, 5],
    [4_000, 20],
  ])('reads %i words in %i minutes', (count, minutes) => {
    expect(readMinutesOf(count)).toBe(minutes);
  });
});

describe('countWords', () => {
  it('counts words, whatever the spacing and punctuation between them', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('one')).toBe(1);
    expect(countWords('one two  three\n\nfour')).toBe(4);
    expect(countWords('Stop. Go, now!')).toBe(3);
    expect(countWords('...')).toBe(0);
  });

  it('counts Japanese, which writes no spaces, by its own word boundaries', () => {
    const sentence = [
      0x4eca, 0x65e5, 0x306f, 0x826f, 0x3044, 0x5929, 0x6c17, 0x3067, 0x3059, 0x306d, 0x3002,
    ]
      .map((code) => String.fromCodePoint(code))
      .join('');

    expect(typeof Intl.Segmenter).toBe('function');
    // One "word" by spaces, several by the language's own rules.
    expect(sentence.split(/\s+/).filter(Boolean)).toHaveLength(1);
    expect(countWords(sentence)).toBeGreaterThan(3);
  });

  it('counts Tamil words by their spaces', () => {
    const [first] = [...TAMIL.matchAll(/<p>([^<]+)<\/p>/g)].map((match) => match[1]);

    expect(countWords(first)).toBe(first.split(/[\s.]+/).filter(Boolean).length);
  });

  it('falls back to splitting on spaces where the runtime has no segmenter', () => {
    const holder = Intl as unknown as { Segmenter?: unknown };
    const original = holder.Segmenter;
    holder.Segmenter = undefined;
    try {
      expect(countWords('one two  three\n\nfour')).toBe(4);
      expect(countWords('')).toBe(0);
    } finally {
      holder.Segmenter = original;
    }
    expect(typeof Intl.Segmenter).toBe('function');
  });
});

describe('paragraphsOf', () => {
  it('breaks at block tags and at line breaks, and nowhere else', () => {
    expect(
      paragraphsOf('<p>One &amp; two</p><div>Three<br>Four <b>bold</b> <a href="x">link</a></div>'),
    ).toEqual(['One & two', 'Three', 'Four bold link']);
  });

  it('splits lists, headings, quotes, table cells and definition lists', () => {
    expect(paragraphsOf('<h2>Head</h2><ul><li>a</li><li>b</li></ul>')).toEqual(['Head', 'a', 'b']);
    expect(paragraphsOf('<blockquote>Said</blockquote>after')).toEqual(['Said', 'after']);
    expect(paragraphsOf('<table><tr><td>1</td><td>2</td></tr></table>')).toEqual(['1', '2']);
    expect(paragraphsOf('<dl><dt>Term</dt><dd>Meaning</dd></dl>')).toEqual(['Term', 'Meaning']);
  });

  it('drops comments, and the bodies of scripts and styles', () => {
    expect(
      paragraphsOf('<p>kept</p><script>stolen()</script><style>p{}</style><!-- gone --><p>too</p>'),
    ).toEqual(['kept', 'too']);
  });

  it('collapses the whitespace inside a paragraph and drops empty ones', () => {
    expect(paragraphsOf('<p>  a \n\n  b\t c </p><p>   </p><div></div><p>d</p>')).toEqual([
      'a b c',
      'd',
    ]);
  });

  it('strips control characters and bidi overrides, which can make text read as something else', () => {
    const override = String.fromCodePoint(0x202e);
    const zeroWidth = String.fromCodePoint(0x200b);

    expect(paragraphsOf(`<p>safe${override}txt${zeroWidth}.exe</p>`)).toEqual(['safetxt.exe']);
  });

  it('answers nothing for nothing', () => {
    expect(paragraphsOf('')).toEqual([]);
    expect(paragraphsOf('<div><p></p></div>')).toEqual([]);
  });
});

describe('extractArticle, on a hostile page', () => {
  // Each of these is refused before Readability sees it. Left to Readability, the
  // deep ones took from eleven seconds to a minute, with nothing able to interrupt.
  const QUICK_MS = 2_000;

  const hostile: [string, string][] = [
    [`more than ${MAX_PAGE_TAGS} tags`, wrap('<b>x</b>'.repeat(MAX_PAGE_TAGS / 2 + 10))],
    [`more than ${MAX_PAGE_ELEMENTS} elements`, wrap('<p>x</p>'.repeat(MAX_PAGE_ELEMENTS + 10))],
    [`more than ${MAX_PAGE_LINKS} links`, wrap('<a href="x">z</a>'.repeat(MAX_PAGE_LINKS + 10))],
    [`nesting just past ${MAX_PAGE_DEPTH} deep`, wrap(nested(MAX_PAGE_DEPTH))],
    ['nesting 3,000 deep', wrap(nested(3_000))],
    // The deepest page that is still under the tag limit, so it is made into a DOM and walked.
    ['nesting 14,000 deep', wrap(nested(14_000))],
    ['nesting 30,000 deep', wrap(nested(30_000))],
    // Under every other limit: 3,000 elements, 52 deep, no links. Only the cost is over.
    ['sixty chains of fifty nested blocks', wrap(nested(50).repeat(60))],
    ['ninety chains of forty nested blocks', wrap(nested(40).repeat(90))],
    ['60,000 empty script tags', wrap('<script></script>'.repeat(60_000))],
  ];

  it.each(hostile)('refuses %s, quickly, and without overflowing', (_what, html) => {
    const { outcome, ms } = timed(html);

    expect(outcome).toBeInstanceOf(PageTooComplexError);
    expect(ms).toBeLessThan(QUICK_MS);
  });

  it('refuses a real article buried in such a page just the same', () => {
    const buried = wrap(`<article><h1>H</h1>${BODY}</article>${nested(3_000)}`);

    expect(timed(buried).outcome).toBeInstanceOf(PageTooComplexError);
  });

  it('throws an error of its own, with nothing of the page in it', () => {
    const { outcome } = timed(
      wrap(`<p>a secret word</p>${'<p>x</p>'.repeat(MAX_PAGE_ELEMENTS + 10)}`),
    );
    const error = outcome as PageTooComplexError;

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PageTooComplexError');
    expect(error.message).toBe('The page is too complex to read.');
    expect(error.message).not.toContain('secret');
  });

  it('still reads a page whose menu holds thousands of links: the menu is taken out first', () => {
    const links = '<a href="x">z</a>'.repeat(12_000);
    const withMenu = page(
      '',
      `<nav>${links}</nav><article><h1>Heading Of It</h1>${BODY}</article>`,
    );
    // Not timed: making 24,000 tags into a DOM is the cost here, and it is not a refusal.
    const { outcome } = timed(withMenu);

    expect(outcome).toMatchObject({ title: 'A Page Title' });
    expect((outcome as { text: string }).text.startsWith('Heading Of It\n\nword0')).toBe(true);
    expect((outcome as { text: string }).text).not.toContain('z z');

    // The same links in the story itself are over the limit.
    const inStory = page('', `<article><h1>Heading Of It</h1>${BODY}${links}</article>`);
    expect(timed(inStory).outcome).toBeInstanceOf(PageTooComplexError);
  });

  it('takes out footers, forms, scripts and styles before it measures, too', () => {
    const noise = [
      `<footer>${'<a href="x">z</a>'.repeat(3_000)}</footer>`,
      `<form>${'<input>'.repeat(3_000)}</form>`,
      `<select>${'<option>o</option>'.repeat(2_000)}</select>`,
      '<script>var a = 1;</script>'.repeat(1_000),
      '<style>p { color: red; }</style>'.repeat(1_000),
    ].join('');
    const { outcome } = timed(page('', `<article><h1>Heading Of It</h1>${BODY}</article>${noise}`));

    expect(outcome).toMatchObject({ title: 'A Page Title', readMinutes: 2 });
  });
});

describe('extractArticle, on a page just under its limits', () => {
  // A known cost, said in the file's header: about a second or two of this thread
  // each. These only prove such a page finishes and answers, not how fast.
  const SLOW_MS = 20_000;

  it.each([
    [
      'elements',
      wrap('<p>word word word word word word word word word</p>'.repeat(MAX_PAGE_ELEMENTS - 10)),
    ],
    ['links', wrap('<a href="x" class="y">z</a>'.repeat(MAX_PAGE_LINKS - 10))],
    ['depth', wrap(nested(MAX_PAGE_DEPTH - 3))],
    ['cost, in a few deep chains', wrap(nested(50).repeat(40))],
    ['cost, in many shallow chains', wrap(nested(20).repeat(230))],
  ])(
    'finishes when it is just under the limit on %s',
    (_what, html) => {
      const { outcome, ms } = timed(html);

      expect(outcome).not.toBeInstanceOf(Error);
      expect(ms).toBeLessThan(SLOW_MS);
    },
    60_000,
  );
});

describe('extractArticle, the shapes a review found past the first limits', () => {
  const HEAD = '<!doctype html><html><head><title>T</title></head><body><p>ok</p></body></html>';

  it.each([
    ['after the closing html tag', `${HEAD}${nested(1_000, '<p>x</p>').repeat(14)}`],
    ['after it, far deeper', `${HEAD}${nested(2_800, '<p>x</p>').repeat(5)}`],
    [
      'in a page with no html tag at all',
      `<title>T</title>${nested(1_000, '<p>x</p>').repeat(14)}`,
    ],
  ])('measures deep chains %s, where only the root used to be walked', (_name, html) => {
    const { outcome, ms } = timed(html);

    expect(outcome).toBeInstanceOf(PageTooComplexError);
    expect(ms).toBeLessThan(2_000);
  });

  it('refuses one tag with more attributes than any real tag has', () => {
    const attributes = Array.from({ length: MAX_ELEMENT_ATTRIBUTES + 1 }, (_, i) => `a${i}`);

    const { outcome, ms } = timed(wrap(`<p ${attributes.join(' ')}>x</p>`));

    expect(outcome).toBeInstanceOf(PageTooComplexError);
    expect(ms).toBeLessThan(2_000);
  });

  it('refuses a page whose tags carry too many attributes between them', () => {
    const perTag = 100;
    const tags = Math.ceil(MAX_PAGE_ATTRIBUTES / perTag) + 1;
    const attributes = Array.from({ length: perTag }, (_, i) => `data-a${i}="1"`).join(' ');

    const { outcome } = timed(wrap(`<span ${attributes}>x</span>`.repeat(tags)));

    expect(outcome).toBeInstanceOf(PageTooComplexError);
  });

  it('still reads a tag with an ordinary number of attributes', () => {
    const attributes = Array.from({ length: 30 }, (_, i) => `data-a${i}="1"`).join(' ');

    const result = read(article(`<div ${attributes}>${BODY}</div>`));

    expect(result).not.toBeNull();
  });

  it('judges "is there enough to read" on what can be shown, not on a megabyte of words', () => {
    // No tags at all, so no limit on shape sees it. Counting every word took two seconds.
    const html = wrap('a '.repeat(500_000));
    const started = Date.now();

    const result = extractArticle(html, PAGE_URL);

    expect(Date.now() - started).toBeLessThan(2_500);
    // Whatever it is taken for, what leaves is capped.
    if (result) expect(Array.from(result.text).length).toBeLessThanOrEqual(ARTICLE_TEXT_MAX_CHARS);
  });

  it('says where it lives, for whoever runs it in a thread it can stop', () => {
    expect(EXTRACT_ARTICLE_FILE).toMatch(/extract-article\.(ts|js)$/);
  });
});
