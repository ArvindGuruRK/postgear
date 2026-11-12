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
import { type SaveControl, SaveButton } from './discover-cards';
import {
  daysUntil,
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
  /** Module 10: the bookmark. */
  save?: SaveControl;
}

/** A festival inside the coming week: its tile's month band is blue, so the near ones stand out. */
const SOON_DAYS = 7;

/**
 * The date as a desk calendar's page: the month on a band over the day.
 * The band is blue for the coming week, plain later on, and the whole tile
 * fades once the day has passed. A screen reader hears "8 Nov" once.
 */
function CalendarTile({
  date,
  iso,
  days,
}: {
  date: NonNullable<ReturnType<typeof festivalDay>>;
  iso: string;
  days: number | null;
}) {
  const past = days !== null && days < 0;
  const soon = days !== null && days >= 0 && days < SOON_DAYS;

  return (
    <time
      dateTime={iso}
      data-testid="festival-tile"
      data-soon={soon || undefined}
      className={cn(
        'flex w-14 shrink-0 flex-col overflow-hidden rounded-md border-2 border-outline text-center',
        past && 'opacity-60',
      )}
    >
      <span className="sr-only">{date.day}</span>
      <span
        aria-hidden="true"
        className={cn(
          'border-b-2 border-outline px-1 py-0.5 type-label text-xs',
          soon ? 'bg-actionPrimary text-onActionPrimary' : 'bg-chrome text-ink',
        )}
      >
        {date.month}
      </span>
      <span
        aria-hidden="true"
        className="bg-secondary py-1 type-heading text-xl leading-none text-ink tabular-nums"
      >
        {date.dayOfMonth}
      </span>
    </time>
  );
}

/** One festival: a calendar tile for 8 Nov, "Diwali/Deepavali", "Sunday, 2 days ago", Public Holiday, Plan A Post. */
export function FestivalRow({ item, today, onPlanPost, save }: FestivalRowProps) {
  const date = festivalDay(item.date);
  const badge = festivalBadge(item);
  const when = festivalWhen(item.date, today);
  const days = daysUntil(item.date, today);

  return (
    <li
      data-testid="discover-festival-row"
      className={cn(ROW, 'animate-fadeIn motion-reduce:animate-none')}
    >
      {date && item.date ? <CalendarTile date={date} iso={item.date} days={days} /> : null}
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span dir="auto" className="min-w-0 break-words type-heading text-base text-ink">
            {item.title}
          </span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <p className="m-0 font-sans text-xs text-ink type-muted">
          {date ? <span>{date.weekday}</span> : null}
          {date && when ? ', ' : null}
          {when ? <span data-testid="festival-when">{when}</span> : null}
        </p>
      </div>
      {onPlanPost || save ? (
        <div className="flex shrink-0 items-center gap-1">
          {onPlanPost ? (
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Plan A Post for ${item.title}`}
              onClick={() => onPlanPost(item)}
            >
              Plan A Post
            </Button>
          ) : null}
          {save ? <SaveButton item={item} save={save} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function FestivalSectionList({
  section,
  today,
  onPlanPost,
  renderSave,
}: {
  section: FestivalSection;
  today: string | null | undefined;
  onPlanPost?: (item: DiscoverItem) => void;
  renderSave?: (item: DiscoverItem) => SaveControl | undefined;
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
          <FestivalRow
            key={item.id}
            item={item}
            today={today}
            onPlanPost={onPlanPost}
            save={renderSave?.(item)}
          />
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
  renderSave,
}: {
  items: readonly DiscoverItem[];
  /** Today in the place's own calendar, from the answer. */
  today: string | null | undefined;
  onPlanPost?: (item: DiscoverItem) => void;
  /** Module 10: the bookmark on each row. */
  renderSave?: (item: DiscoverItem) => SaveControl | undefined;
}) {
  return (
    <div className="flex flex-col gap-5">
      {festivalSections(items, today).map((section) => (
        <FestivalSectionList
          key={section.id}
          section={section}
          today={today}
          onPlanPost={onPlanPost}
          renderSave={renderSave}
        />
      ))}
    </div>
  );
}
