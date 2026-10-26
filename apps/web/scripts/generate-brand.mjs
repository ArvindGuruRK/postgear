/**
 * Generates the PostGear logo: the shapes the app draws and every icon file.
 *
 *     node apps/web/scripts/generate-brand.mjs --mark-font <LuckiestGuy.ttf> --word-font <Baby Barbie.otf>
 *
 * Run once by hand; everything it writes is committed. Nothing loads a logo
 * font at runtime: the letters are outlined to SVG paths here, so the logo
 * renders the same in the app, the PDF and the browser tab with no font file.
 *
 * ## The logo (locked 2026-10-26)
 *
 * - The mark, the "Cog Badge": a ten-tooth blue gear with an ink outline and
 *   no hard shadow, holding "PG" in Luckiest Guy, white with a thin ink
 *   border on each letter.
 * - The wordmark: "PostGear" in Baby Barbie, one colour (the component fills
 *   it with the surrounding text colour).
 *
 * ## The fonts and their licences
 *
 * Neither font file is committed: only the outlined shapes are.
 * - Luckiest Guy (Astigmatic): SIL Open Font License, commercial use fine.
 *   From Google Fonts (github.com/google/fonts, ofl/luckiestguy).
 * - Baby Barbie: 1001Fonts "Free For Personal Use". A logo for a business
 *   needs the author's written permission; the owner asked for it on
 *   2026-10-26. If the answer is no, swap the wordmark (see WORD below) and
 *   re-run.
 *
 * ## What it writes
 *
 * - src/components/brand/brand-paths.ts: the path data `BrandMark` and
 *   `BrandWordmark` (src/components/brand/brand-mark.tsx) and the PDF draw.
 * - src/app/icon.svg (the tab icon, from the tab cut: TAB_GEAR below) and
 *   src/app/apple-icon.png (180, on a white ground): Next's app icon
 *   file conventions.
 * - public/brand/icon-192.png, icon-512.png, icon-maskable-512.png: the web
 *   manifest's icons (src/app/manifest.ts).
 * - public/logo.svg: the mark on its own, for anything outside the app.
 *
 * It does not write src/app/favicon.ico. That file is the owner's own
 * favicon.io export (2026-10-27), kept with the rest of that set in
 * public/favicon_io/; it is only the fallback for browsers without SVG
 * icons. Keep it small (16 to 48 px): a bigger frame makes Next announce the
 * .ico at that size, and Chrome then prefers it over icon.svg and shrinks the
 * bitmap, which looks blurry in the tab.
 *
 * The icon files carry literal colours because they are images, read before
 * any stylesheet; they match the flat brand tokens in
 * packages/ui/src/styles/colors.css (blue, white, ink), which never change
 * with the theme.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import sharp from 'sharp';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

// actionPrimary (--color-forth), --color-on-action-primary and
// --color-on-action-light.
const BLUE = '#1d4ed8';
const WHITE = '#ffffff';
const INK = '#0a0a0a';
// The solid ground under the home-screen and install icons: plain white
// (the owner's choice, 2026-10-27; the cream page colour was tried first).
const GROUND = WHITE;

// The mark on a 64 x 64 grid.
const GRID = 64;
const OUTLINE = 3; // the gear's outline, the app's border-2 scaled to the grid
const LETTER_OUTLINE = 2.4; // painted under each letter, so 1.2 shows outside it
const GEAR = { cx: 32, cy: 32, rOut: 27.5, rRoot: 22.5, teeth: 10, halfRoot: 10, halfTip: 6.5 };
const LETTERS = { text: 'PG', cx: 32, cy: 32, w: 29, h: 22 };
// The browser-tab cut (icon.svg): the same badge pushed to the
// edge of the square with shallower teeth and bigger letters, so it is as big
// in a 16 px tab as the full-bleed icons beside it. The inner circle (26 less
// half the outline) still clears the letters' corners and their border.
const TAB_GEAR = { ...GEAR, rOut: 30.4, rRoot: 26 };
const TAB_LETTERS = { ...LETTERS, w: 36, h: 27.5 };
const WORD = 'PostGear';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) {
    console.error(
      `Missing ${name} <path to the font file>. See the comment at the top of this script.`,
    );
    process.exit(1);
  }
  return process.argv[i + 1];
}

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
const trim = (d, places) => d.replace(/(\d+\.\d+)/g, (m) => String(round(Number(m), places)));

/** Lays out `text` and returns one path per glyph, y flipped to SVG's down. */
function glyphPaths(face, text) {
  const run = face.layout(text);
  let x = 0;
  return run.glyphs.map((g, i) => {
    const p = g.path.transform(1, 0, 0, -1, x, 0);
    x += run.positions[i].xAdvance;
    return p;
  });
}

function bounds(paths) {
  const b = paths.map((p) => p.bbox);
  return {
    minX: Math.min(...b.map((x) => x.minX)),
    maxX: Math.max(...b.map((x) => x.maxX)),
    minY: Math.min(...b.map((x) => x.minY)),
    maxY: Math.max(...b.map((x) => x.maxY)),
  };
}

/** The gear outline as one path: trapezoid teeth joined by arcs on the root circle. */
function gearPath({ cx, cy, rOut, rRoot, teeth, halfRoot, halfTip }) {
  const pt = (rad, deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${round(cx + rad * Math.cos(a), 2)} ${round(cy + rad * Math.sin(a), 2)}`;
  };
  const step = 360 / teeth;
  let d = `M${pt(rRoot, -halfRoot)}`;
  for (let i = 0; i < teeth; i++) {
    const t = i * step;
    d += `L${pt(rOut, t - halfTip)}`;
    d += `A${rOut} ${rOut} 0 0 1 ${pt(rOut, t + halfTip)}`;
    d += `L${pt(rRoot, t + halfRoot)}`;
    d += `A${rRoot} ${rRoot} 0 0 1 ${pt(rRoot, t + step - halfRoot)}`;
  }
  return `${d}Z`;
}

/** "PG" fitted inside the w x h box centred on (cx, cy), one path per letter. */
function letterPaths(face, box) {
  const raw = glyphPaths(face, box.text);
  const b = bounds(raw);
  const s = Math.min(box.w / (b.maxX - b.minX), box.h / (b.maxY - b.minY));
  const tx = box.cx - ((b.minX + b.maxX) / 2) * s;
  const ty = box.cy - ((b.minY + b.maxY) / 2) * s;
  return raw.map((p) => trim(p.transform(s, 0, 0, s, tx, ty).toSVG(), 2));
}

/** The wordmark in font units, with a 2% pad so no curve touches the edge. */
function wordmark(face) {
  const paths = glyphPaths(face, WORD);
  const b = bounds(paths);
  const pad = face.unitsPerEm * 0.02;
  const box = [
    b.minX - pad,
    b.minY - pad,
    b.maxX - b.minX + 2 * pad,
    b.maxY - b.minY + 2 * pad,
  ].map((n) => Math.round(n));
  return {
    viewBox: box.join(' '),
    width: box[2],
    height: box[3],
    d: trim(paths.map((p) => p.toSVG()).join(''), 1),
  };
}

/** The mark as a standalone SVG body (literal colours, for image files). */
function markBody(gear, letters) {
  const letter = (d) =>
    `<path fill="${WHITE}" stroke="${INK}" stroke-width="${LETTER_OUTLINE}" stroke-linejoin="round" paint-order="stroke" d="${d}"/>`;
  return `<path fill="${BLUE}" stroke="${INK}" stroke-width="${OUTLINE}" stroke-linejoin="round" d="${gear}"/>${letters.map(letter).join('')}`;
}

const svg = (body, ground) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}"><title>PostGear</title>${ground ? `<rect width="${GRID}" height="${GRID}" fill="${ground}"/>` : ''}${body}</svg>`;

/** The mark scaled down onto a solid ground, for home-screen and install icons. */
function padded(body, scale) {
  const t = round((GRID - GRID * scale) / 2, 2);
  return svg(`<g transform="translate(${t} ${t}) scale(${scale})">${body}</g>`, GROUND);
}

const png = (text, size) =>
  sharp(Buffer.from(text), { density: Math.max(72, (size / GRID) * 72 * 2) })
    .resize(size, size)
    .png()
    .toBuffer();

const markFace = fontkit.openSync(arg('--mark-font'));
const wordFace = fontkit.openSync(arg('--word-font'));

const gear = gearPath(GEAR);
const letters = letterPaths(markFace, LETTERS);
const word = wordmark(wordFace);

const ts = `// Generated by apps/web/scripts/generate-brand.mjs: do not edit by hand.
// The PostGear logo as path data. The mark's letters are Luckiest Guy (OFL),
// the wordmark is Baby Barbie; both outlined, so no font is ever loaded.

/** The Cog Badge on a ${GRID} x ${GRID} grid: the gear, then one path per letter of "PG". */
export const BRAND_MARK = {
  viewBox: '0 0 ${GRID} ${GRID}',
  outline: ${OUTLINE},
  letterOutline: ${LETTER_OUTLINE},
  gear: '${gear}',
  letters: [${letters.map((d) => `\n    '${d}'`).join(',')},\n  ],
} as const;

/** "${WORD}" in font units; width and height give its aspect ratio. */
export const BRAND_WORDMARK = {
  viewBox: '${word.viewBox}',
  width: ${word.width},
  height: ${word.height},
  d: '${word.d}',
} as const;
`;

const body = markBody(gear, letters);
const flat = svg(body);
const tab = svg(markBody(gearPath(TAB_GEAR), letterPaths(markFace, TAB_LETTERS)));

const out = (...p) => join(WEB, ...p);
await mkdir(out('src', 'components', 'brand'), { recursive: true });
await mkdir(out('public', 'brand'), { recursive: true });
await writeFile(out('src', 'components', 'brand', 'brand-paths.ts'), ts);
await writeFile(out('src', 'app', 'icon.svg'), tab);
await writeFile(out('src', 'app', 'apple-icon.png'), await png(padded(body, 0.78), 180));
await writeFile(out('public', 'brand', 'icon-192.png'), await png(padded(body, 0.78), 192));
await writeFile(out('public', 'brand', 'icon-512.png'), await png(padded(body, 0.78), 512));
// Maskable icons get cropped to a circle or squircle, so the mark sits inside the safe zone.
await writeFile(
  out('public', 'brand', 'icon-maskable-512.png'),
  await png(padded(body, 0.62), 512),
);
await writeFile(out('public', 'logo.svg'), flat);

console.log('Wrote the PostGear logo files.');
