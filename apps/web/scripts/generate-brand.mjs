/**
 * Generates the PostGear logo: the shapes the app draws and every icon file.
 *
 *     node apps/web/scripts/generate-brand.mjs [--word-font <Jumping Chick.ttf>]
 *
 * Run once by hand; everything it writes is committed. Nothing loads a logo
 * font at runtime: the wordmark is outlined to SVG paths here, so the logo
 * renders the same in the app, the PDF and the browser tab with no font file.
 * Without --word-font the wordmark already in brand-paths.ts is kept as it is.
 *
 * ## The logo (mark locked 2026-11-05)
 *
 * - The mark: a blue gear with 6 tall spokes, deep cuts and a solid white
 *   centre (white on every background), in the app's sticker: an ink outline,
 *   a white band, an ink rim and a hard ink shadow. It has no letters. It is
 *   Version 5 of the Logo Lab, which replaced the ten-tooth PG Cog Badge.
 * - The wordmark: "POSTGEAR" in Jumping Chick capitals, one colour (the
 *   component fills it with the surrounding text colour). It replaced Baby
 *   Barbie on 2026-10-27, whose licence is personal use only.
 * - The sidebar's tile (2026-11-05): "PG" in Luckiest Guy, outlined here like
 *   the wordmark. It is the one place the rail differs from the gear; only its
 *   letters come from this script, and no icon file uses them.
 *
 * ## The fonts and their licences
 *
 * - Jumping Chick (Khurasan Studio, khurasanstudio.com): its notes say "100%
 *   free for personal use & commercial use". The font file is not committed:
 *   only the outlined shapes are.
 * - Luckiest Guy (Astigmatic): Apache License 2.0, commercial use fine. Read
 *   from packages/design-engine/fonts, where Design Studio already ships it.
 *
 * ## What it writes
 *
 * - src/components/brand/brand-paths.ts: the path data `BrandMark`,
 *   `BrandWordmark` and `BrandTile` (src/components/brand/brand-mark.tsx) and
 *   the PDF draw.
 * - src/app/icon.svg and src/app/favicon.ico (the tab icon: the same mark,
 *   filling the square, see TAB_SHADOW below) and src/app/apple-icon.png
 *   (180, on a white ground): Next's app icon file conventions.
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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
// The badge wears a sticker (the owner's pick, 2026-10-27): a white band and
// an ink rim round the gear's own outer edge, so 2 of band and then 1.2 of rim
// show outside it, over a hard ink shadow 2 down and right (2px when the mark
// is drawn at 64px). The app icons, logo.svg and the tab icon wear it too; the
// wordmark stays plain.
const MARK_BAND = 7;
const MARK_RIM = 9.4;
const MARK_SHADOW = 2;
// Version 5 of the Logo Lab (locked by the owner, 2026-11-05).
const GEAR = {
  cx: 32,
  cy: 32,
  rOut: 27.5,
  rRoot: 19.5,
  teeth: 6,
  halfRoot: 19,
  halfTip: 14,
  tipRound: 1.6,
  rootRound: 1.2,
};
// The gear's hole, and the white disc under it, slightly wider so no ground
// shows at the seam. The hard shadow still falls on the disc inside the hole.
const HOLE = 10;
const CENTRE = 11;
// The tab icon is the same mark filling the square. The owner wants to see it
// with the shadow first and may remove it later: set this to false and re-run.
const TAB_SHADOW = true;
// The tab icon's frames in favicon.ico (see the note at the top on sizes).
const ICO_SIZES = [16, 32, 48];
// All capitals (the owner's pick, 2026-10-27); screen readers still get "PostGear" from `label`.
const WORD = 'POSTGEAR';
// The sidebar tile's letters, the same as the old badge's and the Logo Lab's:
// 29 wide on the 64 grid, with an ink border painted under each letter, so only
// its outer half shows and the border parts the P from the G.
const TILE_FONT = join(
  WEB,
  '..',
  '..',
  'packages',
  'design-engine',
  'fonts',
  'luckiest-guy-400.woff2',
);
const TILE_TEXT = 'PG';
const TILE_WIDTH = 29;
const TILE_OUTLINE = 2.4;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
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

/**
 * The gear's outer edge as one path: trapezoid teeth with softly rounded
 * corners, joined by arcs on the root circle.
 */
function gearPath({ cx, cy, rOut, rRoot, teeth, halfRoot, halfTip, tipRound, rootRound }) {
  const at = (rad, deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  const str = (p) => `${round(p[0], 2)} ${round(p[1], 2)}`;
  const toward = (from, to, dist) => {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return [from[0] + ((to[0] - from[0]) * dist) / len, from[1] + ((to[1] - from[1]) * dist) / len];
  };
  // A distance along a circle, as degrees.
  const deg = (dist, rad) => (dist / rad) * (180 / Math.PI);
  const step = 360 / teeth;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const t = i * step;
    const rootA = at(rRoot, t - halfRoot);
    const tipA = at(rOut, t - halfTip);
    const tipB = at(rOut, t + halfTip);
    const rootB = at(rRoot, t + halfRoot);
    const start = at(rRoot, t - halfRoot - deg(rootRound, rRoot));
    d += i === 0 ? `M${str(start)}` : `A${rRoot} ${rRoot} 0 0 1 ${str(start)}`;
    d += `Q${str(rootA)} ${str(toward(rootA, tipA, rootRound))}`;
    d += `L${str(toward(tipA, rootA, tipRound))}`;
    d += `Q${str(tipA)} ${str(at(rOut, t - halfTip + deg(tipRound, rOut)))}`;
    d += `A${rOut} ${rOut} 0 0 1 ${str(at(rOut, t + halfTip - deg(tipRound, rOut)))}`;
    d += `Q${str(tipB)} ${str(toward(tipB, rootB, tipRound))}`;
    d += `L${str(toward(rootB, tipB, rootRound))}`;
    d += `Q${str(rootB)} ${str(at(rRoot, t + halfRoot + deg(rootRound, rRoot)))}`;
  }
  return `${d}A${rRoot} ${rRoot} 0 0 1 ${str(at(rRoot, -halfRoot - deg(rootRound, rRoot)))}Z`;
}

/** The gear's hole, added to the outer edge and filled with the even-odd rule. */
const holePath = ({ cx, cy }, r) =>
  `M${cx} ${cy - r}A${r} ${r} 0 1 0 ${cx} ${cy + r}A${r} ${r} 0 1 0 ${cx} ${cy - r}Z`;

/**
 * Letters in font units, with a 2% pad so no curve touches the edge. The box
 * hugs the ink, so centring the box centres the letters themselves.
 */
function outlined(face, paths) {
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

const wordmark = (face) => outlined(face, glyphPaths(face, WORD));

/** The sidebar tile's "PG", one path per letter, in a box that hugs the border. */
function tileLetters(face) {
  const raw = glyphPaths(face, TILE_TEXT);
  const b = bounds(raw);
  const s = TILE_WIDTH / (b.maxX - b.minX);
  const edge = TILE_OUTLINE / 2;
  const width = round(TILE_WIDTH + 2 * edge, 2);
  const height = round((b.maxY - b.minY) * s + 2 * edge, 2);
  return {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    paths: raw.map((p) =>
      trim(p.transform(s, 0, 0, s, edge - b.minX * s, edge - b.minY * s).toSVG(), 2),
    ),
  };
}

/**
 * The mark as a standalone SVG body (literal colours, for image files), in
 * its sticker, as the app draws it (src/components/brand/brand-mark.tsx): the
 * white centre, the shadow, the rim and the band under the gear. The sticker
 * follows the outer edge only, so it never rings the hole.
 */
function markBody(edge, body, shadow = true) {
  const ring = (colour, width) =>
    `<path fill="none" stroke="${colour}" stroke-width="${width}" stroke-linejoin="round" d="${edge}"/>`;
  return [
    `<circle cx="${GEAR.cx}" cy="${GEAR.cy}" r="${CENTRE}" fill="${WHITE}"/>`,
    shadow
      ? `<g transform="translate(${MARK_SHADOW} ${MARK_SHADOW})"><path fill="${INK}" fill-rule="evenodd" d="${body}"/>${ring(INK, MARK_RIM)}</g>`
      : '',
    ring(INK, MARK_RIM),
    ring(WHITE, MARK_BAND),
    `<path fill="${BLUE}" fill-rule="evenodd" stroke="${INK}" stroke-width="${OUTLINE}" stroke-linejoin="round" d="${body}"/>`,
  ].join('');
}

/**
 * The square the sticker fills, as [x, y, size]: the rim reaches half its
 * width past the gear's teeth, and the shadow a little further down and right.
 */
const stickerBox = ({ cx, cy, rOut }, shadow = MARK_SHADOW) => {
  const r = rOut + MARK_RIM / 2;
  return [round(cx - r, 2), round(cy - r, 2), round(2 * r + shadow, 2)];
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

const out = (...p) => join(WEB, ...p);
const PATHS_FILE = out('src', 'components', 'brand', 'brand-paths.ts');

/** The wordmark already in brand-paths.ts, used when no font file is given. */
async function keptWordmark() {
  const text = await readFile(PATHS_FILE, 'utf8');
  const part = text.slice(text.indexOf('BRAND_WORDMARK'));
  return {
    viewBox: part.match(/viewBox: '([^']+)'/)[1],
    width: Number(part.match(/width: (\d+)/)[1]),
    height: Number(part.match(/height: (\d+)/)[1]),
    d: part.match(/ d: '([^']+)'/)[1],
  };
}

const wordFont = arg('--word-font');
const edge = gearPath(GEAR);
const gear = edge + holePath(GEAR, HOLE);
const word = wordFont ? wordmark(fontkit.openSync(wordFont)) : await keptWordmark();
const tile = tileLetters(fontkit.openSync(TILE_FONT));

const ts = `// Generated by apps/web/scripts/generate-brand.mjs: do not edit by hand.
// The PostGear logo as path data. The wordmark is Jumping Chick, outlined, so no
// font is ever loaded.

/**
 * The mark on a ${GRID} x ${GRID} grid: \`edge\` is the gear's outer edge (the sticker
 * follows it), \`gear\` adds the hole (fill it with the even-odd rule), and
 * \`centre\` is the white disc under the hole.
 */
export const BRAND_MARK = {
  viewBox: '0 0 ${GRID} ${GRID}',
  outline: ${OUTLINE},
  band: ${MARK_BAND},
  rim: ${MARK_RIM},
  shadow: ${MARK_SHADOW},
  centre: { cx: ${GEAR.cx}, cy: ${GEAR.cy}, r: ${CENTRE} },
  edge: '${edge}',
  gear: '${gear}',
} as const;

/** "${WORD}" in font units; width and height give its aspect ratio. */
export const BRAND_WORDMARK = {
  viewBox: '${word.viewBox}',
  width: ${word.width},
  height: ${word.height},
  d: '${word.d}',
} as const;

/** "${TILE_TEXT}" in Luckiest Guy for the sidebar's tile, one path per letter. */
export const BRAND_TILE_LETTERS = {
  viewBox: '${tile.viewBox}',
  width: ${tile.width},
  height: ${tile.height},
  outline: ${TILE_OUTLINE},
  paths: [${tile.paths.map((d) => `\n    '${d}'`).join(',')},\n  ],
} as const;
`;

const body = markBody(edge, gear);
const box = stickerBox(GEAR);
const flat = svg(body, null, box);
const tab = svg(
  markBody(edge, gear, TAB_SHADOW),
  null,
  stickerBox(GEAR, TAB_SHADOW ? MARK_SHADOW : 0),
);

await mkdir(out('src', 'components', 'brand'), { recursive: true });
await mkdir(out('public', 'brand'), { recursive: true });
await writeFile(PATHS_FILE, ts);
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
