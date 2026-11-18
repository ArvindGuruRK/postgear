/**
 * The "Made with PostGear" mark a plan without the watermark-free feature
 * carries (Module 15). One PNG, `assets/watermark.png` in this package,
 * drawn by `npm run watermark:make` from the logo's own art; the worker image
 * carries it and the web app draws the same file over the editor's stage.
 *
 * The compiler only names the file and needs its size to place it; this
 * half finds it, reads its size from the PNG header and copies it into the
 * job's scratch folder.
 */
import { existsSync } from 'node:fs';
import { copyFile, open } from 'node:fs/promises';
import * as path from 'node:path';

/** The mark's name inside a job's scratch folder. */
export const WATERMARK_SCRATCH_NAME = 'watermark.png';

/** The mark on disk, with its real size. */
export interface WatermarkFile {
  /** Absolute path of the PNG. */
  file: string;
  width: number;
  height: number;
}

/**
 * Where the mark is: `assets/watermark.png` beside this package's source,
 * or, when the code runs from a build folder, the same file under the first
 * folder with a `turbo.json` walking up from `from`. Null when neither is there.
 */
export function defaultWatermarkFile(from: string = __dirname): string | null {
  const beside = path.resolve(__dirname, '..', '..', 'assets', WATERMARK_SCRATCH_NAME);
  if (existsSync(beside)) return beside;
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, 'turbo.json'))) {
      const inRepo = path.join(dir, 'packages', 'media-tools', 'assets', WATERMARK_SCRATCH_NAME);
      return existsSync(inRepo) ? inRepo : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The eight bytes every PNG starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A PNG's width and height from its header chunk (`IHDR`, always first),
 * or null when the bytes are not a PNG. Exported for tests.
 */
export function pngSize(head: Buffer): { width: number; height: number } | null {
  if (head.length < 24) return null;
  if (!head.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (head.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 8192 || height > 8192) return null;
  return { width, height };
}

/** Reads the mark's size. Null when the file is missing or is not a PNG. */
export async function loadWatermark(file: string): Promise<WatermarkFile | null> {
  const absolute = path.resolve(file);
  const handle = await open(absolute, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const head = Buffer.alloc(24);
    const { bytesRead } = await handle.read(head, 0, 24, 0);
    const size = pngSize(head.subarray(0, bytesRead));
    return size ? { file: absolute, ...size } : null;
  } finally {
    await handle.close();
  }
}

/**
 * Copies the mark into the job's scratch folder as `watermark.png` and
 * returns what the plan's `assets.watermark` takes: the plain name and the size.
 */
export async function copyWatermarkInto(
  watermark: WatermarkFile,
  scratchDir: string,
): Promise<{ file: string; width: number; height: number }> {
  await copyFile(watermark.file, path.join(path.resolve(scratchDir), WATERMARK_SCRATCH_NAME));
  return { file: WATERMARK_SCRATCH_NAME, width: watermark.width, height: watermark.height };
}
