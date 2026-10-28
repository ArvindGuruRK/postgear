/**
 * CarouselClick's ten generated patterns, ported byte for byte.
 *
 * The code below is CarouselClick's `patternSvg` (from
 * `src/features/templates/patterns.ts`) with only its quotes and line breaks
 * changed. That includes its private helpers: `n`, which rounds every number
 * to one decimal, and `mix`, which writes lower-case hex and does not clamp.
 * Both differ from `color.ts` in the last digit, and swapping either in would
 * move a coordinate or a stop colour by one unit: invisible on a slide, but a
 * ported look would then no longer be the look it was ported from, and there
 * would be no cheap way to prove it still is. `patterns.test.ts` freezes the
 * output against hashes recorded from CarouselClick's own file, so an edit
 * that changes a single character fails there.
 *
 * Each pattern is drawn at the exact canvas size (the viewBox is the canvas),
 * so every format gets its own composition rather than a crop of another. The
 * techniques are the ones the hand-made originals use (heavily blurred
 * gradient shapes for light and depth, translucent planes), and the busy part
 * of each drawing stays near an edge or a corner so the text keeps a calm area.
 */
import type { ArtColors, ArtStyle } from './types';

type PatternId =
  | 'aurora'
  | 'prism'
  | 'beams'
  | 'arcs'
  | 'planes'
  | 'waves'
  | 'horizon'
  | 'halftone'
  | 'glass'
  | 'minimal';

/** CarouselClick's own names, in its own order (the gallery lists them this way). */
const PATTERNS: Record<PatternId, string> = {
  aurora: 'Aurora',
  prism: 'Prism',
  beams: 'Beams',
  arcs: 'Arcs',
  planes: 'Planes',
  waves: 'Waves',
  horizon: 'Horizon',
  halftone: 'Halftone',
  glass: 'Glass',
  minimal: 'Minimal',
};

/** One decimal: enough for a 1080 px canvas, and it keeps the strings short. */
const n = (value: number) => Math.round(value * 10) / 10;

/** Blends two `#rrggbb` colours; `amount` 0 is `a`, 1 is `b`. CarouselClick's, not `color.ts`'s. */
function mix(a: string, b: string, amount: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function patternSvg(pattern: PatternId, colors: ArtColors, width: number, height: number): string {
  const { background, mid, highlight, sheen } = colors;
  const w = width;
  const h = height;
  const m = Math.min(w, h);
  const blur = (id: string, amount: number) =>
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${n(amount)}"/></filter>`;
  // Bright, then deep, then the ground: the gradient the originals use for their glows.
  const glow = (id: string, x1: number, y1: number, x2: number, y2: number) =>
    `<linearGradient id="${id}" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" gradientUnits="userSpaceOnUse"><stop stop-color="${highlight}"/><stop offset=".6" stop-color="${mid}"/><stop offset="1" stop-color="${background}"/></linearGradient>`;

  let defs = '';
  let art = '';

  switch (pattern) {
    case 'aurora':
      // Two large blurred glows, bright at the far corners and deep toward the content, like Drift.
      defs =
        blur('b', m * 0.08) +
        glow('g1', w * 1.1, h * 1.05, w * 0.55, h * 0.7) +
        glow('g2', -w * 0.25, -h * 0.1, w * 0.55, h * 0.32);
      art = [
        `<ellipse cx="${n(w * 0.9)}" cy="${n(h * 0.95)}" rx="${n(w * 0.7)}" ry="${n(h * 0.2)}" transform="rotate(-14 ${n(w * 0.9)} ${n(h * 0.95)})" fill="url(#g1)" filter="url(#b)"/>`,
        `<ellipse cx="${n(w * 0.05)}" cy="${n(h * 0.06)}" rx="${n(w * 0.62)}" ry="${n(h * 0.2)}" transform="rotate(-18 ${n(w * 0.05)} ${n(h * 0.06)})" fill="url(#g2)" opacity=".85" filter="url(#b)"/>`,
      ].join('');
      break;

    case 'prism': {
      // Rhombi cascading off the top-right corner, each a sheen-to-mid gradient at low opacity, like Cascade.
      const size = m * 0.48;
      defs = `<linearGradient id="s" x1="1" y1="0" x2="0" y2="0"><stop stop-color="${sheen}" stop-opacity=".9"/><stop offset="1" stop-color="${mid}" stop-opacity=".85"/></linearGradient>${blur('b', m * 0.1)}`;
      art =
        `<circle cx="${n(w)}" cy="0" r="${n(m * 0.45)}" fill="${highlight}" opacity=".18" filter="url(#b)"/>` +
        Array.from({ length: 5 }, (_, i) => {
          const x = w - m * 0.038 - i * size * 0.2;
          return `<rect width="${n(size)}" height="${n(size)}" transform="matrix(.5 .866 .5 -.866 ${n(x)} ${n(m * 0.188)})" fill="url(#s)" opacity=".16"/>`;
        }).join('');
      break;
    }

    case 'beams': {
      defs =
        `<linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${highlight}" stop-opacity=".85"/><stop offset=".45" stop-color="${mid}" stop-opacity=".45"/><stop offset="1" stop-color="${mid}" stop-opacity="0"/></linearGradient>` +
        blur('b', m * 0.025) +
        blur('g', m * 0.1);
      const origin = { x: w * 1.02, y: -h * 0.02 };
      const length = Math.hypot(w, h) * 1.1;
      art =
        `<circle cx="${n(origin.x)}" cy="${n(origin.y)}" r="${n(m * 0.35)}" fill="${highlight}" opacity=".35" filter="url(#g)"/>` +
        [
          [128, 0.07, 0.9],
          [141, 0.035, 0.6],
          [152, 0.1, 0.45],
        ]
          .map(
            ([angle, thickness, opacity]) =>
              `<rect x="${n(origin.x)}" y="${n(origin.y - (m * thickness) / 2)}" width="${n(length)}" height="${n(m * thickness)}" transform="rotate(${angle} ${n(origin.x)} ${n(origin.y)})" fill="url(#beam)" opacity="${opacity}" filter="url(#b)"/>`,
          )
          .join('');
      break;
    }

    case 'arcs': {
      const cx = w * 1.02;
      const cy = h * 1.02;
      defs =
        `<linearGradient id="ring" x1="${n(cx - m * 0.9)}" y1="${n(cy)}" x2="${n(cx)}" y2="${n(cy - m * 0.9)}" gradientUnits="userSpaceOnUse"><stop stop-color="${highlight}" stop-opacity=".05"/><stop offset=".5" stop-color="${highlight}" stop-opacity=".7"/><stop offset="1" stop-color="${highlight}" stop-opacity=".05"/></linearGradient>` +
        blur('b', m * 0.09);
      art =
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(m * 0.42)}" fill="${mid}" opacity=".9" filter="url(#b)"/>` +
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(m * 0.2)}" fill="${highlight}" opacity=".35" filter="url(#b)"/>` +
        Array.from({ length: 7 }, (_, i) => {
          const radius = m * (0.24 + i * 0.1);
          return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(radius)}" fill="none" stroke="url(#ring)" stroke-width="${n(m * (0.006 - i * 0.0005))}" opacity="${(0.9 - i * 0.11).toFixed(2)}"/>`;
        }).join('');
      break;
    }

    case 'planes':
      // Large tonal planes like Shards and Slabs, with one bright edge for depth.
      defs = `<linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${mid}" stop-opacity=".95"/><stop offset="1" stop-color="${background}" stop-opacity=".2"/></linearGradient>`;
      art = [
        `<polygon points="${n(w * 0.52)},0 ${w},0 ${w},${n(h * 0.62)} ${n(w * 0.78)},${n(h * 0.5)}" fill="url(#p)" opacity=".85"/>`,
        `<polygon points="${n(w * 0.72)},0 ${w},0 ${w},${n(h * 0.34)}" fill="${mid}" opacity=".75"/>`,
        `<polygon points="0,${n(h * 0.8)} ${n(w * 0.62)},${n(h * 0.88)} ${n(w * 0.55)},${h} 0,${h}" fill="url(#p)" opacity=".7"/>`,
        `<line x1="${n(w * 0.52)}" y1="0" x2="${n(w * 0.78)}" y2="${n(h * 0.5)}" stroke="${highlight}" stroke-opacity=".7" stroke-width="${n(m * 0.003)}"/>`,
        `<line x1="0" y1="${n(h * 0.8)}" x2="${n(w * 0.62)}" y2="${n(h * 0.88)}" stroke="${highlight}" stroke-opacity=".5" stroke-width="${n(m * 0.003)}"/>`,
      ].join('');
      break;

    case 'waves': {
      defs = `<linearGradient id="r" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${mid}"/><stop offset=".7" stop-color="${highlight}"/><stop offset="1" stop-color="${mid}"/></linearGradient>${blur('b', m * 0.03)}`;
      const ribbon = (base: number, amp: number, opacity: number, blurred = false) => {
        const y = h * base;
        const a = m * amp;
        return `<path d="M0 ${n(y)}C${n(w * 0.25)} ${n(y - a * 2)} ${n(w * 0.55)} ${n(y + a * 1.6)} ${w} ${n(y - a)}V${h}H0Z" fill="url(#r)" opacity="${opacity}"${blurred ? ' filter="url(#b)"' : ''}/>`;
      };
      // Kept below the footer text so the bright crest never sits behind words.
      art =
        ribbon(0.86, 0.035, 0.5, true) +
        ribbon(0.89, 0.03, 0.35) +
        ribbon(0.93, 0.025, 0.55) +
        ribbon(0.97, 0.02, 0.8);
      break;
    }

    case 'horizon': {
      // A perspective floor fading into a glowing horizon.
      const horizon = h * 0.7;
      const vanishX = w * 0.5;
      defs =
        `<linearGradient id="fade" x1="0" y1="${n(horizon)}" x2="0" y2="${h}" gradientUnits="userSpaceOnUse"><stop stop-color="${highlight}" stop-opacity="0"/><stop offset="1" stop-color="${highlight}" stop-opacity=".55"/></linearGradient>` +
        blur('b', m * 0.06);
      const lines: string[] = [];
      for (let i = -12; i <= 12; i++)
        lines.push(`M${n(vanishX)} ${n(horizon)}L${n(vanishX + i * w * 0.14)} ${h}`);
      for (let i = 1; i <= 8; i++) {
        // biome-ignore lint/style/useExponentiationOperator: kept exactly as CarouselClick computes it, so the output stays byte for byte.
        const y = horizon + (h - horizon) * Math.pow(i / 8, 1.8);
        lines.push(`M0 ${n(y)}H${w}`);
      }
      art =
        `<ellipse cx="${n(vanishX)}" cy="${n(horizon)}" rx="${n(w * 0.6)}" ry="${n(m * 0.08)}" fill="${highlight}" opacity=".5" filter="url(#b)"/>` +
        `<ellipse cx="${n(vanishX)}" cy="${n(horizon)}" rx="${n(w * 0.9)}" ry="${n(m * 0.22)}" fill="${mid}" opacity=".7" filter="url(#b)"/>` +
        `<path d="${lines.join('')}" stroke="url(#fade)" stroke-width="${n(m * 0.002)}" fill="none"/>`;
      break;
    }

    case 'halftone': {
      const step = m * 0.03;
      const dots: string[] = [];
      for (let x = step / 2; x < w; x += step) {
        for (let y = step / 2; y < h; y += step) {
          // Dots grow toward the top-right corner and vanish before the text area.
          const t = 1 - Math.hypot((w - x) / (w * 0.55), y / (h * 0.4));
          if (t > 0.04)
            dots.push(
              `<circle cx="${n(x)}" cy="${n(y)}" r="${n(step * 0.42 * Math.min(1, t * 1.4))}"/>`,
            );
        }
      }
      defs = blur('b', m * 0.1);
      art = `<circle cx="${n(w)}" cy="0" r="${n(m * 0.5)}" fill="${mid}" opacity=".9" filter="url(#b)"/><g fill="${highlight}" opacity=".5">${dots.join('')}</g>`;
      break;
    }

    case 'glass': {
      // Frosted diagonal panes over a soft light, each with a bright leading edge.
      defs =
        `<linearGradient id="pane" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${sheen}" stop-opacity=".2"/><stop offset="1" stop-color="${sheen}" stop-opacity=".03"/></linearGradient>` +
        blur('b', m * 0.12);
      const pane = (x: number, thickness: number) => {
        const t = m * thickness;
        return `<polygon points="${n(x)},${h} ${n(x + t)},${h} ${w},${n(h - (w - x - t) * 1.25)} ${w},${n(h - (w - x) * 1.25)}" fill="url(#pane)"/><line x1="${n(x)}" y1="${h}" x2="${w}" y2="${n(h - (w - x) * 1.25)}" stroke="${sheen}" stroke-opacity=".3" stroke-width="${n(m * 0.002)}"/>`;
      };
      art =
        `<circle cx="${n(w * 0.95)}" cy="${n(h * 0.92)}" r="${n(m * 0.45)}" fill="${highlight}" opacity=".45" filter="url(#b)"/>` +
        `<circle cx="${n(w * 0.75)}" cy="${n(h * 0.75)}" r="${n(m * 0.4)}" fill="${mid}" opacity=".8" filter="url(#b)"/>` +
        pane(w * 0.38, 0.12) +
        pane(w * 0.56, 0.09) +
        pane(w * 0.72, 0.14);
      break;
    }

    case 'minimal':
      defs = blur('b', m * 0.12);
      art = [
        `<circle cx="${n(w)}" cy="${n(h)}" r="${n(m * 0.5)}" fill="${mid}" opacity=".95" filter="url(#b)"/>`,
        `<circle cx="${n(w)}" cy="${n(h)}" r="${n(m * 0.18)}" fill="${highlight}" opacity=".3" filter="url(#b)"/>`,
        `<rect x="${n(m * 0.035)}" y="${n(m * 0.035)}" width="${n(w - m * 0.07)}" height="${n(h - m * 0.07)}" rx="${n(m * 0.012)}" fill="none" stroke="${highlight}" stroke-opacity=".3" stroke-width="${n(m * 0.002)}"/>`,
        `<rect x="${n(w - m * 0.035 - m * 0.12)}" y="${n(m * 0.035 - m * 0.002)}" width="${n(m * 0.12)}" height="${n(m * 0.006)}" fill="${highlight}"/>`,
      ].join('');
      break;
  }

  // A gentle diagonal gradient instead of a flat fill gives every pattern some depth.
  const base = `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${background}"/><stop offset="1" stop-color="${mix(background, mid, 0.35)}"/></linearGradient>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${base}${defs}</defs><rect width="${w}" height="${h}" fill="url(#bg)"/>${art}</svg>`;
}

/**
 * Free on every plan: the patterns are the everyday looks, and they recolour
 * with any theme or brand kit, so they never date a design.
 */
export const PATTERN_ARTS: ArtStyle[] = (Object.keys(PATTERNS) as PatternId[]).map((id) => ({
  id,
  name: PATTERNS[id],
  kind: 'pattern',
  premium: false,
  draw: (colors: ArtColors, width: number, height: number) => patternSvg(id, colors, width, height),
}));
