'use client';

/**
 * How many competitor rows this person has not seen yet (Module 10), for the
 * count on the Competitors tab. `GET /discover/competitors/unseen` reads only
 * the cached copies, so asking costs no competitor's site anything.
 *
 * Asked when `enabled` turns on and again whenever `refreshKey` moves (the
 * page's Refresh, or after the tab marked its competitors seen). A failed or
 * cancelled answer reads as 0: a missing count is better than a wrong one.
 */
import { useEffect, useState } from 'react';
import { getCompetitorUnseen } from '@/lib/discover-api';

export function useCompetitorUnseen(enabled: boolean, refreshKey: number): number {
  const [total, setTotal] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refreshKey` is a trigger, not an input
  useEffect(() => {
    if (!enabled) {
      setTotal(0);
      return;
    }

    const controller = new AbortController();
    getCompetitorUnseen(controller.signal)
      .then((answer) => {
        if (controller.signal.aborted) return;
        setTotal(Number.isFinite(answer?.total) ? Math.max(0, answer.total) : 0);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTotal(0);
      });

    return () => controller.abort();
  }, [enabled, refreshKey]);

  return total;
}
