import {
  countSentences,
  countSyllables,
  decodeEntities,
  fleschReadingEase,
  parseHtml,
  STOP_WORDS,
  tokenize,
  topKeywords,
} from './html.parser';

const FIXTURE = `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <title> Acme &amp; Co &mdash; Widgets </title>
  <meta name="description" content="Buy  widgets &amp; gadgets from Acme.">
  <meta name="robots" content="index, follow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="/widgets?ref=1#top">
  <link rel="alternate" hreflang="fr" href="https://www.acme.example/fr/widgets">
  <link rel="alternate" hreflang="de" href="https://www.acme.example/de/widgets">
  <link rel="shortcut icon" href="/favicon.ico">
  <meta property="og:title" content="Acme Widgets">
  <meta property="og:description" content="Widgets for all">
  <meta property="og:image" content="https://cdn.example/w.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Acme Widgets">
  <style>body { color: red } /* <h1>not a heading</h1> */</style>
  <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Acme"},{"@type":"WebSite","url":"https://acme.example"}]}
  </script>
  <script type="application/ld+json">{"@type":"Article","author":{"@type":"Person","name":"A"}}</script>
  <script type="application/ld+json">{not json}</script>
  <script>var x = "<h1>also not a heading</h1>";</script>
</head>
<body>
  <!-- <h1>commented out</h1> -->
  <header><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>
  <h1>Acme &quot;Widgets&quot;</h1>
  <p>Widgets are great. Widgets are small &#169; everyone agrees!</p>
  <h2>Why widgets?</h2>
  <p>Because widgets &#x2764; people. Read <a href='https://partner.example/review' rel="nofollow sponsored">the review</a>.</p>
  <h4>Skipped level</h4>
  <img src="a.png" alt="A widget">
  <img src="b.png" alt="">
  <img src="c.png">
  <a href="mailto:x@acme.example">mail</a>
  <a href="tel:+123">call</a>
  <a href="javascript:void(0)">js</a>
  <a href="#section">anchor</a>
  <a href="https://www.acme.example/pricing/">Pricing</a>
  <a href="/about">About again</a>
  <a href="https://github.com/acme">GitHub</a>
  <noscript><p>Enable JavaScript</p></noscript>
  <template><p>hidden template</p></template>
  <div>Footer text</div>
</body>
</html>`;

describe('decodeEntities', () => {
  it('decodes named and numeric entities and leaves unknown ones', () => {
    expect(decodeEntities('a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;')).toBe(
      'a & b < c > d "e" \'f\'',
    );
    expect(decodeEntities('&#169; &#xA9; &#x1F600; &mdash; &nbsp;')).toBe('© © 😀 \u2014  ');
    expect(decodeEntities('&eacute;&Eacute;&unknown;')).toBe('éÉ&unknown;');
    expect(decodeEntities('&#0; &#99999999;')).toBe('� �');
    expect(decodeEntities('no entities')).toBe('no entities');
  });
});

describe('tokenize', () => {
  it('reads attributes in either quote style or none, and self-closing tags', () => {
    const tokens = tokenize(`<img src="a.png" alt='A "quoted" alt' width=10 hidden/><br>`);
    expect(tokens[0]).toEqual({
      type: 'open',
      name: 'img',
      selfClosing: true,
      attrs: { src: 'a.png', alt: 'A "quoted" alt', width: '10', hidden: '' },
    });
    expect(tokens[1]).toMatchObject({ type: 'open', name: 'br', selfClosing: true });
  });

  it('keeps script and style bodies raw and skips comments and CDATA', () => {
    const tokens = tokenize(
      '<script>if (a < b) {}</script><!-- <p>x</p> --><![CDATA[<p>y</p>]]><STYLE>a{}</STYLE>z',
    );
    expect(tokens).toEqual([
      { type: 'raw', name: 'script', attrs: {}, content: 'if (a < b) {}' },
      { type: 'raw', name: 'style', attrs: {}, content: 'a{}' },
      { type: 'text', text: 'z' },
    ]);
  });

  it('treats a stray < as text', () => {
    expect(tokenize('1 < 2 and <3')).toEqual([
      { type: 'text', text: '1 ' },
      { type: 'text', text: '<' },
      { type: 'text', text: ' 2 and ' },
      { type: 'text', text: '<' },
      { type: 'text', text: '3' },
    ]);
  });
});

describe('parseHtml', () => {
  const page = parseHtml(FIXTURE, 'https://acme.example/widgets?ref=1');

  it('extracts head metadata with entities decoded and whitespace collapsed', () => {
    expect(page.title).toBe('Acme & Co \u2014 Widgets');
    expect(page.metaDescription).toBe('Buy widgets & gadgets from Acme.');
    expect(page.robotsMeta).toBe('index, follow');
    expect(page.viewport).toBe('width=device-width, initial-scale=1');
    expect(page.lang).toBe('en-GB');
    expect(page.charset).toBe('utf-8');
    expect(page.favicon).toBe(true);
    expect(page.hreflang).toBe(2);
  });

  it('resolves the canonical URL and strips its fragment', () => {
    expect(page.canonical).toBe('https://acme.example/widgets?ref=1');
  });

  it('collects Open Graph and Twitter metas without their prefixes', () => {
    expect(page.openGraph).toEqual({
      title: 'Acme Widgets',
      description: 'Widgets for all',
      image: 'https://cdn.example/w.png',
    });
    expect(page.twitterCard).toEqual({ card: 'summary_large_image', title: 'Acme Widgets' });
  });

  it('lists headings in order, decoded, ignoring script, style, comments and noscript', () => {
    expect(page.headings).toEqual([
      { level: 1, text: 'Acme "Widgets"' },
      { level: 2, text: 'Why widgets?' },
      { level: 4, text: 'Skipped level' },
    ]);
  });

  it('counts images and missing or empty alt text', () => {
    expect(page.images).toEqual({ count: 3, missingAlt: 2 });
  });

  it('classifies links, resolves relative ones, folds www and counts nofollow', () => {
    expect(page.links.internal).toEqual([
      'https://acme.example/',
      'https://acme.example/about',
      'https://www.acme.example/pricing/',
    ]);
    expect(page.links.external).toEqual([
      'https://partner.example/review',
      'https://github.com/acme',
    ]);
    expect(page.links.nofollow).toBe(1);
  });

  it('reads JSON-LD including nested @graph and counts invalid blocks', () => {
    expect(page.structuredData.count).toBe(3);
    expect(page.structuredData.invalid).toBe(1);
    expect(page.structuredData.types).toEqual(['Organization', 'WebSite', 'Article', 'Person']);
  });

  it('derives visible text excluding hidden elements', () => {
    expect(page.text.content).not.toContain('not a heading');
    expect(page.text.content).not.toContain('commented out');
    expect(page.text.content).not.toContain('Enable JavaScript');
    expect(page.text.content).not.toContain('hidden template');
    expect(page.text.content).not.toContain('Widgets for all');
    expect(page.text.content).toContain('Widgets are great.');
    expect(page.text.content).toContain('Footer text');
    expect(page.text.content).toContain('©');
    expect(page.text.paragraphCount).toBe(2);
    expect(page.text.wordCount).toBeGreaterThan(20);
    expect(page.text.sentenceCount).toBeGreaterThanOrEqual(5);
    expect(page.text.readability).toBeNull();
    expect(page.text.textToHtmlRatio).toBeGreaterThan(0);
    expect(page.text.textToHtmlRatio).toBeLessThan(0.2);
  });

  it('ranks keywords without stop words', () => {
    expect(page.text.topKeywords[0].term).toBe('widgets');
    expect(page.text.topKeywords[0].count).toBe(5);
    expect(page.text.topKeywords[0].density).toBeGreaterThan(5);
    expect(page.text.topKeywords.map((k) => k.term)).not.toContain('are');
    expect(page.text.topKeywords.map((k) => k.term)).not.toContain('the');
  });

  it('honours <base href> and falls back to text blocks when there is no <p>', () => {
    const parsed = parseHtml(
      '<html><head><base href="https://b.example/dir/"></head><body><a href="x">x</a>' +
        '<div>one two three four five six seven eight nine</div><div>short</div></body></html>',
      'https://a.example/',
    );
    expect(parsed.links.internal).toEqual(['https://b.example/dir/x']);
    expect(parsed.text.paragraphCount).toBe(1);
  });

  it('returns empty but well-formed output for an empty document', () => {
    const parsed = parseHtml('', 'https://a.example/');
    expect(parsed.title).toBeNull();
    expect(parsed.headings).toEqual([]);
    expect(parsed.text.wordCount).toBe(0);
    expect(parsed.text.textToHtmlRatio).toBe(0);
    expect(parsed.text.topKeywords).toEqual([]);
  });

  it('reads charset from a content-type meta and a meta description named in upper case', () => {
    const parsed = parseHtml(
      '<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"><meta name="Description" content="x">',
      'https://a.example/',
    );
    expect(parsed.charset).toBe('ISO-8859-1');
    expect(parsed.metaDescription).toBe('x');
  });
});

describe('readability', () => {
  const PASSAGE = Array.from(
    { length: 12 },
    () =>
      'The cat sat on the mat. It was a warm day and the sun was out. The dog ran to the park and played with a ball.',
  ).join(' ');

  it('counts syllables with the vowel-group heuristic', () => {
    expect(countSyllables('cat')).toBe(1);
    expect(countSyllables('table')).toBe(2);
    expect(countSyllables('readability')).toBe(5);
    expect(countSyllables('jumped')).toBe(1);
    expect(countSyllables('')).toBe(0);
  });

  it('counts sentences on terminal punctuation and block boundaries', () => {
    expect(countSentences('One. Two! Three?')).toBe(3);
    expect(countSentences('Heading\nBody text here.')).toBe(2);
    expect(countSentences('')).toBe(0);
  });

  it('scores a simple passage as very easy and a short one as null', () => {
    const score = fleschReadingEase(PASSAGE);
    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThan(85);
    expect(score as number).toBeLessThanOrEqual(100);
    expect(fleschReadingEase('Too short to score.')).toBeNull();
  });

  it('scores dense academic prose lower', () => {
    const academic = Array.from(
      { length: 8 },
      () =>
        'Notwithstanding the aforementioned considerations, the epistemological ramifications of institutionalised methodological heterogeneity necessitate comprehensive interdisciplinary re-evaluation.',
    ).join(' ');
    const score = fleschReadingEase(academic) as number;
    expect(score).toBeLessThan(20);
  });
});

describe('topKeywords', () => {
  it('excludes stop words and short tokens and computes density over all words', () => {
    const keywords = topKeywords('the the the widget widget is a widget of ox', 10);
    expect(keywords[0]).toEqual({ term: 'widget', count: 3, density: 30 });
    expect(keywords.map((k) => k.term)).not.toContain('the');
    expect(keywords.map((k) => k.term)).not.toContain('ox');
    expect(STOP_WORDS.has('the')).toBe(true);
    expect(STOP_WORDS.size).toBeGreaterThanOrEqual(110);
  });
});
