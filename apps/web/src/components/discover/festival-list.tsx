'use client';

/**
 * The Festivals tab's list (blueprint section 4, stories DC-5.1 and DC-5.2):
 * the place's festivals and holidays in sections by week (This Week, Next
 * Week, Later This Month, Next Month, then Just Happened), each a box of rows
 * you read: the date, the name, a Public Holiday or Observance tag, how far
 * off it is, and Plan A Post.
 *
 * Which section a festival is in and what "in 5 days" says are worked out in
 * `discover-model.ts` from the answer's own `today` (the place's date, from
 * the API) and each festival's calendar date. Nothing here asks the browser
 * what day it is, so the list reads the same from any time zone.
 *
 * **Plan A Post** is the neutral secondary, like Create Post on a card: the
 * same action on every row is not the one call to action. It opens the Create
 * Post sheet with a date for the draft (`festivalPublishAt`, set by the view).
 */
import { Badge, Button, cn } from '@postgear/ui';
import { useId } from 'react';
import type { DiscoverItem } from '@/types/discover';
import {
  type FestivalSection,
  festivalBadge,
  festivalDay,
  festivalSections,
  festivalWhen,
} from './discover-model';
import { ROW, ROW_LIST } from './discover-ui';

export interface FestivalRowProps {
  item: DiscoverItem;
  /** Today in the place's own calendar (`YYYY-MM-DD`), from the answer. Without it the row says no "in 5 days". */
  today: string | null | undefined;
  /** Opens the Create Post sheet with the festival's date. Without it there is no Plan A Post (the playground). */
  onPlanPost?: (item: DiscoverItem) => void;
}

/** One festival: "8 Nov, Sunday  Diwali/Deepavali  Public Holiday  2 days ago  Plan A Post". */
export function FestivalRow({ item, today, onPlanPost }: FestivalRowProps) {
  const date = festivalDay(item.date);
  const badge = festivalBadge(item);
  const when = festivalWhen(item.date, today);

  return (
    <li
      data-testid="discover-festival-row"
      className={cn(ROW, 'animate-fadeIn motion-reduce:animate-none')}
    >
      {date ? (
        <time dateTime={item.date} className="flex w-20 shrink-0 flex-col">
          <span className="type-heading text-base text-ink">{date.day}</span>
          <span className="font-sans text-xs text-ink type-muted">{date.weekday}</span>
        </time>
      ) : null}
      <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-x-3 gap-y-1">
        <span dir="auto" className="min-w-0 break-words type-ui text-sm text-ink">
          {item.title}
        </span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {when ? (
          <span className="font-sans text-xs text-ink type-muted" data-testid="festival-when">
            {when}
          </span>
        ) : null}
      </div>
      {onPlanPost ? (
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          aria-label={`Plan A Post for ${item.title}`}
          onClick={() => onPlanPost(item)}
        >
          Plan A Post
        </Button>
      ) : null}
    </li>
  );
}

function FestivalSectionList({
  section,
  today,
  onPlanPost,
}: {
  section: FestivalSection;
  today: string | null | undefined;
  onPlanPost?: (item: DiscoverItem) => void;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={section.title ? headingId : undefined}
      data-testid="discover-festival-section"
      data-section={section.id}
      className="flex flex-col gap-2"
    >
      {section.title ? (
        <h3 id={headingId} className="m-0 type-label text-sm text-ink">
          {section.title}
        </h3>
      ) : null}
      <ul className={ROW_LIST}>
        {section.items.map((item) => (
          <FestivalRow key={item.id} item={item} today={today} onPlanPost={onPlanPost} />
        ))}
      </ul>
    </section>
  );
}

/** The festivals in their sections, empty sections left out. */
export function FestivalList({
  items,
  today,
  onPlanPost,
}: {
  items: readonly DiscoverItem[];
  /** Today in the place's own calendar, from the answer. */
  today: string | null | undefined;
  onPlanPost?: (item: DiscoverItem) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {festivalSections(items, today).map((section) => (
        <FestivalSectionList
          key={section.id}
          section={section}
          today={today}
          onPlanPost={onPlanPost}
        />
      ))}
    </div>
  );
}
