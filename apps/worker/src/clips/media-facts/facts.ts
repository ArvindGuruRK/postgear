/**
 * A Media video's poster and length (Sprint 12, Module 19):
 * `mediaVideoFactsWorkflow`'s one activity.
 *
 * 1. Read the row (the workspace's video, not deleted). A row already
 *    checked, gone or not a video is skipped: a second start changes nothing.
 * 2. Fetch the stored file into the scratch folder.
 * 3. `probeFile`: length, size, frame rate.
 * 4. When the row has no picture yet: a WebP poster one second in (the first
 *    frame for a shorter video, or when that frame cannot be read), its
 *    longest side at most 480 px like the library's image thumbnails, stored
 *    beside the file under `thumbnailKeyFor` (`<key>.thumb.webp`), as an
 *    image upload's thumbnail is.
 * 5. Write `thumbnail`, `durationMs`, `fps`, `width`, `height` and
 *    `factsCheckedAt` on the row. Deleted meanwhile: the poster is removed.
 *
 * A file that is missing or is not a video we can read is an answer, not a
 * failure: the row gets `factsCheckedAt` alone, so it is not tried again on
 * every pass. A poster that cannot be made still leaves the length. Tool and
 * storage faults throw, so Temporal tries once more.
 */
import { rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  FFMPEG_HEAD,
  FfmpegError,
  fileInput,
  type MediaFacts,
  ProbeError,
  type RunTool,
  runFfmpeg,
  SAFE_INPUT_ARGS,
  toFfmpegError,
} from '@postgear/media-tools';
import {
  MEDIA_POSTER_EDGE,
  type MediaVideoFactsInput,
  mediaPosterTimeMs,
} from '@postgear/scheduling';
import { CONTENT_TYPES, isMediaKey, type StorageBackend, thumbnailKeyFor } from '@postgear/storage';
import { ClipStepError } from '../failures';
import type { MediaFactsRows, MediaFactsUpdate } from './rows';

/** What one run did. */
export type MediaVideoFactsOutcome =
  | { status: 'written'; poster: boolean }
  /** The file is missing or is not a video we can read: checked, no facts. */
  | { status: 'unreadable' }
  /** Gone, deleted, not a video, or already checked: nothing written. */
  | { status: 'skipped' };

export interface MediaPoster {
  file: string;
  bytes: number;
}

export interface MediaFactsTools {
  probe(file: string, opts: { cwd: string; signal: AbortSignal }): Promise<MediaFacts>;
  poster(opts: {
    cwd: string;
    signal: AbortSignal;
    input: string;
    output: string;
    facts: Pick<MediaFacts, 'durationMs' | 'width' | 'height'>;
  }): Promise<MediaPoster>;
}

export interface MediaVideoFactsDeps {
  rows: MediaFactsRows;
  /** The public media space, where the upload and its poster live. */
  storage: Pick<StorageBackend, 'read' | 'put' | 'delete'>;
  tools: MediaFactsTools;
  /** Runs `fn` in a fresh scratch folder that is removed afterwards. */
  scratch<T>(fn: (dir: string) => Promise<T>): Promise<T>;
  now(): Date;
  heartbeat(): void;
  signal: AbortSignal;
  log?: (event: string, meta: Record<string, unknown>) => void;
}

/** `Media.durationMs` and the sizes are 32-bit columns. */
const MAX_INT = 2_147_483_647;

function wholeOrUndefined(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? Math.min(MAX_INT, Math.round(value)) : undefined;
}

function cancelledIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ClipStepError('cancelled');
}

export async function runMediaVideoFacts(
  deps: MediaVideoFactsDeps,
  input: MediaVideoFactsInput,
): Promise<MediaVideoFactsOutcome> {
  const { rows, storage, signal } = deps;
  const { organizationId, mediaId } = input;
  const row = await rows.video(organizationId, mediaId);
  if (!row || row.factsCheckedAt !== null) return { status: 'skipped' };

  const unreadable = async (reason: string): Promise<MediaVideoFactsOutcome> => {
    deps.log?.('media.video_facts.unreadable', { organizationId, mediaId, reason });
    const written = await rows.writeFacts(organizationId, mediaId, { factsCheckedAt: deps.now() });
    return written ? { status: 'unreadable' } : { status: 'skipped' };
  };

  // A row pointing anywhere but the media tree is never read or written beside.
  if (!isMediaKey(row.path) || row.path.includes('.thumb.')) return unreadable('not_a_media_key');

  return deps.scratch(async (dir) => {
    const bytes = await storage.read(row.path);
    if (!bytes || bytes.length === 0) return unreadable('missing');
    const local = path.join(dir, `source${path.extname(row.path)}`);
    await writeFile(local, bytes);
    deps.heartbeat();
    cancelledIfAborted(signal);

    let facts: MediaFacts;
    try {
      facts = await deps.tools.probe(local, { cwd: dir, signal });
    } catch (error) {
      if (error instanceof ProbeError && error.code === 'upload_not_video') {
        return unreadable('not_a_video');
      }
      throw error;
    }
    deps.heartbeat();
    cancelledIfAborted(signal);

    let posterKey: string | null = null;
    if (row.thumbnail === null) {
      try {
        const poster = await deps.tools.poster({
          cwd: dir,
          signal,
          input: local,
          output: path.join(dir, 'poster.webp'),
          facts,
        });
        cancelledIfAborted(signal);
        const key = thumbnailKeyFor(row.path);
        await storage.put(key, { filePath: poster.file, size: poster.bytes }, CONTENT_TYPES.webp);
        posterKey = key;
      } catch (error) {
        // No picture is not worth losing the length for; a stop is still a stop.
        if (!(error instanceof FfmpegError) || error.code === 'cancelled') throw error;
        deps.log?.('media.video_facts.no_poster', { organizationId, mediaId });
      }
    }

    const update: MediaFactsUpdate = {
      factsCheckedAt: deps.now(),
      durationMs: wholeOrUndefined(facts.durationMs),
      width: wholeOrUndefined(facts.width),
      height: wholeOrUndefined(facts.height),
      fps: Number.isFinite(facts.fps) && facts.fps > 0 ? facts.fps : undefined,
      ...(posterKey ? { thumbnail: posterKey } : {}),
    };
    const written = await rows.writeFacts(organizationId, mediaId, update);
    if (!written) {
      // Deleted while we worked: its poster has no row to belong to.
      if (posterKey) await storage.delete(posterKey).catch(() => undefined);
      return { status: 'skipped' };
    }
    return { status: 'written', poster: posterKey !== null };
  });
}

// --- The WebP poster ---------------------------------------------------------------

/** The largest even number at or below `n`, at least 2. */
function evenFloor(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

/** The poster's size: the video's shape, its longest side at most 480 px, never enlarged. */
export function mediaPosterSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > MEDIA_POSTER_EDGE ? MEDIA_POSTER_EDGE / longest : 1;
  return { width: evenFloor(width * scale), height: evenFloor(height * scale) };
}

/** Quality as the library's image thumbnails (`THUMBNAIL_QUALITY` in the API). */
const POSTER_QUALITY = '70';

/**
 * One WebP frame at `atMs`. `-quality` is libwebp's own 0 to 100 scale: the
 * JPEG poster's `-q:v 3` would mean quality 3 here.
 */
export function buildWebpPosterArgs(params: {
  input: string;
  output: string;
  atMs: number;
  width: number;
  height: number;
}): string[] {
  return [
    ...FFMPEG_HEAD,
    '-ss',
    (Math.max(0, Math.round(params.atMs)) / 1000).toFixed(3),
    ...SAFE_INPUT_ARGS,
    '-i',
    fileInput(params.input),
    '-map',
    '0:v:0',
    '-an',
    '-frames:v',
    '1',
    '-vf',
    `scale=${params.width}:${params.height}:flags=bicubic,setsar=1`,
    '-c:v',
    'libwebp',
    '-quality',
    POSTER_QUALITY,
    '-map_metadata',
    '-1',
    '-f',
    'webp',
    fileInput(params.output),
  ];
}

/**
 * Writes the poster: one second in, or the first frame for a video of a
 * second or less; when the frame one second in cannot be read, the first.
 */
export async function makeWebpPoster(opts: {
  runTool: RunTool;
  cwd: string;
  signal: AbortSignal;
  input: string;
  output: string;
  facts: Pick<MediaFacts, 'durationMs' | 'width' | 'height'>;
}): Promise<MediaPoster> {
  const size = mediaPosterSize(opts.facts.width, opts.facts.height);
  const first = mediaPosterTimeMs(opts.facts.durationMs);
  const attempts = first > 0 ? [first, 0] : [0];
  let lastError: unknown = null;
  for (const atMs of attempts) {
    try {
      await runFfmpeg({
        runTool: opts.runTool,
        cwd: opts.cwd,
        signal: opts.signal,
        durationMs: 1_000,
        timeoutMs: 2 * 60_000,
        args: buildWebpPosterArgs({ input: opts.input, output: opts.output, atMs, ...size }),
      });
      const info = await stat(opts.output).catch(() => null);
      if (!info?.isFile() || info.size === 0) throw new FfmpegError('tool_failed');
      return { file: opts.output, bytes: info.size };
    } catch (error) {
      lastError = error;
      await rm(opts.output, { force: true }).catch(() => undefined);
      if (opts.signal.aborted) break;
    }
  }
  throw toFfmpegError(lastError, opts.signal);
}
