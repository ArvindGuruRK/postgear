'use client';

/**
 * One intro or outro video for a brand kit (Module 10 section 3), sent
 * through Sprint 12's upload path into the Clips library like any other
 * upload, so it is the workspace's own video with a light copy to play.
 *
 * 1. **Checked first**, in the browser: a video file we read, at most 50 MB,
 *    and at most 5 seconds (the length read from a hidden `<video>`'s
 *    metadata). A refusal is one sentence and nothing is sent.
 * 2. **Uploaded** with the Videos tab's `VideoUploader` (parts, retries,
 *    waiting for the connection), the length already read handed to it.
 * 3. **Waited for**: the video is asked for every few seconds until it is
 *    READY, then `onReady` saves it on the kit (the API checks the real
 *    length again: a file the browser could not read is refused there).
 *
 * Leaving the page stops the upload and the waiting.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getVideo } from '@/lib/clips-api';
import { browserUploadTransport, readDurationWithVideo } from '../home/use-video-upload';
import { type UploadTransport, VideoUploader } from '../home/video-uploader';
import { BRAND_VIDEO_FAILED, brandFileProblem, brandLengthProblem } from './kit-model';

/** How often a video that is coming in is asked for. */
export const BRAND_VIDEO_POLL_MS = 2_500;
/** Give up waiting after this many asks (about five minutes). */
const MAX_POLLS = 120;

export const BRAND_VIDEO_SLOW =
  'Your video is still getting ready. It is in your Clips videos: try again in a few minutes.';

export type BrandUploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; name: string; percent: number }
  | { phase: 'waiting'; name: string }
  | { phase: 'failed'; message: string };

export interface BrandUploadDeps {
  transport: UploadTransport;
  readDuration: (file: File) => Promise<number | null>;
  getVideo: typeof getVideo;
  pollMs: number;
}

const DEFAULT_DEPS: BrandUploadDeps = {
  transport: browserUploadTransport,
  readDuration: readDurationWithVideo,
  getVideo,
  pollMs: BRAND_VIDEO_POLL_MS,
};

export interface BrandVideoUpload {
  state: BrandUploadState;
  /** Checks the file, then uploads it and waits for it. */
  start: (file: File) => void;
  cancel: () => void;
  /** Clears a refusal. */
  reset: () => void;
}

/**
 * `onReady` saves the ready video on the kit; it answers null when that
 * worked, or the sentence to show.
 */
export function useBrandVideoUpload(
  onReady: (videoId: string) => Promise<string | null>,
  deps: BrandUploadDeps = DEFAULT_DEPS,
): BrandVideoUpload {
  const [state, setState] = useState<BrandUploadState>({ phase: 'idle' });
  const live = useRef(true);
  const run = useRef(0);
  const uploader = useRef<VideoUploader | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      run.current += 1;
      uploader.current?.cancel();
    };
  }, []);

  const start = useCallback((file: File) => {
    const mine = ++run.current;
    const current = () => live.current && run.current === mine;
    const fail = (message: string) => {
      if (current()) setState({ phase: 'failed', message });
    };
    const { transport, readDuration, getVideo: readVideo, pollMs } = depsRef.current;

    void (async () => {
      const problem = brandFileProblem(file);
      if (problem) return fail(problem);
      const durationMs = await readDuration(file);
      if (!current()) return;
      const tooLong = brandLengthProblem(durationMs);
      if (tooLong) return fail(tooLong);

      setState({ phase: 'uploading', name: file.name, percent: 0 });
      // The length is known now: the uploader does not read the file again.
      const one = new VideoUploader(file, null, {
        ...transport,
        readDuration: async () => durationMs,
      });
      uploader.current = one;
      one.subscribe((snapshot) => {
        if (current() && snapshot.phase === 'uploading') {
          setState({ phase: 'uploading', name: file.name, percent: snapshot.percent });
        }
      });
      const final = await one.run();
      uploader.current = null;
      if (!current()) return;
      if (final.phase === 'cancelled') {
        setState({ phase: 'idle' });
        return;
      }
      if (final.phase !== 'done' || !final.videoId) {
        return fail(final.error ?? BRAND_VIDEO_FAILED);
      }

      setState({ phase: 'waiting', name: file.name });
      const videoId = final.videoId;
      for (let poll = 0; poll < MAX_POLLS; poll += 1) {
        let status: string;
        try {
          status = (await readVideo(videoId)).video.status;
        } catch {
          // A missed answer is asked again on the next turn.
          status = 'IMPORTING';
        }
        if (!current()) return;
        if (status === 'READY') {
          const refusal = await onReadyRef.current(videoId);
          if (!current()) return;
          if (refusal) return fail(refusal);
          setState({ phase: 'idle' });
          return;
        }
        if (status === 'FAILED' || status === 'REMOVED') return fail(BRAND_VIDEO_FAILED);
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        if (!current()) return;
      }
      fail(BRAND_VIDEO_SLOW);
    })();
  }, []);

  const cancel = useCallback(() => {
    run.current += 1;
    uploader.current?.cancel();
    uploader.current = null;
    setState({ phase: 'idle' });
  }, []);

  const reset = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, start, cancel, reset };
}
