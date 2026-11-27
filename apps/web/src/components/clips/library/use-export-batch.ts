'use client';

/**
 * One Export All batch, kept current (Module 11, section 2), the way
 * `useClipJob` keeps one job: first the batch (`GET
 * /clips/exports/batches/:batchId`), then its stream (one job event per
 * change, `lib/sse.ts`), each event merged into its row so a finished clip
 * never runs again. When the stream drops or ends while clips are still
 * going, the batch is read every 2 s until it is done.
 */
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { exportBatchEventsPath, getExportBatch } from '@/lib/clips-bulk-api';
import { streamGetEvents } from '@/lib/sse';
import type { ClipJobEvent } from '@/types/clips';
import type { ClipExportBatchView } from '@/types/clips-batch';
import {
  batchRunning,
  EXPORT_ALL_LOAD_FAILED,
  mergeBatchJob,
  mergeBatchView,
} from './export-all-model';

const POLL_MS = 2000;

export interface ExportBatchState {
  view: ClipExportBatchView | null;
  error: string | null;
}

function messageOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : EXPORT_ALL_LOAD_FAILED;
}

export function useExportBatch(
  batchId: string | null,
  initial: ClipExportBatchView | null = null,
): ExportBatchState {
  const [view, setView] = useState<ClipExportBatchView | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<ClipExportBatchView | null>(initial);
  const seed = useRef(initial);
  seed.current = initial;

  useEffect(() => {
    if (!batchId) {
      current.current = null;
      setView(null);
      setError(null);
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const start = seed.current?.batchId === batchId ? seed.current : null;
    current.current = start;
    setView(start);
    setError(null);

    const show = (next: ClipExportBatchView) => {
      if (!live || next === current.current) return;
      current.current = next;
      setView(next);
    };

    const poll = () => {
      timer = null;
      getExportBatch(batchId, { signal: controller.signal })
        .then((read) => {
          if (!live) return;
          show(mergeBatchView(current.current, read));
          setError(null);
          if (batchRunning(current.current)) timer = setTimeout(poll, POLL_MS);
        })
        .catch((cause: unknown) => {
          if (!live) return;
          setError(messageOf(cause));
          if (!(cause instanceof ApiError && cause.status === 404)) {
            timer = setTimeout(poll, POLL_MS);
          }
        });
    };

    const listen = () => {
      streamGetEvents<ClipJobEvent>(exportBatchEventsPath(batchId), {
        signal: controller.signal,
        onEvent: (event) => {
          if (!live || event.type === 'error' || !current.current) return;
          const { type: _type, ...job } = event;
          show(mergeBatchJob(current.current, job));
        },
      })
        .catch(() => undefined)
        .then(() => {
          if (live && batchRunning(current.current)) timer = setTimeout(poll, POLL_MS);
        });
    };

    getExportBatch(batchId, { signal: controller.signal })
      .then((read) => {
        if (!live) return;
        show(mergeBatchView(current.current, read));
        if (batchRunning(current.current)) listen();
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(messageOf(cause));
        if (!(cause instanceof ApiError && cause.status === 404)) timer = setTimeout(poll, POLL_MS);
      });

    return () => {
      live = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [batchId]);

  return { view, error };
}
