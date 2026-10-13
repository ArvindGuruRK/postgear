'use client';

/**
 * The workspace's AI credit balance, kept current without polling.
 *
 * The server page sends the balance it loaded, which is right on first paint
 * and stale a second later: every generation and every copilot message
 * changes it. Rather than re-fetch after each, the API puts the post-charge
 * balance on the terminal event of every stream (`done` and `error`), and
 * `apply` takes it from there. The one re-fetch on mount covers the balance
 * having moved in another tab since the page was rendered.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AiCredits } from '@/types/ai';

export interface CreditsHandle {
  credits: AiCredits | null;
  /** The last fetch failed and there is no balance to show. */
  failed: boolean;
  /** Takes the balance a stream's terminal event carried. */
  apply: (credits: AiCredits) => void;
  refresh: () => Promise<void>;
}

export function useCredits(initial: AiCredits | null): CreditsHandle {
  const [credits, setCredits] = useState<AiCredits | null>(initial);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await api<{ credits: AiCredits }>('/ai/credits');
      setCredits(result.credits);
      setFailed(false);
    } catch {
      // Whatever balance is on screen stays; the meter only says
      // "unavailable" when `failed` is set and there is no balance at all.
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apply = useCallback((next: AiCredits) => {
    setCredits(next);
    setFailed(false);
  }, []);

  return { credits, failed, apply, refresh };
}
