'use client';

/**
 * The AI credits meter in the page header: used of allowance, when it resets,
 * which tier sets it, and a "Low" badge once under 20% remains.
 *
 * `UsageMeter`'s own ≥ 90% danger takeover is independent of `low`: the
 * badge is the API's rule (user story 5.5's warning), the red bar is the
 * design system's, and the two agree in practice without being wired to
 * each other.
 *
 * The reset date is formatted in the viewer's locale, which the server does
 * not share, so it renders after mount; the tier alone is the caption until
 * then (see `use-mounted.ts`).
 */
import { Badge, Button, cn, Skeleton, Text, UsageMeter } from '@postgear/ui';
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

  return (
    <UsageMeter
      className={className}
      data-testid="credits-meter"
      data-used={credits.used}
      data-remaining={credits.remaining}
      label="AI credits"
      value={credits.used}
      max={credits.allowance}
      tone="ai"
      caption={
        <span className="flex flex-wrap items-center gap-2">
          <span>
            {mounted ? `Resets ${formatResetDate(credits.resetsAt)}, ` : ''}
            {tierLabel(credits.tier)}
          </span>
          {credits.low ? <Badge variant="danger">Low</Badge> : null}
        </span>
      }
    />
  );
}
