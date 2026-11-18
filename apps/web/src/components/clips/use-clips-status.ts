'use client';

/**
 * `GET /clips/status` for the Clips page (Module 06): the tools, the
 * platforms switched on, the space gauge, the plan's values and meters.
 *
 * Loaded once on open and again on `refresh()` (after an import, an upload or
 * a delete, so the storage meter moves). While a refresh runs the last answer
 * stays on screen; a failed refresh keeps it too and only a first load that
 * fails says so. Answers that arrive after a newer request started are
 * dropped, so the meter never steps back to an older value.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { getClipsStatus } from '@/lib/clips-api';
import type { ClipsStatus } from '@/types/clips';

export const STATUS_LOAD_FAILED = 'Clips could not load. Check your connection and try again.';

export interface ClipsStatusState {
  status: ClipsStatus | null;
  /** True only while the first answer is on its way. */
  loading: boolean;
  /** One sentence when the first load failed. */
  error: string | null;
  refresh: () => void;
}

export function useClipsStatus(initial: ClipsStatus | null = null): ClipsStatusState {
  const [status, setStatus] = useState<ClipsStatus | null>(initial);
  const [loading, setLoading] = useState(initial === null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    const mine = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;

    getClipsStatus({ signal: abort.signal })
      .then((next) => {
        if (mine !== sequence.current) return;
        setStatus(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (mine !== sequence.current || abort.signal.aborted) return;
        setError(
          cause instanceof ApiError && cause.status !== 0 ? cause.message : STATUS_LOAD_FAILED,
        );
      })
      .finally(() => {
        if (mine === sequence.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
    return () => {
      sequence.current += 1;
      controller.current?.abort();
    };
  }, [load]);

  return { status, loading, error, refresh: load };
}
