/**
 * The brand extractor against fixture pages and fake fetchers: where a logo
 * is looked for and in what order, which colours are suggested for which
 * role, the web app manifest, inline SVG written back as a standalone file,
 * the JavaScript shell fallback, and that crafted pages stay fast (it reads
 * pages a stranger controls, on the API's own event loop).
 */
import { colorDistance } from '@postgear/design-engine';
import { type SafeFetchResponse, SeoCrawlError, tokenize } from '@postgear/seo-engine';
import sharp from 'sharp';
import {
  type ColorEvidence,
  colorsFromCss,
  decodeDataUri,
  type ExtractDeps,
  emptyEvidence,
  extractBrand,
  hslToHex,
  MAX_CANDIDATE_BYTES,
  MAX_LOGO_CANDIDATES,
  manifestFrom,
  oklchToHex,
  type PageScan,
  parseCssColor,
  rankColors,
  scanPage,
  serializeSvg,
  toCandidate,
} from './brand-extractor';

const SITE = 'https://acme.example/';

/** Generous: the patterns these replace took seconds to minutes on the same inputs. */
const FAST_MS = 2_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function png(width: number, height: number, background: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background } })
    .png()
    .toBuffer();
}

function fetched(url: string, body: string, contentType: string): SafeFetchResponse {
  return {
    requestedUrl: url,
    finalUrl: url,
    statusCode: 200,
    headers: { 'content-type': contentType },
    body,
    bytes: Buffer.byteLength(body),
    contentType,
    compressed: false,
    https: true,
    certificateValid: true,
    responseTimeMs: 5,
    redirects: [],
    addresses: ['203.0.113.10'],
  };
}

function notFound(url: string): SeoCrawlError {
  return new SeoCrawlError('bad_status', `${new URL(url).host} answered 404.`, false, {
    statusCode: 404,
  });
}

interface FakePage {
  body: string;
  type?: string;
}

/** Fake fetchers over a map of address to response, recording every address asked for. */
function fakeSite(pages: Record<string, FakePage>, assets: Record<string, Buffer> = {}) {
  const requested: string[] = [];
  const warn = jest.fn();
  const deps: ExtractDeps = {
    fetchPage: jest.fn(async (url: string) => {
      requested.push(url);
      const page = pages[url];
      if (!page) throw notFound(url);

      return fetched(url, page.body, page.type ?? 'text/html; charset=utf-8');
    }),
    fetchAsset: jest.fn(async (url: string) => {
      requested.push(url);
      const body = assets[url];
      if (!body) throw notFound(url);

      return { ...fetched(url, '', 'image/png'), body, bytes: body.length };
    }),
    logger: { warn },
  };

  return { deps, requested, warn };
}

function timed(check: () => unknown): number {
  const started = performance.now();
  check();
  return performance.now() - started;
}

/** A picture's address, or its kind when it is inline. */
function pictureKey(picture: PageScan['pictures'][number]): string {
  return picture.source.kind === 'url' ? picture.source.href : picture.source.kind;
}

function evidenceWith(parts: Partial<Record<keyof ColorEvidence, Record<string, number>>>) {
  const evidence = emptyEvidence();
  for (const role of ['brand', 'ground', 'ink'] as const) {
    for (const [hex, weight] of Object.entries(parts[role] ?? {})) evidence[role].set(hex, weight);
  }
  return evidence;
}

const LONG_TEXT = 'Plan, write and schedule posts for every channel in one calm place. '.repeat(5);

// ---------------------------------------------------------------------------
// A whole site
// ---------------------------------------------------------------------------

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Acme Media | Social media for small teams</title>
  <meta property="og:site_name" content="Acme Media">
  <meta name="description" content="Plan, write and schedule posts.">
  <meta property="og:image" content="/social.png">
  <meta name="theme-color" content="#FF5A1F">
  <link rel="stylesheet" href="/main.css">
  <link rel="alternate stylesheet" href="/contrast.css">
  <link rel="stylesheet" href="https://cdn.example.net/banner.css">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="icon" href="/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="mask-icon" href="/pinned.svg" color="#FF5A1F">
  <style>.cta { background: #1F6FFF; }</style>
</head>
<body>
  <header class="site-header">
    <a href="/"><img src="/brand/acme-wordmark.png" alt="Acme Media"></a>
    <nav><img src="/icons/menu.png" width="24" height="24"></nav>
  </header>
  <main>
    <h1>Posts that sound like you</h1>
    <p>${LONG_TEXT}</p>
    <section class="trusted">
      <img src="/clients/logo-one.png">
      <img src="/clients/logo-two.png">
      <img src="/clients/logo-three.png">
    </section>
  </main>
  <footer><img class="footer-logo" src="/brand/acme-mark.png"></footer>
</body>
</html>`;

const MAIN_CSS = `/* .old { color: #00FF00 } */
:root { --brand-primary: #FF5A1F; --brand-accent: #1F6FFF; }
body { background: #FFFDF8; color: #1A1A1A; }
.btn { background: var(--brand-primary); border: 1px solid #E5E5E5; }
a { color: #1F6FFF; }
@media (prefers-color-scheme: dark) { body { background: #0B0B0F; color: #F5F5F5; } }`;

const MANIFEST = JSON.stringify({
  name: 'Acme Media App',
  short_name: 'Acme',
  description: 'Social media for small teams.',
  theme_color: '#FF5A1F',
  background_color: '#FFFDF8',
  icons: [
    { src: '/android-chrome-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/maskable.png', sizes: '192x192', purpose: 'maskable any' },
    { src: '/mono.png', sizes: '512x512', purpose: 'monochrome' },
  ],
});

async function acmeSite() {
  const assets: Record<string, Buffer> = {
    [`${SITE}brand/acme-wordmark.png`]: await png(400, 100, '#FF5A1F'),
    [`${SITE}brand/acme-mark.png`]: await png(120, 120, '#1F6FFF'),
    [`${SITE}android-chrome-512.png`]: await png(512, 512, '#FF5A1E'),
    [`${SITE}icons/maskable.png`]: await png(192, 192, '#FF5A1D'),
    [`${SITE}apple-touch-icon.png`]: await png(180, 180, '#FF5A1C'),
    [`${SITE}clients/logo-one.png`]: await png(200, 80, '#333333'),
    [`${SITE}clients/logo-two.png`]: await png(200, 80, '#444444'),
    [`${SITE}favicon-32.png`]: await png(32, 32, '#FF5A1F'),
    [`${SITE}social.png`]: await png(1200, 630, '#FFFDF8'),
  };

  return fakeSite(
    {
      [SITE]: { body: PAGE },
      [`${SITE}main.css`]: { body: MAIN_CSS, type: 'text/css' },
      'https://cdn.example.net/banner.css': {
        body: '.cookie-banner { background: #00AA55; }',
        type: 'text/css',
      },
      [`${SITE}site.webmanifest`]: { body: MANIFEST, type: 'application/manifest+json' },
    },
    assets,
  );
}

describe('extractBrand', () => {
  it('reads the name, description, logos and colours of a site', async () => {
    const { deps, requested } = await acmeSite();
    const result = await extractBrand(SITE, deps);

    expect(result.url).toBe(SITE);
    expect(result.finalUrl).toBe(SITE);
    expect(result.name).toBe('Acme Media');
    expect(result.description).toBe('Plan, write and schedule posts.');
    expect(result.usedBrowser).toBe(false);

    // Header logo, footer logo, the large icons by size, then the loose
    // logos; six at most, so the rest are never downloaded.
    expect(result.logos.map((logo) => logo.sourceUrl)).toEqual([
      `${SITE}brand/acme-wordmark.png`,
      `${SITE}brand/acme-mark.png`,
      `${SITE}android-chrome-512.png`,
      `${SITE}icons/maskable.png`,
      `${SITE}apple-touch-icon.png`,
      `${SITE}clients/logo-one.png`,
    ]);
    expect(result.logos).toHaveLength(MAX_LOGO_CANDIDATES);
    expect(result.logos[0]).toMatchObject({ mimeType: 'image/png', width: 400, height: 100 });
    expect(result.logos[0].preview.startsWith('data:image/png;base64,')).toBe(true);
    expect(requested).not.toContain(`${SITE}clients/logo-two.png`);
    expect(requested).not.toContain(`${SITE}contrast.css`);
    expect(requested).not.toContain(`${SITE}mono.png`);

    expect(result.colors.map(({ hex, suggestedRole }) => [hex, suggestedRole])).toEqual([
      ['#FF5A1F', 'primary'],
      ['#1F6FFF', 'accent'],
      ['#00AA55', 'secondary'],
      ['#FFFDF8', 'background'],
      ['#1A1A1A', 'text'],
    ]);
  });

  it('renders a JavaScript shell in the browser and reads what it drew', async () => {
    const shell =
      '<!doctype html><html><head><title>Acme</title></head>' +
      '<body><div id="root"></div><script src="/app.js"></script></body></html>';
    const { deps } = fakeSite({ [SITE]: { body: shell } });
    const renderPage = jest.fn(async () => ({
      html: '<html><head><meta property="og:site_name" content="Acme Rendered"></head></html>',
      finalUrl: `${SITE}home`,
    }));

    const result = await extractBrand(SITE, { ...deps, renderPage });

    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(renderPage).toHaveBeenCalledWith(SITE, {
      signal: expect.any(AbortSignal),
      timeoutMs: expect.any(Number),
    });
    expect(result).toMatchObject({
      name: 'Acme Rendered',
      finalUrl: `${SITE}home`,
      usedBrowser: true,
    });
  });

  it('keeps the plain HTML when rendering fails', async () => {
    const shell =
      '<html><head><title>Acme Shell</title></head><body><script>boot()</script></body></html>';
    const { deps, warn } = fakeSite({ [SITE]: { body: shell } });
    const renderPage = jest.fn(async () => {
      throw new Error('No browser is available.');
    });

    const result = await extractBrand(SITE, { ...deps, renderPage });

    expect(result).toMatchObject({ name: 'Acme Shell', usedBrowser: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('studio.extract.render_failed'));
  });

  it('does not render a page that has content of its own', async () => {
    const page = `<html><head><title>Acme</title><script src="/a.js"></script></head><body><p>${LONG_TEXT}</p></body></html>`;
    const { deps } = fakeSite({ [SITE]: { body: page } });
    const renderPage = jest.fn();

    await extractBrand(SITE, { ...deps, renderPage });

    expect(renderPage).not.toHaveBeenCalled();
  });

  it('passes on the error when the page itself cannot be read', async () => {
    const { deps } = fakeSite({});

    await expect(extractBrand(SITE, deps)).rejects.toMatchObject({ kind: 'bad_status' });
  });

  it('treats a stylesheet, a manifest or a logo that will not load as one less suggestion', async () => {
    const page =
      '<html><head><title>Acme</title><link rel="stylesheet" href="/gone.css">' +
      '<link rel="manifest" href="/gone.json"><meta name="theme-color" content="#FF5A1F"></head>' +
      `<body><header><img class="logo" src="/gone.png"></header><p>${LONG_TEXT}</p></body></html>`;
    const { deps, warn } = fakeSite({ [SITE]: { body: page } });

    const result = await extractBrand(SITE, deps);

    expect(result.logos).toEqual([]);
    expect(result.colors[0]).toMatchObject({ hex: '#FF5A1F', suggestedRole: 'primary' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('studio.extract.stylesheet_failed'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('studio.extract.manifest_failed'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('studio.extract.logo_failed'));
  });

  it.each([
    ['a bar', 'Acme &amp; Co | Home'],
    ['a colon', 'Acme &amp; Co: Home'],
    ['a hyphen', 'Acme &amp; Co - Home'],
    ['an en dash', 'Acme &amp; Co &#8211; Home'],
    ['an em dash', 'Acme &amp; Co &#8212; Home'],
    ['a middle dot', 'Acme &amp; Co &#183; Home'],
  ])('names the brand from a title split by %s', async (_label, title) => {
    const { deps } = fakeSite({ [SITE]: { body: `<title>${title}</title><p>${LONG_TEXT}</p>` } });

    expect((await extractBrand(SITE, deps)).name).toBe('Acme & Co');
  });

  it('prefers the manifest name over the title', async () => {
    const page = `<title>Home | Acme</title><link rel="manifest" href="/m.json"><p>${LONG_TEXT}</p>`;
    const { deps } = fakeSite({
      [SITE]: { body: page },
      [`${SITE}m.json`]: { body: '{"name":"Acme Studio"}', type: 'application/json' },
    });

    expect((await extractBrand(SITE, deps)).name).toBe('Acme Studio');
  });
});

// ---------------------------------------------------------------------------
// Reading one page
// ---------------------------------------------------------------------------

describe('scanPage', () => {
  it('ranks header logos, footer logos and loose logos, in page order within a rank', () => {
    const scan = scanPage(PAGE);

    expect(scan.pictures.map((picture) => [pictureKey(picture), picture.rank])).toEqual([
      ['/brand/acme-wordmark.png', 0],
      ['/clients/logo-one.png', 4],
      ['/clients/logo-two.png', 4],
      ['/brand/acme-mark.png', 2],
    ]);
  });

  it('keeps the first header picture that is not an icon, even without a hint', () => {
    const scan = scanPage(
      '<header><img src="/menu.svg" width="24" height="24"><img src="/mark.png"><img src="/x.png"></header>',
    );

    expect(scan.pictures.map((picture) => [pictureKey(picture), picture.rank])).toEqual([
      ['/mark.png', 1],
    ]);
  });

  it('does not take a header inside an article for the site header', () => {
    const scan = scanPage('<article><header><img src="/photo.png"></header></article>');

    expect(scan.pictures).toEqual([]);
  });

  it('reads lazy and responsive images and inline data images', () => {
    const scan = scanPage(
      '<header>' +
        '<img class="logo" srcset="/logo-1x.png 1x, /logo-2x.png 2x" src="/logo.png">' +
        '<img class="logo" data-src="/lazy-logo.png">' +
        '<img class="logo" src="data:image/png;base64,iVBORw0KGgo=">' +
        '</header>',
    );

    expect(scan.pictures.map(pictureKey)).toEqual(['/logo-2x.png', '/lazy-logo.png', 'data']);
  });

  it('writes an inline SVG logo back as a standalone file and counts its colours', () => {
    const scan = scanPage(
      '<header><a href="/" aria-label="Acme home">' +
        '<svg viewbox="0 0 10 10" class="logo"><lineargradient id="g">' +
        '<stop offset="0" stop-color="#FF5A1F"/></lineargradient>' +
        '<rect width="10" height="10" fill="url(#g)"/></svg>' +
        '</a></header>',
    );

    const [picture] = scan.pictures;
    expect(picture.rank).toBe(0);
    if (picture.source.kind !== 'svg') throw new Error('Expected an inline SVG.');

    const svg = picture.source.svg.toString('utf8');
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"');
    expect(svg).toContain('<linearGradient id="g">');
    expect(scan.colors.brand.get('#FF5A1F')).toBeGreaterThan(0);
  });

  it('does not offer an inline SVG that carries a script', () => {
    const scan = scanPage('<header><svg class="logo"><script>alert(1)</script></svg></header>');

    expect(scan.pictures).toEqual([]);
  });

  it('ends an unclosed SVG where HTML would, rather than swallowing the page', () => {
    const scan = scanPage(
      '<header><svg class="logo" width="400" height="100"><path d="M0 0h10"/>' +
        '<div><img src="/brand/logo.png" alt="Acme logo"></div></header>' +
        '<meta name="description" content="Still read.">',
    );

    expect(scan.pictures.map(pictureKey)).toEqual(['svg', '/brand/logo.png']);
    expect(scan.metas.get('description')).toBe('Still read.');
  });

  it('reads metas by property, name or itemprop, first one winning', () => {
    const scan = scanPage(
      '<meta property="" name="description" content="  Plan   posts  ">' +
        '<meta name="description" content="Second">' +
        '<meta itemprop="name" content="Acme">',
    );

    expect(scan.metas.get('description')).toBe('Plan posts');
    expect(scan.metas.get('name')).toBe('Acme');
  });

  it('reads stylesheets, the manifest and every kind of icon', () => {
    const scan = scanPage(
      '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/a.css">' +
        '<link rel="alternate stylesheet" href="/b.css">' +
        '<link rel="manifest" href="/m.json"><link rel="manifest" href="/n.json">' +
        '<link rel="icon" href="/favicon.ico">' +
        '<link rel="icon" type="image/svg+xml" href="/icon.svg">' +
        '<link rel="icon" sizes="16x16 192x192" href="/i.png">' +
        '<link rel="apple-touch-icon" href="/t.png">' +
        '<link rel="mask-icon" href="/m.svg" color="#5BBAD5">',
    );

    expect(scan.stylesheets).toEqual(['/a.css']);
    expect(scan.manifest).toBe('/m.json');
    expect(scan.icons).toEqual([
      { href: '/favicon.ico', size: 32, kind: 'icon' },
      { href: '/icon.svg', size: 1_024, kind: 'icon' },
      { href: '/i.png', size: 192, kind: 'icon' },
      { href: '/t.png', size: 180, kind: 'touch' },
      { href: '/m.svg', size: 0, kind: 'mask' },
    ]);
    expect(scan.colors.brand.get('#5BBAD5')).toBe(30);
  });

  it('reads the title with its entities decoded', () => {
    expect(scanPage('<title>Acme &amp; Co</title>').title).toBe('Acme & Co');
  });

  it('reads the page background and text colour from the body', () => {
    const fromAttributes = scanPage('<body bgcolor="#FFFFFF" text="#000000">');
    expect(fromAttributes.colors.ground.get('#FFFFFF')).toBe(12);
    expect(fromAttributes.colors.ink.get('#000000')).toBe(12);

    const fromStyle = scanPage('<body style="background-color: #FAF7F0; color: #222">');
    expect(fromStyle.colors.ground.get('#FAF7F0')).toBe(12);
    expect(fromStyle.colors.ink.get('#222222')).toBe(12);
  });

  it.each([
    ['a page that draws itself', '<div id="app"></div><script src="/main.js"></script>', true],
    ['a page with words of its own', `<p>${LONG_TEXT}</p><script src="/main.js"></script>`, false],
    ['a page with only structured data', '<script type="application/ld+json">{}</script>', false],
    [
      'a page whose only words are for no-script browsers',
      `<noscript>${LONG_TEXT}</noscript><script type="module" src="/main.js"></script>`,
      true,
    ],
  ])('calls %s a shell: %s', (_label, body, shell) => {
    expect(
      scanPage(`<html><head><title>Acme</title></head><body>${body}</body></html>`).isShell,
    ).toBe(shell);
  });

  it('stays fast on crafted pages', () => {
    const size = 1_000_000;
    const repeat = (unit: string) => unit.repeat(Math.floor(size / unit.length));
    const crafted = [
      repeat('<a href="/">'),
      repeat('<div class="logo">'),
      repeat('<svg>'),
      repeat('<svg><div>'),
      repeat('<header><img class="logo" src="/a.png">'),
      repeat('<title>'),
      repeat('<p style="color: rgb(1 2 '),
      `<style>${repeat('{')}</style>`,
      `<style>${repeat('}')}</style>`,
      `<style>${repeat('a{color:#')}</style>`,
      `<style>${repeat('rgb(1 ')}</style>`,
      `<style>${repeat('--brand-x: 1 ')}</style>`,
      `<p>${repeat('&#x')}</p>`,
      `<img srcset="${repeat('a,')}">`,
    ];

    for (const page of crafted) {
      expect(timed(() => scanPage(page))).toBeLessThan(FAST_MS);
    }
  });
});

// ---------------------------------------------------------------------------
// Inline SVG
// ---------------------------------------------------------------------------

describe('serializeSvg', () => {
  function written(html: string): string | null {
    const tokens = tokenize(html);
    return serializeSvg(tokens, 0, tokens.length)?.toString('utf8') ?? null;
  }

  it('puts back the names HTML lower-cased, and the namespaces', () => {
    expect(
      written(
        '<svg viewbox="0 0 10 10"><lineargradient gradientunits="userSpaceOnUse" id="g">' +
          '</lineargradient><use xlink:href="#g"/></svg>',
      ),
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
        'viewBox="0 0 10 10"><linearGradient gradientUnits="userSpaceOnUse" id="g">' +
        '</linearGradient><use xlink:href="#g"/></svg>',
    );
  });

  it('drops elements in undeclared namespaces, children and all, and keeps declared ones', () => {
    expect(
      written(
        '<svg xmlns:dc="http://purl.org/dc/elements/1.1/">' +
          '<sodipodi:namedview><inkscape:grid/></sodipodi:namedview>' +
          '<metadata><dc:title>Acme</dc:title></metadata><rect/></svg>',
      ),
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        '<metadata><dc:title>Acme</dc:title></metadata><rect/></svg>',
    );
  });

  it('escapes text and attributes, and keeps style as character data', () => {
    expect(
      written(
        `<svg><text>Fish &amp; Chips &lt;3</text><g data-x='a"b'></g>` +
          '<style>.a > .b { fill: red }</style></svg>',
      ),
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>Fish &amp; Chips &lt;3</text>' +
        '<g data-x="a&quot;b"></g><style><![CDATA[.a > .b { fill: red }]]></style></svg>',
    );
  });

  it('closes what the page left open', () => {
    expect(written('<svg><g><rect></svg>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><g><rect></rect></g></svg>',
    );
  });

  it('refuses a drawing nested too deeply to be a logo', () => {
    expect(written(`<svg>${'<g>'.repeat(300)}</svg>`)).toBeNull();
  });

  it('refuses tokens that do not start with an svg', () => {
    const tokens = tokenize('<div><svg></svg></div>');
    expect(serializeSvg(tokens, 0, tokens.length)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

describe('parseCssColor', () => {
  it.each([
    ['#abc', '#AABBCC'],
    ['#FF5A1F', '#FF5A1F'],
    ['#ff5a1f80', '#FF5A1F'],
    ['#f00c', '#FF0000'],
    ['rgb(255, 90, 31)', '#FF5A1F'],
    ['rgb(255 90 31 / 50%)', '#FF5A1F'],
    ['rgba(0,0,255,.5)', '#0000FF'],
    ['rgb(100%, 0%, 0%)', '#FF0000'],
    ['hsl(0 100% 50%)', '#FF0000'],
    ['hsl(120deg, 100%, 25%)', '#008000'],
    ['hsl(.5turn 100% 50%)', '#00FFFF'],
    ['hsla(240, 100%, 50%, 0.4)', '#0000FF'],
    ['oklch(100% 0 0)', '#FFFFFF'],
    ['oklch(0 0 0)', '#000000'],
    ['white', '#FFFFFF'],
    ['BLACK !important', '#000000'],
  ])('reads %s', (value, hex) => {
    expect(parseCssColor(value)).toBe(hex);
  });

  it.each(['red', 'transparent', 'currentColor', 'var(--brand)', '', `#${'a'.repeat(200)}`])(
    'has nothing to say about %s',
    (value) => {
      expect(parseCssColor(value)).toBeNull();
    },
  );

  it('reads a minified Tailwind oklch close to the colour it names', () => {
    // Tailwind 4's red-600 and blue-500.
    expect(colorDistance(parseCssColor('oklch(57.7% .245 27.325)') ?? '', '#E7000B')).toBeLessThan(
      0.02,
    );
    expect(colorDistance(parseCssColor('oklch(62.3% .214 259.815)') ?? '', '#2B7FFF')).toBeLessThan(
      0.02,
    );
  });
});

describe('hslToHex and oklchToHex', () => {
  it('wraps hues and refuses what is not a number', () => {
    expect(hslToHex(-120, 100, 50)).toBe('#0000FF');
    expect(hslToHex(360, 100, 50)).toBe('#FF0000');
    expect(hslToHex(Number.NaN, 100, 50)).toBeNull();
    expect(oklchToHex(Number.POSITIVE_INFINITY, 0, 0)).toBeNull();
  });

  it('puts pure sRGB red back where it started', () => {
    expect(colorDistance(oklchToHex(0.627955, 0.257683, 29.2339) ?? '', '#FF0000')).toBeLessThan(
      0.01,
    );
  });
});

describe('colorsFromCss', () => {
  it('weighs a brand custom property above a button, and a button above a border', () => {
    const evidence = colorsFromCss(
      ':root { --brand: #FF5A1F; } .btn { color: #1F6FFF; } .card { border-color: #00AA55; }',
    );

    expect(evidence.brand.get('#FF5A1F')).toBe(25);
    expect(evidence.brand.get('#1F6FFF')).toBe(6);
    expect(evidence.brand.get('#00AA55')).toBe(1);
  });

  it('ignores commented-out rules', () => {
    expect(
      colorsFromCss('/* a { color: #00FF00 } */ b { color: #FF0000 }').brand.has('#00FF00'),
    ).toBe(false);
  });

  it('reads the page background and text, inside at-rules too', () => {
    const evidence = colorsFromCss(
      'body { background: #FFFDF8; color: #1A1A1A; }' +
        '@media (prefers-color-scheme: dark) { html { background-color: #0B0B0F; } }' +
        '.panel { --surface: #F4F4F4; }',
    );

    expect(Object.fromEntries(evidence.ground)).toEqual({
      '#FFFDF8': 12,
      '#0B0B0F': 12,
      '#F4F4F4': 4,
    });
    expect(Object.fromEntries(evidence.ink)).toEqual({ '#1A1A1A': 12 });
  });

  it("reads shadcn's bare HSL triples where a colour is expected", () => {
    const evidence = colorsFromCss(
      ':root { --background: 0 0% 100%; --foreground: 222.2 84% 4.9%; ' +
        '--primary: 221.2 83.2% 53.3%; --radius: 0.5rem; }',
    );

    expect(evidence.ground.get('#FFFFFF')).toBe(12);
    expect(evidence.ink.size).toBe(1);
    expect(evidence.brand.get('#2563EB')).toBe(25);
    expect(evidence.brand.size).toBe(1);
  });
});

describe('rankColors', () => {
  it('drops greys and near-white and near-black tints, and merges near duplicates', () => {
    const colors = rankColors(
      evidenceWith({
        brand: { '#777777': 50, '#FFFFFF': 40, '#050505': 30, '#FF5A1F': 10, '#FF5B20': 5 },
      }),
    );

    expect(colors).toEqual([{ hex: '#FF5A1F', suggestedRole: 'primary', weight: 15 }]);
  });

  it('suggests Primary, Accent and Secondary by weight, six brand colours at most', () => {
    const colors = rankColors(
      evidenceWith({
        brand: {
          '#1F6FFF': 5,
          '#FF5A1F': 9,
          '#00AA55': 7,
          '#AA00FF': 3,
          '#FFB800': 2,
          '#E0115F': 1.5,
          '#008080': 1,
        },
      }),
    );

    expect(colors.map(({ hex, suggestedRole }) => [hex, suggestedRole])).toEqual([
      ['#FF5A1F', 'primary'],
      ['#00AA55', 'accent'],
      ['#1F6FFF', 'secondary'],
      ['#AA00FF', 'secondary'],
      ['#FFB800', 'secondary'],
      ['#E0115F', 'secondary'],
    ]);
  });

  it('adds the page background and the first text colour readable on it', () => {
    const colors = rankColors(
      evidenceWith({
        brand: { '#FF5A1F': 10 },
        ground: { '#FFFDF8': 12, '#0B0B0F': 4 },
        ink: { '#F5F5F5': 12, '#1A1A1A': 4 },
      }),
    );

    expect(colors.map(({ hex, suggestedRole }) => [hex, suggestedRole])).toEqual([
      ['#FF5A1F', 'primary'],
      ['#FFFDF8', 'background'],
      ['#1A1A1A', 'text'],
    ]);
  });

  it('settles for large-text contrast, and offers no text colour below it', () => {
    const readable = rankColors(evidenceWith({ ink: { '#8A8A8A': 12 } }));
    expect(readable).toEqual([{ hex: '#8A8A8A', suggestedRole: 'text', weight: 12 }]);

    expect(rankColors(evidenceWith({ ink: { '#BBBBBB': 12 } }))).toEqual([]);
  });

  it('does not offer a background that is already one of the brand colours', () => {
    const colors = rankColors(
      evidenceWith({ brand: { '#1F6FFF': 10 }, ground: { '#1F70FF': 12 } }),
    );

    expect(colors.map(({ suggestedRole }) => suggestedRole)).toEqual(['primary']);
  });
});

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

describe('manifestFrom', () => {
  const MANIFEST_URL = 'https://acme.example/app/site.webmanifest';

  it('reads the name, colours and icons, resolved against the manifest', () => {
    expect(manifestFrom(MANIFEST, MANIFEST_URL)).toEqual({
      name: 'Acme Media App',
      description: 'Social media for small teams.',
      themeColor: '#FF5A1F',
      backgroundColor: '#FFFDF8',
      icons: [
        { href: 'https://acme.example/android-chrome-512.png', size: 512, kind: 'icon' },
        { href: 'https://acme.example/app/icons/maskable.png', size: 192, kind: 'icon' },
      ],
    });
  });

  it('falls back to the short name, and to the vector size for an SVG icon', () => {
    const info = manifestFrom(
      JSON.stringify({
        short_name: '  Acme  ',
        icons: [{ src: '/icon.svg', type: 'image/svg+xml' }, { src: 'javascript:alert(1)' }],
      }),
      MANIFEST_URL,
    );

    expect(info?.name).toBe('Acme');
    expect(info?.icons).toEqual([
      { href: 'https://acme.example/icon.svg', size: 1_024, kind: 'icon' },
    ]);
  });

  it('caps the icons it reads', () => {
    const icons = Array.from({ length: 100 }, (_, index) => ({ src: `/i${index}.png` }));
    expect(manifestFrom(JSON.stringify({ icons }), MANIFEST_URL)?.icons).toHaveLength(30);
  });

  it.each(['not json', '[]', 'null', '42'])('refuses %s', (text) => {
    expect(manifestFrom(text, MANIFEST_URL)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Logo candidates
// ---------------------------------------------------------------------------

describe('decodeDataUri', () => {
  it('reads base64 and percent-encoded payloads', async () => {
    const bytes = await png(60, 60, '#FF5A1F');

    expect(decodeDataUri(`data:image/png;base64,${bytes.toString('base64')}`)).toEqual(bytes);
    expect(
      decodeDataUri('data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E')?.toString(),
    ).toBe('<svg></svg>');
  });

  it.each([
    ['an empty payload', 'data:,'],
    ['a payload that is not base64', 'data:image/png;base64,!!!!'],
    ['broken percent-encoding', 'data:image/svg+xml,%E0%A4%A'],
    ['something that is not a data URI', 'https://acme.example/logo.png'],
    [
      'a payload too large to be a logo',
      `data:image/png;base64,${'A'.repeat(MAX_CANDIDATE_BYTES * 2)}`,
    ],
  ])('refuses %s', (_label, uri) => {
    expect(decodeDataUri(uri)).toBeNull();
  });
});

describe('toCandidate', () => {
  const SVG = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>',
  );

  it('offers a raster logo with its size and a preview', async () => {
    const bytes = await png(120, 60, '#FF5A1F');

    expect(await toCandidate(bytes, `${SITE}logo.png`, 'image/png')).toEqual({
      preview: `data:image/png;base64,${bytes.toString('base64')}`,
      sourceUrl: `${SITE}logo.png`,
      width: 120,
      height: 60,
      mimeType: 'image/png',
      bytes: bytes.length,
    });
  });

  it('offers a safe SVG at any size', async () => {
    expect(await toCandidate(SVG, `${SITE}logo.svg`, 'image/svg+xml')).toMatchObject({
      mimeType: 'image/svg+xml',
      width: 40,
      height: 20,
    });
  });

  it('keeps a raster that is narrow but tall enough', async () => {
    expect(await toCandidate(await png(32, 120, '#FF5A1F'), SITE, null)).not.toBeNull();
  });

  it('refuses favicons, other formats, mislabelled pages and unsafe SVGs', async () => {
    const gif = await sharp({
      create: { width: 120, height: 60, channels: 4, background: '#FF5A1F' },
    })
      .gif()
      .toBuffer();
    const unsafe = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );

    expect(await toCandidate(await png(32, 32, '#FF5A1F'), SITE, 'image/png')).toBeNull();
    expect(await toCandidate(gif, SITE, 'image/gif')).toBeNull();
    expect(await toCandidate(Buffer.from('<html>Not found</html>'), SITE, 'image/png')).toBeNull();
    expect(await toCandidate(SVG, SITE, 'text/html')).toBeNull();
    expect(await toCandidate(unsafe, SITE, 'image/svg+xml')).toBeNull();
    expect(await toCandidate(Buffer.alloc(0), SITE, 'image/png')).toBeNull();
    expect(await toCandidate(Buffer.alloc(MAX_CANDIDATE_BYTES + 1), SITE, 'image/png')).toBeNull();
  });
});
