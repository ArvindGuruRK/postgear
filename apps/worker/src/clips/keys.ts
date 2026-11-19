/**
 * Storage keys a clip job writes, derived from the job's own id.
 *
 * Why not a fresh random key each time: a worker can die between storing a
 * file and writing the row that points at it. With a key derived from the job
 * id, the next attempt (and the failure or cancel bookkeeping, which runs in
 * another activity) knows every key the job could have written and removes
 * them, so a crash never leaves an orphan file behind.
 *
 * - Private files of a video: `clips/<orgId>/<videoId>/<kind>-<job hex>.<ext>`,
 *   the same shape `clipKeys.videoFile` makes (the 32 hex characters are the
 *   job id without its dashes instead of fresh random bits; the private space
 *   is reached only through signed addresses, so the key is not the lock).
 * - A finished export in the public media space: `YYYY/MM/<job hex>.mp4`
 *   (month of the job's creation, so every attempt gets the same key) and its
 *   poster beside it, `YYYY/MM/<job hex>.thumb.jpg`. Both match
 *   `MEDIA_KEY_PATTERN`. The job id is a random UUID only the workspace's
 *   members ever see, and they can see the Media row anyway.
 *
 * Every key is checked against the storage package's own patterns.
 */
import {
  assertValidClipKey,
  type ClipExtension,
  clipKindSegment,
  isMediaKey,
} from '@postgear/storage';
import { FILMSTRIP_COLUMNS, FILMSTRIP_MAX_TILES, FILMSTRIP_ROWS } from '@postgear/video-engine';

/**
 * The most filmstrip sheets an import can write: about 1,200 tiles at 100 a
 * sheet, plus one for the stray sheet FFmpeg's rate filter can add at the end.
 */
export const FILMSTRIP_SHEET_LIMIT =
  Math.ceil(FILMSTRIP_MAX_TILES / (FILMSTRIP_COLUMNS * FILMSTRIP_ROWS)) + 2;

/** The job id as 32 lowercase hex characters. Throws for anything that is not a UUID. */
export function jobHex(jobId: string): string {
  const hex = jobId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error('A clip job id must be a UUID');
  }
  return hex;
}

/** One private file of a video, written by job `jobId`. */
export function jobVideoFileKey(
  orgId: string,
  videoId: string,
  kind: string,
  jobId: string,
  ext: ClipExtension,
): string {
  const key = `clips/${orgId}/${videoId}/${clipKindSegment(kind)}-${jobHex(jobId)}.${ext}`;
  assertValidClipKey(key);
  return key;
}

/** The private files an import writes, by role. Filmstrip sheets are numbered from 0. */
export const importKeys = {
  proxy: (orgId: string, videoId: string, jobId: string) =>
    jobVideoFileKey(orgId, videoId, 'proxy', jobId, 'mp4'),
  analysisAudio: (orgId: string, videoId: string, jobId: string) =>
    jobVideoFileKey(orgId, videoId, 'analysis-audio', jobId, 'wav'),
  waveform: (orgId: string, videoId: string, jobId: string) =>
    jobVideoFileKey(orgId, videoId, 'waveform', jobId, 'json'),
  poster: (orgId: string, videoId: string, jobId: string) =>
    jobVideoFileKey(orgId, videoId, 'poster', jobId, 'jpg'),
  filmstrip: (orgId: string, videoId: string, jobId: string, sheet: number) =>
    jobVideoFileKey(orgId, videoId, `filmstrip-${sheet}`, jobId, 'jpg'),
  /** Module 16: the heat map track, when YouTube gave one. */
  signals: (orgId: string, videoId: string, jobId: string) =>
    jobVideoFileKey(orgId, videoId, 'signals', jobId, 'json.gz'),
};

/** The signals file a highlights run writes (Module 16): every track of the video so far. */
export function highlightsSignalsKey(orgId: string, videoId: string, jobId: string): string {
  return jobVideoFileKey(orgId, videoId, 'signals', jobId, 'json.gz');
}

/**
 * Every key an import job could have written: what a failed or cancelled
 * attempt deletes (deleting a key that was never written succeeds).
 */
export function allImportKeys(orgId: string, videoId: string, jobId: string): string[] {
  const keys = [
    importKeys.proxy(orgId, videoId, jobId),
    importKeys.analysisAudio(orgId, videoId, jobId),
    importKeys.waveform(orgId, videoId, jobId),
    importKeys.poster(orgId, videoId, jobId),
    importKeys.signals(orgId, videoId, jobId),
  ];
  for (let sheet = 0; sheet < FILMSTRIP_SHEET_LIMIT; sheet += 1) {
    keys.push(importKeys.filmstrip(orgId, videoId, jobId, sheet));
  }
  return keys;
}

/** The sharp range a SEGMENT job writes. */
export function segmentKey(orgId: string, videoId: string, jobId: string): string {
  return jobVideoFileKey(orgId, videoId, 'segment', jobId, 'mp4');
}

/** Where a finished export and its poster go in the public media space. */
export function exportMediaKeys(
  jobId: string,
  jobCreatedAt: Date,
): { video: string; poster: string } {
  const year = jobCreatedAt.getUTCFullYear();
  const month = String(jobCreatedAt.getUTCMonth() + 1).padStart(2, '0');
  const base = `${year}/${month}/${jobHex(jobId)}`;
  const keys = { video: `${base}.mp4`, poster: `${base}.thumb.jpg` };
  if (!isMediaKey(keys.video) || !isMediaKey(keys.poster)) {
    throw new Error('An export key does not match the media key pattern');
  }
  return keys;
}
