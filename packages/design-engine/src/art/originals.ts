/**
 * CarouselClick's hand-made backgrounds, rebuilt as generators.
 *
 * CarouselClick ships eleven small vector files (Figma exports with no text,
 * logo or picture) and shows each as an `<img>` with `object-fit: cover` over
 * the template's ground, always in the colours it was drawn in. Here each
 * file is a function: the same shapes, the same viewBox and the same numbers,
 * with every colour literal replaced by a token. A token is one of the four
 * art colours, a fixed mix of two of them, or white mixed in at a fixed
 * amount. That buys two things at once:
 *
 * - On its home ground an original draws the file. `artColors` hands it
 *   `home`, and `home` was chosen so every token resolves back to the file's
 *   own literal (one, Drift's fade, lands a single step of red away).
 *   Rendered in Chromium beside the file drawn the CarouselClick way, every
 *   original is within 4 per channel on 99.97% or more of its pixels at
 *   1080 x 1350 and 1920 x 1080, except Ladder (99.52% and 99.49%, every
 *   miss on a bar edge): CarouselClick scales a small file through an
 *   `<img>`, which Chrome draws from a resampled raster, so its hard edges
 *   come out a little soft. The file's own markup sliced into the canvas
 *   scores exactly the same, and Ladder matches that pixel for pixel.
 * - On any other ground (a brand kit, another theme) it recolours like a
 *   pattern, which CarouselClick never did. PostGear's brand kit promise is
 *   that one click restyles everything, the art included.
 *
 * Every document keeps its file's viewBox and is drawn at the canvas size
 * with `preserveAspectRatio="xMidYMid slice"`, which is `object-fit: cover`
 * done inside the SVG: the same crop CarouselClick shows, in every format
 * (Canopy hangs from the top edge, so a landscape crop leaves only its
 * ground, exactly as in CarouselClick). A ground rect comes first because
 * some of the files are transparent and relied on the template's ground
 * showing through.
 *
 * Left out of the files, all invisible: Figma's clip to the whole frame (the
 * viewport already clips tighter), its flood-and-blend filter preamble (an
 * identity) and a grey rect hidden under the ground. Cascade's clip, a
 * quarter-turned rect, is written as the box it covers.
 */
import { mix } from '../color';
import type { ArtColors, ArtStyle } from './types';

/** A file's viewBox, sliced into the canvas the way `object-fit: cover` crops the file. */
function frame(
  colors: ArtColors,
  width: number,
  height: number,
  view: readonly [number, number],
  defs: string,
  drawing: string,
): string {
  const [vw, vh] = view;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid slice">${defs ? `<defs>${defs}</defs>` : ''}<rect width="${vw}" height="${vh}" fill="${colors.background}"/>${drawing}</svg>`;
}

/**
 * Figma's layer blur, without its preamble. `userSpaceOnUse` keeps the
 * file's own filter region (the blur is cut where the file cut it), and sRGB
 * keeps the blur's falloff the one the file was approved with.
 */
function blur(id: string, x: string, y: string, w: string, h: string, deviation: string): string {
  return `<filter id="${id}" x="${x}" y="${y}" width="${w}" height="${h}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${deviation}"/></filter>`;
}

/* Facets: the translucent rhombi of Cascade, Canopy, Tiers and Facets. */

/**
 * The gradient line of each facet, in the order the files assign them. The
 * coordinates are in the facet's own space (before its transform), so one set
 * serves every placement in every file.
 */
const FACET_LINES = [
  ['580.803', '575.417', '113.118', '575.417'],
  ['574.307', '568.921', '33.3944', '590.526'],
  ['561.316', '555.93', '33.3928', '577.513'],
  ['573.302', '582.918', '18.428', '590.318'],
  ['522.342', '516.957', '-0.0541358', '524.351'],
] as const;

/** Every file sets its facets on the same 519.649 square, at 10%. */
const FACET_SIZE = '519.649';

/**
 * Sheen to mid, as CarouselClick's own Prism reads these files. The first
 * facet was drawn a touch softer: an off-white (`#F7F7F7` at home, 4% of the
 * way to the mid) and both stops just under full strength.
 */
function facetGradient(colors: ArtColors, index: number): string {
  const [x1, y1, x2, y2] = FACET_LINES[index];
  const stops =
    index === 0
      ? `<stop stop-color="${mix(colors.sheen, colors.mid, 0.04)}" stop-opacity="0.85"/><stop offset="1" stop-color="${colors.mid}" stop-opacity="0.83"/>`
      : `<stop stop-color="${colors.sheen}"/><stop offset="1" stop-color="${colors.mid}"/>`;
  return `<linearGradient id="f${index}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">${stops}</linearGradient>`;
}

/** Facet `i` at `matrices[i]`, in gradient `i`: the files never pair them any other way. */
function facets(colors: ArtColors, matrices: readonly string[]): { defs: string; drawing: string } {
  return {
    defs: matrices.map((_, i) => facetGradient(colors, i)).join(''),
    drawing: matrices
      .map(
        (matrix, i) =>
          `<rect opacity="0.1" width="${FACET_SIZE}" height="${FACET_SIZE}" transform="matrix(${matrix})" fill="url(#f${i})"/>`,
      )
      .join(''),
  };
}

/** Facets standing on a point, stepped across the frame (Cascade, and Facets when tall). */
const upright = (xs: readonly string[]) => xs.map((x) => `0.5 0.866025 0.5 -0.866025 ${x} 202.97`);

/** Facets lying flat, stacked down the frame from one x (Canopy, Tiers, and Facets when wide). */
const flat = (x: string, ys: readonly string[]) =>
  ys.map((y) => `-0.866025 0.5 0.866025 0.5 ${x} ${y}`);

/** The five steps of a flat stack, as Tiers and the wide Facets file set them. */
const FLAT_STACK = ['123.719', '19.7897', '-84.1397', '-188.071', '-292'] as const;

/** Five upright facets from the top-right corner, kept to the corner's upper half by the file's clip. */
function cascade(colors: ArtColors, width: number, height: number): string {
  const { defs, drawing } = facets(
    colors,
    upright(['1038.72', '934.79', '830.86', '726.929', '623']),
  );
  return frame(
    colors,
    width,
    height,
    [1080, 1350],
    `${defs}<clipPath id="c"><rect x="623" width="457" height="653"/></clipPath>`,
    `<g clip-path="url(#c)">${drawing}</g>`,
  );
}

/** Three flat facets hanging from the top edge. */
function canopy(colors: ArtColors, width: number, height: number): string {
  const { defs, drawing } = facets(colors, flat('760.03', ['-262.281', '-366.21', '-470.14']));
  return frame(colors, width, height, [1080, 1350], defs, drawing);
}

/** Five flat facets stacked in the top-right corner. */
function tiers(colors: ArtColors, width: number, height: number): string {
  const { defs, drawing } = facets(colors, flat('877.03', FLAT_STACK));
  return frame(colors, width, height, [1080, 1350], defs, drawing);
}

/**
 * The facets alone, close up and filling the frame. CarouselClick shipped a
 * tall file and a wide one as two templates; here one style picks the file
 * that suits the canvas, so the same design holds in every format.
 */
function layeredDepth(colors: ArtColors, width: number, height: number): string {
  if (height > width) {
    const { defs, drawing } = facets(
      colors,
      upright(['415.719', '311.79', '207.86', '103.929', '0']),
    );
    return frame(colors, width, height, [457, 653], defs, drawing);
  }
  const { defs, drawing } = facets(colors, flat('450.03', FLAT_STACK));
  return frame(colors, width, height, [653, 644], defs, drawing);
}

/* Tonal planes: Shards and Slabs. */

/**
 * Half way from the ground to the mid. At home that is the file's darker
 * green (`#03421F` on `#025226`); elsewhere it stays the same quiet step
 * from the ground, where the full mid would shout behind the text.
 */
const plane = (colors: ArtColors) => mix(colors.background, colors.mid, 0.5);

/** A tall wedge on the left and a broad shard on the right. */
function shards(colors: ArtColors, width: number, height: number): string {
  const fill = plane(colors);
  return frame(
    colors,
    width,
    height,
    [1080, 1350],
    '',
    `<path d="M321.57 289.129L-284.412 323.365L-110.347 1758.88L576.298 1347.28L321.57 289.129Z" fill="${fill}"/><path d="M650.095 644.91L554.784 110.792L1047.19 -52.7098L1462.85 865.301L1170.82 1184.59L650.095 644.91Z" fill="${fill}"/>`,
  );
}

/** Two tilted slabs, one across the top and one across the foot. */
function slabs(colors: ArtColors, width: number, height: number): string {
  const fill = plane(colors);
  return frame(
    colors,
    width,
    height,
    [1080, 1350],
    '',
    `<path d="M170.534 737.95L98.5591 -4.7813L864.18 -80.9187L1060.9 633.7L170.534 737.95Z" fill="${fill}"/><path d="M-16.7392 1720.97L154.23 994.605L903.602 1169L859.782 1908.91L-16.7392 1720.97Z" fill="${fill}"/>`,
  );
}

/* Soft glows: Drift and Bloom. */

/**
 * Highlight, then mid, then a fade: the glow gradient the patterns copied
 * from these two files. Bloom fades into the ground itself. Drift's file
 * fades into `#193133`, a hair above its `#162D2F` ground; the ground lifted
 * 1.8% toward white gives `#1A3133`, which no eye or pixel check can tell
 * apart, and on any other ground it stays the same faint lift.
 */
function glow(
  id: string,
  colors: ArtColors,
  line: readonly [string, string, string, string],
  midAt: string,
  fade: string,
): string {
  const [x1, y1, x2, y2] = line;
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse"><stop stop-color="${colors.highlight}"/><stop offset="${midAt}" stop-color="${colors.mid}"/><stop offset="1" stop-color="${fade}"/></linearGradient>`;
}

/** Two blurred glows: a pool at the foot and a ribbon across the top left. */
function drift(colors: ArtColors, width: number, height: number): string {
  const fade = mix(colors.background, '#FFFFFF', 0.018);
  return frame(
    colors,
    width,
    height,
    [1080, 1350],
    blur('b0', '37.9978', '822', '1530', '706', '75') +
      blur('b1', '-488.475', '-175.679', '1443.08', '961.377', '75') +
      glow('g0', colors, ['1121.4', '1403.39', '903.71', '852.838'], '0.599483', fade) +
      glow('g1', colors, ['-342.17', '-16.0002', '805.156', '627.841'], '0.599483', fade),
    `<path d="M638.304 983.264C313.034 1032.85 202.571 1207.54 187.998 1288.69C298.024 1495.64 1413.59 1288.69 1417.96 1210.21C1422.33 1131.73 1044.89 921.28 638.304 983.264Z" fill="url(#g0)" filter="url(#b0)"/><path d="M-86.4313 355.921C-179.956 375.093 -272.732 364.495 -307.43 356.799C-339.3 221.758 -371.136 -72.6516 -268.806 10.1426C-140.894 113.635 75.9307 -56.7274 280.076 -20.5381C484.221 15.6512 415.658 377.426 493.108 490.62C555.069 581.174 726.59 527.526 804.606 489.382C774.604 530.835 670.415 617.917 493.68 634.619C272.762 655.497 266.116 367.02 151.958 327.474C37.7995 287.927 30.4744 331.957 -86.4313 355.921Z" fill="url(#g1)" filter="url(#b1)"/>`,
  );
}

/**
 * Drift turned the other way, for a light ground: the pool at the foot left
 * and the ribbon across the top right. Its strongest colour is the deep one,
 * which is why its home highlight is the dark teal: on a light ground the
 * highlight is the colour that stands out from the ground, as everywhere else.
 */
function bloom(colors: ArtColors, width: number, height: number): string {
  return frame(
    colors,
    width,
    height,
    [1080, 1350],
    blur('b0', '-497', '927.908', '1458', '682', '75') +
      blur('b1', '127.578', '-83.6797', '1443.08', '961.377', '75') +
      glow(
        'g0',
        colors,
        ['-67.7634', '1483.8', '136.966', '965.704'],
        '0.599483',
        colors.background,
      ) +
      glow(
        'g1',
        colors,
        ['1424.35', '75.9993', '470.185', '559.908'],
        '0.485281',
        colors.background,
      ),
    `<path d="M387.053 1088.51C693.283 1135.16 797.28 1299.53 811 1375.88C707.414 1570.59 -342.849 1375.88 -346.965 1302.03C-351.081 1228.19 4.26642 1030.19 387.053 1088.51Z" fill="url(#g0)" filter="url(#b0)"/><path d="M1168.61 447.921C1262.14 467.093 1354.92 456.494 1389.61 448.799C1421.48 313.757 1453.32 19.3479 1350.99 102.142C1223.08 205.635 1006.25 35.2721 802.108 71.4614C597.962 107.651 666.526 469.426 589.075 582.619C527.115 673.174 355.593 619.525 277.578 581.382C307.58 622.835 411.768 709.916 588.503 726.618C809.422 747.496 816.068 459.02 930.226 419.473C1044.38 379.926 1051.71 423.956 1168.61 447.921Z" fill="url(#g1)" filter="url(#b1)"/>`,
  );
}

/* Signals: Ray and Ladder. */

/** One blurred wedge of light from the right edge, fading to a fifth as it narrows. */
function ray(colors: ArtColors, width: number, height: number): string {
  return frame(
    colors,
    width,
    height,
    [832, 358],
    `${blur('b0', '0', '0', '1028.4', '357.4', '57.1')}<linearGradient id="g0" x1="914.2" y1="178.7" x2="114.2" y2="178.7" gradientUnits="userSpaceOnUse"><stop stop-color="${colors.highlight}"/><stop offset="1" stop-color="${colors.highlight}" stop-opacity="0.2"/></linearGradient>`,
    '<path d="M114.2 149.669L914.2 114.2V243.2L114.2 149.669Z" fill="url(#g0)" filter="url(#b0)"/>',
  );
}

/**
 * The bright bars of the right column, as `[top, thickness]`: each a 153-long
 * rect turned a quarter about its top corner, as the file draws it.
 */
const LADDER_LIT = [
  [5.9999, 65],
  [78.9999, 65],
  [152, 65],
  [234, 53],
  [304, 53],
  [385, 42],
  [462, 33],
  [536, 31],
  [610, 25],
  [689, 18],
  [765, 11],
  [841, 7],
  [917, 3],
] as const;

/**
 * The deep bars of the left column, as `[thickness, bottom]`, through Figma's
 * near-quarter-turn matrix (its `4.37114e-08` is a float's cos 90).
 */
const LADDER_DIM = [
  [68, 917],
  [65, 841],
  [58, 765],
  [54, 689],
  [43, 610],
  [41, 536],
  [35, 462],
  [28, 385],
  [17, 304],
  [17, 234],
  [8, 152],
  [8, 79],
  [3, 3.00001],
] as const;

/**
 * Bars in two columns, each in the other's gaps, thinning toward the foot on
 * the right and toward the head on the left. The rects keep the file's turns
 * although plain boxes would cover the same ground: the near-quarter-turn
 * matrix is not quite axis-aligned, so Chrome antialiases those bars along
 * its path renderer, and plain boxes landed up to 7 levels off the file on
 * their edges. (The exact quarter turns make no difference; they stay for
 * symmetry with the file.)
 */
function ladder(colors: ArtColors, width: number, height: number): string {
  const lit = LADDER_LIT.map(
    ([top, size]) =>
      `<rect x="306" y="${top}" width="${size}" height="153" transform="rotate(90 306 ${top})"/>`,
  ).join('');
  const dim = LADDER_DIM.map(
    ([size, bottom]) =>
      `<rect width="${size}" height="153" transform="matrix(4.37114e-08 -1 -1 -4.37114e-08 153 ${bottom})"/>`,
  ).join('');
  return frame(
    colors,
    width,
    height,
    [306, 920],
    '',
    `<g fill="${colors.highlight}">${lit}</g><g fill="${colors.mid}">${dim}</g>`,
  );
}

type Home = NonNullable<ArtStyle['home']>;

/**
 * Premium, like every hand-made look. A `home` colour the drawing does not
 * use is CarouselClick's ink for these templates (`#0B6B35` mid, `#B8FF35`
 * highlight), so a style's home still reads as one palette.
 */
function original(id: string, name: string, home: Home, draw: ArtStyle['draw']): ArtStyle {
  return { id, name, kind: 'original', premium: true, home: { ...home }, draw };
}

/** The ground the facet files were drawn on, with the grey their facets fade into. */
const FACET_HOME: Home = { background: '#05011A', mid: '#3F3F3F', highlight: '#B8FF35' };

/**
 * Ids and names are PostGear's own: no file name or label from CarouselClick
 * survives (`layered-depth` is the one id the sprint brief fixed). The order
 * is the one CarouselClick lists its originals in.
 */
export const ORIGINAL_ARTS: ArtStyle[] = [
  original('cascade', 'Cascade', FACET_HOME, cascade),
  original('canopy', 'Canopy', FACET_HOME, canopy),
  original('tiers', 'Tiers', FACET_HOME, tiers),
  original(
    'shards',
    'Shards',
    { background: '#025226', mid: '#043218', highlight: '#B8FF35' },
    shards,
  ),
  original(
    'slabs',
    'Slabs',
    { background: '#025226', mid: '#043218', highlight: '#B8FF35' },
    slabs,
  ),
  original(
    'drift',
    'Drift',
    { background: '#162D2F', mid: '#004D43', highlight: '#D0FF71' },
    drift,
  ),
  original('layered-depth', 'Facets', FACET_HOME, layeredDepth),
  original('ray', 'Ray', { background: '#05011A', mid: '#0B6B35', highlight: '#05DC7F' }, ray),
  original(
    'ladder',
    'Ladder',
    { background: '#05011A', mid: '#0D461D', highlight: '#08F967' },
    ladder,
  ),
  original(
    'bloom',
    'Bloom',
    { background: '#EBFFF6', mid: '#D0FF71', highlight: '#004D43' },
    bloom,
  ),
];
