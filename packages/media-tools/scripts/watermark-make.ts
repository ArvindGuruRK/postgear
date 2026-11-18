/**
 * `npm run watermark:make --workspace=@postgear/media-tools`: draws the
 * "Made with PostGear" mark an export carries on a plan without the
 * watermark-free feature (Module 15).
 *
 * Everything in it is the logo's own art or outlined letters, never live text:
 * - the gear and the POSTGEAR wordmark are read from
 *   `apps/web/src/components/brand/brand-paths.ts` (the locked logo, the way
 *   `apps/web/scripts/generate-email-brand.mjs` reads it);
 * - "Made with" is Sora 700 (the app's one font, OFL) turned into outlines
 *   with fontkit, so no font is loaded when the mark is drawn.
 *
 * White on a transparent background, with a soft dark halo baked under it so
 * it reads on a bright sky and on a dark room alike. 600 px wide; the render
 * scales it to 18 percent of the frame's width.
 *
 * It writes the same PNG twice, and both are kept in git:
 * - `packages/media-tools/assets/watermark.png`: what the worker copies into
 *   a job's scratch folder (the worker image carries it);
 * - `apps/web/public/clips/watermark.png`: what the editor draws over its
 *   stage at the same fractions, so the preview shows the mark where the
 *   export puts it.
 *
 * Re-run after the logo changes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as fontkit from 'fontkit';
import sharp from 'sharp';

const REPO = path.resolve(__dirname, '..', '..', '..');
const OUTPUTS = [
  path.join(REPO, 'packages', 'media-tools', 'assets', 'watermark.png'),
  path.join(REPO, 'apps', 'web', 'public', 'clips', 'watermark.png'),
];
const BRAND_PATHS = path.join(REPO, 'apps', 'web', 'src', 'components', 'brand', 'brand-paths.ts');
const SORA_700 = path.join(REPO, 'apps', 'web', 'public', 'fonts', 'sora', 'sora-700.woff');

const WHITE = '#ffffff';
const INK = '#0a0a0a';

/** The canvas, in output pixels. */
const WIDTH = 600;
const PAD = 14;
const GEAR = 112;
const GAP = 16;
/** "Made with" letter size, and the space between it and the wordmark. */
const WORDS_SIZE = 30;
const WORDS_GAP = 9;
/** The halo: a dark outline this wide under every shape, blurred by `HALO_BLUR`. */
const HALO = 7;
const HALO_BLUR = 3;
const HALO_OPACITY = 0.6;
/** Drawn at this many times the size, then scaled down, for clean edges. */
const SUPERSAMPLE = 2;

interface BrandMark {
  viewBox: string;
  gear: string;
}
interface BrandWordmark {
  viewBox: string;
  width: number;
  height: number;
  d: string;
}

/** Reads one `export const NAME = {...} as const;` from brand-paths.ts (generated data, our own file). */
function readConstant<T>(source: string, name: string): T {
  const match = source.match(new RegExp(`export const ${name} = (\\{[\\s\\S]*?\\n\\}) as const;`));
  if (!match?.[1]) throw new Error(`${name} not found in brand-paths.ts`);
  return new Function(`return (${match[1]});`)() as T;
}

/** "Made with" as outlines, its baseline at y = 0, with its ink box. */
function wordsShape(
  text: string,
  size: number,
): { d: string; left: number; top: number; width: number; height: number } {
  const face = fontkit.openSync(SORA_700);
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

/** One layer of the mark: every shape filled (and stroked, for the halo) in one colour. */
function layer(
  shapes: Array<{ d: string; transform: string; scale: number; evenOdd?: boolean }>,
  height: number,
  options: { fill: string; stroke?: number },
): Buffer {
  const body = shapes
    .map((shape) => {
      const rule = shape.evenOdd ? ' fill-rule="evenodd"' : '';
      const stroke =
        options.stroke !== undefined
          ? ` stroke="${options.fill}" stroke-width="${(options.stroke / shape.scale).toFixed(4)}" stroke-linejoin="round"`
          : '';
      return `<g transform="${shape.transform}"><path d="${shape.d}" fill="${options.fill}"${rule}${stroke}/></g>`;
    })
    .join('\n');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">\n${body}\n</svg>`,
  );
}

async function main(): Promise<void> {
  const source = readFileSync(BRAND_PATHS, 'utf8');
  const mark = readConstant<BrandMark>(source, 'BRAND_MARK');
  const wordmark = readConstant<BrandWordmark>(source, 'BRAND_WORDMARK');

  const words = wordsShape('Made with', WORDS_SIZE);
  const textLeft = PAD + GEAR + GAP;
  const textWidth = WIDTH - PAD - textLeft;
  const wordmarkScale = textWidth / wordmark.width;
  const wordmarkHeight = wordmark.height * wordmarkScale;
  const blockHeight = words.height + WORDS_GAP + wordmarkHeight;
  const inner = Math.max(GEAR, blockHeight);
  const height = Math.ceil(inner + PAD * 2);

  const gearScale = GEAR / 64;
  const gearTop = PAD + (inner - GEAR) / 2;
  const blockTop = PAD + (inner - blockHeight) / 2;
  const [vbX, vbY] = wordmark.viewBox.split(/\s+/).map(Number) as [number, number];

  const shapes = [
    {
      d: mark.gear,
      transform: `translate(${PAD} ${gearTop.toFixed(3)}) scale(${gearScale.toFixed(5)})`,
      scale: gearScale,
      evenOdd: true,
    },
    {
      d: words.d,
      transform: `translate(${(textLeft - words.left + 2).toFixed(3)} ${(blockTop - words.top).toFixed(3)})`,
      scale: 1,
    },
    {
      d: wordmark.d,
      transform: `translate(${textLeft} ${(blockTop + words.height + WORDS_GAP).toFixed(3)}) scale(${wordmarkScale.toFixed(6)}) translate(${-vbX} ${-vbY})`,
      scale: wordmarkScale,
    },
  ];

  const density = 72 * SUPERSAMPLE;
  const render = (svg: Buffer) =>
    sharp(svg, { density }).resize(WIDTH, height, { kernel: 'lanczos3' }).png().toBuffer();

  const halo = await sharp(await render(layer(shapes, height, { fill: INK, stroke: HALO })))
    .ensureAlpha()
    .linear([1, 1, 1, HALO_OPACITY], [0, 0, 0, 0])
    .blur(HALO_BLUR)
    .png()
    .toBuffer();
  const ink = await render(layer(shapes, height, { fill: WHITE }));
  const png = await sharp(halo)
    .composite([{ input: ink }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  for (const file of OUTPUTS) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, png);
    console.log(`Wrote ${path.relative(REPO, file)} (${WIDTH} x ${height}, ${png.length} bytes)`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
