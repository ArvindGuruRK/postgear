/**
 * Generates the PostGear logo: the shapes the app draws and every icon file.
 *
 *     node apps/web/scripts/generate-brand.mjs --mark-font <LuckiestGuy.ttf> --word-font <Jumping Chick.ttf>
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
 * - The wordmark: "POSTGEAR" in Jumping Chick capitals, one colour (the
 *   component fills it with the surrounding text colour). It replaced Baby
 *   Barbie on 2026-10-27, whose licence is personal use only.
 *
 * ## The fonts and their licences
 *
 * Neither font file is committed: only the outlined shapes are.
 * - Luckiest Guy (Astigmatic): Apache License 2.0, commercial use fine.
 *   From Google Fonts (github.com/google/fonts, apache/luckiestguy).
 * - Jumping Chick (Khurasan Studio, khurasanstudio.com): its notes say "100%
 *   free for personal use & commercial use".
 *
 * ## What it writes
 *
 * - src/components/brand/brand-paths.ts: the path data `BrandMark` and
 *   `BrandWordmark` (src/components/brand/brand-mark.tsx) and the PDF draw.
 * - src/app/icon.svg and src/app/favicon.ico (the tab icon: the Monogram
 *   Tile, TAB_TILE below) and src/app/apple-icon.png (180, on a white
 *   ground): Next's app icon file conventions.
 * - public/brand/icon-192.png, icon-512.png, icon-maskable-512.png: the web
 *   manifest's icons (src/app/manifest.ts).
 * - public/logo.svg: the mark on its own, for anything outside the app.
 *
 * favicon.ico is only the fallback for browsers without SVG icons. Keep its
 * frames small (16 to 48 px): a bigger frame makes Next announce the .ico at
 * that size, and Chrome then prefers it over icon.svg and shrinks the bitmap,
 * which looks blurry in the tab. The owner's earlier favicon.io export is
 * kept in public/favicon_io/.
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
// The badge wears a sticker (the owner's pick, 2026-10-27): a white band and
// an ink rim round the gear's own outline, so 2 of band and then 1.2 of rim
// show outside it, over a hard ink shadow 2 down and right (the app's 2px
// drop shadow at the 64px sidebar size). The app icons and logo.svg wear it
// too, the browser-tab icon does not (see `tab` below); the wordmark stays
// plain.
const MARK_BAND = 7;
const MARK_RIM = 9.4;
const MARK_SHADOW = 2;
const GEAR = { cx: 32, cy: 32, rOut: 27.5, rRoot: 22.5, teeth: 10, halfRoot: 10, halfTip: 6.5 };
const LETTERS = { text: 'PG', cx: 32, cy: 32, w: 29, h: 22 };
// The browser-tab icon is not the gear but a Monogram Tile (the owner's pick,
// 2026-10-27): a blue rounded square to the edge of the square, white PG
// filling it. At 16 px the round gear filled only 69% of the square and its
// teeth and small letters read as clutter beside other sites' square icons;
// a white tile behind the gear was tried and still looked small. The border
// is 4 units, one crisp ink pixel at 16 px.
const TAB_TILE = { border: 4, radius: 12 };
const TAB_LETTERS = { ...LETTERS, w: 46, h: 34 };
// Luckiest Guy is very heavy, so the tab's PG is thinned (the owner asked,
// 2026-10-27): this much is shaved off each letter, half from each side of
// every stroke, and the thin ink edge follows the new edge.
const TAB_THIN = 3;
// The tab icon's frames in favicon.ico (see the note at the top on sizes).
const ICO_SIZES = [16, 32, 48];
// All capitals (the owner's pick, 2026-10-27); screen readers still get "PostGear" from `label`.
const WORD = 'POSTGEAR';

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

/** One white letter with its thin ink border (literal colours, for image files). */
const letterSvg = (d) =>
  `<path fill="${WHITE}" stroke="${INK}" stroke-width="${LETTER_OUTLINE}" stroke-linejoin="round" paint-order="stroke" d="${d}"/>`;

/**
 * The mark as a standalone SVG body (literal colours, for image files), in
 * its sticker: the shadow, the rim and the band under the gear, as the app
 * draws it (src/components/brand/brand-mark.tsx).
 */
function markBody(gear, letters) {
  const layer = (fill, width, extra = '') =>
    `<path fill="${fill}" stroke="${fill}" stroke-width="${width}" stroke-linejoin="round"${extra} d="${gear}"/>`;
  return [
    layer(INK, MARK_RIM, ` transform="translate(${MARK_SHADOW} ${MARK_SHADOW})"`),
    layer(INK, MARK_RIM),
    layer(WHITE, MARK_BAND),
    `<path fill="${BLUE}" stroke="${INK}" stroke-width="${OUTLINE}" stroke-linejoin="round" d="${gear}"/>`,
    ...letters.map(letterSvg),
  ].join('');
}

/**
 * The square the sticker fills, as [x, y, size]: the rim reaches half its
 * width past the gear's teeth, and the shadow a little further down and right.
 */
const stickerBox = ({ cx, cy, rOut }) => {
  const r = rOut + MARK_RIM / 2;
  return [round(cx - r, 2), round(cy - r, 2), round(2 * r + MARK_SHADOW, 2)];
};

const svg = (body, ground, [x, y, size] = [0, 0, GRID]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${size} ${size}"><title>PostGear</title>${ground ? `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${ground}"/>` : ''}${body}</svg>`;

/**
 * The mark on a solid ground, for home-screen and install icons: the sticker
 * spans `scale` of the square, centred.
 */
function padded(body, box, scale) {
  const s = round((GRID * scale) / box[2], 4);
  const tx = round((GRID - box[2] * s) / 2 - box[0] * s, 2);
  const ty = round((GRID - box[2] * s) / 2 - box[1] * s, 2);
  return svg(`<g transform="translate(${tx} ${ty}) scale(${s})">${body}</g>`, GROUND);
}

/** The Monogram Tile, for the browser tab (icon.svg and favicon.ico). */
function monogram(letters) {
  const { border, radius } = TAB_TILE;
  const edge = GRID - border;
  const d = letters.join('');
  // A mask keeps the inside of the letters less a band along their edge, so
  // a layer drawn through it is the letters shaved by half the band's width.
  const shaved = (id, band) =>
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${GRID}" height="${GRID}"><path fill="${WHITE}" stroke="#000" stroke-width="${band}" stroke-linejoin="round" d="${d}"/></mask>`;
  return svg(
    `<defs>${shaved('ink', TAB_THIN - LETTER_OUTLINE)}${shaved('white', TAB_THIN)}</defs>` +
      `<rect x="${border / 2}" y="${border / 2}" width="${edge}" height="${edge}" rx="${radius}" fill="${BLUE}" stroke="${INK}" stroke-width="${border}"/>` +
      `<path fill="${INK}" mask="url(#ink)" d="${d}"/><path fill="${WHITE}" mask="url(#white)" d="${d}"/>`,
  );
}

/** An .ico holding one PNG frame per size (PNG frames work in every current browser). */
function ico(frames) {
  const head = Buffer.alloc(6 + 16 * frames.length);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size, at);
    head.writeUInt8(size, at + 1);
    head.writeUInt16LE(1, at + 4); // colour planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...frames.map((f) => f.data)]);
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
// The PostGear logo as path data. The mark's letters are Luckiest Guy (Apache 2.0),
// the wordmark is Jumping Chick; both outlined, so no font is ever loaded.

/** The Cog Badge on a ${GRID} x ${GRID} grid: the gear, then one path per letter of "PG". */
export const BRAND_MARK = {
  viewBox: '0 0 ${GRID} ${GRID}',
  outline: ${OUTLINE},
  letterOutline: ${LETTER_OUTLINE},
  band: ${MARK_BAND},
  rim: ${MARK_RIM},
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
const box = stickerBox(GEAR);
const flat = svg(body, null, box);
const tab = monogram(letterPaths(markFace, TAB_LETTERS));

const out = (...p) => join(WEB, ...p);
await mkdir(out('src', 'components', 'brand'), { recursive: true });
await mkdir(out('public', 'brand'), { recursive: true });
await writeFile(out('src', 'components', 'brand', 'brand-paths.ts'), ts);
await writeFile(out('src', 'app', 'icon.svg'), tab);
await writeFile(
  out('src', 'app', 'favicon.ico'),
  ico(await Promise.all(ICO_SIZES.map(async (size) => ({ size, data: await png(tab, size) })))),
);
await writeFile(out('src', 'app', 'apple-icon.png'), await png(padded(body, box, 0.8), 180));
await writeFile(out('public', 'brand', 'icon-192.png'), await png(padded(body, box, 0.8), 192));
await writeFile(out('public', 'brand', 'icon-512.png'), await png(padded(body, box, 0.8), 512));
// Maskable icons get cropped to a circle or squircle, so the mark sits inside the safe zone.
await writeFile(
  out('public', 'brand', 'icon-maskable-512.png'),
  await png(padded(body, box, 0.64), 512),
);
await writeFile(out('public', 'logo.svg'), flat);

console.log('Wrote the PostGear logo files.');
