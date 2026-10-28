/**
 * The page an export is screenshotted from.
 *
 * The API renders `SlideView` in `export` mode with `react-dom/server`, then
 * wraps the markup here. The result is a complete, **offline** document: the
 * fonts are `data:` URIs, the pictures are `data:` URIs, and there is one
 * inline script, the shared text fitter. Nothing is fetched while it renders,
 * which is both the fidelity argument (no network, no flash of a fallback
 * face, no slide that came out differently because a CDN was slow) and the
 * safety one (a user's picture cannot make the export browser reach anywhere).
 * The page's Content Security Policy says the same thing to the browser, so
 * even a bug that put a URL into the markup could not fetch it.
 *
 * This file stays browser-safe like the rest of the package: it is handed
 * base64 that somebody else read off disk. The API's exporter is the only
 * thing that touches a file.
 */
import { fitScriptSource } from './fit-runtime';

export interface InlineFont {
  family: string;
  /** A single weight, or `"100 800"` for a variable file. */
  weight: string;
  /** The woff2, base64 encoded. */
  base64: string;
}

export interface ExportPageInput {
  /** `renderToStaticMarkup(<SlideView mode="export" .../>)`. */
  markup: string;
  width: number;
  height: number;
  fonts: InlineFont[];
}

/**
 * Nothing but inline styles, the inline fitter and `data:` fonts and images.
 * `connect-src` and every other fetch fall back to `'none'`.
 */
const EXPORT_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
].join('; ');

/**
 * Keeps a value built here from closing a string, a rule or a tag early.
 *
 * Everything user-written reaches this page as React-escaped text inside
 * `markup`, so this is for the values that come from the font table. Belt and
 * braces, in the one file that writes raw HTML.
 */
function escapeCss(value: string): string {
  return value.replace(/[\\"'<>;{}]/g, '');
}

/** A base64 payload, refused if it holds anything a data URI must not. */
function base64(value: string): string {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('A font payload is not base64.');
  }
  return value;
}

/** The CSS shorthand the page asks the browser to load a face by: `800 16px "Sora"`. */
export function fontLoadSpec(font: Pick<InlineFont, 'family' | 'weight'>): string {
  const weight = escapeCss(font.weight).split(/\s+/)[0] || '400';
  return `${weight} 16px "${escapeCss(font.family)}"`;
}

export function buildExportPage({ markup, width, height, fonts }: ExportPageInput): string {
  const faces = fonts
    .map(
      (font) =>
        `@font-face{font-family:"${escapeCss(font.family)}";font-weight:${escapeCss(
          font.weight,
        )};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${base64(
          font.base64,
        )}) format("woff2");}`,
    )
    .join('\n');

  const size = (value: number) => Math.max(1, Math.round(value));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">
<title>Slide</title>
<style>
${faces}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${size(width)}px;height:${size(height)}px;overflow:hidden;background:#FFFFFF}
img{display:block}
</style>
</head>
<body>
${markup}
<script>${fitScriptSource(fonts.map(fontLoadSpec))}</script>
</body>
</html>`;
}

/**
 * The CSS the **editor** needs for the same fonts, as a stylesheet the web app
 * can drop into the page.
 *
 * The editor does not inline the bytes: the files are served by the API, so
 * the browser caches one copy across every design rather than re-downloading
 * the fonts inside every thumbnail. The declarations are otherwise identical
 * to the export's, which is what matters.
 */
export function buildFontStylesheet(
  fonts: Array<{ family: string; weight: string; url: string }>,
): string {
  return fonts
    .map(
      (font) =>
        `@font-face{font-family:"${escapeCss(font.family)}";font-weight:${escapeCss(
          font.weight,
        )};font-style:normal;font-display:swap;src:url("${font.url.replace(
          /["'<>\\\s]/g,
          '',
        )}") format("woff2");}`,
    )
    .join('\n');
}
