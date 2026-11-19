'use client';

import {
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  TooltipHint,
} from '@postgear/ui';
import { HardDrive, Sparkles } from 'lucide-react';
import { useState } from 'react';
/**
 * The two gauges in the Clips actions row (Sprint 12, Module 06; blueprint
 * section 2): how much video space the workspace uses, and how many AI
 * minutes are left this month.
 *
 * - `StorageMeter`: a small bar with "12.4 GB of 50 GB". The limit is the
 *   one the API resolved for this workspace (`status.storage.limitBytes`),
 *   so an operator's edit shows on the next status read. The warning colour
 *   starts at 80%; the bar's own danger colour takes over at 90%.
 * - `AiMinutesChip`: "38 of 300 AI minutes left", read from the plan
 *   snapshot (`GET /entitlements/me`, meter `clips.ai_minutes_per_month`),
 *   falling back to the status route's copy until the snapshot arrives. It
 *   never mentions credits: those are for text and image AI elsewhere.
 *   Under a tenth left it turns to the warning colour; with none left it
 *   says so and offers See Plans. It is not violet: the only violet on a
 *   Clips screen is Find Clips, the one AI action (blueprint section 1).
 *
 * Both name their numbers in words, so colour is never the only signal.
 */
import { ActionLink } from '@/components/home/home-actions';
import { meterOf, useEntitlements } from '@/lib/entitlements';
import type { ClipsMeterView, ClipsStatus } from '@/types/clips';
import { aiMinutesChipView, storageBreakdown, storageMeterView } from './home-model';

export const AI_MINUTES_METER = 'clips.ai_minutes_per_month';

const CHIP =
  'inline-flex items-center gap-1.5 rounded-full border-2 border-outline bg-clip-padding px-2.5 py-1 font-sans text-xs font-bold tabular-nums outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

function TooltipLines({ lines }: { lines: readonly string[] }) {
  return (
    <span className="flex max-w-64 flex-col gap-1">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

export function StorageMeter({
  status,
  className,
  onSeeWhatUsesSpace,
}: {
  status: ClipsStatus;
  className?: string;
  /** Module 19: sorts the Videos tab by size. Without it the panel offers no button (the playground). */
  onSeeWhatUsesSpace?: () => void;
}) {
  const view = storageMeterView(status);
  const tone = view.warning ? 'accent' : 'primary';
  const breakdown = storageBreakdown(status);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="clips-storage-meter"
          data-percent={view.percent ?? ''}
          data-warning={view.warning || undefined}
          aria-label={`Video space: ${view.text}. Show what uses it.`}
          className={cn(
            'flex w-56 cursor-pointer flex-col gap-1.5 rounded-md text-left outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
            className,
          )}
        >
          <span className="flex w-full items-center justify-between gap-2 font-sans text-xs text-ink">
            <span className="inline-flex items-center gap-1.5 font-bold">
              <HardDrive className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
              Video Space
            </span>
            <span
              className={cn('tabular-nums', view.full ? 'font-bold text-dangerInk' : 'muted-tone')}
            >
              {view.text}
            </span>
          </span>
          {view.percent !== null ? (
            <Progress
              value={view.percent}
              tone={view.percent >= 90 ? 'danger' : tone}
              size="sm"
              aria-hidden="true"
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-80 flex-col gap-3"
        data-testid="clips-storage-panel"
      >
        <p className="m-0 flex items-center justify-between gap-2">
          <span className="type-heading text-sm">Video Space</span>
          <span className="tabular-nums type-ui text-sm">{view.text}</span>
        </p>
        {breakdown.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {breakdown.map((row) => (
              <li
                key={row.label}
                className="flex items-center justify-between gap-2 rounded-md bg-inset px-2.5 py-1.5 text-xs"
              >
                <span>{row.label}</span>
                <span className="tabular-nums font-bold">{row.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <TooltipLines lines={view.lines} />
        {onSeeWhatUsesSpace ? (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => {
              setOpen(false);
              onSeeWhatUsesSpace();
            }}
          >
            See What Uses Space
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The chip itself, from a meter: shown in the playground as well as on the
 * page, so it takes the meter rather than reading the store.
 */
export function AiMinutesChipView({
  meter,
  orgId,
  className,
}: {
  meter: Pick<ClipsMeterView, 'limit' | 'remaining' | 'cycleEnd'> | null;
  orgId: string;
  className?: string;
}) {
  const view = aiMinutesChipView(meter);
  if (view.tone === 'unknown') return null;
  const warn = view.tone === 'low' || view.tone === 'none';

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <TooltipHint label={<TooltipLines lines={[view.tooltip]} />} side="bottom">
        <span
          // biome-ignore lint/a11y/noNoninteractiveTabindex: lets keyboard users reach when the minutes come back
          tabIndex={0}
          data-testid="clips-ai-minutes"
          data-tone={view.tone}
          className={cn(
            CHIP,
            warn ? 'bg-actionAccent text-onActionLight' : 'bg-secondary text-ink',
          )}
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
          {view.text}
        </span>
      </TooltipHint>
      {view.seePlans ? (
        <ActionLink href={`/${encodeURIComponent(orgId)}/settings/billing`}>See Plans</ActionLink>
      ) : null}
    </span>
  );
}

/** The chip on the page: the plan snapshot's meter, or the status route's until it arrives. */
export function AiMinutesChip({
  orgId,
  fallback,
}: {
  orgId: string;
  fallback: ClipsMeterView | null;
}) {
  const { snapshot } = useEntitlements(orgId);
  const meter = meterOf(snapshot, AI_MINUTES_METER) ?? fallback;
  return <AiMinutesChipView meter={meter} orgId={orgId} />;
}
