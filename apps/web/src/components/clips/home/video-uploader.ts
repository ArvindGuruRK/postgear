/**
 * One video upload in parts (Module 06, section 4), straight from the browser
 * to the private space through addresses the API signs.
 *
 * Our own small uploader over the three routes, not Uppy: Module 06 allows
 * it, it adds no dependency, and every rule below is ours to test (Decision
 * Log, 2026-11-18).
 *
 * 1. **Preflight**, free and instant: the type (MP4, MOV, MKV, WebM), the size
 *    against the plan's cap, and the length when the browser can read it.
 * 2. **Start** (`POST /clips/videos/uploads`): the API answers the part size
 *    and count and makes the video row.
 * 3. **Parts**, four at a time. Addresses are signed in small batches as
 *    they are needed and signed again when one is refused (they last an
 *    hour). A failed part is tried again with growing waits (1, 2, 4, 8 and
 *    16 seconds). When the browser is offline the upload pauses ("Waiting
 *    for your connection") without using up a try, and carries on by itself
 *    once it is back.
 * 4. **Complete** with every part's ETag: the import starts.
 *
 * Cancel stops every part at once and asks the API to drop the video row;
 * the parts already stored are cleared by the 24 hour upload cleanup.
 *
 * Pure TypeScript over an injected transport, so the whole thing is tested
 * with fakes (jsdom has no network and no media).
 */
import type { ClipJobView, ClipsStatus, ClipUploadStarted, ClipVideoView } from '@/types/clips';
import { preflightClipUpload, preflightLength, uploadTypeOf } from './home-model';

/** Parts in flight at once. */
export const PART_CONCURRENCY = 4;
/** Addresses asked for in one call. */
export const SIGN_BATCH = 8;
/** Waits between tries of one part, in ms. */
export const RETRY_WAITS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

export const WAITING_FOR_CONNECTION = 'Waiting for your connection';
export const UPLOAD_FAILED = 'The upload did not finish. Upload the file again.';

export type UploadPhase =
  | 'checking'
  | 'starting'
  | 'uploading'
  | 'waiting'
  | 'finishing'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface UploadSnapshot {
  id: string;
  name: string;
  bytes: number;
  phase: UploadPhase;
  /** 0 to 100. */
  percent: number;
  /** A sentence for `failed` (a refusal from preflight or the API). */
  error: string | null;
  /** Its code, when the API gave one (`clips_*` offers See Plans). */
  errorCode: string | null;
  videoId: string | null;
}

/** A refusal that carries the API's sentence and code. */
export interface TransportError {
  status: number;
  message: string;
  code?: string;
}

export interface UploadTransport {
  start(input: { name: string; bytes: number; mimeType: string }): Promise<ClipUploadStarted>;
  sign(
    uploadId: string,
    partNumbers: number[],
  ): Promise<Array<{ partNumber: number; url: string }>>;
  /** PUTs one part; resolves with its ETag. Rejects with `{ status }` (0 for no answer). */
  put(
    url: string,
    body: Blob,
    onProgress: (loaded: number) => void,
    signal: AbortSignal,
  ): Promise<string>;
  complete(
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<{ video: ClipVideoView; job: ClipJobView | null }>;
  cancel(videoId: string): Promise<unknown>;
  /** The file's length in ms when the browser can tell, else null. Never rejects. */
  readDuration(file: File): Promise<number | null>;
  isOnline(): boolean;
  /** Calls back once the browser is online again; returns the unsubscribe. */
  onOnline(callback: () => void): () => void;
  wait(ms: number, signal: AbortSignal): Promise<void>;
}

function asTransportError(cause: unknown): TransportError | null {
  if (cause && typeof cause === 'object' && 'status' in cause) {
    const status = Number((cause as { status: unknown }).status);
    const message = String((cause as { message?: unknown }).message ?? '');
    const code = (cause as { code?: unknown }).code;
    return {
      status: Number.isFinite(status) ? status : 0,
      message,
      code: typeof code === 'string' ? code : undefined,
    };
  }
  return null;
}

class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

let counter = 0;

export class VideoUploader {
  readonly id: string;
  private snapshot: UploadSnapshot;
  private readonly listeners = new Set<(snapshot: UploadSnapshot) => void>();
  private readonly abort = new AbortController();
  private loaded = new Map<number, number>();
  private urls = new Map<number, string>();
  private etags = new Map<number, string>();
  private started: ClipUploadStarted | null = null;
  private signing: Promise<void> | null = null;

  constructor(
    private readonly file: File,
    private readonly status: ClipsStatus | null,
    private readonly transport: UploadTransport,
  ) {
    counter += 1;
    this.id = `upload-${counter}`;
    this.snapshot = {
      id: this.id,
      name: file.name,
      bytes: file.size,
      phase: 'checking',
      percent: 0,
      error: null,
      errorCode: null,
      videoId: null,
    };
  }

  get current(): UploadSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: UploadSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(patch: Partial<UploadSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    const changed = (Object.keys(patch) as Array<keyof UploadSnapshot>).some(
      (key) => next[key] !== this.snapshot[key],
    );
    if (!changed) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
  }

  /** The person pressed Cancel (a failing part also aborts the others, but is not a cancel). */
  private userCancelled = false;

  private get cancelled(): boolean {
    return this.abort.signal.aborted;
  }

  private check(): void {
    if (this.cancelled) throw new Cancelled();
  }

  /** Runs the whole upload. Resolves with the final snapshot; never rejects. */
  async run(): Promise<UploadSnapshot> {
    try {
      const refusal = preflightClipUpload(this.file, this.status);
      if (refusal) return this.fail(refusal, null);
      const length = await this.transport.readDuration(this.file);
      this.check();
      const tooLong = preflightLength(length, this.status);
      if (tooLong) return this.fail(tooLong, 'clips_video_too_long');

      this.set({ phase: 'starting' });
      const mimeType = uploadTypeOf(this.file) as string;
      this.started = await this.transport.start({
        name: this.file.name,
        bytes: this.file.size,
        mimeType,
      });
      if (this.cancelled) {
        // Cancel was pressed while the row was being made, so `cancel` had no
        // id to drop: the row goes now rather than waiting for the cleanup.
        this.transport.cancel(this.started.videoId).catch(() => undefined);
        throw new Cancelled();
      }
      this.set({ phase: 'uploading', videoId: this.started.videoId });

      await this.uploadParts(this.started);
      this.check();

      this.set({ phase: 'finishing', percent: 100 });
      const parts = [...this.etags.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([partNumber, etag]) => ({ partNumber, etag }));
      await this.transport.complete(this.started.uploadId, parts);
      this.set({ phase: 'done', percent: 100 });
      return this.snapshot;
    } catch (cause) {
      if (this.userCancelled) {
        this.set({ phase: 'cancelled' });
        return this.snapshot;
      }
      const error = asTransportError(cause);
      if (error && error.status !== 0 && error.message) {
        return this.fail(error.message, error.code ?? null);
      }
      return this.fail(UPLOAD_FAILED, null);
    }
  }

  /** Stops everything; the video row is dropped best effort. */
  cancel(): void {
    const { phase } = this.snapshot;
    if (this.userCancelled || phase === 'done' || phase === 'failed' || phase === 'finishing') {
      return;
    }
    this.userCancelled = true;
    this.abort.abort();
    this.set({ phase: 'cancelled' });
    const videoId = this.started?.videoId;
    if (videoId) {
      this.transport.cancel(videoId).catch(() => {
        // The upload cleanup removes it within a day; nothing to tell the person.
      });
    }
  }

  private fail(message: string, code: string | null): UploadSnapshot {
    this.set({ phase: 'failed', error: message, errorCode: code });
    return this.snapshot;
  }

  private progress(): void {
    const total = this.file.size || 1;
    let sum = 0;
    for (const value of this.loaded.values()) sum += value;
    // 99 at most until the API has joined the parts.
    const percent = Math.min(99, Math.floor((sum / total) * 100));
    if (percent > this.snapshot.percent) this.set({ percent });
  }

  private async uploadParts(started: ClipUploadStarted): Promise<void> {
    const queue: number[] = [];
    for (let n = 1; n <= started.partCount; n += 1) queue.push(n);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(PART_CONCURRENCY, queue.length); i += 1) {
      workers.push(
        (async () => {
          for (;;) {
            this.check();
            const next = queue.shift();
            if (next === undefined) return;
            await this.uploadPart(started, next, queue);
          }
        })(),
      );
    }
    // The first failure stops the rest; `Promise.all` rejects with that first
    // failure, so the person reads its reason, not the others' stop.
    await Promise.all(
      workers.map((worker) =>
        worker.catch((cause: unknown) => {
          if (!this.cancelled) this.abort.abort();
          throw cause;
        }),
      ),
    );
  }

  /** Signs this part and the next few in the queue, once at a time. */
  private async addressFor(uploadId: string, partNumber: number, queue: readonly number[]) {
    for (let tries = 0; tries < 3; tries += 1) {
      const known = this.urls.get(partNumber);
      if (known) return known;
      if (!this.signing) {
        const wanted = [partNumber, ...queue.filter((n) => !this.urls.has(n))].slice(0, SIGN_BATCH);
        this.signing = this.transport
          .sign(uploadId, [...new Set(wanted)])
          .then((parts) => {
            for (const part of parts) this.urls.set(part.partNumber, part.url);
          })
          .finally(() => {
            this.signing = null;
          });
      }
      await this.signing;
      this.check();
    }
    const url = this.urls.get(partNumber);
    if (!url) throw { status: 0, message: UPLOAD_FAILED } satisfies TransportError;
    return url;
  }

  private async uploadPart(
    started: ClipUploadStarted,
    partNumber: number,
    queue: readonly number[],
  ): Promise<void> {
    const from = (partNumber - 1) * started.partSize;
    const to = Math.min(this.file.size, from + started.partSize);
    const body = this.file.slice(from, to);
    let attempt = 0;

    for (;;) {
      this.check();
      if (!this.transport.isOnline()) {
        await this.waitForConnection();
        continue;
      }
      try {
        const url = await this.addressFor(started.uploadId, partNumber, queue);
        const etag = await this.transport.put(
          url,
          body,
          (loaded) => {
            this.loaded.set(partNumber, Math.min(loaded, to - from));
            this.progress();
          },
          this.abort.signal,
        );
        this.loaded.set(partNumber, to - from);
        this.etags.set(partNumber, etag);
        this.progress();
        if (this.snapshot.phase === 'waiting') this.set({ phase: 'uploading' });
        return;
      } catch (cause) {
        this.check();
        this.loaded.set(partNumber, 0);
        const error = asTransportError(cause);
        // A refused address (expired or not ours any more): sign it again.
        if (error && (error.status === 403 || error.status === 404)) {
          this.urls.delete(partNumber);
        }
        // Dropped mid-part: wait for the connection without using a try.
        if (!this.transport.isOnline()) continue;
        const wait = RETRY_WAITS_MS[attempt];
        if (wait === undefined) throw cause;
        attempt += 1;
        await this.transport.wait(wait, this.abort.signal);
      }
    }
  }

  private waitForConnection(): Promise<void> {
    this.set({ phase: 'waiting' });
    return new Promise<void>((resolve, reject) => {
      const stopCancel = () => {
        unsubscribe();
        reject(new Cancelled());
      };
      const unsubscribe = this.transport.onOnline(() => {
        this.abort.signal.removeEventListener('abort', stopCancel);
        unsubscribe();
        this.set({ phase: 'uploading' });
        resolve();
      });
      this.abort.signal.addEventListener('abort', stopCancel, { once: true });
      // It may have come back between the check and the subscription.
      if (this.transport.isOnline()) {
        this.abort.signal.removeEventListener('abort', stopCancel);
        unsubscribe();
        this.set({ phase: 'uploading' });
        resolve();
      }
    });
  }
}
