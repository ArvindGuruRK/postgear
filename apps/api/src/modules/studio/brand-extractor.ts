/**
 * Reading a brand off a website.
 *
 * ## Nothing here fetches anything on its own
 *
 * Every request goes through `@postgear/seo-engine`'s `fetchUrlSafely` and
 * `fetchBinarySafely`, which is the SSRF guard Sprint 7 built and tested:
 * private, loopback, link-local and cloud-metadata addresses refused, the
 * address pinned after it is validated so DNS cannot be re-resolved to
 * something else, redirects re-checked at every hop, odd ports and
 * credentials-in-URL refused. The one page that may need a browser is
 * rendered by the shared pool, whose pages run that same guard on every
 * request they make. Writing a second fetcher here would be writing a second
 * set of those bugs, so this file has no `fetch`, no `http`, no `dns` and no
 * socket.
 *
 * ## Nothing here can be made slow by the page
 *
 * A website is input from a stranger, read on the API's own event loop. So
 * the page is read in one pass of the SEO engine's tokenizer (linear in the
 * size of the page), stylesheets are cut up on their braces, and the regular
 * expressions that remain either run over short, bounded strings or are
 * written so that they cannot backtrack. A pattern like `<img[^>]*logo[^>]*>`
 * over a hostile 1.5 MB page is a quadratic stall; there is none here.
 *
 * ## Everything it returns is a suggestion
 *
 * The output is candidates, never a saved kit. A logo is a `data:` preview
 * until the user picks it and saves, at which point the browser uploads that
 * preview through the logo route like any other logo file, so it meets the
 * same checks. Extraction quality varies enormously by site, which is exactly
 * why the review screen exists.
 *
 * ## The budget
 *
 * One page (rendered in the browser only when its plain HTML is an empty
 * JavaScript shell), its web app manifest, up to two stylesheets at 1 MB
 * each, and up to six logo candidates at 1 MB each, three downloads at a
 * time, all under a 10 second deadline. A site that is slow simply yields
 * fewer candidates rather than holding a request open.
 */
import {
  AA_CONTRAST,
  type BrandColors,
  colorDistance,
  contrastRatio,
  hexToRgb,
  normalizeHex,
  rgbToHex,
  saturation,
} from '@postgear/design-engine';
import {
  DEFAULT_MAX_HTML_BYTES,
  decodeEntities,
  fetchBinarySafely,
  fetchUrlSafely,
  type HtmlToken,
  normaliseUrl,
  tokenize,
} from '@postgear/seo-engine';
import sharp from 'sharp';
import { SNIFF_BYTES, sniffMedia } from '../media/file-type';
import { isSafeSvg, LOGO_RASTER_TYPES, MAX_SVG_BYTES } from './brand-logo';
import type { BrandExtraction, ColorCandidate, LogoCandidate } from './studio.types';

/** The whole extraction, however many requests it makes. */
export const EXTRACT_DEADLINE_MS = 10_000;
const PAGE_TIMEOUT_MS = 7_000;
const ASSET_TIMEOUT_MS = 4_000;
/** Below this much time left, a JavaScript shell is not worth starting a browser for. */
const BROWSER_MIN_REMAINING_MS = 4_000;
/** Below this much time left, no further download is started. */
const ASSET_MIN_REMAINING_MS = 800;

/** The SEO analyzer's own page limit: a page it can read, extraction can read too. */
const MAX_PAGE_BYTES = DEFAULT_MAX_HTML_BYTES;
const MAX_STYLESHEET_LINKS = 8;
const MAX_STYLESHEETS = 2;
/**
 * The fetcher refuses a larger sheet rather than cutting it short, so this is
 * sized for a full framework build, not a typical one.
 */
const MAX_STYLESHEET_BYTES = 1_000_000;
const MAX_MANIFEST_BYTES = 100_000;
const MAX_MANIFEST_ICONS = 30;
/** One candidate. Its preview travels back as base64, so six of these bound the response. */
export const MAX_CANDIDATE_BYTES = 1_000_000;
export const MAX_LOGO_CANDIDATES = 6;
/** Brand colours, plus a background and a text colour when the site declares them. */
export const MAX_COLOR_CANDIDATES = 8;
const MAX_BRAND_COLORS = 6;
const LOGO_DOWNLOADS_AT_ONCE = 3;
/** Inline SVG logos offered, at most. */
const MAX_INLINE_SVGS = 2;
/** Inline SVGs kept from the page before the rest are ignored. */
const MAX_SVG_CANDIDATES = 6;
/** Pictures kept from the page before the rest are ignored. */
const MAX_PICTURES = 24;
/** Logo-like pictures outside the header and footer: often a "trusted by" row of other brands. */
const MAX_LOOSE_LOGOS = 2;
const MAX_ICONS = 16;
/** A raster smaller than this on both sides is a favicon, not a logo anyone wants on a slide. */
const MIN_LOGO_EDGE = 48;
/** A picture declared this small or smaller is an icon, unless it says it is a logo. */
const ICON_EDGE = 32;
/** An icon declared at least this large is worth offering before loose logos. */
const LARGE_ICON = 96;
/** The size an icon is ranked at when it is a vector (`sizes="any"`, or SVG). */
const VECTOR_ICON = 1_024;
/** Visible text under this, on a page that runs scripts, is an app that draws itself. */
const SHELL_TEXT_LENGTH = 200;
/** Tokens and nesting an inline SVG may have before it is a drawing, not a logo. */
const MAX_SVG_TOKENS = 20_000;
const MAX_SVG_DEPTH = 256;
/** Open elements tracked while reading the page; anything deeper is not a site header. */
const MAX_STACK_DEPTH = 1_024;
/** Attribute text looked at for a hint; a logo says so in its first few words. */
const HINT_LENGTH = 300;
const MAX_TITLE_LENGTH = 1_000;
const MAX_URL_LENGTH = 2_048;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

/** Under this and a colour is a grey: a brand is not described by its greys. */
const MIN_SATURATION = 0.12;
/** Near-black and near-white tints are text and backgrounds, not brand colours. */
const MIN_LIGHTNESS = 0.08;
const MAX_LIGHTNESS = 0.92;
/** Two colours closer than this are the same colour with a rounding error. */
const MERGE_DISTANCE = 0.07;

/** How much each kind of evidence says about a brand colour. */
const WEIGHT = {
  /** `<meta name="theme-color">`: the one colour a site declares about itself. */
  themeColor: 40,
  manifestTheme: 35,
  /** Safari's pinned-tab colour, `<link rel="mask-icon" color>`. */
  maskIcon: 30,
  /** A custom property whose name says brand, primary or accent. */
  brandProperty: 25,
  tileColor: 20,
  /** Each colour the site's own inline logo is drawn in. */
  logo: 15,
  /** Buttons and links: what a brand paints in its own colour. */
  brandRule: 6,
  inlineStyle: 3,
  rule: 1,
  /** A page background or text colour set on `html`, `body` or `:root`, or by the manifest. */
  page: 12,
  /** The same, set somewhere else: usually a dark-mode variant. */
  variant: 4,
} as const;

/**
 * What a site puts between its name and its tagline in `<title>`: a bar or a
 * dash with a space either side, or a colon with the space after it, the way
 * a colon is written.
 *
 * Written with escapes rather than the characters themselves: two of them
 * are ones this project never types (the project hook refuses them in source),
 * and an escape is what the UI conventions say to use where code genuinely
 * needs the character.
 */
const TITLE_SEPARATOR = /\s[|\-\u2013\u2014\u00B7]\s|:\s/;

const LOGO_HINT = /logo|brand|wordmark/i;
const HEADER_HINT = /\b(?:site-?header|header|navbar|top-?bar|masthead)\b/i;
/** A link to the site's own front page: what a header logo almost always is. */
const HOME_HREF = /^(?:\/|\.\/|\/index\.html?|https?:\/\/[^/?#]+\/?)$/i;
const EXECUTABLE_SCRIPT = /^(?:(?:text|application)\/(?:x-)?(?:java|ecma)script|module)$/i;
const BRAND_PROPERTY = /brand|primary|accent|secondary|theme|main|cta|highlight/;
/** Rules for the things a brand paints in its own colour: buttons and links. */
const BRAND_SELECTOR = /(?:^|[\s,}>])(?:\.?btn|button|\.button|\.cta|a)(?:[\s.:,[{#>-]|$)/i;
/** Selectors that style the page itself, whose background and colour are the page's. */
const PAGE_SELECTOR = /^(?:html|body|:root|main)$/i;
/** Custom properties that name the page background (`--background`, shadcn's) or its text. */
const GROUND_PROPERTY = /^--(?:color-)?(?:background|background-color|bg|surface|body-bg|page-bg)$/;
const INK_PROPERTY = /^--(?:color-)?(?:foreground|text|text-color|ink|fg|body-color|font-color)$/;

export interface ExtractorLogger {
  warn(message: string): void;
}

export interface RenderedPage {
  html: string;
  finalUrl: string;
}

export interface ExtractDeps {
  /** Injected so the specs drive the extractor without a network. */
  fetchPage: typeof fetchUrlSafely;
  fetchAsset: typeof fetchBinarySafely;
  /**
   * Renders a page in the shared, guarded browser. Absent in the specs and
   * when no browser is available, in which case a JavaScript shell yields
   * what its plain HTML has, and the review screen takes over.
   */
  renderPage?: (
    url: string,
    options: { signal: AbortSignal; timeoutMs: number },
  ) => Promise<RenderedPage>;
  logger?: ExtractorLogger;
}

export const defaultExtractDeps: ExtractDeps = {
  fetchPage: fetchUrlSafely,
  fetchAsset: fetchBinarySafely,
};

interface Clock {
  signal: AbortSignal;
  remaining(): number;
}

/** A deadline every sub-request shares, so the total really is 10 s. */
function deadline(ms: number): Clock & { done(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const startedAt = Date.now();

  return {
    signal: controller.signal,
    remaining: () => Math.max(0, ms - (Date.now() - startedAt)),
    done: () => clearTimeout(timer),
  };
}

/**
 * Reads one website and returns everything worth suggesting.
 *
 * Throws the fetcher's own `SeoCrawlError` when the page itself cannot be
 * read (refused, unreachable, not HTML); everything after the page is best
 * effort and only ever shortens the lists.
 */
export async function extractBrand(
  rawUrl: string,
  deps: ExtractDeps = defaultExtractDeps,
): Promise<BrandExtraction> {
  const url = normaliseUrl(rawUrl);
  const clock = deadline(EXTRACT_DEADLINE_MS);

  try {
    const page = await deps.fetchPage(url, {
      signal: clock.signal,
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: MAX_PAGE_BYTES,
    });

    let base = page.finalUrl;
    let scan = scanPage(page.body);
    let usedBrowser = false;

    if (deps.renderPage && scan.isShell && clock.remaining() >= BROWSER_MIN_REMAINING_MS) {
      try {
        const rendered = await deps.renderPage(base, {
          signal: clock.signal,
          timeoutMs: clock.remaining() - 1_000,
        });

        scan = scanPage(rendered.html.slice(0, MAX_PAGE_BYTES));
        base = rendered.finalUrl;
        usedBrowser = true;
      } catch (error) {
        // The plain HTML is still something: its head usually names the site
        // and its icons, even when the body is empty.
        deps.logger?.warn(`studio.extract.render_failed ${describe(error)}`);
      }
    }

    const [stylesheets, manifest] = await Promise.all([
      readStylesheets(scan.stylesheets, base, deps, clock),
      readManifest(scan.manifest, base, deps, clock),
    ]);

    const evidence: ColorEvidence = {
      brand: new Map(scan.colors.brand),
      ground: new Map(scan.colors.ground),
      ink: new Map(scan.colors.ink),
    };
    for (const css of stylesheets) colorsFromCss(css, evidence);
    if (manifest?.themeColor) addColor(evidence.brand, manifest.themeColor, WEIGHT.manifestTheme);
    if (manifest?.backgroundColor) addColor(evidence.ground, manifest.backgroundColor, WEIGHT.page);

    const logos = await readLogos(logoSources(scan, manifest, base), deps, clock);

    return {
      url,
      finalUrl: base,
      name: brandName(scan, manifest),
      description: brandDescription(scan, manifest),
      logos,
      colors: rankColors(evidence),
      usedBrowser,
    };
  } finally {
    clock.done();
  }
}

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

/** Colour to weight. Ties keep the order the colours were first seen in. */
export type ColorTally = Map<string, number>;

/** What the page says about its colours, kept apart by what each colour paints. */
export interface ColorEvidence {
  /** Every colour, weighted by how much it looks like the brand's own. */
  brand: ColorTally;
  /** What the page is painted on: the body's background, `--background`. */
  ground: ColorTally;
  /** What its text is written in: the body's `color`, `--foreground`. */
  ink: ColorTally;
}

export function emptyEvidence(): ColorEvidence {
  return { brand: new Map(), ground: new Map(), ink: new Map() };
}

/** Where a logo is found, best first. Within one rank, pictures keep page order. */
const RANK = {
  /** A picture in the site header that says it is a logo, or links home. */
  headerLogo: 0,
  /** The first picture in the site header, when it is not an icon. */
  headerFirst: 1,
  footerLogo: 2,
  /** Touch icons, manifest icons and vector icons: square, but large and the site's own. */
  largeIcon: 3,
  /** A logo-like picture anywhere else. */
  looseLogo: 4,
  smallIcon: 5,
  /** The social sharing image: usually a banner rather than a logo. */
  socialImage: 6,
} as const;

type PictureSource =
  | { kind: 'url'; href: string }
  | { kind: 'data'; uri: string }
  | { kind: 'svg'; svg: Buffer };

interface Picture {
  source: PictureSource;
  rank: number;
}

interface IconLink {
  href: string;
  /** The declared edge, used to rank icons; vectors count as large. */
  size: number;
  kind: 'touch' | 'icon' | 'mask';
}

export interface PageScan {
  title: string | null;
  /** `<meta>` content by lower-cased name or property; the first one wins. */
  metas: Map<string, string>;
  stylesheets: string[];
  manifest: string | null;
  icons: IconLink[];
  pictures: Picture[];
  colors: ColorEvidence;
  /** Scripts and next to no visible text: an app that draws itself after load. */
  isShell: boolean;
}

interface OpenElement {
  name: string;
  logoish: boolean;
  /**
   * This element or one of its two nearest open ancestors hints at a logo.
   * Worked out once, when it is pushed: the stack only changes at the top, so
   * the elements under it are the same for as long as it is open.
   */
  nearLogo: boolean;
  region: 'header' | 'footer' | null;
}

/**
 * Everything the extractor wants from one HTML document, in a single pass.
 *
 * It keeps a stack of open elements so it knows whether a picture sits in
 * the site header, the footer or a container that calls itself a logo. HTML
 * leaves elements open freely, so the stack is a best effort: a closing tag
 * pops back to its own element when that element is open and is ignored
 * when it is not, and a per-name count keeps that check constant time.
 */
export function scanPage(html: string): PageScan {
  const tokens = tokenize(html);
  const scan: PageScan = {
    title: null,
    metas: new Map(),
    stylesheets: [],
    manifest: null,
    icons: [],
    pictures: [],
    colors: emptyEvidence(),
    isShell: false,
  };

  const stack: OpenElement[] = [];
  const openCount = new Map<string, number>();
  let headerDepth = 0;
  let footerDepth = 0;
  let headerPictureSeen = false;
  let looseLogos = 0;
  let inlineSvgs = 0;
  let titleParts: string[] | null = null;
  let titleLength = 0;
  let titleDone = false;
  let runsScripts = false;
  let visibleText = 0;

  const inside = (name: string) => (openCount.get(name) ?? 0) > 0;

  /** Tracks an open element. Past the depth limit nothing is, so its hints are not worked out. */
  const push = (name: string, attrs: Record<string, string>) => {
    if (stack.length >= MAX_STACK_DEPTH) return;

    const logoish = hintsLogo(name, attrs);
    const parent = stack[stack.length - 1];
    const grandparent = stack[stack.length - 2];
    const element: OpenElement = {
      name,
      logoish,
      nearLogo: logoish || parent?.logoish === true || grandparent?.logoish === true,
      region: regionOf(name, attrs, inside),
    };
    stack.push(element);
    openCount.set(element.name, (openCount.get(element.name) ?? 0) + 1);
    if (element.region === 'header') headerDepth += 1;
    if (element.region === 'footer') footerDepth += 1;
  };

  const popTo = (name: string) => {
    if (!inside(name)) return;

    while (stack.length > 0) {
      const element = stack.pop() as OpenElement;
      openCount.set(element.name, (openCount.get(element.name) ?? 1) - 1);
      if (element.region === 'header') headerDepth -= 1;
      if (element.region === 'footer') footerDepth -= 1;
      if (element.name === name) return;
    }
  };

  /** The three nearest open elements: a logo's wrapper is rarely further out. */
  const ancestorSaysLogo = () => stack[stack.length - 1]?.nearLogo === true;

  /**
   * Where a picture here would rank, or null when it is not worth offering.
   * Each question is only asked when the answer matters: most pictures on a
   * page are not candidates, and a crafted page can hold a hundred thousand.
   */
  const rankFor = (name: string, attrs: Record<string, string>): number | null => {
    if (scan.pictures.length >= MAX_PICTURES) return null;

    const logoish = hintsLogo(name, attrs) || ancestorSaysLogo();

    if (footerDepth === 0 && headerDepth > 0) {
      if (logoish) return RANK.headerLogo;
      // A header picture that is not a logo is offered when it is not an icon.
      return !headerPictureSeen && declaredEdge(attrs) > ICON_EDGE ? RANK.headerFirst : null;
    }

    if (!logoish) return null;
    if (footerDepth > 0) return RANK.footerLogo;
    return looseLogos < MAX_LOOSE_LOGOS ? RANK.looseLogo : null;
  };

  const keep = (source: PictureSource, rank: number) => {
    scan.pictures.push({ source, rank });
    if (rank === RANK.headerLogo || rank === RANK.headerFirst) headerPictureSeen = true;
    if (rank === RANK.looseLogo) looseLogos += 1;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === 'raw') {
      if (token.name === 'script') {
        const type = token.attrs.type?.trim() ?? '';
        if (type === '' || EXECUTABLE_SCRIPT.test(type)) runsScripts = true;
      } else if (token.name === 'style') {
        colorsFromCss(token.content, scan.colors);
      }
      continue;
    }

    if (token.type === 'text') {
      if (inside('title')) {
        if (titleParts && !titleDone && titleLength < MAX_TITLE_LENGTH) {
          titleParts.push(token.text);
          titleLength += token.text.length;
        }
      } else if (
        visibleText < SHELL_TEXT_LENGTH &&
        !inside('head') &&
        !inside('noscript') &&
        !inside('template')
      ) {
        visibleText += collapse(token.text).length;
      }
      continue;
    }

    if (token.type === 'close') {
      if (token.name === 'title' && titleParts) titleDone = true;
      popTo(token.name);
      continue;
    }

    const { name, attrs } = token;
    const page = name === 'html' || name === 'body';
    if (attrs.style) colorsFromDeclarations(attrs.style, WEIGHT.inlineStyle, page, scan.colors);

    if (name === 'svg') {
      if (token.selfClosing) continue;

      // The whole drawing is consumed here, so its own <title> and <style>
      // never pass for the page's.
      const end = svgEnd(tokens, index);
      const rank =
        inlineSvgs < MAX_SVG_CANDIDATES && end - index <= MAX_SVG_TOKENS
          ? rankFor(name, attrs)
          : null;

      if (rank !== null) {
        const svg = serializeSvg(tokens, index, end);

        if (svg && isSafeSvg(svg)) {
          keep({ kind: 'svg', svg }, rank);
          inlineSvgs += 1;
          if (rank <= RANK.footerLogo) colorsInSvg(svg.toString('utf8'), scan.colors.brand);
        }
      }

      index = end - 1;
      continue;
    }

    switch (name) {
      case 'meta':
        readMeta(attrs, scan);
        break;
      case 'link':
        readLink(attrs, scan);
        break;
      case 'title':
        titleParts ??= [];
        break;
      case 'body': {
        // A body that starts while the head is still open closes it.
        popTo('head');
        const ground = attrs.bgcolor ? parseCssColor(attrs.bgcolor) : null;
        const ink = attrs.text ? parseCssColor(attrs.text) : null;
        if (ground) addColor(scan.colors.ground, ground, WEIGHT.page);
        if (ink) addColor(scan.colors.ink, ink, WEIGHT.page);
        break;
      }
      case 'img': {
        const source = imageSource(attrs);
        const rank = source ? rankFor(name, attrs) : null;
        if (source && rank !== null) keep(source, rank);
        break;
      }
    }

    if (!token.selfClosing) push(name, attrs);
  }

  if (titleParts) scan.title = collapse(decodeEntities(titleParts.join(' '))) || null;
  scan.isShell = runsScripts && visibleText < SHELL_TEXT_LENGTH;

  return scan;
}

function readMeta(attrs: Record<string, string>, scan: PageScan): void {
  const key = (attrs.property || attrs.name || attrs.itemprop || '').trim().toLowerCase();
  const content = attrs.content ? collapse(attrs.content) : '';
  if (!key || !content) return;

  // Every theme colour counts (sites declare one per colour scheme); only the
  // first of each name is kept as text.
  if (key === 'theme-color') addCssColor(content, WEIGHT.themeColor, scan.colors.brand);
  if (key === 'msapplication-tilecolor') {
    addCssColor(content, WEIGHT.tileColor, scan.colors.brand);
  }

  if (!scan.metas.has(key)) scan.metas.set(key, content.slice(0, 1_000));
}

function readLink(attrs: Record<string, string>, scan: PageScan): void {
  const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const href = attrs.href?.trim();
  if (!href || rel.length === 0) return;

  if (rel.includes('stylesheet')) {
    if (
      !rel.includes('alternate') &&
      scan.stylesheets.length < MAX_STYLESHEET_LINKS &&
      !scan.stylesheets.includes(href)
    ) {
      scan.stylesheets.push(href);
    }
    return;
  }

  if (rel.includes('manifest')) {
    scan.manifest ??= href;
    return;
  }

  if (scan.icons.length >= MAX_ICONS) return;

  if (rel.includes('mask-icon')) {
    scan.icons.push({ href, size: 0, kind: 'mask' });
    if (attrs.color) addCssColor(attrs.color, WEIGHT.maskIcon, scan.colors.brand);
  } else if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
    // Apple's own default touch icon size, when a site does not say.
    scan.icons.push({ href, size: declaredSize(attrs.sizes) ?? 180, kind: 'touch' });
  } else if (rel.includes('icon')) {
    const vector =
      (attrs.type ?? '').toLowerCase().includes('svg') || /\.svg(?:[?#]|$)/i.test(href);
    scan.icons.push({
      href,
      size: declaredSize(attrs.sizes) ?? (vector ? VECTOR_ICON : ICON_EDGE),
      kind: 'icon',
    });
  }
}

/** `sizes="16x16 32x32"` is 32; `sizes="any"` is a vector. */
function declaredSize(sizes: string | undefined): number | null {
  if (!sizes) return null;

  let largest: number | null = null;

  for (const size of sizes.toLowerCase().split(/\s+/).slice(0, 12)) {
    const match = /^(\d{1,5})x(\d{1,5})$/.exec(size);
    const edge =
      size === 'any' ? VECTOR_ICON : match ? Math.max(Number(match[1]), Number(match[2])) : null;
    if (edge !== null && (largest === null || edge > largest)) largest = edge;
  }

  return largest;
}

/** The edge a picture declares in its own attributes, or Infinity when it does not say. */
function declaredEdge(attrs: Record<string, string>): number {
  const width = Number.parseFloat(attrs.width ?? '');
  const height = Number.parseFloat(attrs.height ?? '');
  if (Number.isFinite(width) && Number.isFinite(height)) return Math.max(width, height);

  const viewBox = attrs.viewbox?.trim();
  if (!viewBox) return Number.POSITIVE_INFINITY;

  const box = viewBox.split(/[\s,]+/).map(Number);
  if (box.length === 4 && box.every(Number.isFinite)) return Math.max(box[2], box[3]);

  return Number.POSITIVE_INFINITY;
}

/** The best address an `<img>` offers: the largest `srcset` entry, then `src`, then a lazy loader's. */
function imageSource(attrs: Record<string, string>): PictureSource | null {
  const href = largestFromSrcset(attrs.srcset) ?? (attrs.src?.trim() || attrs['data-src']?.trim());
  if (!href) return null;

  return href.slice(0, 5).toLowerCase() === 'data:'
    ? { kind: 'data', uri: href }
    : { kind: 'url', href };
}

function largestFromSrcset(srcset: string | undefined): string | null {
  if (!srcset) return null;

  let best: { url: string; size: number } | null = null;

  for (const entry of srcset.split(',').slice(0, 20)) {
    const [url, descriptor = '1x'] = entry.trim().split(/\s+/);
    if (!url || url.slice(0, 5).toLowerCase() === 'data:') continue;

    const size = Number.parseFloat(descriptor) || 1;
    if (!best || size > best.size) best = { url, size };
  }

  return best?.url ?? null;
}

function hintsLogo(name: string, attrs: Record<string, string>): boolean {
  if (name === 'a' && HOME_HREF.test((attrs.href ?? '').trim().slice(0, MAX_URL_LENGTH))) {
    return true;
  }

  const src = attrs.src && attrs.src.slice(0, 5).toLowerCase() !== 'data:' ? attrs.src : '';
  const hint = [attrs.class, attrs.id, attrs['aria-label'], attrs.alt, attrs.title, src]
    .map((value) => (value ?? '').slice(0, HINT_LENGTH))
    .join(' ');

  return LOGO_HINT.test(hint);
}

function regionOf(
  name: string,
  attrs: Record<string, string>,
  inside: (name: string) => boolean,
): OpenElement['region'] {
  // A <header>, <nav> or <footer> inside an article or the main content is
  // that section's own, not the site's.
  if (inside('main') || inside('article') || inside('aside')) return null;

  if (name === 'footer' || attrs.role === 'contentinfo') return 'footer';
  if (inside('footer')) return null;
  if (name === 'header' || name === 'nav' || attrs.role === 'banner') return 'header';
  if (name !== 'div') return null;

  const hint = `${(attrs.class ?? '').slice(0, HINT_LENGTH)} ${(attrs.id ?? '').slice(0, HINT_LENGTH)}`;
  return HEADER_HINT.test(hint) ? 'header' : null;
}

// ---------------------------------------------------------------------------
// Inline SVG
// ---------------------------------------------------------------------------

/**
 * Start tags that make the HTML parser leave an SVG, whether or not it was
 * closed (the "breakout" list in the HTML standard). Without them, one
 * unclosed `<svg>` would swallow the rest of the page.
 */
const SVG_BREAKOUT = new Set([
  'b',
  'big',
  'blockquote',
  'body',
  'br',
  'center',
  'code',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'hr',
  'i',
  'img',
  'li',
  'listing',
  'menu',
  'meta',
  'nobr',
  'ol',
  'p',
  'pre',
  'ruby',
  's',
  'small',
  'span',
  'strong',
  'strike',
  'sub',
  'sup',
  'table',
  'tt',
  'u',
  'ul',
  'var',
]);

/** The token index just past an SVG that starts at `start`. */
function svgEnd(tokens: HtmlToken[], start: number): number {
  let depth = 0;
  let foreign = 0;

  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === 'open') {
      if (token.name === 'svg' && !token.selfClosing) depth += 1;
      else if (token.name === 'foreignobject' && !token.selfClosing) foreign += 1;
      else if (foreign === 0 && SVG_BREAKOUT.has(token.name)) return index;
    } else if (token.type === 'close') {
      if (token.name === 'foreignobject' && foreign > 0) foreign -= 1;
      if (token.name === 'svg') {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
    }
  }

  return tokens.length;
}

/**
 * HTML lower-cases every name; SVG is case-sensitive. These are the names
 * the HTML standard puts back ("adjust SVG tag names" and "adjust SVG
 * attributes"), so `viewbox` becomes `viewBox` again and a gradient keeps
 * working once the SVG stands on its own.
 */
const SVG_TAG_NAMES: Record<string, string> = {
  altglyph: 'altGlyph',
  altglyphdef: 'altGlyphDef',
  altglyphitem: 'altGlyphItem',
  animatecolor: 'animateColor',
  animatemotion: 'animateMotion',
  animatetransform: 'animateTransform',
  clippath: 'clipPath',
  feblend: 'feBlend',
  fecolormatrix: 'feColorMatrix',
  fecomponenttransfer: 'feComponentTransfer',
  fecomposite: 'feComposite',
  feconvolvematrix: 'feConvolveMatrix',
  fediffuselighting: 'feDiffuseLighting',
  fedisplacementmap: 'feDisplacementMap',
  fedistantlight: 'feDistantLight',
  fedropshadow: 'feDropShadow',
  feflood: 'feFlood',
  fefunca: 'feFuncA',
  fefuncb: 'feFuncB',
  fefuncg: 'feFuncG',
  fefuncr: 'feFuncR',
  fegaussianblur: 'feGaussianBlur',
  feimage: 'feImage',
  femerge: 'feMerge',
  femergenode: 'feMergeNode',
  femorphology: 'feMorphology',
  feoffset: 'feOffset',
  fepointlight: 'fePointLight',
  fespecularlighting: 'feSpecularLighting',
  fespotlight: 'feSpotLight',
  fetile: 'feTile',
  feturbulence: 'feTurbulence',
  foreignobject: 'foreignObject',
  glyphref: 'glyphRef',
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  textpath: 'textPath',
};

const SVG_ATTRIBUTE_NAMES: Record<string, string> = {
  attributename: 'attributeName',
  attributetype: 'attributeType',
  basefrequency: 'baseFrequency',
  baseprofile: 'baseProfile',
  calcmode: 'calcMode',
  clippathunits: 'clipPathUnits',
  diffuseconstant: 'diffuseConstant',
  edgemode: 'edgeMode',
  filterunits: 'filterUnits',
  glyphref: 'glyphRef',
  gradienttransform: 'gradientTransform',
  gradientunits: 'gradientUnits',
  kernelmatrix: 'kernelMatrix',
  kernelunitlength: 'kernelUnitLength',
  keypoints: 'keyPoints',
  keysplines: 'keySplines',
  keytimes: 'keyTimes',
  lengthadjust: 'lengthAdjust',
  limitingconeangle: 'limitingConeAngle',
  markerheight: 'markerHeight',
  markerunits: 'markerUnits',
  markerwidth: 'markerWidth',
  maskcontentunits: 'maskContentUnits',
  maskunits: 'maskUnits',
  numoctaves: 'numOctaves',
  pathlength: 'pathLength',
  patterncontentunits: 'patternContentUnits',
  patterntransform: 'patternTransform',
  patternunits: 'patternUnits',
  pointsatx: 'pointsAtX',
  pointsaty: 'pointsAtY',
  pointsatz: 'pointsAtZ',
  preservealpha: 'preserveAlpha',
  preserveaspectratio: 'preserveAspectRatio',
  primitiveunits: 'primitiveUnits',
  refx: 'refX',
  refy: 'refY',
  repeatcount: 'repeatCount',
  repeatdur: 'repeatDur',
  requiredextensions: 'requiredExtensions',
  requiredfeatures: 'requiredFeatures',
  specularconstant: 'specularConstant',
  specularexponent: 'specularExponent',
  spreadmethod: 'spreadMethod',
  startoffset: 'startOffset',
  stddeviation: 'stdDeviation',
  stitchtiles: 'stitchTiles',
  surfacescale: 'surfaceScale',
  systemlanguage: 'systemLanguage',
  tablevalues: 'tableValues',
  targetx: 'targetX',
  targety: 'targetY',
  textlength: 'textLength',
  viewbox: 'viewBox',
  viewtarget: 'viewTarget',
  xchannelselector: 'xChannelSelector',
  ychannelselector: 'yChannelSelector',
  zoomandpan: 'zoomAndPan',
};

const XML_NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

// Hoisted so the suppression stays on the line it applies to.
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are the characters XML 1.0 cannot carry, which is why they are removed
const XML_INVALID = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;

/**
 * Writes the SVG between `start` and `end` out as a standalone file.
 *
 * Inline SVG is HTML, not XML: names lower-cased, entities XML does not
 * know, attributes without quotes, a namespace left implied. Rather than
 * cutting the original text out of the page, the tokens are written back as
 * well-formed XML this file controls, so the result is what the browser drew
 * and what librsvg can read. It is then held to the same `isSafeSvg` check
 * an uploaded logo is: nothing is stripped to make an unsafe SVG pass.
 *
 * Returns null for a drawing too large or too deeply nested to be a logo.
 */
export function serializeSvg(tokens: HtmlToken[], start: number, end: number): Buffer | null {
  const root = tokens[start];
  if (root?.type !== 'open' || root.name !== 'svg') return null;

  const declared = new Set(['xml', 'xmlns', 'xlink']);
  for (const name of Object.keys(root.attrs)) {
    if (name.startsWith('xmlns:')) declared.add(name.slice('xmlns:'.length));
  }

  const usage = { xlink: false };
  const stack: string[] = [];
  let body = '';
  let skipDepth = 0;

  for (let index = start + 1; index < end; index += 1) {
    const token = tokens[index];

    if (token.type === 'open') {
      const name = SVG_TAG_NAMES[token.name] ?? token.name;

      // An element in a namespace the SVG never declared (editor metadata,
      // usually) cannot be written as valid XML; it and its children go.
      if (skipDepth > 0 || !validName(name, declared)) {
        if (!token.selfClosing) skipDepth += 1;
        continue;
      }

      body += `<${name}${serializeAttributes(token.attrs, declared, usage)}`;
      if (token.selfClosing) {
        body += '/>';
      } else {
        if (stack.length >= MAX_SVG_DEPTH) return null;
        body += '>';
        stack.push(name);
      }
    } else if (token.type === 'close') {
      if (skipDepth > 0) {
        skipDepth -= 1;
        continue;
      }

      const at = stack.lastIndexOf(SVG_TAG_NAMES[token.name] ?? token.name);
      if (at === -1) continue;

      while (stack.length > at) body += `</${stack.pop()}>`;
    } else if (skipDepth === 0) {
      if (token.type === 'text') {
        body += escapeXml(decodeEntities(token.text));
      } else {
        const content = token.content.replaceAll(']]>', ']]]]><![CDATA[>');
        const attributes = serializeAttributes(token.attrs, declared, usage);
        body += `<${token.name}${attributes}><![CDATA[${content}]]></${token.name}>`;
      }
    }

    if (body.length > MAX_SVG_BYTES) return null;
  }

  while (stack.length > 0) body += `</${stack.pop()}>`;

  const attributes = serializeAttributes(root.attrs, declared, usage);
  const xlink = usage.xlink ? ` xmlns:xlink="${XLINK_NAMESPACE}"` : '';
  const svg = `<svg xmlns="${SVG_NAMESPACE}"${xlink}${attributes}>${body}</svg>`;

  return svg.length > MAX_SVG_BYTES ? null : Buffer.from(svg, 'utf8');
}

function validName(name: string, declared: Set<string>): boolean {
  if (!XML_NAME.test(name)) return false;

  const colon = name.indexOf(':');
  return colon === -1 || declared.has(name.slice(0, colon));
}

function serializeAttributes(
  attrs: Record<string, string>,
  declared: Set<string>,
  usage: { xlink: boolean },
): string {
  let out = '';

  for (const [raw, value] of Object.entries(attrs)) {
    // `serializeSvg` writes both namespaces itself, with the right URIs,
    // whatever the page wrote.
    if (raw === 'xmlns' || raw === 'xmlns:xlink') continue;

    const name = SVG_ATTRIBUTE_NAMES[raw] ?? raw;
    if (!validName(name, declared)) continue;
    if (name.startsWith('xlink:')) usage.xlink = true;

    out += ` ${name}="${escapeXml(value).replace(/"/g, '&quot;')}"`;
  }

  return out;
}

/** XML's special characters escaped, and the characters XML 1.0 cannot carry removed. */
function escapeXml(text: string): string {
  return text
    .replace(XML_INVALID, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Each colour a logo is drawn in counts once: fifty paths of one blue are one blue. */
function colorsInSvg(svg: string, tally: ColorTally): void {
  const own: ColorTally = new Map();
  colorsInText(svg, 1, own);

  for (const hex of own.keys()) addColor(tally, hex, WEIGHT.logo);
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const NUMBER = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
/** A comma (legacy syntax) or whitespace (modern syntax) between channels. */
const SEPARATOR = String.raw`(?:\s*,\s*|\s+)`;

const HEX_COLOR = /#([0-9a-f]{3,8})\b/gi;
const RGB_COLOR = new RegExp(
  String.raw`rgba?\(\s*(${NUMBER})(%?)${SEPARATOR}(${NUMBER})(%?)${SEPARATOR}(${NUMBER})(%?)`,
  'gi',
);
const HSL_COLOR = new RegExp(
  String.raw`hsla?\(\s*(-?${NUMBER})(deg|turn|rad|grad)?${SEPARATOR}(${NUMBER})%${SEPARATOR}(${NUMBER})%`,
  'gi',
);
/** Tailwind 4's palette, as minifiers write it: `oklch(62.3% .214 259.815)`. */
const OKLCH_COLOR = new RegExp(
  String.raw`oklch\(\s*(${NUMBER})(%?)\s+(${NUMBER})(%?)\s+(-?${NUMBER})(deg)?`,
  'gi',
);
/** shadcn/ui's custom properties hold a bare HSL triple: `--primary: 222.2 47.4% 11.2%`. */
const BARE_HSL = new RegExp(
  String.raw`^\s*(-?${NUMBER})(?:deg)?\s+(${NUMBER})%\s+(${NUMBER})%\s*$`,
);
const MAX_BARE_HSL_LENGTH = 60;

function bareHsl(value: string): string | null {
  if (value.length > MAX_BARE_HSL_LENGTH) return null;

  const triple = BARE_HSL.exec(value);
  return triple ? hslToHex(Number(triple[1]), Number(triple[2]), Number(triple[3])) : null;
}

function addColor(tally: ColorTally, hex: string, weight: number): void {
  tally.set(hex, (tally.get(hex) ?? 0) + weight);
}

/** Adds the first colour a CSS value holds. */
function addCssColor(value: string, weight: number, tally: ColorTally): void {
  const hex = parseCssColor(value);
  if (hex) addColor(tally, hex, weight);
}

/** The two named colours a page background or text is commonly written as. */
const NAMED_COLORS: Record<string, string> = { white: '#FFFFFF', black: '#000000' };

/**
 * One CSS colour value as `#RRGGBB`: hex, `rgb()`, `hsl()`, `oklch()`, or
 * white or black by name. Null for anything else.
 */
export function parseCssColor(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > 120) return null;

  const named = NAMED_COLORS[text.toLowerCase().replace(/\s*!important$/, '')];
  if (named) return named;

  const found: ColorTally = new Map();
  colorsInText(text, 1, found);

  const [first] = found.keys();
  return first ?? null;
}

/**
 * Adds every colour written anywhere in `text` to the tally at `weight`, and
 * says how many it found.
 */
function colorsInText(text: string, weight: number, tally: ColorTally): number {
  let found = 0;

  const add = (hex: string | null) => {
    if (!hex) return;
    addColor(tally, hex, weight);
    found += 1;
  };

  for (const match of text.matchAll(HEX_COLOR)) {
    const digits = match[1];
    // #RGBA and #RRGGBBAA carry an alpha the brand colour does not need.
    const solid =
      digits.length === 3 || digits.length === 6
        ? digits
        : digits.length === 4 || digits.length === 8
          ? digits.slice(0, (digits.length * 3) / 4)
          : null;
    add(solid ? normalizeHex(solid) : null);
  }

  for (const match of text.matchAll(RGB_COLOR)) {
    const channels = [1, 3, 5].map((at) =>
      match[at + 1] === '%' ? Number(match[at]) * 2.55 : Number(match[at]),
    );
    if (channels.some((value) => !Number.isFinite(value) || value > 255)) continue;

    add(rgbToHex({ r: channels[0], g: channels[1], b: channels[2] }));
  }

  for (const match of text.matchAll(HSL_COLOR)) {
    add(hslToHex(hueDegrees(Number(match[1]), match[2]), Number(match[3]), Number(match[4])));
  }

  for (const match of text.matchAll(OKLCH_COLOR)) {
    const lightness = Number(match[1]) / (match[2] === '%' ? 100 : 1);
    const chroma = match[4] === '%' ? (Number(match[3]) / 100) * 0.4 : Number(match[3]);
    add(oklchToHex(lightness, chroma, Number(match[5])));
  }

  return found;
}

function hueDegrees(value: number, unit: string | undefined): number {
  switch (unit) {
    case 'turn':
      return value * 360;
    case 'rad':
      return (value * 180) / Math.PI;
    case 'grad':
      return value * 0.9;
    default:
      return value;
  }
}

/** `hsl(h s% l%)` as hex, with `s` and `l` given as the percentages CSS writes. */
export function hslToHex(
  hue: number,
  saturationPercent: number,
  lightnessPercent: number,
): string | null {
  if (![hue, saturationPercent, lightnessPercent].every(Number.isFinite)) return null;

  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, saturationPercent / 100));
  const l = Math.min(1, Math.max(0, lightnessPercent / 100));

  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const second = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const offset = l - chroma / 2;
  const sector = Math.floor(h / 60);
  const [r, g, b] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ][sector] ?? [0, 0, 0];

  return rgbToHex({ r: (r + offset) * 255, g: (g + offset) * 255, b: (b + offset) * 255 });
}

/**
 * `oklch(L C H)` as hex, through OKLab and linear sRGB (Bjorn Ottosson's
 * published matrices). A colour outside sRGB is clipped per channel, which
 * is close enough for a swatch the user can still adjust.
 */
export function oklchToHex(lightness: number, chroma: number, hue: number): string | null {
  if (![lightness, chroma, hue].every(Number.isFinite)) return null;

  const L = Math.min(1, Math.max(0, lightness));
  const C = Math.max(0, chroma);
  const radians = (hue * Math.PI) / 180;
  const a = C * Math.cos(radians);
  const b = C * Math.sin(radians);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const encode = (linear: number) => {
    const value = Math.min(1, Math.max(0, linear));
    return 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
  };

  return rgbToHex({
    r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  });
}

/** Comments go first: a commented-out colour is not one the site uses. */
function stripCssComments(css: string): string {
  let out = '';
  let from = 0;

  while (from < css.length) {
    const start = css.indexOf('/*', from);
    if (start === -1) {
      out += css.slice(from);
      break;
    }

    out += `${css.slice(from, start)} `;
    const end = css.indexOf('*/', start + 2);
    if (end === -1) break;
    from = end + 2;
  }

  return out;
}

/**
 * Tallies the colours in a stylesheet, weighted by what they are for.
 *
 * Read by cutting on braces rather than with a rule-matching pattern: every
 * `}` ends a rule, and within what comes before it the last `{` separates the
 * selector from the declarations. Linear in the size of the sheet, and
 * nested at-rules come out right. A custom property whose name says "brand"
 * is worth far more than the twentieth grey in a reset stylesheet; a button's
 * or a link's colour is worth more than a border's.
 */
export function colorsFromCss(
  css: string,
  evidence: ColorEvidence = emptyEvidence(),
): ColorEvidence {
  for (const chunk of stripCssComments(css).split('}')) {
    const open = chunk.lastIndexOf('{');
    if (open === -1) continue;

    const start =
      open > 0 ? Math.max(chunk.lastIndexOf('{', open - 1), chunk.lastIndexOf(';', open - 1)) : -1;
    const selector = chunk.slice(start + 1, open).slice(0, 2_000);
    const ruleWeight = BRAND_SELECTOR.test(selector) ? WEIGHT.brandRule : WEIGHT.rule;
    const page = selector
      .split(',')
      .slice(0, 20)
      .some((part) => PAGE_SELECTOR.test(part.trim()));

    colorsFromDeclarations(chunk.slice(open + 1), ruleWeight, page, evidence);
  }

  return evidence;
}

/**
 * The declarations of one rule or one `style` attribute.
 *
 * Every colour counts towards the brand at the rule's weight (far more for a
 * custom property whose name says brand). A background or text colour set on
 * the page itself, or a custom property that names one, is counted as the
 * page's background or text as well, so the review screen can suggest those
 * two roles too.
 */
function colorsFromDeclarations(
  text: string,
  ruleWeight: number,
  page: boolean,
  evidence: ColorEvidence,
): void {
  for (const declaration of text.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;

    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1);
    const custom = property.startsWith('--');
    const brand = custom && BRAND_PROPERTY.test(property);
    const weight = brand ? WEIGHT.brandProperty : ruleWeight;

    // shadcn's bare triple only counts where a colour is expected.
    if (colorsInText(value, weight, evidence.brand) === 0 && brand) {
      const hex = bareHsl(value);
      if (hex) addColor(evidence.brand, hex, weight);
    }

    const ground = custom
      ? GROUND_PROPERTY.test(property)
      : page && (property === 'background' || property === 'background-color');
    const ink = custom ? INK_PROPERTY.test(property) : page && property === 'color';
    if (!ground && !ink) continue;

    const hex = parseCssColor(value) ?? bareHsl(value);
    const role = ground ? evidence.ground : evidence.ink;
    if (hex) addColor(role, hex, page ? WEIGHT.page : WEIGHT.variant);
  }
}

/** Under this, text is unreadable at any size. AA for large text. */
const LARGE_TEXT_CONTRAST = 3;

/**
 * Ranks the colours found and suggests a role for each.
 *
 * Brand colours first: the greys and the near-black and near-white tints
 * dropped, near-duplicates merged, the heaviest suggested as Primary, then
 * Accent, then Secondary. Then the page's own background, and a text colour
 * readable on it, when the site declares them and they are not already in
 * the list.
 *
 * The role suggestions are the part most likely to be wrong, which is why
 * every one of them is a choice on the review screen. The ranking itself is
 * the reliable part: a declared `theme-color` and a custom property called
 * `--brand` are what a site says about itself, and they outweigh the twentieth
 * grey in a reset stylesheet by design.
 */
export function rankColors(evidence: ColorEvidence): ColorCandidate[] {
  const ranked = byWeight(evidence.brand).filter(([hex]) => {
    const light = lightnessOf(hex);
    return saturation(hex) >= MIN_SATURATION && light >= MIN_LIGHTNESS && light <= MAX_LIGHTNESS;
  });

  const merged: Array<{ hex: string; weight: number }> = [];

  for (const [hex, weight] of ranked) {
    const near = merged.find((kept) => colorDistance(kept.hex, hex) < MERGE_DISTANCE);
    if (near) near.weight += weight;
    else if (merged.length < MAX_BRAND_COLORS) merged.push({ hex, weight });
  }

  // Merging can lift a later colour above an earlier one.
  merged.sort((a, b) => b.weight - a.weight);

  const candidates: ColorCandidate[] = merged.map((candidate, index) => ({
    hex: candidate.hex,
    suggestedRole: roleFor(index),
    weight: candidate.weight,
  }));
  const distinct = (hex: string) =>
    candidates.every((kept) => colorDistance(kept.hex, hex) >= MERGE_DISTANCE);

  const [ground] = byWeight(evidence.ground);
  if (ground && distinct(ground[0])) {
    candidates.push({ hex: ground[0], suggestedRole: 'background', weight: ground[1] });
  }

  // Text has to be readable on that background; on a page that declares
  // none, on the browser's white.
  const paper = ground?.[0] ?? '#FFFFFF';
  const inks = byWeight(evidence.ink);
  const ink =
    inks.find(([hex]) => contrastRatio(hex, paper) >= AA_CONTRAST) ??
    inks.find(([hex]) => contrastRatio(hex, paper) >= LARGE_TEXT_CONTRAST);
  if (ink && distinct(ink[0])) {
    candidates.push({ hex: ink[0], suggestedRole: 'text', weight: ink[1] });
  }

  return candidates.slice(0, MAX_COLOR_CANDIDATES);
}

/** Heaviest first; ties keep the order the colours were first seen in. */
function byWeight(tally: ColorTally): Array<[string, number]> {
  return [...tally.entries()].sort((a, b) => b[1] - a[1]);
}

/** HSL lightness, 0 to 1. */
function lightnessOf(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;

  return (Math.max(rgb.r, rgb.g, rgb.b) + Math.min(rgb.r, rgb.g, rgb.b)) / 510;
}

function roleFor(index: number): keyof BrandColors {
  const order: Array<keyof BrandColors> = ['primary', 'accent', 'secondary'];
  return order[index] ?? 'secondary';
}

// ---------------------------------------------------------------------------
// Stylesheets and the manifest
// ---------------------------------------------------------------------------

async function readStylesheets(
  hrefs: string[],
  base: string,
  deps: ExtractDeps,
  clock: Clock,
): Promise<string[]> {
  if (clock.remaining() < 1_000) return [];

  const host = hostOf(base);
  const urls = [...new Set(hrefs.map((href) => resolve(href, base)))].filter(
    (url): url is string => url !== null,
  );
  // The site's own stylesheets first: a cookie banner's CDN has colours too.
  urls.sort((a, b) => Number(hostOf(b) === host) - Number(hostOf(a) === host));

  const sheets = await Promise.all(
    urls.slice(0, MAX_STYLESHEETS).map(async (url) => {
      try {
        const response = await deps.fetchPage(url, {
          signal: clock.signal,
          timeoutMs: Math.max(1, Math.min(ASSET_TIMEOUT_MS, clock.remaining())),
          maxBytes: MAX_STYLESHEET_BYTES,
          requireHtml: false,
          accept: 'text/css,*/*;q=0.1',
        });
        return response.body;
      } catch (error) {
        // A stylesheet that will not load costs the user nothing: the colour
        // pickers on the review screen are the fallback for everything here.
        deps.logger?.warn(`studio.extract.stylesheet_failed ${describe(error)}`);
        return null;
      }
    }),
  );

  return sheets.filter((sheet): sheet is string => sheet !== null);
}

export interface ManifestInfo {
  name: string | null;
  description: string | null;
  themeColor: string | null;
  backgroundColor: string | null;
  /** Already absolute: a manifest's icons resolve against the manifest, not the page. */
  icons: IconLink[];
}

async function readManifest(
  href: string | null,
  base: string,
  deps: ExtractDeps,
  clock: Clock,
): Promise<ManifestInfo | null> {
  const url = href ? resolve(href, base) : null;
  if (!url || clock.remaining() < 1_000) return null;

  try {
    const response = await deps.fetchPage(url, {
      signal: clock.signal,
      timeoutMs: Math.max(1, Math.min(ASSET_TIMEOUT_MS, clock.remaining())),
      maxBytes: MAX_MANIFEST_BYTES,
      requireHtml: false,
      accept: 'application/manifest+json,application/json;q=0.9,*/*;q=0.1',
    });
    return manifestFrom(response.body, response.finalUrl);
  } catch (error) {
    deps.logger?.warn(`studio.extract.manifest_failed ${describe(error)}`);
    return null;
  }
}

/** A web app manifest's name, colours and icons, or null when it is not one. */
export function manifestFrom(text: string, manifestUrl: string): ManifestInfo | null {
  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const record = data as Record<string, unknown>;
  const icons: IconLink[] = [];
  const listed = Array.isArray(record.icons) ? record.icons.slice(0, MAX_MANIFEST_ICONS) : [];

  for (const icon of listed) {
    if (!icon || typeof icon !== 'object') continue;

    const { src, sizes, type, purpose } = icon as Record<string, unknown>;
    if (typeof src !== 'string') continue;

    // A monochrome icon is a silhouette for the system to tint, not a logo.
    const purposes = typeof purpose === 'string' ? purpose.toLowerCase().split(/\s+/) : [];
    if (purposes.length > 0 && purposes.every((value) => value === 'monochrome')) continue;

    const href = resolve(src, manifestUrl);
    if (!href) continue;

    const vector = typeof type === 'string' && type.toLowerCase().includes('svg');
    const declared = declaredSize(typeof sizes === 'string' ? sizes : undefined);
    icons.push({ href, size: declared ?? (vector ? VECTOR_ICON : 0), kind: 'icon' });
  }

  return {
    name: textOf(record.name, MAX_NAME_LENGTH) ?? textOf(record.short_name, MAX_NAME_LENGTH),
    description: textOf(record.description, MAX_DESCRIPTION_LENGTH),
    themeColor: typeof record.theme_color === 'string' ? parseCssColor(record.theme_color) : null,
    backgroundColor:
      typeof record.background_color === 'string' ? parseCssColor(record.background_color) : null,
    icons,
  };
}

// ---------------------------------------------------------------------------
// Logos
// ---------------------------------------------------------------------------

type LogoSource =
  | { kind: 'svg'; svg: Buffer; sourceUrl: string }
  | { kind: 'data'; uri: string; sourceUrl: string }
  | { kind: 'url'; url: string };

/** Every place a logo might be, best first, with no address twice. */
function logoSources(scan: PageScan, manifest: ManifestInfo | null, base: string): LogoSource[] {
  const ranked: Array<{ rank: number; size: number; source: LogoSource }> = [];

  for (const { source, rank } of scan.pictures) {
    if (source.kind === 'svg') {
      ranked.push({ rank, size: 0, source: { ...source, sourceUrl: `${base}#inline-svg` } });
    } else if (source.kind === 'data') {
      ranked.push({ rank, size: 0, source: { ...source, sourceUrl: `${base}#inline-image` } });
    } else {
      const url = resolve(source.href, base);
      if (url) ranked.push({ rank, size: 0, source: { kind: 'url', url } });
    }
  }

  const icons = [
    ...scan.icons.map((icon) => ({ ...icon, href: resolve(icon.href, base) })),
    ...(manifest?.icons ?? []),
  ];

  for (const icon of icons) {
    if (!icon.href) continue;

    const large = icon.kind !== 'mask' && icon.size >= LARGE_ICON;
    ranked.push({
      rank: large ? RANK.largeIcon : RANK.smallIcon,
      // A touch icon outranks a plain icon of the same size: it is drawn to be seen.
      size: icon.size + (icon.kind === 'touch' ? 0.5 : 0),
      source: { kind: 'url', url: icon.href },
    });
  }

  for (const key of ['og:image', 'og:image:secure_url', 'og:image:url', 'twitter:image']) {
    const value = scan.metas.get(key);
    const url = value ? resolve(value, base) : null;
    if (url) ranked.push({ rank: RANK.socialImage, size: 0, source: { kind: 'url', url } });
  }

  ranked.sort((a, b) => a.rank - b.rank || b.size - a.size);

  const seen = new Set<string>();
  const sources: LogoSource[] = [];

  for (const { source } of ranked) {
    if (source.kind === 'url') {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
    }
    sources.push(source);
  }

  return sources;
}

/**
 * Turns the sources into candidates, best first, a few downloads at a time,
 * until there are enough or the deadline is close.
 */
async function readLogos(
  sources: LogoSource[],
  deps: ExtractDeps,
  clock: Clock,
): Promise<LogoCandidate[]> {
  const accepted: LogoCandidate[] = [];
  let inline = 0;
  let next = 0;

  while (
    next < sources.length &&
    accepted.length < MAX_LOGO_CANDIDATES &&
    clock.remaining() >= ASSET_MIN_REMAINING_MS
  ) {
    const batch = sources.slice(next, next + LOGO_DOWNLOADS_AT_ONCE);
    next += batch.length;

    const candidates = await Promise.all(batch.map((source) => candidateFrom(source, deps, clock)));

    for (const [at, candidate] of candidates.entries()) {
      if (!candidate || accepted.length >= MAX_LOGO_CANDIDATES) continue;
      if (accepted.some((kept) => kept.preview === candidate.preview)) continue;

      if (batch[at].kind === 'svg') {
        if (inline >= MAX_INLINE_SVGS) continue;
        inline += 1;
      }

      accepted.push(candidate);
    }
  }

  return accepted;
}

async function candidateFrom(
  source: LogoSource,
  deps: ExtractDeps,
  clock: Clock,
): Promise<LogoCandidate | null> {
  try {
    if (source.kind === 'svg') {
      return await toCandidate(source.svg, source.sourceUrl, 'image/svg+xml');
    }

    if (source.kind === 'data') {
      const bytes = decodeDataUri(source.uri);
      return bytes ? await toCandidate(bytes, source.sourceUrl, null) : null;
    }

    const response = await deps.fetchAsset(source.url, {
      signal: clock.signal,
      timeoutMs: Math.max(1, Math.min(ASSET_TIMEOUT_MS, clock.remaining())),
      maxBytes: MAX_CANDIDATE_BYTES,
      // No `image/*`: a server that negotiates would answer with AVIF, which
      // a logo cannot be.
      accept: 'image/webp,image/png,image/jpeg,image/svg+xml;q=0.9,*/*;q=0.1',
    });

    return await toCandidate(response.body, source.url, response.contentType);
  } catch (error) {
    deps.logger?.warn(`studio.extract.logo_failed ${describe(error)}`);
    return null;
  }
}

/**
 * Turns bytes into a candidate, or refuses them.
 *
 * The type is decided by sniffing, never by the server's content type: a site
 * that serves an HTML error page labelled `image/png` would otherwise put
 * markup into a `data:` URI the review screen renders. Only what the logo
 * upload accepts is offered (PNG, JPG, WebP, and SVG that passes the upload's
 * own safety check, readable by the same library), so whatever the user
 * picks can be saved.
 */
export async function toCandidate(
  bytes: Buffer,
  sourceUrl: string,
  contentType: string | null,
): Promise<LogoCandidate | null> {
  if (bytes.length === 0 || bytes.length > MAX_CANDIDATE_BYTES) return null;

  const sniffed = sniffMedia(bytes.subarray(0, SNIFF_BYTES));
  let mimeType: string;

  if (sniffed?.kind === 'image') {
    if (!LOGO_RASTER_TYPES.has(sniffed.mimeType)) return null;
    mimeType = sniffed.mimeType;
  } else if (sniffed === null && !/html/i.test(contentType ?? '') && isSafeSvg(bytes)) {
    mimeType = 'image/svg+xml';
  } else {
    return null;
  }

  const size = await measure(bytes);
  if (!size) return null;

  // A 16 or 32 px favicon is not a logo anyone wants on a slide.
  const vector = mimeType === 'image/svg+xml';
  if (!vector && size.width < MIN_LOGO_EDGE && size.height < MIN_LOGO_EDGE) return null;

  return {
    preview: `data:${mimeType};base64,${bytes.toString('base64')}`,
    sourceUrl,
    width: size.width,
    height: size.height,
    mimeType,
    bytes: bytes.length,
  };
}

async function measure(bytes: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const { width, height } = await sharp(bytes, { limitInputPixels: 64_000_000 }).metadata();
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

const DATA_URI = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?((?:;[a-z0-9-]+=[^;,]*)*)(;base64)?,/i;

/** The bytes of a `data:` URI an `<img>` carries, small enough to be a candidate. */
export function decodeDataUri(uri: string): Buffer | null {
  if (uri.length > MAX_CANDIDATE_BYTES * 2) return null;

  const header = DATA_URI.exec(uri.slice(0, 512));
  if (!header) return null;

  const payload = uri.slice(header[0].length);

  try {
    const bytes = header[3]
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    return bytes.length > 0 && bytes.length <= MAX_CANDIDATE_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Name and description
// ---------------------------------------------------------------------------

function brandName(scan: PageScan, manifest: ManifestInfo | null): string | null {
  for (const key of ['og:site_name', 'application-name', 'apple-mobile-web-app-title']) {
    const value = scan.metas.get(key);
    if (value) return clip(value, MAX_NAME_LENGTH);
  }

  // "Acme Media | Social media for small teams" is a title, not a name: the
  // part before the first separator is what a person would call the brand.
  const first = (manifest?.name ?? scan.title)?.split(TITLE_SEPARATOR)[0]?.trim();
  return first ? clip(first, MAX_NAME_LENGTH) : null;
}

function brandDescription(scan: PageScan, manifest: ManifestInfo | null): string | null {
  for (const key of ['og:description', 'description', 'twitter:description']) {
    const value = scan.metas.get(key);
    if (value) return clip(value, MAX_DESCRIPTION_LENGTH);
  }

  return manifest?.description ?? null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function resolve(value: string, base: string): string | null {
  const text = value.trim();
  if (!text || text.length > MAX_URL_LENGTH) return null;

  try {
    const url = new URL(text, base);
    // Only real web addresses are followed; a picture inline in the page is
    // read from the page itself.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number): string {
  return text.slice(0, max).trim();
}

function textOf(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;

  const text = collapse(value);
  return text ? clip(text, max) : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
