'use client';

import { useState } from 'react';
import type { PostSummary } from '@/types/post';
import type { CalendarHandlers } from './calendar-handlers';
import { type CardDensity, PostCard } from './post-card';

/**
 * Cards shown in one cell before the rest fold away. Without a cap, one busy
 * hour would stretch its row for all seven days.
 */
const MAX_VISIBLE = 3;

/**
 * The posts in one calendar cell, the reference's way: the first three, then
 * "+ Show more (n)" which expands the cell in place, and "- Show less" to fold
 * it back. In place rather than jumping to the day view, so the person keeps
 * their week and their scroll position.
 */
export function SlotPosts({
  posts,
  now,
  density,
  handlers,
}: {
  posts: PostSummary[];
  now: Date;
  density: CardDensity;
  handlers: CalendarHandlers;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflow = posts.length > MAX_VISIBLE;
  const visible = expanded || !overflow ? posts : posts.slice(0, MAX_VISIBLE);

  return (
    <>
      {visible.map((post) => (
        <PostCard
          key={post.group}
          post={post}
          now={now}
          density={density}
          editHref={handlers.editHref(post)}
          onPreview={handlers.onPreview}
          onStatistics={handlers.onStatistics}
          onDelete={handlers.onDelete}
        />
      ))}
      {overflow ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="rounded-md px-1 py-1 text-center font-sans text-xs text-ink outline-none hover:underline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
        >
          {expanded ? '- Show less' : `+ Show more (${posts.length - MAX_VISIBLE})`}
        </button>
      ) : null}
    </>
  );
}
