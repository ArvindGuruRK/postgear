/** Reading a source's files from a folder the operator points at, never outside it. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { LibraryError } from '../types';

/** The file `relative` inside `root`, refused if it leaves the folder or is over `maxBytes`. */
export function readInside(root: string, relative: string, maxBytes: number): Buffer {
  const base = path.resolve(root);
  const file = path.resolve(base, relative);
  if (file !== base && !file.startsWith(`${base}${path.sep}`)) {
    throw new LibraryError(`${relative} is outside the source folder`);
  }
  const size = statSync(file).size;
  if (size > maxBytes)
    throw new LibraryError(`${relative} is ${size} bytes, over the ${maxBytes} byte cap`);
  return readFileSync(file);
}

/** Every picture file under `root` (PNG, GIF, WebP), as forward-slash paths relative to it, sorted. */
export function pictureFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:png|gif|webp)$/i.test(entry.name))
        out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(path.resolve(root));
  return out.sort();
}

/** A file's words as a Title Case name: `emote_heart-2.png` becomes "Heart 2" with `drop: ['emote']`. */
export function nameFromFile(file: string, drop: readonly string[] = []): string {
  const words = path
    .basename(file, path.extname(file))
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word && !drop.includes(word.toLowerCase()));
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

/** The licence file in a pack's top folder (`License.txt`, `LICENSE`, ...), or null. */
export function licenceText(root: string): string | null {
  const entry = readdirSync(root).find((name) => /^licen[cs]e(?:\.(?:txt|md))?$/i.test(name));
  return entry ? readFileSync(path.join(root, entry), 'utf8') : null;
}

/** Every sound file under `root` (OGG, WAV, MP3, FLAC, M4A), as forward-slash paths relative to it, sorted. */
export function soundFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:ogg|wav|mp3|flac|m4a)$/i.test(entry.name))
        out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(path.resolve(root));
  return out.sort();
}

/**
 * A sound file's words as a Title Case name, camelCase split and a
 * zero-based counter shown from 1: `impactPunch_heavy_000.ogg` becomes
 * "Impact Punch Heavy 1".
 */
export function soundNameFromFile(file: string, drop: readonly string[] = []): string {
  const words = path
    .basename(file, path.extname(file))
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word && !drop.includes(word.toLowerCase()));
  return words
    .map((word) =>
      /^\d+$/.test(word)
        ? String(Number.parseInt(word, 10) + (/^0\d/.test(word) || word === '0' ? 1 : 0))
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(' ');
}
