/**
 * The pieces PostGear's own sticker art is drawn from (Module 12): SVG
 * built here and turned into pictures by sharp. The look is the app's own:
 * a black outline, a flat fill and a small hard shadow, like its buttons.
 *
 * Words are drawn as outlines from the Studio's OFL fonts in
 * `packages/design-engine/fonts` (read with fontkit), so no system font is
 * ever asked for and every machine draws the same pixels. Everything is
 * drawn around (0, 0) on a 640 px square; `stickers-draw.ts` trims it.
 */
import * as path from 'node:path';
import * as fontkit from 'fontkit';

export const INK = '#111111';

/** The fills, all from the app's own bright set. */
export const COLOURS = {
  yellow: '#FFD60A',
  pink: '#FF5D8F',
  blue: '#4D7CFE',
  sky: '#38BDF8',
  green: '#2EC27E',
  orange: '#FF8A3D',
  violet: '#8B5CF6',
  red: '#F0453A',
  white: '#FFFFFF',
} as const;
export type ColourName = keyof typeof COLOURS;

/** The outline's full stroke (half shows outside the fill) and the shadow's offset, in px of the 640 square. */
export const OUTLINE = 16;
export const SHADOW = 10;

export type ArtFont = 'luckiest-guy' | 'titan-one' | 'bangers';
export const ART_FONT_NAMES: Record<ArtFont, string> = {
  'luckiest-guy': 'Luckiest Guy',
  'titan-one': 'Titan One',
  bangers: 'Bangers',
};

const FONTS_DIR = path.resolve(__dirname, '..', '..', 'design-engine', 'fonts');
const fonts = new Map<ArtFont, fontkit.FontkitFont>();

function fontFor(name: ArtFont): fontkit.FontkitFont {
  let font = fonts.get(name);
  if (!font) {
    font = fontkit.openSync(path.join(FONTS_DIR, `${name}-400.woff2`));
    fonts.set(name, font);
  }
  return font;
}

/** One line of words as an outline path, its baseline at y = 0, and its ink box. */
export interface TextShape {
  d: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function textShape(font: ArtFont, text: string, size: number): TextShape {
  const face = fontFor(font);
  const scale = size / face.unitsPerEm;
  const run = face.layout(text);
  const parts: string[] = [];
  let pen = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  run.glyphs.forEach((glyph, index) => {
    const position = run.positions[index];
    if (!position) return;
    const x = pen + position.xOffset * scale;
    const y = -position.yOffset * scale;
    const box = glyph.path.bbox;
    // A space has no outline (its box is infinite).
    if (Number.isFinite(box.minX) && box.maxX > box.minX) {
      minX = Math.min(minX, x + box.minX * scale);
      maxX = Math.max(maxX, x + box.maxX * scale);
      top = Math.min(top, y - box.maxY * scale);
      bottom = Math.max(bottom, y - box.minY * scale);
      parts.push(glyph.path.scale(scale, -scale).translate(x, y).toSVG());
    }
    pen += position.xAdvance * scale;
  });
  if (parts.length === 0) throw new Error(`No outline for "${text}"`);
  return { d: parts.join(' '), left: minX, top, width: maxX - minX, height: bottom - top };
}

/**
 * Lines of words centred on (0, 0), each line as wide as it is drawn, the
 * size made smaller until the widest line fits `maxWidth`.
 */
export function wordsBody(
  font: ArtFont,
  lines: readonly string[],
  options: { size: number; maxWidth: number; gap?: number },
): { body: string; width: number; height: number } {
  let size = options.size;
  let shapes = lines.map((line) => textShape(font, line, size));
  const widest = Math.max(...shapes.map((shape) => shape.width));
  if (widest > options.maxWidth) {
    size = (size * options.maxWidth) / widest;
    shapes = lines.map((line) => textShape(font, line, size));
  }
  const gap = (options.gap ?? 0.12) * size;
  const height = shapes.reduce((sum, shape) => sum + shape.height, 0) + gap * (shapes.length - 1);
  let y = -height / 2;
  const body = shapes
    .map((shape) => {
      const dx = -shape.left - shape.width / 2;
      const dy = y - shape.top;
      y += shape.height + gap;
      return `<path transform="translate(${round(dx)} ${round(dy)})" d="${shape.d}"/>`;
    })
    .join('');
  return { body, width: Math.max(...shapes.map((shape) => shape.width)), height };
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Filled shapes (SVG elements with no paint of their own) drawn the
 * PostGear way: a hard shadow, then the fill with its black outline.
 */
export function inked(
  body: string,
  fill: string,
  options: { outline?: number; shadow?: number } = {},
): string {
  const outline = options.outline ?? OUTLINE;
  const shadow = options.shadow ?? SHADOW;
  const stroke = `stroke="${INK}" stroke-width="${outline}" stroke-linejoin="round" stroke-linecap="round"`;
  const under =
    shadow > 0
      ? `<g transform="translate(${shadow} ${shadow})" fill="${INK}" ${stroke}>${body}</g>`
      : '';
  return `${under}<g fill="${fill}" ${stroke} paint-order="stroke">${body}</g>`;
}

/** A thick line (drawn by its stroke): a hard shadow, the outline, then its colour. */
export function inkedLine(
  d: string,
  colour: string,
  width: number,
  options: { outline?: number; shadow?: number } = {},
): string {
  const outline = options.outline ?? OUTLINE;
  const shadow = options.shadow ?? SHADOW;
  const line = (strokeWidth: number, stroke: string, offset: number) =>
    `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" ` +
    `stroke-linejoin="round"${offset ? ` transform="translate(${offset} ${offset})"` : ''}/>`;
  return `${shadow > 0 ? line(width + outline, INK, shadow) : ''}${line(width + outline, INK, 0)}${line(width, colour, 0)}`;
}

/** Plain black marks (a face's eyes and mouth): no outline, no shadow. */
export function ink(body: string): string {
  return `<g fill="${INK}">${body}</g>`;
}

/** A black stroke for a face's lines. */
export function inkStroke(d: string, width = 22): string {
  return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export function polygon(points: ReadonlyArray<readonly [number, number]>): string {
  return `<path d="M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join(' L')} Z"/>`;
}

/** A star of `points` points, its first tip straight up. */
export function starPoints(points: number, outer: number, inner: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < points * 2; k += 1) {
    const radius = k % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (k * Math.PI) / points;
    out.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return out;
}

/** A heart about `size` px tall, centred. */
export function heart(size = 300): string {
  const s = size / 310;
  const pts = [
    'M0 150',
    'C-30 120 -170 40 -170 -50',
    'C-170 -120 -110 -160 -60 -160',
    'C-25 -160 0 -135 0 -110',
    'C0 -135 25 -160 60 -160',
    'C110 -160 170 -120 170 -50',
    'C170 40 30 120 0 150 Z',
  ].join(' ');
  return `<path transform="translate(0 5) scale(${round(s)})" d="${pts}"/>`;
}

/** A teardrop, its point up, centred on (x, y). */
export function drop(x: number, y: number, size = 50): string {
  const s = size / 60;
  return `<path transform="translate(${x} ${y}) scale(${round(s)})" d="M0 -32 C14 -8 24 8 24 18 A24 24 0 0 1 -24 18 C-24 8 -14 -8 0 -32 Z"/>`;
}

/** A four-point sparkle centred on (x, y). */
export function sparkle(x: number, y: number, radius: number): string {
  const r = radius;
  const k = r * 0.12;
  return `<path transform="translate(${x} ${y})" d="M0 ${-r} Q${k} ${-k} ${r} 0 Q${k} ${k} 0 ${r} Q${-k} ${k} ${-r} 0 Q${-k} ${-k} 0 ${-r} Z"/>`;
}

/** Wraps drawn content in a `<g>` turned, scaled and moved about (0, 0). */
export function moved(content: string, move: Motion | null): string {
  if (!move) return content;
  const parts: string[] = [];
  if (move.dx || move.dy) parts.push(`translate(${round(move.dx ?? 0)} ${round(move.dy ?? 0)})`);
  if (move.pivot) parts.push(`translate(${move.pivot[0]} ${move.pivot[1]})`);
  if (move.rotate) parts.push(`rotate(${round(move.rotate)})`);
  if (move.scale !== undefined || move.scaleX !== undefined) {
    const sx = (move.scaleX ?? 1) * (move.scale ?? 1);
    const sy = move.scale ?? 1;
    parts.push(`scale(${round(sx)} ${round(sy)})`);
  }
  if (move.pivot) parts.push(`translate(${-move.pivot[0]} ${-move.pivot[1]})`);
  const opacity = move.opacity !== undefined ? ` opacity="${round(move.opacity)}"` : '';
  return `<g transform="${parts.join(' ')}"${opacity}>${content}</g>`;
}

/** How the whole sticker is placed at one moment of its loop. */
export interface Motion {
  dx?: number;
  dy?: number;
  rotate?: number;
  scale?: number;
  scaleX?: number;
  opacity?: number;
  /** The point it turns and scales about (default the centre). */
  pivot?: readonly [number, number];
}

/** An overshooting ease for pops, 0 to 1. */
export function easeOutBack(t: number): number {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** The ready motions, each a loop: `t` runs from 0 up to (not including) 1. */
export const MOTIONS = {
  bounce: (t: number): Motion => ({ dy: -46 * Math.sin(Math.PI * t) }),
  pulse: (t: number): Motion => ({ scale: 1 + 0.08 * Math.sin(2 * Math.PI * t) }),
  wiggle: (t: number): Motion => ({ rotate: 9 * Math.sin(2 * Math.PI * t) }),
  shake: (t: number): Motion => ({ dx: 9 * Math.sin(8 * Math.PI * t) }),
  sway: (t: number): Motion => ({ rotate: 5 * Math.sin(2 * Math.PI * t) }),
  /**
   * Holds, then pops back in with an overshoot halfway through the loop, so
   * the first and the last frame (what a sticker that plays once keeps) are full size.
   */
  pop: (t: number): Motion => {
    const u = (t + 0.5) % 1;
    return { scale: u < 0.3 ? 0.25 + 0.75 * easeOutBack(u / 0.3) : 1 };
  },
  /** Turns like a coin, edge on halfway. */
  flip: (t: number): Motion => ({ scaleX: Math.max(0.06, Math.abs(Math.cos(2 * Math.PI * t))) }),
  swing: (t: number): Motion => ({ rotate: 16 * Math.sin(2 * Math.PI * t), pivot: [0, -170] }),
  rise: (t: number): Motion => ({ dy: -22 * Math.sin(2 * Math.PI * t) }),
} as const;
export type MotionName = keyof typeof MOTIONS;

/** A nudge along a direction (degrees, 0 is right, clockwise), for arrows that point. */
export function nudge(angleDeg: number, t: number): Motion {
  const radians = (angleDeg * Math.PI) / 180;
  const distance = 24 * Math.sin(2 * Math.PI * t);
  return { dx: distance * Math.cos(radians), dy: distance * Math.sin(radians) };
}
