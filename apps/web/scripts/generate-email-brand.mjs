/**
 * Generates the two logo images every PostGear email shows:
 *
 *     node apps/web/scripts/generate-email-brand.mjs
 *
 * Email clients do not draw SVG (Gmail and Outlook drop it), so the emails
 * carry PNGs, hosted by the web app at /email/* and linked by absolute URL
 * (never attached). Both come from the locked logo, never redrawn:
 *
 * - public/email/postgear-gear.png: the Version 5 gear sticker, resized from
 *   public/brand/icon-512.png (written by generate-brand.mjs). Shown at 44 px,
 *   made at 3x for sharp screens.
 * - public/email/postgear-tile.png: the sidebar's blue PG tile, its letters
 *   read from src/components/brand/brand-paths.ts. Shown at 32 px, made at 3x.
 *
 * Both have a transparent background and carry their own white, blue and ink,
 * so they look the same on the cream page and in a dark inbox. Re-run after
 * generate-brand.mjs changes the logo; everything it writes is committed.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (...parts) => join(ROOT, ...parts);

const BLUE = '#1d4ed8';
const WHITE = '#ffffff';
const INK = '#0a0a0a';

/** Reads one `export const NAME = {...} as const;` from brand-paths.ts. */
function readConstant(source, name) {
  const match = source.match(new RegExp(`export const ${name} = (\\{[\\s\\S]*?\\n\\}) as const;`));
  if (!match) throw new Error(`${name} not found in brand-paths.ts`);
  return new Function(`return (${match[1]});`)();
}

const paths = await readFile(out('src', 'components', 'brand', 'brand-paths.ts'), 'utf8');
const letters = readConstant(paths, 'BRAND_TILE_LETTERS');

await mkdir(out('public', 'email'), { recursive: true });

// The gear: the manifest icon, already the full sticker with its shadow.
await writeFile(
  out('public', 'email', 'postgear-gear.png'),
  await sharp(out('public', 'brand', 'icon-512.png'))
    .resize(132, 132, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

// The tile, on a 32 unit grid: a 2 unit hard shadow, an ink border, the blue
// square with the sidebar's corner, and PG at the sidebar's proportions
// (letters 40 by 28 on a 56 tile).
const tile = 29;
const scale = (tile * (40 / 56)) / letters.width;
const lettersWidth = letters.width * scale;
const lettersHeight = letters.height * scale;
const x = (tile - lettersWidth) / 2;
const y = (tile - lettersHeight) / 2;
const radius = tile * (12 / 56);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="96" height="96">
<rect x="2.6" y="2.6" width="${tile - 1.2}" height="${tile - 1.2}" rx="${radius}" fill="${INK}"/>
<rect x="0.6" y="0.6" width="${tile - 1.2}" height="${tile - 1.2}" rx="${radius}" fill="${BLUE}" stroke="${INK}" stroke-width="1.2"/>
<g transform="translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${scale.toFixed(5)})">
${letters.paths.map((d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${letters.outline}" stroke-linejoin="round"/>`).join('\n')}
${letters.paths.map((d) => `<path d="${d}" fill="${WHITE}"/>`).join('\n')}
</g>
</svg>`;

await writeFile(
  out('public', 'email', 'postgear-tile.png'),
  await sharp(Buffer.from(svg), { density: 72 * 3 })
    .resize(96, 96)
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

console.log('Wrote public/email/postgear-gear.png and public/email/postgear-tile.png');
