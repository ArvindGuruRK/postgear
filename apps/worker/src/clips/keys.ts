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

/** The most stills one run cuts (12 bursts of four), as the media contract allows. */
export const WATCH_STILLS_MAX = 48;

/**
 * Module 06, Look For Action: the files a highlights run writes between its
 * steps. The motion file and the stills come from the Python service (same
 * job-derived shape); the state file carries the run's gathered tracks and
 * moments from one step to the next, so no speech or AI answer ever rides in
 * a workflow payload. All of them go when the run ends, whatever happened.
 */
export const watchKeys = {
  motion: (orgId: string, videoId: string, jobId: string) =>
    jobVideoFileKey(orgId, videoId, 'motion', jobId, 'json.gz'),
  state: (orgId: string, videoId: string, jobId: string) =>
    jobVideoFileKey(orgId, videoId, 'watch-state', jobId, 'json.gz'),
  still: (orgId: string, videoId: string, jobId: string, index: number) =>
    jobVideoFileKey(orgId, videoId, `still-${index}`, jobId, 'jpg'),
};

/** Every key the watch step could have written: what any end of the run deletes. */
export function allWatchKeys(orgId: string, videoId: string, jobId: string): string[] {
  const keys = [watchKeys.motion(orgId, videoId, jobId), watchKeys.state(orgId, videoId, jobId)];
  for (let index = 0; index < WATCH_STILLS_MAX; index += 1) {
    keys.push(watchKeys.still(orgId, videoId, jobId, index));
  }
  return keys;
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

/**
 * Sprint 13, Module 02: the heard file the Python service writes for a
 * listening job (the words and the speech curve of the asked stretches). The
 * Python side builds the same key from the job id (`services/transcribe.py`).
 */
export function heardFileKey(orgId: string, videoId: string, jobId: string): string {
  return jobVideoFileKey(orgId, videoId, 'heard', jobId, 'json.gz');
}

/**
 * Sprint 13, Module 07: the face file a FACES job's Python step writes. It is
 * kept where it lands, as the video's `FACE_TRACKS` asset (no copy).
 */
export function facesFileKey(orgId: string, videoId: string, jobId: string): string {
  return jobVideoFileKey(orgId, videoId, 'faces', jobId, 'json.gz');
}

/** The video's transcript file as one listening job wrote it (the newest replaces the last). */
export function transcriptFileKey(orgId: string, videoId: string, jobId: string): string {
  return jobVideoFileKey(orgId, videoId, 'transcript', jobId, 'json.gz');
}

/**
 * Sprint 13, Module 09: a SPEECH job's files, all in the workspace's library
 * space (a made voice belongs to the workspace, not to a video), named from
 * the job id so the failure and cancel bookkeeping can remove each one:
 * - `text`: the speech text file the Python step reads (the line never rides
 *   in a Temporal payload);
 * - `wav`: what the Python step writes (`services/speech.py` builds the same key);
 * - `sound`: the editor's AAC `.m4a`, kept as the workspace's own sound.
 */
export function speechKeys(
  orgId: string,
  jobId: string,
): { text: string; wav: string; sound: string } {
  const base = `clips/${orgId}/library/${jobHex(jobId)}`;
  const keys = { text: `${base}.json`, wav: `${base}.wav`, sound: `${base}.m4a` };
  for (const key of Object.values(keys)) assertValidClipKey(key);
  return keys;
}
