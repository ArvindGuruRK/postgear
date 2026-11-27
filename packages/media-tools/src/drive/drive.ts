/**
 * Google Drive (Sprint 13 Module 12, D13-09): one file a person picked in
 * Google's own picker, read with the short-lived access token the picker
 * gave the browser. PostGear never lists a Drive, never stores a refresh
 * token, and never keeps the access token past the import.
 *
 * Two calls, each with a binding chosen once per process:
 * - **facts** (the API, before any row is made): the file's name, type and
 *   size from `files.get`, so the upload limits apply before anything moves;
 * - **fetch** (the worker's import): the bytes from `files.get?alt=media`
 *   into the job's scratch folder, stopped past `maxBytes`.
 *
 * The simulated binding (`CLIPS_SIMULATION`) knows a few made-up file ids
 * and copies a local sample; no Google address is ever reached.
 *
 * The token is a value in a header only: it is never logged, never put in
 * an error message, and never part of an address.
 */
import { createWriteStream } from 'node:fs';
import { copyFile, rm, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { type SampleName, sampleFileName } from '../downloader/samples';

export { defaultSamplesDir } from '../downloader/samples';

/** A Drive file id: letters, digits, dash and underscore. */
export const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const FACTS_TIMEOUT_MS = 15_000;

export type DriveErrorCode =
  /** The token was refused, ran out or does not cover this file: pick it again. */
  | 'drive_not_connected'
  /** No such file, or it is in the bin. */
  | 'link_not_found'
  | 'upload_not_video'
  | 'too_big'
  | 'cancelled'
  | 'tool_failed';

export class DriveError extends Error {
  readonly code: DriveErrorCode;
  readonly retryable: boolean;

  constructor(code: DriveErrorCode, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(`drive failed: ${code}`);
    this.name = 'DriveError';
    this.code = code;
    this.retryable = options.retryable ?? code === 'tool_failed';
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

export interface DriveFileFacts {
  name: string;
  mimeType: string;
  bytes: number;
}

export interface DriveFetchInput {
  fileId: string;
  accessToken: string;
  /** Absolute path inside the job's scratch folder. */
  outFile: string;
  /** Stop past this many bytes (the declared size, or the space left). */
  maxBytes: number;
}

export interface DriveFiles {
  readonly simulated: boolean;
  facts(fileId: string, accessToken: string, signal?: AbortSignal): Promise<DriveFileFacts>;
  fetch(
    input: DriveFetchInput,
    onProgress: (bytes: number) => void,
    signal: AbortSignal,
  ): Promise<{ path: string; bytes: number }>;
}

function assertFileId(fileId: string): string {
  if (!DRIVE_FILE_ID_PATTERN.test(fileId)) throw new DriveError('link_not_found');
  return fileId;
}

function assertToken(token: string): string {
  if (token.length === 0 || token.length > 4096 || /[\0\r\n\s]/.test(token)) {
    throw new DriveError('drive_not_connected');
  }
  return token;
}

/** What an HTTP status from Drive means for us. */
export function driveStatusCode(status: number): DriveErrorCode {
  if (status === 401 || status === 403) return 'drive_not_connected';
  if (status === 404 || status === 410) return 'link_not_found';
  return 'tool_failed';
}

// --- The real binding ---------------------------------------------------------------

type FetchLike = typeof fetch;

/** The real Drive binding. `fetchImpl` is injectable for the tests (nothing reaches Google there). */
export function createDriveFiles(options: { fetchImpl?: FetchLike } = {}): DriveFiles {
  const doFetch: FetchLike = options.fetchImpl ?? fetch;
  const headers = (token: string) => ({ authorization: `Bearer ${assertToken(token)}` });

  return {
    simulated: false,

    async facts(fileId, accessToken, signal) {
      const url = `${DRIVE_API}/${assertFileId(fileId)}?fields=name,mimeType,size,trashed&supportsAllDrives=true`;
      const auth = headers(accessToken);
      let response: Response;
      try {
        response = await doFetch(url, {
          headers: auth,
          redirect: 'error',
          signal: signal ?? AbortSignal.timeout(FACTS_TIMEOUT_MS),
        });
      } catch (error) {
        throw new DriveError('tool_failed', { cause: error });
      }
      if (!response.ok) throw new DriveError(driveStatusCode(response.status));
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const name = typeof body?.name === 'string' ? body.name : '';
      const mimeType = typeof body?.mimeType === 'string' ? body.mimeType : '';
      const bytes = Number(body?.size);
      if (body?.trashed === true) throw new DriveError('link_not_found');
      // A Google Doc or a folder has no size: it is not a video file.
      if (!name || !mimeType || !Number.isFinite(bytes) || bytes <= 0) {
        throw new DriveError('upload_not_video');
      }
      return { name, mimeType, bytes };
    },

    async fetch(input, onProgress, signal) {
      const url = `${DRIVE_API}/${assertFileId(input.fileId)}?alt=media&supportsAllDrives=true`;
      const auth = headers(input.accessToken);
      let response: Response;
      try {
        response = await doFetch(url, {
          headers: auth,
          redirect: 'follow',
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw new DriveError('cancelled', { retryable: false, cause: error });
        throw new DriveError('tool_failed', { cause: error });
      }
      if (!response.ok || !response.body) {
        throw new DriveError(driveStatusCode(response.status));
      }
      let written = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          written += chunk.length;
          if (written > input.maxBytes) {
            done(new DriveError('too_big', { retryable: false }));
            return;
          }
          onProgress(written);
          done(null, chunk);
        },
      });
      try {
        await pipeline(
          Readable.fromWeb(response.body as never),
          counter,
          createWriteStream(input.outFile),
          { signal },
        );
      } catch (error) {
        await rm(input.outFile, { force: true }).catch(() => undefined);
        if (error instanceof DriveError) throw error;
        if (signal.aborted) throw new DriveError('cancelled', { retryable: false, cause: error });
        throw new DriveError('tool_failed', { cause: error });
      }
      return { path: input.outFile, bytes: written };
    },
  };
}

// --- The simulated binding ----------------------------------------------------------

/**
 * Made-up Drive files the fake picker can hand out (CLIPS_SIMULATION). The
 * testing guide lists them. Any other id answers "not found".
 */
export const SIMULATED_DRIVE_FILES: Readonly<
  Record<string, { name: string; sample: SampleName } | { fails: DriveErrorCode }>
> = Object.freeze({
  'sim-drive-talk-0001': { name: 'PostGear Sample Talk From Drive.mp4', sample: 'talk' },
  'sim-drive-stream-0001': { name: 'PostGear Sample Stream From Drive.mp4', sample: 'stream' },
  /** The token does not cover the file (a picker answer from another account). */
  'sim-drive-denied-0001': { fails: 'drive_not_connected' },
  /** A Google Doc: no bytes, not a video. */
  'sim-drive-document-01': { fails: 'upload_not_video' },
});

/** The file the fake picker hands out by default. */
export const SIMULATED_DRIVE_FILE_ID = 'sim-drive-talk-0001';

export function createSimulatedDriveFiles(options: { samplesDir: string }): DriveFiles {
  const entry = (fileId: string) => {
    const found = SIMULATED_DRIVE_FILES[assertFileId(fileId)];
    if (!found) throw new DriveError('link_not_found');
    if ('fails' in found) throw new DriveError(found.fails, { retryable: false });
    return found;
  };
  const samplePath = (sample: SampleName) => path.join(options.samplesDir, sampleFileName(sample));

  return {
    simulated: true,

    async facts(fileId, accessToken) {
      assertToken(accessToken);
      const found = entry(fileId);
      const info = await stat(samplePath(found.sample)).catch(() => null);
      if (!info) throw new DriveError('tool_failed', { retryable: false });
      return { name: found.name, mimeType: 'video/mp4', bytes: info.size };
    },

    async fetch(input, onProgress, signal) {
      assertToken(input.accessToken);
      const found = entry(input.fileId);
      if (signal.aborted) throw new DriveError('cancelled', { retryable: false });
      const info = await stat(samplePath(found.sample)).catch(() => null);
      if (!info) throw new DriveError('tool_failed', { retryable: false });
      if (info.size > input.maxBytes) throw new DriveError('too_big', { retryable: false });
      await copyFile(samplePath(found.sample), input.outFile);
      onProgress(info.size);
      return { path: input.outFile, bytes: info.size };
    },
  };
}
