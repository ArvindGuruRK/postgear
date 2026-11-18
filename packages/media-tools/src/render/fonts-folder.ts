/**
 * The render's fonts folder on disk (Module 11): the TTF twins and the
 * `manifest.json` that `npm run clips:fonts:build` writes (`CLIPS_FONTS_DIR`,
 * default `<repo>/.cache/clips-fonts`; the worker image runs the same build).
 *
 * The compiler only names files; this half reads the manifest and copies the
 * twins a plan uses into the job's scratch folder, so FFmpeg's `fontsdir`
 * holds exactly those fonts and nothing for libass to fall back to.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { FONT_MANIFEST_FILE, type FontManifest, parseFontManifest } from '@postgear/video-engine';

export interface FontsFolder {
  /** Absolute folder holding the twins and `manifest.json`. */
  dir: string;
  manifest: FontManifest;
}

/** A plain file name: no folders, nothing hidden. */
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * The repo's default fonts folder: `.cache/clips-fonts` beside the first
 * `turbo.json` found walking up from `from`, or null outside the repo.
 */
export function defaultFontsDir(from: string = __dirname): string | null {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, 'turbo.json'))) {
      return path.join(dir, '.cache', 'clips-fonts');
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Reads the folder's manifest. Null when the folder or its manifest is not
 * there (the build was never run); throws when the manifest is unreadable or
 * an older version (the build must be run again).
 */
export async function loadFontsFolder(dir: string): Promise<FontsFolder | null> {
  const absolute = path.resolve(dir);
  const file = path.join(absolute, FONT_MANIFEST_FILE);
  const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (text === null) return null;
  return { dir: absolute, manifest: parseFontManifest(JSON.parse(text)) };
}

/**
 * Copies `files` (names from the plan) from the fonts folder into
 * `<scratchDir>/<sub>/`. Returns the names it could not find, empty when all
 * were copied; a name with a folder in it is never copied and counts as missing.
 */
export async function copyFontsInto(
  folder: FontsFolder,
  files: readonly string[],
  scratchDir: string,
  sub: string,
): Promise<string[]> {
  if (!PLAIN_NAME.test(sub)) {
    throw new Error('The fonts folder inside the scratch folder must be a plain name');
  }
  const target = path.join(path.resolve(scratchDir), sub);
  await mkdir(target, { recursive: true });
  const missing: string[] = [];
  for (const file of files) {
    const from = path.join(folder.dir, file);
    const info = PLAIN_NAME.test(file) ? await stat(from).catch(() => null) : null;
    if (!info?.isFile()) {
      missing.push(file);
      continue;
    }
    await copyFile(from, path.join(target, file));
  }
  return missing;
}
