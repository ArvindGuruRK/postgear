/**
 * The luxury art set: PostGear's own backgrounds for the premium collection.
 *
 * Luxury reads as space. Each style is a few fine lines, a metallic gradient
 * and a lot of untouched ground, because a slide's headline, body and lists
 * can sit anywhere in the middle and must still read there at AA (the pixel
 * contrast check samples the art under every text slot). So the detail lives
 * at the edges and in the corners, mostly inside the margin `formats.ts`
 * keeps clear of text, and whatever reaches the middle is a hairline or a
 * tone a few percent off the ground.
 *
 * ## Colours
 *
 * Only the four `ArtColors`, white and black, and two-colour mixes of those
 * six, at an opacity: never a hex of its own. A luxury theme pins its metal
 * (`Theme.art`), and a brand kit's ground and accent recolour the same
 * drawing, so a navy kit with a periwinkle accent gets silver-blue linework
 * on navy rather than gold on navy.
 *
 * Metal is three tones of the highlight: its body, a glint where the light
 * catches it and a shade where it turns away. On a dark ground the glint
 * leans to the sheen (white) and the shade to `mid`. A light ground has no
 * white to lean to, so the glint leans to `mid` (paler, toward the paper)
 * and the shade to black, which is how gold foil reads printed on ivory.
 *
 * ## Size and cost
 *
 * Every length is a fraction of the canvas's short edge, so a frame is the
 * same weight in a square and in a story, and the tall formats simply get
 * more calm ground. The drawings are gradients and thin strokes, which cost
 * almost nothing to paint, because the gallery draws dozens of these at once
 * and a full-canvas blur is the slowest thing an SVG can ask for. The one
 * blur in the set is the silk's: under a hundredth of the short edge, over
 * its two corners only.
 */
import { contrastRatio, INK_DARK, INK_LIGHT, mix, normalizeHex } from '../color';
import type { ArtColors, ArtStyle } from './types';

const WHITE = '#FFFFFF';
const BLACK = '#000000';

type Point = [number, number];

/** A coordinate to a tenth of a pixel: finer than any screen shows, and short in the markup. */
function n(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** An opacity or a gradient offset, to three decimals. */
function o(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function pt([x, y]: Point): string {
  return `${n(x)} ${n(y)}`;
}

/** The palette a drawing works in: the four art colours plus the metal's three tones. */
interface Inks {
  ground: string;
  mid: string;
  highlight: string;
  sheen: string;
  dark: boolean;
  /** Where the light catches the metal. */
  glint: string;
  /** Where the metal turns away from the light. */
  shade: string;
  /**
   * How much of each texture to show, 0.65 to 1. A highlight far from its
   * ground (champagne on emerald) reads louder at the same opacity than one
   * close to it (deep gold on ivory), so the textures that reach toward the
   * text (rays, ribbons, veins, stripes, the lattice, the glows) are scaled
   * down once the two stand more than 8:1 apart. That keeps a brand kit with
   * a white or neon accent as quiet as the gold the set was drawn in. Lines
   * that live in the margin (the frame, the arch's sides) stay at full
   * strength.
   */
  presence: number;
}

function inksFor(colors: ArtColors): Inks {
  const ground = normalizeHex(colors.background) ?? colors.background;
  const mid = normalizeHex(colors.mid) ?? colors.mid;
  const highlight = normalizeHex(colors.highlight) ?? colors.highlight;
  const sheen = normalizeHex(colors.sheen) ?? colors.sheen;
  // `isDarkGround` in `./index` asks the same question, but `./index` builds
  // its registry from this file, so importing it back would be a cycle.
  const dark = contrastRatio(INK_LIGHT, ground) >= contrastRatio(INK_DARK, ground);

  return {
    ground,
    mid,
    highlight,
    sheen,
    dark,
    glint: dark ? mix(highlight, sheen, 0.55) : mix(highlight, mid, 0.5),
    shade: dark ? mix(highlight, mid, 0.55) : mix(highlight, BLACK, 0.22),
    presence: Math.min(1, Math.max(0.65, 8 / contrastRatio(highlight, ground))),
  };
}

function stop(offset: number, color: string, opacity = 1): string {
  const alpha = opacity < 1 ? ` stop-opacity="${o(opacity)}"` : '';
  return `<stop offset="${o(offset)}" stop-color="${color}"${alpha}/>`;
}

/**
 * Metal along a line: shade, body, glint, body, shade. Laid across a whole
 * frame or arch, it puts the light on one stretch of the line and lets it
 * fall away on either side, which is what makes a hairline read as gold
 * rather than as yellow.
 */
function foil(id: string, k: Inks, x1: number, y1: number, x2: number, y2: number): string {
  return (
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}">` +
    stop(0, k.shade) +
    stop(0.3, k.highlight) +
    stop(0.5, k.glint) +
    stop(0.7, k.highlight) +
    stop(1, k.shade) +
    '</linearGradient>'
  );
}

/** The whole document: the ground first, so the art stands on its own as a gallery tile. */
function svg(width: number, height: number, ground: string, defs: string, art: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${defs}</defs><rect width="${width}" height="${height}" fill="${ground}"/>${art}</svg>`
  );
}

/** A small lozenge centred on (x, y): the jewel at a frame's corner or an arch's crown. */
function diamond(x: number, y: number, size: number): string {
  return `M${n(x - size)} ${n(y)}L${n(x)} ${n(y - size)}L${n(x + size)} ${n(y)}L${n(x)} ${n(y + size)}Z`;
}

type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

/**
 * A point given in short edges from a corner (`across` along the top or
 * bottom edge, `down` along the side, both measured inward), as canvas
 * coordinates. Corner detail drawn this way is the same size, and the same
 * distance from the text, in every format.
 */
function fromCorner(corner: Corner, [across, down]: Point, w: number, h: number, m: number): Point {
  const x = corner.endsWith('left') ? across * m : w - across * m;
  const y = corner.startsWith('top') ? down * m : h - down * m;
  return [x, y];
}

function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** A point on a cubic Bezier. */
function cubicAt([p0, p1, p2, p3]: Point[], t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/**
 * A cubic in corner units from `from` to `to`, its thirds pushed off the
 * straight line by `bow` (positive is away from the corner, into the slide).
 * Opposite bows give the gentle S of a drape or a vein.
 */
function bowed(from: Point, to: Point, bow: [number, number]): Point[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  // Of the two normals, the one pointing into the slide (both components up).
  const flip = dy - dx >= 0 ? 1 : -1;
  const nx = (dy / length) * flip;
  const ny = (-dx / length) * flip;
  const first = lerp(from, to, 1 / 3);
  const second = lerp(from, to, 2 / 3);
  return [
    from,
    [first[0] + nx * bow[0], first[1] + ny * bow[0]],
    [second[0] + nx * bow[1], second[1] + ny * bow[1]],
    to,
  ];
}

/** A soft bump centred on `at`, `width` wide: the profile of a crest of light. */
function bump(t: number, at: number, width: number): number {
  return Math.exp(-(((t - at) / width) ** 2));
}

/** Mulberry32: a tiny seeded generator, so irregular drawings come back the same every time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Gilded Frame
// ---------------------------------------------------------------------------

/**
 * A thin double border inset from the edge, the inner line cut into concave
 * corners with a small jewel in each. The whole frame sits in the margin
 * outside the content box, so it never touches text, and the light runs
 * along it on the diagonal, catching two opposite corners.
 */
function gildedFrame(colors: ArtColors, w: number, h: number): string {
  const k = inksFor(colors);
  const m = Math.min(w, h);
  const outer = m * 0.042;
  const inner = m * 0.056;
  const cut = m * 0.026;
  const left = inner;
  const top = inner;
  const right = w - inner;
  const bottom = h - inner;
  const r = n(cut);

  const innerLine =
    `M${n(left + cut)} ${n(top)}H${n(right - cut)}A${r} ${r} 0 0 0 ${n(right)} ${n(top + cut)}` +
    `V${n(bottom - cut)}A${r} ${r} 0 0 0 ${n(right - cut)} ${n(bottom)}` +
    `H${n(left + cut)}A${r} ${r} 0 0 0 ${n(left)} ${n(bottom - cut)}` +
    `V${n(top + cut)}A${r} ${r} 0 0 0 ${n(left + cut)} ${n(top)}Z`;
  const jewels = [
    diamond(left, top, m * 0.0075),
    diamond(right, top, m * 0.0075),
    diamond(right, bottom, m * 0.0075),
    diamond(left, bottom, m * 0.0075),
  ].join('');

  const defs = foil('gf-foil', k, 0, 0, w, h);
  const art =
    `<rect x="${n(outer)}" y="${n(outer)}" width="${n(w - outer * 2)}" height="${n(h - outer * 2)}" fill="none" stroke="url(#gf-foil)" stroke-width="${n(m * 0.0028)}"/>` +
    `<path d="${innerLine}" fill="none" stroke="url(#gf-foil)" stroke-width="${n(m * 0.0014)}" stroke-opacity=".75"/>` +
    `<path d="${jewels}" fill="url(#gf-foil)"/>`;

  return svg(w, h, k.ground, defs, art);
}

// ---------------------------------------------------------------------------
// Art Deco
// ---------------------------------------------------------------------------

/**
 * A sunrise on the bottom edge: a sun just breaking the edge, three close
 * rings and a fan of fine rays, long and short in turn, that fade out as
 * they climb. The centre sits a little below the edge, so the sun and its
 * rings rise only about a tenth of the short edge, into the bottom margin
 * below a footer, even a centred one; the rays cross the footer row as
 * hairlines and have faded out well before the middle.
 */
function artDeco(colors: ArtColors, w: number, h: number): string {
  const k = inksFor(colors);
  const m = Math.min(w, h);
  const cx = w / 2;
  const cy = h + m * 0.025;
  const sun = m * 0.066;
  const rings = [0.09, 0.106, 0.122].map((f) => f * m);
  const rayFrom = m * 0.152;
  const rayLong = m * 0.39;
  const rayShort = m * 0.3;
  const RAYS = 30;

  let rays = '';
  for (let i = 1; i < RAYS; i++) {
    const angle = Math.PI + (Math.PI * i) / RAYS;
    const reach = i % 2 === 0 ? rayLong : rayShort;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    rays += `M${n(cx + cos * rayFrom)} ${n(cy + sin * rayFrom)}L${n(cx + cos * reach)} ${n(cy + sin * reach)}`;
  }
  const arc = (r: number) => `M${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 0 1 ${n(cx + r)} ${n(cy)}`;

  const defs =
    foil('ad-foil', k, cx - rings[2], 0, cx + rings[2], 0) +
    `<radialGradient id="ad-ray" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(rayLong)}">` +
    stop(0, k.highlight, 0) +
    stop(rayFrom / rayLong, k.highlight, 0.55 * k.presence) +
    stop(0.75, k.highlight, 0.2 * k.presence) +
    stop(1, k.highlight, 0) +
    '</radialGradient>' +
    `<radialGradient id="ad-sun" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(sun)}">` +
    stop(0, k.glint, 0.2) +
    stop(1, k.highlight, 0.08) +
    '</radialGradient>';
  const art =
    `<path d="${arc(sun)}Z" fill="url(#ad-sun)" stroke="url(#ad-foil)" stroke-width="${n(m * 0.0024)}"/>` +
    `<path d="${rings.map(arc).join('')}" fill="none" stroke="url(#ad-foil)" stroke-width="${n(m * 0.0016)}"/>` +
    `<path d="${rays}" fill="none" stroke="url(#ad-ray)" stroke-width="${n(m * 0.0016)}"/>`;

  return svg(w, h, k.ground, defs, art);
}

// ---------------------------------------------------------------------------
// Silk
// ---------------------------------------------------------------------------

/** One edge of a ribbon, in corner units: from the top or bottom edge round to the side. */
interface RibbonEdge {
  from: Point;
  to: Point;
  bow: [number, number];
}

interface Ribbon {
  corner: Corner;
  /** The edge nearer the corner, and the one farther in. */
  outer: RibbonEdge;
  inner: RibbonEdge;
  /** 0-1: how much of the full satin this ribbon shows. */
  strength: number;
}

/**
 * Three ribbons of satin, two folded across the top-right corner and one
 * across the bottom-left. The edges differ, so each ribbon widens and
 * narrows as it turns, the way cloth does.
 */
const RIBBONS: Ribbon[] = [
  {
    corner: 'top-right',
    outer: { from: [0.1, -0.08], to: [-0.08, 0.2], bow: [-0.02, 0.03] },
    inner: { from: [0.44, -0.08], to: [-0.08, 0.46], bow: [0.05, 0.04] },
    strength: 1,
  },
  {
    corner: 'top-right',
    outer: { from: [0.48, -0.08], to: [-0.08, 0.52], bow: [0.04, 0.05] },
    inner: { from: [0.7, -0.08], to: [-0.08, 0.82], bow: [0.07, 0.02] },
    strength: 0.55,
  },
  {
    corner: 'bottom-left',
    outer: { from: [-0.08, 0.16], to: [0.14, -0.08], bow: [0.02, -0.02] },
    inner: { from: [-0.08, 0.42], to: [0.4, -0.08], bow: [0.05, 0.03] },
    strength: 0.7,
  },
];

/** Strokes across a ribbon. The blur below smooths the steps between them. */
const RIBBON_STROKES = 24;
/** Each stroke is this many times the spacing, so neighbours overlap and leave no seams. */
const RIBBON_OVERLAP = 1.5;

/**
 * Broad satin ribbons draped across two opposite corners, the middle of the
 * slide left as plain ground.
 *
 * A ribbon is drawn as a run of strokes that blend from its outer edge to
 * its inner one, each stroke following the curve. That is what makes it read
 * as cloth: the light follows the fold, which a gradient laid straight across
 * a curved band cannot do. Two soft crests catch the light (the sheen on a
 * dark ground, white on a light one) over a body of `mid` that fades to
 * nothing at both edges, so the ribbons melt into the ground.
 *
 * Where a ribbon narrows its strokes crowd together, and the uneven overlap
 * would show as fine ridges; a blur of under a hundredth of the short edge
 * irons them out. It is the one blur in the set, and it covers each corner's
 * ribbons only, never the whole canvas.
 */
function silk(colors: ArtColors, w: number, h: number): string {
  const k = inksFor(colors);
  const m = Math.min(w, h);
  const crest = k.dark ? k.glint : WHITE;
  const bodyPeak = (k.dark ? 0.42 : 0.34) * k.presence;
  const crestPeak = (k.dark ? 0.3 : 0.85) * k.presence;

  const corners: Corner[] = [];
  const drawn = new Map<Corner, string>();
  for (const ribbon of RIBBONS) {
    const place = (point: Point) => fromCorner(ribbon.corner, point, w, h, m);
    const outer = bowed(ribbon.outer.from, ribbon.outer.to, ribbon.outer.bow);
    const inner = bowed(ribbon.inner.from, ribbon.inner.to, ribbon.inner.bow);
    const widest = Math.max(
      ...[0.25, 0.5, 0.75].map((s) => {
        const [ax, ay] = place(cubicAt(outer, s));
        const [bx, by] = place(cubicAt(inner, s));
        return Math.hypot(bx - ax, by - ay);
      }),
    );
    const width = n((widest / RIBBON_STROKES) * RIBBON_OVERLAP);

    let body = '';
    let light = '';
    for (let i = 0; i <= RIBBON_STROKES; i++) {
      const t = i / RIBBON_STROKES;
      const [p0, p1, p2, p3] = outer.map((point, index) => place(lerp(point, inner[index], t)));
      const d = `M${pt(p0)}C${pt(p1)} ${pt(p2)} ${pt(p3)}`;
      const shading = (ribbon.strength * bodyPeak * Math.sin(Math.PI * t) ** 1.1) / RIBBON_OVERLAP;
      const shine =
        (ribbon.strength * crestPeak * (bump(t, 0.3, 0.085) + 0.55 * bump(t, 0.72, 0.06))) /
        RIBBON_OVERLAP;
      if (shading >= 0.004) body += `<path d="${d}" stroke-opacity="${o(shading)}"/>`;
      if (shine >= 0.004) light += `<path d="${d}" stroke-opacity="${o(shine)}"/>`;
    }
    if (!drawn.has(ribbon.corner)) corners.push(ribbon.corner);
    drawn.set(
      ribbon.corner,
      (drawn.get(ribbon.corner) ?? '') +
        `<g stroke="${k.mid}" stroke-width="${width}">${body}</g>` +
        `<g stroke="${crest}" stroke-width="${width}">${light}</g>`,
    );
  }

  const defs = `<filter id="sk-soft" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${n(m * 0.007)}"/></filter>`;
  const art = corners
    .map((corner) => `<g fill="none" filter="url(#sk-soft)">${drawn.get(corner)}</g>`)
    .join('');

  return svg(w, h, k.ground, defs, art);
}

// ---------------------------------------------------------------------------
// Spotlight
// ---------------------------------------------------------------------------

/**
 * A soft pool of light falling from above the top edge, and a gentle veil
 * that deepens toward the bottom corners, as a room does away from its one
 * lamp. No line at all: the light is brightest above the content box and has
 * faded to a few percent by the middle, so text reads on what is, in effect,
 * the plain ground.
 */
function spotlight(colors: ArtColors, w: number, h: number): string {
  const k = inksFor(colors);
  const m = Math.min(w, h);
  const light = k.dark ? k.glint : WHITE;
  const veil = k.dark ? BLACK : k.mid;

  const defs =
    `<radialGradient id="sl-glow" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${n(w / 2)} ${n(-m * 0.1)}) scale(${n(m * 0.85)} ${n(m * 1.05)})">` +
    stop(0, light, (k.dark ? 0.26 : 0.85) * k.presence) +
    stop(0.3, light, (k.dark ? 0.12 : 0.5) * k.presence) +
    stop(0.6, k.dark ? k.highlight : light, (k.dark ? 0.04 : 0.15) * k.presence) +
    stop(1, k.dark ? k.highlight : light, 0) +
    '</radialGradient>' +
    '<radialGradient id="sl-veil" cx=".5" cy="0" r="1.12">' +
    stop(0, veil, 0) +
    stop(0.5, veil, 0) +
    stop(1, veil, k.dark ? 0.55 : 0.32) +
    '</radialGradient>';
  const art =
    `<rect width="${w}" height="${h}" fill="url(#sl-veil)"/>` +
    `<rect width="${w}" height="${h}" fill="url(#sl-glow)"/>`;

  return svg(w, h, k.ground, defs, art);
}

// ---------------------------------------------------------------------------
// Marble
// ---------------------------------------------------------------------------

interface VeinSpec {
  corner: Corner;
  /** Where it enters and leaves, in corner units (both past the canvas edge for a full vein). */
  from: Point;
  to: Point;
  bow: [number, number];
  /** Widest point, in short edges. */
  width: number;
  /** The stretch of the curve drawn, for a vein that starts or dies out in the stone. */
  span: [number, number];
  /** 0-1. */
  strength: number;
  seed: number;
}

/**
 * Two vein systems, one across the top-right corner and one across the
 * bottom-left, all running the same way as veins in one slab do: a main vein,
 * a hairline companion that runs beside it for a stretch, and a fainter vein
 * nearer the corner. Fixed seeds: marble is irregular, but a design must look
 * the same every time it is drawn.
 */
const VEINS: VeinSpec[] = [
  {
    corner: 'top-right',
    from: [0.52, -0.08],
    to: [-0.08, 0.6],
    bow: [0.04, -0.03],
    width: 0.0028,
    span: [0, 1],
    strength: 1,
    seed: 11,
  },
  {
    corner: 'top-right',
    from: [0.45, -0.08],
    to: [-0.08, 0.52],
    bow: [0.06, -0.01],
    width: 0.0011,
    span: [0.12, 0.72],
    strength: 0.7,
    seed: 12,
  },
  {
    corner: 'top-right',
    from: [0.26, -0.08],
    to: [-0.08, 0.28],
    bow: [0.01, 0.03],
    width: 0.0015,
    span: [0, 1],
    strength: 0.6,
    seed: 13,
  },
  {
    corner: 'bottom-left',
    from: [-0.08, 0.5],
    to: [0.58, -0.08],
    bow: [-0.03, 0.05],
    width: 0.0025,
    span: [0, 1],
    strength: 1,
    seed: 21,
  },
  {
    corner: 'bottom-left',
    from: [-0.08, 0.57],
    to: [0.5, -0.08],
    bow: [0.02, 0.06],
    width: 0.001,
    span: [0.3, 0.9],
    strength: 0.65,
    seed: 22,
  },
  {
    corner: 'bottom-left',
    from: [-0.08, 0.26],
    to: [0.26, -0.08],
    bow: [0.02, 0.0],
    width: 0.0014,
    span: [0, 1],
    strength: 0.55,
    seed: 23,
  },
];

const VEIN_SAMPLES = 64;

/**
 * A vein's centre line: the bowed curve with a little irregularity laid
 * along it (two slow waves, never a zigzag), and its width at each point,
 * swelling and thinning, tapering only where it begins or ends inside the
 * slide.
 */
function veinLine(
  spec: VeinSpec,
  w: number,
  h: number,
  m: number,
): { points: Point[]; widths: number[] } {
  const rand = seeded(spec.seed);
  const curve = bowed(spec.from, spec.to, spec.bow).map((point) =>
    fromCorner(spec.corner, point, w, h, m),
  );
  const wobble = [
    { weight: 0.7, cycles: 2 + rand() * 2, phase: rand() * Math.PI * 2 },
    { weight: 0.3, cycles: 6 + rand() * 4, phase: rand() * Math.PI * 2 },
  ];
  const swell = { cycles: 1 + rand() * 1.5, phase: rand() * Math.PI * 2 };
  const [start, end] = spec.span;

  const points: Point[] = [];
  const widths: number[] = [];
  for (let i = 0; i <= VEIN_SAMPLES; i++) {
    const s = start + ((end - start) * i) / VEIN_SAMPLES;
    const [x, y] = cubicAt(curve, s);
    const [ax, ay] = cubicAt(curve, Math.max(0, s - 0.01));
    const [bx, by] = cubicAt(curve, Math.min(1, s + 0.01));
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const offset =
      wobble.reduce(
        (sum, wave) => sum + wave.weight * Math.sin(Math.PI * 2 * wave.cycles * s + wave.phase),
        0,
      ) *
      m *
      0.006;
    points.push([x - ((by - ay) / length) * offset, y + ((bx - ax) / length) * offset]);

    const fadeIn = start > 0 ? Math.min(1, (s - start) / ((end - start) * 0.25)) : 1;
    const fadeOut = end < 1 ? Math.min(1, (end - s) / ((end - start) * 0.25)) : 1;
    const thickness = 0.55 + 0.45 * Math.sin(Math.PI * 2 * swell.cycles * s + swell.phase);
    widths.push(spec.width * m * Math.max(0.15, thickness) * Math.min(fadeIn, fadeOut));
  }
  return { points, widths };
}

/**
 * A vein as a filled outline rather than a stroke, so it can swell and thin
 * along its length the way a real one does.
 */
function taper(points: Point[], widths: number[]): string {
  const left: string[] = [];
  const right: string[] = [];
  points.forEach(([x, y], index) => {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const tx = after[0] - before[0];
    const ty = after[1] - before[1];
    const length = Math.hypot(tx, ty) || 1;
    const half = widths[index] / 2;
    const ox = (-ty / length) * half;
    const oy = (tx / length) * half;
    left.push(pt([x + ox, y + oy]));
    right.push(pt([x - ox, y - oy]));
  });
  return `M${left.join('L')}L${right.reverse().join('L')}Z`;
}

/**
 * A few fine veins crossing two opposite corners, each a crisp core inside a
 * double halo of `mid`, over a faint cloud of `mid` that lets the ground read
 * as stone. The veins reach into the content box only as hairlines.
 */
function marble(colors: ArtColors, w: number, h: number): string {
  const k = inksFor(colors);
  const m = Math.min(w, h);
  const core = k.dark ? k.glint : k.highlight;

  let halos = '';
  let cores = '';
  for (const spec of VEINS) {
    const { points, widths } = veinLine(spec, w, h, m);
    const line = `M${points.map(pt).join('L')}`;
    halos +=
      `<path d="${line}" stroke-width="${n(m * 0.018)}" stroke-opacity="${o((k.dark ? 0.06 : 0.1) * spec.strength * k.presence)}"/>` +
      `<path d="${line}" stroke-width="${n(m * 0.006)}" stroke-opacity="${o((k.dark ? 0.12 : 0.18) * spec.strength * k.presence)}"/>`;
    cores += `<path d="${taper(points, widths)}" fill-opacity="${o((k.dark ? 0.62 : 0.55) * spec.strength * k.presence)}"/>`;
  }

  const clouds: Point[] = [
    fromCorner('top-right', [0.24, 0.24], w, h, m),
    fromCorner('bottom-left', [0.24, 0.24], w, h, m),
  ];
  const defs = clouds
    .map(
      ([cx, cy], index) =>
        `<radialGradient id="mb-cloud-${index}" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(m * 0.6)}">` +
        stop(0, k.mid, k.dark ? 0.16 : 0.2) +
        stop(1, k.mid, 0) +
        '</radialGradient>',
    )
    .join('');
  const art =
    clouds
      .map(
        ([cx, cy], index) =>
          `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(m * 0.6)}" fill="url(#mb-cloud-${index})"/>`,
      )
      .join('') +
    `<g fill="none" stroke="${k.mid}" stroke-linecap="round" stroke-linejoin="round">${halos}</g>` +
    `<g fill="${core}">${cores}</g>`;

  return svg(w, h, k.ground, defs, art);
}

// ---------------------------------------------------------------------------
// Arch
// ---------------------------------------------------------------------------

/**
 * An arched window as tall as the slide: a fine double line that stands in
 * the side margins and turns over in a crown at the top, a keystone jewel at
 * the apex, and a soft light falling inside from it.
 *
 * The sides and the apex sit in the margin, so they frame the text rather
 * than cross it. The crown's shoulders cannot: on the way down from the apex
 * they pass the content box's two top corners, which is exactly where most
 * layouts start their words (an eyebrow, then the first line of the
 * headline). So the line is metal only where it stands in the margin, and
 * across those corners it fades to a ghost of itself, as does the light,
 * which pools under the apex rather than filling the crown. The eye still
 * completes the arch from the lit apex and the sides, where a line through a
 * word would be the first thing it saw.
 *
 * The crown is a half circle, flattened to a half ellipse when the slide is
 * wider than tall, where a half circle would not fit.
 */
function arch(colors: ArtColors, w: number, h: number): string {
  const k = inksFor(colors);
  const m = Math.min(w, h);
  const cx = w / 2;
  const side = m * 0.032;
  const rise = m * 0.032;
  const gap = m * 0.015;
  const below = h + m * 0.01;
  const radiusX = w / 2 - side;
  const radiusY = Math.min(radiusX, h * 0.46);
  const spring = rise + radiusY;
  // 8% of the short edge is the narrowest margin `formats.ts` keeps clear of
  // text, on any side of any format. The crown is over the content box from
  // that far below the top edge down to `corner`, the height at which it
  // crosses that far in from the side.
  const clear = m * 0.08;
  const corner = spring - radiusY * Math.sqrt(1 - ((cx - clear) / radiusX) ** 2);
  const ghost = 0.1 * k.presence;

  const shape = (inset: number) => {
    const rx = radiusX - inset;
    const ry = radiusY - inset;
    const springline = rise + inset + ry;
    return `M${n(cx - rx)} ${n(below)}V${n(springline)}A${n(rx)} ${n(ry)} 0 0 1 ${n(cx + rx)} ${n(springline)}V${n(below)}`;
  };
  const glow = k.dark ? k.glint : WHITE;
  // On a light ground the glint is the paler tone, close to the paper, and a
  // hairline drawn in it would all but vanish; there the lit stretch is the
  // metal's own body.
  const lit = k.dark ? k.glint : k.highlight;
  const at = (y: number) => y / h;

  // The metal runs top to bottom: lit at the apex, a ghost from the top of
  // the content box down to where the crown leaves it, back to full strength
  // by the springline, and falling to the shade at the floor.
  const defs =
    `<linearGradient id="ar-line" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${n(h)}">` +
    stop(at(rise), lit, 0.75) +
    stop(at(clear), lit, ghost) +
    stop(at(corner), lit, ghost) +
    stop(at((corner + spring) / 2), lit, 0.5) +
    stop(at(spring), lit) +
    stop(at(spring + (h - spring) * 0.45), k.highlight) +
    stop(1, k.shade) +
    '</linearGradient>' +
    `<radialGradient id="ar-glow" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${n(cx)} ${n(rise)}) scale(${n(radiusX * 0.9)} ${n(h * 0.7)})">` +
    stop(0, glow, (k.dark ? 0.14 : 0.75) * k.presence) +
    stop(0.5, glow, (k.dark ? 0.05 : 0.28) * k.presence) +
    stop(1, glow, 0) +
    '</radialGradient>';
  const art =
    `<path d="${shape(gap)}Z" fill="url(#ar-glow)"/>` +
    `<path d="${shape(0)}" fill="none" stroke="url(#ar-line)" stroke-width="${n(m * 0.0026)}"/>` +
    `<path d="${shape(gap)}" fill="none" stroke="url(#ar-line)" stroke-width="${n(m * 0.0012)}" stroke-opacity=".65"/>` +
    `<path d="${diamond(cx, rise + gap / 2, m * 0.011)}" fill="${lit}" stroke="${k.ground}" stroke-width="${n(m * 0.003)}"/>`;

  return svg(w, h, k.ground, defs, art);
}

// ---------------------------------------------------------------------------
// Pinstripe
// ---------------------------------------------------------------------------

/**
 * Very fine vertical stripes across the whole slide, strongest in the top
 * and bottom margins and close to nothing in the middle, with two thin metal
 * rules across the margins. Like the cloth it is named for, it is a texture
 * you notice second.
 */
function pinstripe(colors: ArtColors, w: number, h: number): string {
  const k = inksFor(colors);
  const m = Math.min(w, h);
  const pitch = m * 0.034;
  const count = Math.floor(w / pitch) + 1;
  const first = (w - (count - 1) * pitch) / 2;
  const rule = m * 0.058;

  let stripes = '';
  for (let i = 0; i < count; i++) stripes += `M${n(first + i * pitch)} 0V${h}`;

  const near = rule / h;
  const settled = Math.min(0.45, (rule + m * 0.12) / h);
  const defs =
    `<linearGradient id="ps-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${h}">` +
    stop(0, k.highlight, 0.22 * k.presence) +
    stop(near, k.highlight, 0.14 * k.presence) +
    stop(settled, k.highlight, 0.05 * k.presence) +
    stop(0.5, k.highlight, 0.035 * k.presence) +
    stop(1 - settled, k.highlight, 0.05 * k.presence) +
    stop(1 - near, k.highlight, 0.14 * k.presence) +
    stop(1, k.highlight, 0.22 * k.presence) +
    '</linearGradient>' +
    foil('ps-foil', k, rule, 0, w - rule, 0);
  const art =
    `<path d="${stripes}" stroke="url(#ps-fade)" stroke-width="${n(m * 0.0012)}"/>` +
    `<path d="M${n(rule)} ${n(rule)}H${n(w - rule)}M${n(rule)} ${n(h - rule)}H${n(w - rule)}" stroke="url(#ps-foil)" stroke-width="${n(m * 0.0026)}"/>`;

  return svg(w, h, k.ground, defs, art);
}

// ---------------------------------------------------------------------------
// Lattice
// ---------------------------------------------------------------------------

/**
 * A fine diamond trellis with a small jewel at each crossing, faded through
 * an ellipse the shape of the canvas: full at the corners, gone well before
 * the middle, so the text sits in a clear field framed by the pattern.
 */
function lattice(colors: ArtColors, w: number, h: number): string {
  const k = inksFor(colors);
  const m = Math.min(w, h);
  const a = m * 0.042;
  const b = m * 0.06;
  const cx = w / 2;
  const cy = h / 2;
  const lean = a / b;
  const reach = Math.ceil((w / 2 + (lean * h) / 2) / (2 * a)) + 1;
  const spread = 0.62;
  const clear = 0.6;

  let lines = '';
  for (let i = -reach; i <= reach; i++) {
    const x = cx + 2 * a * i;
    lines += `M${n(x - lean * cy)} 0L${n(x + lean * (h - cy))} ${h}`;
    lines += `M${n(x + lean * cy)} 0L${n(x - lean * (h - cy))} ${h}`;
  }

  let jewels = '';
  const columns = Math.ceil(cx / a);
  const rows = Math.ceil(cy / b);
  for (let s = -columns; s <= columns; s++) {
    for (let t = -rows; t <= rows; t++) {
      if ((s + t) % 2 !== 0) continue;
      const x = cx + a * s;
      const y = cy + b * t;
      const radius = Math.hypot((x - cx) / (w * spread), (y - cy) / (h * spread));
      if (radius < clear || x < 0 || x > w || y < 0 || y > h) continue;
      jewels += diamond(x, y, m * 0.0035);
    }
  }

  const defs =
    `<radialGradient id="lt-fade" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${n(cx)} ${n(cy)}) scale(${n(w * spread)} ${n(h * spread)})">` +
    stop(0, k.highlight, 0) +
    stop(clear, k.highlight, 0) +
    stop(0.85, k.highlight, 0.18 * k.presence) +
    stop(1, k.highlight, 0.38 * k.presence) +
    '</radialGradient>';
  const art =
    `<path d="${lines}" fill="none" stroke="url(#lt-fade)" stroke-width="${n(m * 0.0012)}"/>` +
    `<path d="${jewels}" fill="url(#lt-fade)"/>`;

  return svg(w, h, k.ground, defs, art);
}

// ---------------------------------------------------------------------------
// Guilloche
// ---------------------------------------------------------------------------

/**
 * One engraved band: `strands` hairlines, each a circle of `radius` rippled
 * by `waves` waves of `amplitude`, every strand a step out of phase with the
 * last, which is what braids them into the rope a rose engine cuts. Only the
 * arc from `start` to `end` (radians) is drawn; the rest is off the slide.
 */
function braid(
  center: Point,
  radius: number,
  amplitude: number,
  waves: number,
  strands: number,
  start: number,
  end: number,
): string {
  const STEPS = 84;
  let d = '';
  for (let strand = 0; strand < strands; strand++) {
    const phase = (Math.PI * 2 * strand) / strands;
    for (let i = 0; i <= STEPS; i++) {
      const angle = start + ((end - start) * i) / STEPS;
      const r = radius + amplitude * Math.sin(waves * angle + phase);
      d += `${i === 0 ? 'M' : 'L'}${pt([center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)])}`;
    }
  }
  return d;
}

/**
 * The engraving of a watch dial or a fine certificate: two braided bands
 * between fine rings, turning out of the top-right corner like a seal, over
 * a faint warmth of `mid`. All hairlines, and all within a third of the
 * short edge of the corner; the rest of the slide is plain ground.
 */
function guilloche(colors: ArtColors, w: number, h: number): string {
  const k = inksFor(colors);
  const m = Math.min(w, h);
  const center: Point = [w + m * 0.05, -m * 0.05];
  // From just right of straight down to just above straight left: the
  // quarter that falls on the slide, with a little to spare at each end.
  const start = Math.PI / 2 - 0.2;
  const end = Math.PI + 0.2;
  const ring = (r: number) =>
    `M${pt([center[0] + r * Math.cos(start), center[1] + r * Math.sin(start)])}` +
    `A${n(r)} ${n(r)} 0 0 1 ${pt([center[0] + r * Math.cos(end), center[1] + r * Math.sin(end)])}`;

  const defs =
    `<radialGradient id="gu-warmth" gradientUnits="userSpaceOnUse" cx="${n(center[0])}" cy="${n(center[1])}" r="${n(m * 0.5)}">` +
    stop(0, k.mid, 0.3 * k.presence) +
    stop(0.7, k.mid, 0.12 * k.presence) +
    stop(1, k.mid, 0) +
    '</radialGradient>' +
    foil('gu-foil', k, center[0] - m * 0.42, center[1], center[0], center[1] + m * 0.42);
  const art =
    `<circle cx="${n(center[0])}" cy="${n(center[1])}" r="${n(m * 0.5)}" fill="url(#gu-warmth)"/>` +
    `<path d="${ring(m * 0.245)}${ring(m * 0.3)}${ring(m * 0.33)}${ring(m * 0.39)}" fill="none" stroke="url(#gu-foil)" stroke-width="${n(m * 0.0016)}"/>` +
    `<path d="${braid(center, m * 0.36, m * 0.022, 28, 9, start, end)}${braid(center, m * 0.272, m * 0.016, 22, 7, start, end)}" fill="none" stroke="${k.highlight}" stroke-opacity="${o(0.34 * k.presence)}" stroke-width="${n(m * 0.0011)}"/>`;

  return svg(w, h, k.ground, defs, art);
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

export const LUXURY_ARTS: ArtStyle[] = [
  { id: 'gilded-frame', name: 'Gilded Frame', kind: 'luxury', premium: true, draw: gildedFrame },
  { id: 'art-deco', name: 'Art Deco', kind: 'luxury', premium: true, draw: artDeco },
  { id: 'silk', name: 'Silk', kind: 'luxury', premium: true, draw: silk },
  { id: 'spotlight', name: 'Spotlight', kind: 'luxury', premium: true, draw: spotlight },
  { id: 'marble', name: 'Marble', kind: 'luxury', premium: true, draw: marble },
  { id: 'arch', name: 'Arch', kind: 'luxury', premium: true, draw: arch },
  { id: 'pinstripe', name: 'Pinstripe', kind: 'luxury', premium: true, draw: pinstripe },
  { id: 'lattice', name: 'Lattice', kind: 'luxury', premium: true, draw: lattice },
  { id: 'guilloche', name: 'Guilloche', kind: 'luxury', premium: true, draw: guilloche },
];
