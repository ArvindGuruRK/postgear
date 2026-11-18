'use client';

/**
 * Uploads on the Clips page (Module 06): the rows the Create tab draws, one
 * `VideoUploader` each, and the browser's side of the transport (signed PUTs
 * with progress through `XMLHttpRequest`, the length read by a `<video>`
 * element, the online and offline events).
 *
 * The length is read with the browser's own `<video>` element rather than
 * Mediabunny: no new dependency, and a file it cannot read (some MKV) simply
 * skips the length check, which the API and the worker make again anyway.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelVideo, completeUpload, signParts, startUpload } from '@/lib/clips-api';
import type { ClipsStatus } from '@/types/clips';
import { type UploadSnapshot, type UploadTransport, VideoUploader } from './video-uploader';

/** Give up reading a file's length after this long; the upload goes on without it. */
const DURATION_TIMEOUT_MS = 8_000;

/** The length of a local file in ms, or null when the browser cannot tell in time. */
export function readDurationWithVideo(file: File): Promise<number | null> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), DURATION_TIMEOUT_MS);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      const seconds = video.duration;
      finish(Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null);
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/** One PUT with upload progress; resolves with the part's ETag. */
function putWithProgress(
  url: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject({ status: 0, message: 'cancelled' });
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    xhr.open('PUT', url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onload = () => {
      signal.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag') ?? xhr.getResponseHeader('etag');
        if (etag) resolve(etag);
        // Without the ETag the parts cannot be joined: the storage's CORS rule must expose it.
        else reject({ status: 0, message: 'missing etag' });
      } else {
        reject({ status: xhr.status, message: '' });
      }
    };
    xhr.onerror = () => {
      signal.removeEventListener('abort', onAbort);
      reject({ status: 0, message: '' });
    };
    xhr.onabort = () => {
      signal.removeEventListener('abort', onAbort);
      reject({ status: 0, message: 'cancelled' });
    };
    xhr.send(body);
  });
}

export const browserUploadTransport: UploadTransport = {
  start: startUpload,
  sign: (uploadId, partNumbers) => signParts(uploadId, partNumbers),
  put: putWithProgress,
  complete: completeUpload,
  cancel: cancelVideo,
  readDuration: readDurationWithVideo,
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  onOnline: (callback) => {
    window.addEventListener('online', callback);
    return () => window.removeEventListener('online', callback);
  },
  wait: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject({ status: 0, message: 'cancelled' });
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject({ status: 0, message: 'cancelled' });
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }),
};

export interface VideoUploads {
  uploads: UploadSnapshot[];
  /** Starts one upload per file. */
  add: (files: readonly File[]) => void;
  cancel: (id: string) => void;
  /** Removes a finished, failed or cancelled row. */
  dismiss: (id: string) => void;
}

/**
 * The rows of the uploads started on this page. `onDone` runs once per
 * upload that completed, so the Videos tab and the storage meter refresh.
 */
export function useVideoUpload(
  status: ClipsStatus | null,
  onDone: (snapshot: UploadSnapshot) => void,
  transport: UploadTransport = browserUploadTransport,
): VideoUploads {
  const [uploads, setUploads] = useState<UploadSnapshot[]>([]);
  const uploaders = useRef(new Map<string, VideoUploader>());
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const statusRef = useRef(status);
  statusRef.current = status;

  const add = useCallback(
    (files: readonly File[]) => {
      for (const file of files) {
        const uploader = new VideoUploader(file, statusRef.current, transport);
        uploaders.current.set(uploader.id, uploader);
        setUploads((rows) => [...rows, uploader.current]);
        uploader.subscribe((snapshot) => {
          setUploads((rows) => rows.map((row) => (row.id === snapshot.id ? snapshot : row)));
        });
        void uploader.run().then((final) => {
          if (final.phase === 'done') onDoneRef.current(final);
        });
      }
    },
    [transport],
  );

  const cancel = useCallback((id: string) => {
    uploaders.current.get(id)?.cancel();
  }, []);

  const dismiss = useCallback((id: string) => {
    const uploader = uploaders.current.get(id);
    const phase = uploader?.current.phase;
    if (phase && phase !== 'done' && phase !== 'failed' && phase !== 'cancelled') return;
    uploaders.current.delete(id);
    setUploads((rows) => rows.filter((row) => row.id !== id));
  }, []);

  // Closing or reloading the tab mid-upload asks first.
  const sending = uploads.some((row) =>
    ['checking', 'starting', 'uploading', 'waiting', 'finishing'].includes(row.phase),
  );
  useEffect(() => {
    if (!sending) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [sending]);

  // Leaving the page stops what is still sending (the cleanup clears its parts).
  useEffect(() => {
    const live = uploaders.current;
    return () => {
      for (const uploader of live.values()) uploader.cancel();
    };
  }, []);

  return { uploads, add, cancel, dismiss };
}
