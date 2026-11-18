/**
 * Refuse work the scratch disk cannot hold.
 *
 * A six hour import that runs out of disk at 90 percent wastes an hour and
 * can starve every other job on the box, so a job checks first: it needs
 * what it will write plus a safety margin (2 GB by default) left over.
 */
import { statfs } from 'node:fs/promises';
import * as path from 'node:path';

/** Space always kept free on the scratch disk for other jobs and the system. */
export const FREE_DISK_MARGIN_BYTES = 2 * 1024 * 1024 * 1024;

/** The scratch disk is too full for this job. Carries whole numbers for the log, no path. */
export class DiskSpaceError extends Error {
  readonly code = 'disk_full' as const;
  readonly bytesFree: number;
  readonly bytesNeeded: number;

  constructor(bytesFree: number, bytesNeeded: number) {
    super('Not enough free disk space for this job.');
    this.name = 'DiskSpaceError';
    this.bytesFree = bytesFree;
    this.bytesNeeded = bytesNeeded;
  }
}

/** Free bytes for this process on the disk holding `dir` (or its nearest existing parent). */
export async function freeDiskBytes(dir: string): Promise<number> {
  let current = path.resolve(dir);
  for (;;) {
    try {
      const info = await statfs(current);
      return Number(info.bavail) * Number(info.bsize);
    } catch (error) {
      const parent = path.dirname(current);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === current) {
        throw error;
      }
      current = parent;
    }
  }
}

/**
 * Throws `DiskSpaceError` unless the disk holding `dir` has `bytesNeeded`
 * plus the margin free. `bytesNeeded` is the job's own estimate (for an
 * import, a few times the expected file size).
 */
export async function assertFreeDisk(
  dir: string,
  bytesNeeded: number,
  options: { marginBytes?: number } = {},
): Promise<void> {
  const needed =
    Math.max(0, Math.ceil(bytesNeeded)) + (options.marginBytes ?? FREE_DISK_MARGIN_BYTES);
  const free = await freeDiskBytes(dir);
  if (free < needed) {
    throw new DiskSpaceError(free, needed);
  }
}
