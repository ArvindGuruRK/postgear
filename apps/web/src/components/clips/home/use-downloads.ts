'use client';

/**
 * The Downloads tab's list (Module 18), owned by the Clips page so a pick on
 * the link card shows its row at once, whatever tab is open.
 *
 * - Asked for the first time the tab opens (or a download is added), then
 *   again on `refresh()`: when a row's job ends (for its size and expiry)
 *   and every 3 seconds while a Save To Media is running.
 * - Rows being prepared follow their own job live (`useClipJob` in the row).
 * - `now` moves every 30 seconds, so "Expires in 23 hours" counts down and a
 *   row turns Expired on time without asking the server.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { listDownloads } from '@/lib/clips-api';
import type { DownloadView } from '@/types/clips';

const SAVING_POLL_MS = 3_000;
const CLOCK_MS = 30_000;
const LOAD_FAILED = 'Your downloads could not be loaded. Check your connection.';

export interface DownloadsState {
  rows: DownloadView[];
  loading: boolean;
  error: string | null;
  now: Date;
  refresh: () => void;
  /** A new or repeated download: on top, or in place when it is already listed. */
  add: (view: DownloadView) => void;
  replace: (view: DownloadView) => void;
  remove: (id: string) => void;
}

export function useDownloads(enabled: boolean): DownloadsState {
  const [rows, setRows] = useState<DownloadView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [wanted, setWanted] = useState(enabled);
  const [now, setNow] = useState(() => new Date());
  const loaded = useRef(false);

  useEffect(() => {
    if (enabled) setWanted(true);
  }, [enabled]);

  const refresh = useCallback(() => {
    setWanted(true);
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    void tick;
    if (!wanted) return;
    const controller = new AbortController();
    if (!loaded.current) setLoading(true);
    listDownloads({ signal: controller.signal })
      .then((list) => {
        loaded.current = true;
        setRows(list);
        setError(null);
        // A fresh list is read against a fresh clock ("Expires in 23 hours", not 24).
        setNow(new Date());
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof ApiError && cause.status !== 0 ? cause.message : LOAD_FAILED);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [wanted, tick]);

  // Save To Media has no job of its own: the list is asked again while one runs.
  const saving = rows.some((row) => row.media?.status === 'saving');
  useEffect(() => {
    if (!saving) return;
    const timer = setInterval(() => setTick((value) => value + 1), SAVING_POLL_MS);
    return () => clearInterval(timer);
  }, [saving]);

  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  const add = useCallback((view: DownloadView) => {
    setRows((current) => [view, ...current.filter((row) => row.id !== view.id)]);
  }, []);
  const replace = useCallback((view: DownloadView) => {
    setRows((current) => current.map((row) => (row.id === view.id ? view : row)));
  }, []);
  const remove = useCallback((id: string) => {
    setRows((current) => current.filter((row) => row.id !== id));
  }, []);

  return { rows, loading, error, now, refresh, add, replace, remove };
}
