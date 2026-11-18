'use client';

/**
 * One clip job, kept current (Module 02): the view, then live changes until
 * it ends. Every progress card on Clips reads it.
 *
 * - **First the view** (`GET /clips/jobs/:jobId`), so the card paints at once.
 * - **Then the stream** (`clipJobEventsPath`, `lib/sse.ts`): each event goes
 *   through `mergeJobView`, which never takes a finished job back to running
 *   and never shows progress going backwards. It closes after the final event.
 * - **Polling as the fallback**: when the stream drops, is refused or ends
 *   (its 30 minutes, or an `error` event) while the job is still going, the
 *   view is fetched every 1.5 s until it ends.
 *
 * `refresh()` starts over (after a cancel or a retry).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { clipJobEventsPath, getClipJob } from '@/lib/clips-api';
import { streamGetEvents } from '@/lib/sse';
import type { ClipJobEvent, ClipJobView } from '@/types/clips';
import { isTerminalJob, mergeJobView } from './clip-job-model';

const POLL_MS = 1500;
const LOAD_FAILED = 'This could not be loaded. Check your connection.';

export interface ClipJobState {
  job: ClipJobView | null;
  /** One sentence when the job could not be loaded. */
  error: string | null;
  refresh: () => void;
}

function messageOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : LOAD_FAILED;
}

export function useClipJob(jobId: string | null): ClipJobState {
  const [job, setJob] = useState<ClipJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const current = useRef<ClipJobView | null>(null);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    // `tick` only asks to start over.
    void tick;
    if (!jobId) {
      current.current = null;
      setJob(null);
      setError(null);
      return;
    }

    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const show = (next: ClipJobView) => {
      if (!live) return;
      const merged = mergeJobView(current.current, next);
      if (merged === current.current) return;
      current.current = merged;
      setJob(merged);
    };
    const ended = () => current.current !== null && isTerminalJob(current.current.status);
    // A job that is gone stays gone; anything else may pass.
    const retryAfter = (cause: unknown) => !(cause instanceof ApiError && cause.status === 404);

    const poll = () => {
      timer = null;
      getClipJob(jobId, { signal: controller.signal })
        .then((view) => {
          if (!live) return;
          show(view);
          setError(null);
          if (!ended()) timer = setTimeout(poll, POLL_MS);
        })
        .catch((cause: unknown) => {
          if (!live) return;
          setError(messageOf(cause));
          if (retryAfter(cause)) timer = setTimeout(poll, POLL_MS);
        });
    };

    const listen = () => {
      streamGetEvents<ClipJobEvent>(clipJobEventsPath(jobId), {
        signal: controller.signal,
        onEvent: (event) => {
          if (!live || event.type === 'error') return;
          const { type: _type, ...view } = event;
          show(view);
        },
      })
        .catch(() => undefined)
        .then(() => {
          if (live && !ended()) timer = setTimeout(poll, POLL_MS);
        });
    };

    // A new job never shows the last one's paint while it loads.
    if (current.current?.id !== jobId) {
      current.current = null;
      setJob(null);
    }
    setError(null);

    getClipJob(jobId, { signal: controller.signal })
      .then((view) => {
        if (!live) return;
        show(view);
        if (!ended()) listen();
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(messageOf(cause));
        if (retryAfter(cause)) timer = setTimeout(poll, POLL_MS);
      });

    return () => {
      live = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [jobId, tick]);

  return { job, error, refresh };
}
