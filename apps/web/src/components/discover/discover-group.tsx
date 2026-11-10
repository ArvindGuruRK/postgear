'use client';

/**
 * One group of a tab ("Rising Searches In Tamil Nadu", "Chennai Stories"), on
 * the analytics page's panel: the frame colour, a Title Case name, and the
 * sentence the API wrote under it, which names the source and, for a copy kept
 * while the source rests, how old it is. A group with nothing in it is never
 * drawn: the tab decides what to say instead.
 */
import { Skeleton } from '@postgear/ui';
import { type ReactNode, useId } from 'react';
import type { DiscoverItem, DiscoverGroup as Group } from '@/types/discover';
import { AnalyticsPanel, PanelHeader } from '../analytics/analytics-ui';
import { StoryCard, TrendCard } from './discover-cards';

export const CARD_GRID = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4';

export function DiscoverGroup({
  group,
  now,
  onCreatePost,
  renderExtra,
}: {
  group: Group;
  now: Date;
  onCreatePost?: (item: DiscoverItem) => void;
  /** Per-card controls after Open (Module 04's overflow menu). */
  renderExtra?: (item: DiscoverItem) => ReactNode;
}) {
  const headingId = useId();
  if (group.items.length === 0) return null;

  return (
    <section aria-labelledby={headingId} data-testid="discover-group" data-group={group.id}>
      <AnalyticsPanel className="flex flex-col gap-4 p-4 md:p-5">
        <PanelHeader
          id={headingId}
          title={group.title}
          sub={
            <p
              className="m-0 font-sans text-sm text-ink type-muted"
              data-stale={group.stale || undefined}
            >
              {group.subtitle}
            </p>
          }
        />
        <div className={CARD_GRID}>
          {group.items.map((item) =>
            item.kind === 'news' ? (
              <StoryCard
                key={item.id}
                item={item}
                now={now}
                onCreatePost={onCreatePost}
                extra={renderExtra?.(item)}
              />
            ) : (
              <TrendCard
                key={item.id}
                item={item}
                now={now}
                onCreatePost={onCreatePost}
                extra={renderExtra?.(item)}
              />
            ),
          )}
        </div>
      </AnalyticsPanel>
    </section>
  );
}

/**
 * A tab's footprint while it loads (blueprint section 7): a group of four
 * cards and a group of five rows, so the answer lands without a jump.
 */
export function DiscoverSkeleton({ label = 'Loading Discover' }: { label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="flex flex-col gap-6" role="status">
      <AnalyticsPanel className="flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-64 max-w-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className={CARD_GRID}>
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="flex flex-col gap-3 rounded-lg border-2 border-outline bg-inset p-4"
            >
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <div className="flex gap-2 pt-1">
                <Skeleton className="h-9 w-28" />
                <Skeleton className="h-9 w-20" />
              </div>
            </div>
          ))}
        </div>
      </AnalyticsPanel>
      <AnalyticsPanel className="flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-56 max-w-full" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="flex flex-col divide-y-2 divide-outline overflow-hidden rounded-lg border-2 border-outline bg-inset">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="flex items-center gap-3 p-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-9 w-24" />
            </div>
          ))}
        </div>
      </AnalyticsPanel>
    </div>
  );
}
