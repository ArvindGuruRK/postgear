'use client';

/**
 * The AI credit balance, two ways.
 *
 * `CreditsMeter` is the AI page's: the violet striped `Progress` (used of
 * allowance) in the actions row beside the mode switch, with when it resets,
 * the plan, and a "Low" badge once under 20% remains (the API's rule, user
 * story 5.5's warning). The 2026-10-26 revamp swapped it for the chip and the
 * owner asked for the bar back the same day, violet even when nearly spent.
 *
 * `CreditsChip` is the compact form beside a button that spends credits (the
 * SEO analyze bar): "62 of 100 credits left", red and "Running low." once
 * the API calls the balance low.
 *
 * The reset date is formatted in the viewer's locale, which the server does
 * not share, so it renders after mount (see `use-mounted.ts`).
 */
import { Badge, Button, cn, Progress, Skeleton, Text } from '@postgear/ui';
import { Sparkles } from 'lucide-react';
import type { AiCredits, AiTier } from '@/types/ai';
import { useMounted } from '../posts/use-mounted';

const TIER_LABELS: Record<AiTier, string> = {
  NONE: 'Trial',
  STANDARD: 'Standard',
  PRO: 'Pro',
  TEAM: 'Team',
  ULTIMATE: 'Ultimate',
};

export function tierLabel(tier: AiTier): string {
  return TIER_LABELS[tier];
}

/** "1 Nov" in the viewer's locale; the year only when it is not this one. */
export function formatResetDate(resetsAt: string, now = new Date()): string {
  const date = new Date(resetsAt);

  if (Number.isNaN(date.getTime())) {
    return 'next cycle';
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function CreditsMeter({
  credits,
  failed,
  onRetry,
  className,
}: {
  credits: AiCredits | null;
  failed: boolean;
  onRetry: () => void;
  className?: string;
}) {
  const mounted = useMounted();

  if (!credits) {
    return (
      <div
        className={cn('flex flex-col gap-2', className)}
        data-testid="credits-meter"
        data-state={failed ? 'failed' : 'loading'}
      >
        {failed ? (
          <div className="flex items-center justify-between gap-3 rounded-md border-2 border-outline bg-secondary px-3 py-2">
            <Text size="sm" muted as="span">
              Credits unavailable
            </Text>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : (
          <Skeleton className="h-14" aria-label="Loading credits" />
        )}
      </div>
    );
  }

  const percent =
    credits.allowance > 0 ? Math.min(100, Math.round((credits.used / credits.allowance) * 100)) : 0;

  return (
    // `UsageMeter`'s layout, with the design system's `Progress` kept violet
    // all the way to the end (the owner's call, 2026-10-26: the AI's colour,
    // not UsageMeter's red takeover). The "Low" badge says it in words.
    <div
      className={cn('flex flex-col gap-2', className)}
      data-testid="credits-meter"
      data-used={credits.used}
      data-remaining={credits.remaining}
    >
      <div className="flex items-center justify-between font-sans text-sm text-ink">
        <span className="font-semibold">AI Credits</span>
        <span className="muted-tone tabular-nums">
          {credits.used.toLocaleString()} / {credits.allowance.toLocaleString()}
        </span>
      </div>
      <Progress
        value={percent}
        tone="ai"
        aria-label={`AI credits: ${credits.used} of ${credits.allowance} used`}
      />
      <span className="flex flex-wrap items-center gap-2 font-sans text-xs font-medium text-ink muted-tone">
        <span>
          {mounted ? `Resets ${formatResetDate(credits.resetsAt)}, ` : ''}
          {tierLabel(credits.tier)}
        </span>
        {credits.low ? <Badge variant="danger">Low</Badge> : null}
      </span>
    </div>
  );
}

export function CreditsChip({
  credits,
  failed,
  onRetry,
  testId,
  className,
}: {
  credits: AiCredits | null;
  /** The balance could not be loaded. */
  failed: boolean;
  onRetry: () => void;
  testId: string;
  className?: string;
}) {
  const mounted = useMounted();

  if (!credits) {
    return failed ? (
      <button
        type="button"
        onClick={onRetry}
        data-testid={testId}
        data-state="failed"
        className={cn(
          'font-sans text-xs font-bold text-ink underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
          className,
        )}
      >
        Credits didn't load, retry
      </button>
    ) : null;
  }

  return (
    <span
      className={cn(
        'inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-xs text-ink',
        className,
      )}
    >
      <span
        data-testid={testId}
        data-used={credits.used}
        data-remaining={credits.remaining}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border-2 border-outline bg-clip-padding px-2.5 py-0.5 font-bold tabular-nums',
          credits.low ? 'bg-actionDanger text-onActionLight' : 'bg-actionAi text-onActionAi',
        )}
      >
        <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
        {credits.remaining} of {credits.allowance} credits left
      </span>
      {/* User story 5.5's warning, in words: the red fill alone is colour only. */}
      {credits.low ? <span className="font-bold text-dangerInk">Running low.</span> : null}
      {mounted ? (
        <span className="type-muted">Resets {formatResetDate(credits.resetsAt)}</span>
      ) : null}
    </span>
  );
}
