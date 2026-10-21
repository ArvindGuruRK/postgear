'use client';

import { TagsIcon } from '@animateicons/react/lucide/tags-icon';
import { Checkbox, cn, MotionIcon, Popover, PopoverContent, PopoverTrigger } from '@postgear/ui';
import { useId } from 'react';
import { TAG_COLOR_CLASS } from '@/types/tag';
import { useCalendar } from './calendar-context';

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

/**
 * The calendar's tag filter (2026-10-19): which tagged posts to show. The
 * reference has tags but no way to filter by them; PostGear adds this beside
 * the view switch, alongside the channel card's channel filter, and the two
 * combine (`filterPosts` in calendar-context).
 *
 * A post with any ticked tag is shown; nothing ticked shows every post,
 * tagged or not. The list is fetched again each time it opens, because the
 * composer (where tags are made) can add one while the calendar stays open
 * underneath it. Each tag wears its own colour, the one its cards' strips
 * wear, so the filter and the grid read as one.
 */
export function TagFilter({ className }: { className?: string }) {
  const { tags, tagFilter, toggleTag, clearTagFilter, reloadTags } = useCalendar();
  const listId = useId();
  const count = tagFilter.length;

  return (
    <Popover onOpenChange={(open) => open && reloadTags()}>
      <PopoverTrigger
        aria-label={count > 0 ? `Tags, ${count} selected` : 'Tags'}
        data-testid="tag-filter"
        className={cn(
          'flex h-10 shrink-0 items-center gap-2 rounded-lg border-2 border-outline px-3 type-ui text-sm',
          count > 0 ? 'bg-actionPrimary/10 text-ink' : 'bg-chrome text-ink hover:bg-primary',
          FOCUS,
          className,
        )}
      >
        <MotionIcon icon={TagsIcon} className="h-4 w-4 shrink-0" />
        <span>{count > 0 ? `Tags (${count})` : 'Tags'}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        {tags === null ? (
          <p className="m-0 p-4 font-sans text-sm text-ink opacity-70">Loading tags…</p>
        ) : tags.length === 0 ? (
          <p className="m-0 p-4 font-sans text-sm text-ink opacity-70">
            No tags yet. Add one to a post in the composer.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
            <span id={listId} className="type-ui text-xs text-ink opacity-70">
              Show Posts Tagged
            </span>
            {count > 0 ? (
              <button
                type="button"
                onClick={clearTagFilter}
                className={cn('rounded-sm type-ui text-xs underline underline-offset-2', FOCUS)}
              >
                Clear
              </button>
            ) : null}
          </div>
        )}

        {tags && tags.length > 0 ? (
          <ul
            aria-labelledby={listId}
            className="m-0 flex max-h-72 list-none flex-col overflow-y-auto p-0 pb-2 pg-scrollbar pg-scrollbar-secondary"
          >
            {tags.map((tag) => {
              const id = `${listId}-${tag.id}`;
              return (
                <li key={tag.id}>
                  <label
                    htmlFor={id}
                    className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-primary"
                  >
                    <Checkbox
                      id={id}
                      checked={tagFilter.includes(tag.id)}
                      onCheckedChange={() => toggleTag(tag.id)}
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-3 w-3 shrink-0 rounded-full border-2 border-outline',
                        TAG_COLOR_CLASS[tag.color],
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-sans text-sm text-ink">
                      {tag.name}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
