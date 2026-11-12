'use client';

/**
 * One group of a tab ("Rising Searches In Tamil Nadu", "Chennai Stories"), on
 * the analytics page's panel: the frame colour, a Title Case name, and the
 * sentence the API wrote under it, which names the source and, for a copy kept
 * while the source rests, how old it is. A group with nothing in it is never
 * drawn: the tab decides what to say instead.
 *
 * What sits inside depends on the group (Module 05): trends, stories and
 * videos are cards in a grid, Wikipedia's most-read articles are rows, the
 * social topics are chips, and festivals are a list in sections by week.
 * Trends and stories also carry Read (Module 08); the card decides whether
 * an item has a page to read.
 *
 * Module 10: a ranked group (trends, videos) numbers its cards in the
 * source's order, every card group draws its first item as the lead, two
 * columns wide, and trends measure their search volume against the group's
 * busiest. `renderSave` gives each card its bookmark.
 */
import { Skeleton } from '@postgear/ui';
import { type ReactNode, useId } from 'react';
import type { DiscoverItem, DiscoverGroup as Group } from '@/types/discover';
import { AnalyticsPanel, PanelHeader } from '../analytics/analytics-ui';
import { type SaveControl, StoryCard, TrendCard, VideoCard } from './discover-cards';
import { SocialChips, WikipediaRows } from './discover-rows';
import { ROW_LIST } from './discover-ui';
import { FestivalList } from './festival-list';

export const CARD_GRID = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4';

export interface DiscoverGroupProps {
  group: Group;
  now: Date;
  /** Festivals only: today in the place's own calendar (`YYYY-MM-DD`), from the answer. */
  today?: string | null;
  onCreatePost?: (item: DiscoverItem) => void;
  /** Festivals only: opens the Create Post sheet with the festival's date. */
  onPlanPost?: (item: DiscoverItem) => void;
  /** Opens the reader sheet on a trend's or a story's page (Module 08). */
  onRead?: (item: DiscoverItem) => void;
  /** Per-card controls after Open (Module 04's overflow menu). */
  renderExtra?: (item: DiscoverItem) => ReactNode;
  /** Module 10: each item's bookmark, or undefined for none. */
  renderSave?: (item: DiscoverItem) => SaveControl | undefined;
}

/** The groups whose order is a ranking worth numbering: Google's rising searches, YouTube's chart. */
const RANKED_GROUPS: ReadonlySet<string> = new Set(['trends', 'videos']);

/** Each trend's search volume against the busiest in its group, or null when the source gave none. */
export function volumesOf(items: readonly DiscoverItem[]): Array<number | null> {
  const most = Math.max(0, ...items.map((item) => item.signal?.traffic ?? 0));
  return items.map((item) =>
    most > 0 && typeof item.signal?.traffic === 'number' ? item.signal.traffic / most : null,
  );
}

export function DiscoverGroup({
  group,
  now,
  today,
  onCreatePost,
  onPlanPost,
  onRead,
  renderExtra,
  renderSave,
}: DiscoverGroupProps) {
  const headingId = useId();
  if (group.items.length === 0) return null;

  function body(): ReactNode {
    if (group.id === 'wikipedia') {
      return (
        <WikipediaRows items={group.items} onCreatePost={onCreatePost} renderSave={renderSave} />
      );
    }
    if (group.id === 'social') {
      return <SocialChips items={group.items} />;
    }
    if (group.id === 'festivals') {
      return (
        <FestivalList
          items={group.items}
          today={today}
          onPlanPost={onPlanPost}
          renderSave={renderSave}
        />
      );
    }

    const ranked = RANKED_GROUPS.has(group.id);
    const volumes = group.id === 'trends' ? volumesOf(group.items) : null;

    return (
      <div className={CARD_GRID}>
        {group.items.map((item, index) => {
          const ItemCard =
            item.kind === 'news' ? StoryCard : item.kind === 'video' ? VideoCard : TrendCard;
          return (
            <ItemCard
              key={item.id}
              item={item}
              now={now}
              onCreatePost={onCreatePost}
              onRead={onRead}
              extra={renderExtra?.(item)}
              save={renderSave?.(item)}
              rank={ranked ? index + 1 : undefined}
              lead={index === 0 && group.items.length > 2}
              volume={volumes?.[index] ?? null}
            />
          );
        })}
      </div>
    );
  }

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
        {body()}
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
        <div className={ROW_LIST}>
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
