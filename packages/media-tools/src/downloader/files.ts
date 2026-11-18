/**
 * File helpers for fetches: a private working folder next to the output,
 * the size watch the runner calls while a download runs, finding what
 * yt-dlp wrote, and moving the result into place.
 */
import type { Dirent } from 'node:fs';
import { copyFile, mkdtemp, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import type { RunToolOptions } from '../run/types';
import { DownloaderError } from './types';

/** How often the size watch sums the working folder. */
export const SIZE_WATCH_EVERY_MS = 2000;

/** A fresh folder beside `outFile` (so it is inside the caller's scratch folder). */
export async function makeWorkDir(outFile: string): Promise<string> {
  return mkdtemp(path.join(path.dirname(outFile), '.fetch-'));
}

/** Removes a folder and everything in it; never throws (cleanup must not hide the real error). */
export async function removeDirQuietly(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(
    () => undefined,
  );
}

/** Removes a file if it is there; never throws. */
export async function unlinkQuietly(file: string): Promise<void> {
  await unlink(file).catch(() => undefined);
}

/** The total size of every file under `dir`. Files that vanish mid-walk count as zero. */
export async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await folderBytes(full);
    } else if (entry.isFile()) {
      total += await stat(full).then(
        (info) => info.size,
        () => 0,
      );
    }
  }
  return total;
}

/**
 * The runner's watch: sums `dir` every few seconds and stops the process past
 * `maxBytes`. Needed because `--max-filesize` is ignored for HLS and FFmpeg
 * downloads (research 04, section 2.3).
 */
export function sizeWatch(
  dir: string,
  maxBytes: number,
  everyMs: number = SIZE_WATCH_EVERY_MS,
): NonNullable<RunToolOptions['watch']> {
  return {
    everyMs,
    check: async () => {
      if ((await folderBytes(dir)) > maxBytes) {
        throw new DownloaderError('too_big', { retryable: false });
      }
    },
  };
}

/** The size of one file. */
export async function fileBytes(file: string): Promise<number> {
  return (await stat(file)).size;
}

/** True when the file exists and is not empty. */
export async function hasContent(file: string): Promise<boolean> {
  return stat(file).then(
    (info) => info.isFile() && info.size > 0,
    () => false,
  );
}

const UNFINISHED = /\.(part|ytdl|temp|tmp)$|\.part-Frag\d+$/i;

/**
 * What yt-dlp wrote for `stem.%(ext)s`: the one finished file named
 * `stem.<ext>`, ignoring leftovers and per-format pieces (`stem.f137.mp4`).
 */
export async function findOutput(dir: string, stem: string): Promise<string | null> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const pattern = new RegExp(`^${stem}\\.[A-Za-z0-9]{2,5}$`);
  for (const name of names) {
    if (pattern.test(name) && !UNFINISHED.test(name)) {
      const full = path.join(dir, name);
      if (await hasContent(full)) return full;
    }
  }
  return null;
}

/** Moves a finished file into place, copying when a rename crosses devices. */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch {
    await copyFile(from, to);
    await unlinkQuietly(from);
  }
}
