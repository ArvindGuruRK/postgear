/**
 * `npm run clips:fonts:build`: the render's fonts folder and its manifest.
 *
 * libass cannot read the Studio's WOFF2 files, so the render needs TTF or OTF
 * twins of the 52 Studio families plus a manifest with each file's
 * `unitsPerEm`, `usWinAscent` and `usWinDescent` (the numbers that turn a CSS
 * font size into an ASS one). Module 05 ships the stub: it lists the Studio
 * families and writes an **empty** manifest of the right shape, so the
 * render's font check already runs (a clip with text fails with
 * `font_missing` instead of being drawn in another face). Module 11 adds the
 * conversion and reads the three numbers from each file.
 *
 *   --out <folder>   default: packages/media-tools/fonts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { emptyFontManifest, FONT_MANIFEST_FILE, fontManifestSchema } from '@postgear/video-engine';
import { FONTS } from '../../design-engine/src/fonts';

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const STARTED_IN = process.env.INIT_CWD ?? process.cwd();

function outDir(argv: readonly string[]): string {
  const index = argv.indexOf('--out');
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value ? path.resolve(STARTED_IN, value) : path.join(PACKAGE_ROOT, 'fonts');
}

async function main(): Promise<number> {
  const dir = outDir(process.argv.slice(2));
  const families = Object.values(FONTS)
    .map((font) => ({ family: font.family, files: font.faces.map((face) => face.file) }))
    .sort((a, b) => a.family.localeCompare(b.family, 'en'));

  process.stdout.write(
    `${families.length} Studio families, none converted yet (the conversion is Module 11):\n`,
  );
  for (const entry of families) {
    process.stdout.write(`  ${entry.family}: ${entry.files.join(', ')}\n`);
  }

  // Parse what is written, so the file always has the shape the render reads.
  const manifest = fontManifestSchema.parse(emptyFontManifest());
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, FONT_MANIFEST_FILE);
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote an empty manifest: ${target}\n`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `The fonts could not be built: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  },
);
