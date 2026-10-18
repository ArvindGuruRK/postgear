'use client';

/**
 * One post on the calendar.
 *
 * Two controls, deliberately: the card body opens the post, and a separate
 * grip starts a drag. Making the whole card the drag handle would turn Space
 * and Enter, which open a button, into drag starts for keyboard users, and
 * a pointer tap into an ambiguous gesture. The grip is also what dnd-kit's
 * keyboard sensor binds to, so a card can be moved by arrow keys; the
 * Reschedule dialog remains the precise keyboard path.
 *
 * Restrained treatment, per design-system-rules.md §15: a calendar is a dense
 * data surface, so the card keeps its thick border and a small shadow, and the
 * state speaks through a colored edge rather than a loud fill.
 */
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Badge, cn } from '@postgear/ui';
import { GripVertical, Lock } from 'lucide-react';
import type { PostSummary } from '@/types/post';
import { ChannelStack } from '../posts/channel-stack';
import { describePost, formatClock, type PostTone } from '../posts/post-status';

/** The state as a colored start edge, in the system's action colors. */
const EDGE: Record<PostTone, string> = {
  draft: 'border-s-ink/40',
  scheduled: 'border-s-actionPrimary',
  publishing: 'border-s-actionAccent',
  retrying: 'border-s-actionAccent',
  published: 'border-s-actionSuccess',
  failed: 'border-s-actionDanger',
};

export type CardDensity = 'compact' | 'regular' | 'roomy';

export function PostCard({
  post,
  now,
  density = 'regular',
  onOpen,
  overlay = false,
}: {
  post: PostSummary;
  now: Date;
  density?: CardDensity;
  onOpen?: (post: PostSummary) => void;
  /** Rendered inside the drag overlay: no drag handle of its own, no fading. */
  overlay?: boolean;
}) {
  const shown = describePost(post, now);
  const locked = post.state === 'PUBLISHED';
  const when = new Date(post.publishDate);

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({
      id: post.group,
      data: { post },
      disabled: locked || overlay,
    });

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={transform && !overlay ? { transform: CSS.Translate.toString(transform) } : undefined}
      data-testid="post-card"
      data-group={post.group}
      data-tone={shown.tone}
      className={cn(
        'group/card relative flex min-w-0 items-stretch rounded-md border-2 border-outline bg-secondary text-ink',
        'border-s-4',
        EDGE[shown.tone],
        overlay ? 'shadow-surfaceMd' : 'shadow-surfaceSm',
        isDragging && !overlay && 'opacity-30',
        shown.tone === 'published' && !overlay && 'opacity-80',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen?.(post)}
        aria-label={`${shown.label}: ${post.preview || 'Empty post'}, ${formatClock(when)}`}
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-1 text-start outline-none',
          'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
          density === 'compact' ? 'px-2 py-1' : 'px-2.5 py-2',
          !overlay && 'hover:bg-actionPrimary/10',
        )}
      >
        <span className="flex items-center gap-1.5">
          <span className="font-sans text-[11px] font-bold tabular-nums">{formatClock(when)}</span>
          {density !== 'compact' ? (
            <Badge
              variant={shown.variant}
              className="px-1.5 py-0 text-[9px] leading-4 tracking-normal"
            >
              {shown.label}
            </Badge>
          ) : (
            <span
              className={cn('h-2 w-2 rounded-full border border-outline', DOT[shown.tone])}
              aria-hidden="true"
            />
          )}
          {locked ? <Lock className="ms-auto h-3 w-3 opacity-60" strokeWidth={3} /> : null}
        </span>
        <span
          className={cn(
            'break-words font-sans font-medium leading-snug',
            density === 'compact' ? 'line-clamp-1 text-xs' : 'text-sm',
            density === 'regular' && 'line-clamp-2',
            density === 'roomy' && 'line-clamp-4',
            !post.preview && 'opacity-60',
          )}
        >
          {post.preview || 'Empty post'}
        </span>
        {density !== 'compact' ? (
          <span className="flex items-center justify-between gap-2 pt-0.5">
            <ChannelStack channels={post.channels} publishDate={post.publishDate} now={now} />
            {shown.detail && density === 'roomy' ? (
              <span className="truncate font-sans text-[11px] opacity-70">{shown.detail}</span>
            ) : null}
          </span>
        ) : null}
      </button>

      {!locked && !overlay ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          aria-label={`Drag to reschedule: ${post.preview || 'Empty post'}`}
          data-testid="post-card-grip"
          className={cn(
            'flex w-5 shrink-0 cursor-grab items-center justify-center border-s-2 border-outline/30 opacity-50 outline-none',
            'transition-opacity hover:opacity-100 active:cursor-grabbing',
            'focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-focusRing',
          )}
        >
          <GripVertical className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}

const DOT: Record<PostTone, string> = {
  draft: 'bg-ink/30',
  scheduled: 'bg-actionPrimary',
  publishing: 'bg-actionAccent',
  retrying: 'bg-actionAccent',
  published: 'bg-actionSuccess',
  failed: 'bg-actionDanger',
};
