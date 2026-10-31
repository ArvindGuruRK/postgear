'use client';

/**
 * The cost line under an AI step's Configure fields (Module 11): "Uses
 * about 5 AI credits per run. You have 240 left this month." The estimate
 * is the definition's own `credits(config)`; the balance is the one the AI
 * page shows (`GET /ai/credits`, `useCredits`). Without a balance (it did
 * not load) only the estimate shows.
 */
import { cn, Text } from '@postgear/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AiCredits } from '@/types/ai';

/** The cost sentence, plus the balance when it is known. */
export function aiCostWords(perRun: number, remaining: number | null): string {
  const estimate = `Uses about ${perRun} AI ${perRun === 1 ? 'credit' : 'credits'} per run.`;
  if (remaining === null) return estimate;
  return `${estimate} You have ${Math.max(0, remaining)} left this month.`;
}

/** True when the balance cannot pay for one more run. */
export function tooFewCredits(perRun: number, remaining: number | null): boolean {
  return remaining !== null && remaining < perRun;
}

export function AiCostLine({ perRun }: { perRun: number }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    api<{ credits?: AiCredits }>('/ai/credits')
      .then((result) => {
        const left = result?.credits?.remaining;
        if (live && typeof left === 'number') setRemaining(left);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const short = tooFewCredits(perRun, remaining);
  return (
    <Text
      size="sm"
      muted={!short}
      className={cn(short && 'text-dangerInk')}
      data-testid="ai-cost-line"
    >
      {aiCostWords(perRun, remaining)}
    </Text>
  );
}
