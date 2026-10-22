'use client';

/**
 * Small pieces the analytics page's sections share (revamp, 2026-10-22): the
 * panel every section sits in, its header, the coloured icon sticker, the
 * trend chip and the segmented control.
 *
 * The panel follows Home's rule (`home-ui.tsx`): what organises or summarises
 * takes the theme's frame colour (`bg-chrome`), and what you read inside it
 * (the chart's plot, the table) stays on the light card layer. So every
 * section is a chrome panel, and the plot and table sit in it as light boxes.
 */
import { InfoIcon } from '@animateicons/react/lucide/info-icon';
import { Card, cn, MotionIcon, TooltipHint, type TrendTone } from '@postgear/ui';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import type { Trend } from './analytics-view-model';

export const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

/** A section's frame: the theme's frame colour, Home's KPI cards' surface. */
export function AnalyticsPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Card className={cn('min-w-0 bg-chrome', className)} {...props} />;
}

/**
 * A section's name (Title Case, the heading role at Home's section size), an
 * optional line under it, and whatever sits on its right.
 */
export function PanelHeader({
  title,
  id,
  sub,
  aside,
  className,
}: {
  title: string;
  /** For the panel's `aria-labelledby`. */
  id: string;
  sub?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={id} className="m-0 type-heading text-lg text-ink">
          {title}
        </h2>
        {sub}
      </div>
      {aside}
    </div>
  );
}

const STICKER_FILL: Record<TrendTone, string> = {
  primary: 'bg-actionPrimary text-onActionPrimary',
  ai: 'bg-actionAi text-onActionLight',
  accent: 'bg-actionAccent text-onActionLight',
  success: 'bg-actionSuccess text-onActionLight',
  danger: 'bg-actionDanger text-onActionLight',
  secondary: 'bg-actionSecondary text-onActionLight',
};

/**
 * A metric's icon as a sticker: a filled, outlined tile in the metric's
 * colour, the same colour as its line. Decorative: the name beside it says
 * what the card is. `bg-clip-padding` keeps the fill inside the border, so
 * no ring of it shows round the rounded corners (2026-10-23).
 */
export function Sticker({ icon: Icon, tone }: { icon: LucideIcon; tone: TrendTone }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-clip-padding',
        STICKER_FILL[tone],
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2.5} />
    </span>
  );
}

/**
 * A move against the previous period as a small filled chip: green up, red
 * down. "No change" and "nothing to compare" are not chips (a flat arrow
 * would be a claim either way); the caller writes those as plain words.
 */
export function DeltaChip({ trend }: { trend: Extract<Trend, { kind: 'trend' }> }) {
  const up = trend.direction === 'up';
  const Arrow = up ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full border-2 border-outline bg-clip-padding py-0.5 ps-1 pe-2 font-sans text-xs font-bold text-onActionLight tabular-nums',
        up ? 'bg-actionSuccess' : 'bg-actionDanger',
      )}
      data-direction={trend.direction}
    >
      <Arrow className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
      <span className="sr-only">{up ? 'Up' : 'Down'} </span>
      {trend.value}
    </span>
  );
}

/** The trend under a number: the chip and what it compares with, or plain words. */
export function TrendLine({
  trend,
  against,
  fallback,
}: {
  trend: Trend;
  /** "vs previous 30 days". */
  against: string;
  /** Said when there is nothing to compare ("No previous period", "32 posts"). */
  fallback: string;
}) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {trend.kind === 'trend' ? (
        <>
          <DeltaChip trend={trend} />
          <span className="truncate font-sans text-xs text-ink type-muted">{against}</span>
        </>
      ) : (
        <span className="truncate font-sans text-xs text-ink type-muted">
          {trend.kind === 'even' ? `${trend.caption} ${against}` : fallback}
        </span>
      )}
    </span>
  );
}

/** The round "about this" button in a card's corner, Home's info button. */
export function InfoButton({ label, info }: { label: string; info: string }) {
  return (
    <TooltipHint label={info}>
      <button
        type="button"
        aria-label={`About ${label.toLowerCase()}`}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink muted-tone hover:opacity-100',
          FOCUS,
        )}
      >
        <MotionIcon icon={InfoIcon} size={14} className="h-3.5 w-3.5" />
      </button>
    </TooltipHint>
  );
}

/**
 * The calendar toolbar's segmented control, for the design system's `Tabs`
 * (so the arrow keys and roles stay Radix's): a chrome frame, and the chosen
 * option as a filled tile with no shadow of its own.
 */
export const SEGMENTED_LIST =
  'h-10 gap-1 rounded-lg border-2 border-outline bg-chrome p-0.5 shadow-none';

export const SEGMENTED_TRIGGER = cn(
  'h-8 rounded border-2 border-transparent px-3 type-ui text-sm',
  'data-[state=active]:border-outline data-[state=inactive]:hover:bg-primary',
);
