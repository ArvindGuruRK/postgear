/**
 * A job's private working folder.
 *
 * Every activity that touches files works inside `<root>/<jobId>/` and the
 * folder is removed when the work ends, also when it throws or is cancelled,
 * so a busy worker's disk never fills with half-made videos. The job id is
 * checked so it can never point outside the root.
 */
import { mkdir, rm } from 'node:fs/promises';
import * as path from 'node:path';

/** Ids are UUIDs in practice; letters, digits, `-` and `_` (an attempt suffix) are allowed. */
const SCRATCH_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** The id or the root cannot make a safe folder. The message never holds the path. */
export class ScratchError extends Error {
  constructor(reason: string) {
    super(`Cannot make a scratch folder: ${reason}`);
    this.name = 'ScratchError';
  }
}

/** The folder a job id gets under the root. Throws for an id that could escape it. */
export function scratchDirFor(root: string, jobId: string): string {
  if (!path.isAbsolute(root)) {
    throw new ScratchError('the root must be an absolute path');
  }
  if (!SCRATCH_ID.test(jobId)) {
    throw new ScratchError('the job id has characters that are not allowed');
  }
  const base = path.resolve(root);
  const dir = path.resolve(base, jobId);
  const relative = path.relative(base, dir);
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ScratchError('the job id points outside the root');
  }
  return dir;
}

/**
 * Makes `<root>/<jobId>/` (emptied first if an earlier attempt left it
 * behind), runs `fn` with its path, and removes it afterwards whatever
 * happens. A failure to remove never hides `fn`'s own result or error.
 */
export async function withScratch<T>(
  root: string,
  jobId: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = scratchDirFor(root, jobId);
  await removeQuietly(dir);
  await mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await removeQuietly(dir);
  }
}

/** Removes a folder, retrying briefly (Windows can hold a file a moment after its program ends). */
export async function removeQuietly(target: string): Promise<void> {
  try {
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Left for the next attempt or the maintenance sweep; never mask the job's outcome.
  }
}
