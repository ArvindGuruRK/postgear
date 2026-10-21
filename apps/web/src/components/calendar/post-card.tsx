'use client';

/**
 * One post on the calendar, after the reference's calendar item (UI revamp,
 * 2026-10-18): a colored strip on top and the post underneath.
 *
 * - **The strip** carries the state as its fill (scheduled is primary,
 *   published is success, and so on: post-status.ts), the time, and the drag
 *   grip. On hover or keyboard focus it also shows the reference's quick
 *   actions, in its order: duplicate (a new post from this one's text and
 *   media, in the composer), preview (the detail dialog, with reschedule and
 *   post-now), statistics once something has gone out, and delete while the
 *   API still allows it.
 * - **Tags take the strip** (2026-10-19, the reference's way): a tagged post's
 *   strip wears its first tag's colour and names its tags, which give way to
 *   the actions on hover. The state is still on the card without the fill:
 *   each channel's dot on the avatars, "Draft:" before a draft's text, and a
 *   published card's grey. A repeating post shows a repeat mark after the
 *   time, kept on hover so its tooltip can still be read.
 * - **The body** opens the post in the composer, as the reference's opens
 *   its editor: its channels as avatars, then the first line of the text,
 *   prefixed "Draft:" for drafts.
 *
 * Two controls for the two gestures, deliberately: the body opens the post,
 * and the grip starts a drag. Making the whole card the drag handle would turn
 * Space and Enter into drag starts for keyboard users, and a pointer tap into
 * an ambiguous gesture. The grip is also what dnd-kit's keyboard sensor binds
 * to, so a card can be moved by arrow keys; the Reschedule dialog remains the
 * precise keyboard path.
 *
 * Touch is the exception. A 16px grip is no target for a finger, so on a
 * touch screen a long press anywhere on the card starts the drag (the
 * TouchSensor in calendar-view.tsx), the way phone calendars move an event.
 * The delay keeps the two gestures apart: a tap still opens the post, and a
 * swipe that starts on a card still scrolls the grid. The card turns off text
 * selection and the link callout on coarse pointers, so the long press is not
 * also read as "select this text" or "preview this link".
 */
import { ChartColumnIcon } from '@animateicons/react/lucide/chart-column-icon';
import { CopyPlusIcon } from '@animateicons/react/lucide/copy-plus-icon';
import { EyeIcon } from '@animateicons/react/lucide/eye-icon';
import { GripVerticalIcon } from '@animateicons/react/lucide/grip-vertical-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { type DraggableSyntheticListeners, useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn, MotionIcon, TooltipHint } from '@postgear/ui';
import { Lock, Repeat } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import type { PostSummary } from '@/types/post';
import { TAG_COLOR_CLASS } from '@/types/tag';
import { CHANNEL_STACK_HOVER_RING, ChannelStack } from '../posts/channel-stack';
import {
  describePost,
  formatClock,
  hasPublishedChannel,
  type PostTone,
} from '../posts/post-status';

/** The strip: the state's fill, with the text color that clears contrast on it. */
const STRIP: Record<PostTone, string> = {
  draft: 'bg-ink/15 text-ink',
  scheduled: 'bg-actionPrimary text-onActionPrimary',
  publishing: 'bg-actionAccent text-onActionLight',
  retrying: 'bg-actionAccent text-onActionLight',
  published: 'bg-actionSuccess text-onActionLight',
  failed: 'bg-actionDanger text-onActionLight',
};

export type CardDensity = 'compact' | 'regular' | 'roomy';

/** "Repeats every 3 days", or "every day" for 1: the repeat mark's tooltip and name. */
export function repeatLabel(days: number): string {
  return days === 1 ? 'Repeats every day' : `Repeats every ${days} days`;
}

export function PostCard({
  post,
  now,
  density = 'regular',
  editHref,
  onDuplicate,
  onPreview,
  onStatistics,
  onDelete,
  overlay = false,
}: {
  post: PostSummary;
  now: Date;
  density?: CardDensity;
  /** The composer, opened on this post: where the card body goes. */
  editHref?: string;
  /** A new post from this one's text and media, in the composer. */
  onDuplicate?: (post: PostSummary) => void;
  onPreview?: (post: PostSummary) => void;
  onStatistics?: (post: PostSummary) => void;
  onDelete?: (post: PostSummary) => void;
  /** Rendered inside the drag overlay: no handle, no actions, no fading. */
  overlay?: boolean;
}) {
  const shown = describePost(post, now);
  const published = post.state === 'PUBLISHED';
  // Once any channel has gone out the API refuses edits and deletes; the
  // detail dialog applies the same rule.
  const locked = hasPublishedChannel(post);
  const when = new Date(post.publishDate);
  const preview = post.preview || 'Empty post';
  // `?? []` and `?? null`: a calendar response from an API older than tags
  // carries neither field.
  const tags = post.tags ?? [];
  const repeatsEvery = post.intervalInDays ?? null;
  const tagNames = tags.map((tag) => tag.name).join(', ');

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({
      id: post.group,
      data: { post },
      disabled: published || overlay,
    });
  // Each sensor's activator by input: the finger's on the whole card, the
  // mouse's and the keyboard's on the grip (see the header comment).
  const { onTouchStart, ...gripListeners } = listeners ?? {};
  const touchListeners: DraggableSyntheticListeners = onTouchStart ? { onTouchStart } : undefined;

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...touchListeners}
      style={transform && !overlay ? { transform: CSS.Translate.toString(transform) } : undefined}
      data-testid="post-card"
      data-group={post.group}
      data-tone={shown.tone}
      className={cn(
        '@container group/card relative flex min-w-0 flex-col overflow-hidden rounded-lg border-2 border-outline bg-secondary text-ink',
        'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]',
        overlay ? 'shadow-surfaceMd' : 'shadow-surfaceSm',
        isDragging && !overlay && 'opacity-30',
        published && !overlay && 'opacity-80 grayscale',
      )}
    >
      <div
        data-testid="post-card-strip"
        className={cn(
          'flex h-6 shrink-0 items-center gap-1 ps-0.5 pe-1',
          (tags.length > 0 && TAG_COLOR_CLASS[tags[0].color]) || STRIP[shown.tone],
        )}
      >
        {!published && !overlay ? (
          <StripAction label="Drag To Reschedule">
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...gripListeners}
              {...attributes}
              aria-label={`Drag to reschedule: ${preview}`}
              data-testid="post-card-grip"
              className={cn(
                'flex h-5 w-4 shrink-0 cursor-grab items-center justify-center rounded-sm opacity-70 outline-none',
                'transition-opacity hover:opacity-100 active:cursor-grabbing',
                'focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-1 focus-visible:outline-focusRing',
              )}
            >
              <MotionIcon icon={GripVerticalIcon} size={14} className="h-3.5 w-3.5" />
            </button>
          </StripAction>
        ) : (
          <span className="w-1 shrink-0" />
        )}
        <span
          className={cn(
            'min-w-0 truncate type-ui text-[11px] tabular-nums',
            // A week or month cell's card is too narrow for the time and
            // three actions at once: the time steps aside while the actions
            // show, as the reference's strip holds only its icons then. It
            // stays in the card's label, and in wider cards (the day view).
            !overlay &&
              'group-focus-within/card:@max-[10rem]:hidden group-hover/card:@max-[10rem]:hidden',
          )}
        >
          {formatClock(when)}
        </span>
        {repeatsEvery ? (
          <TooltipHint label={repeatLabel(repeatsEvery)} side="top" hoverable={false}>
            <span
              role="img"
              aria-label={repeatLabel(repeatsEvery)}
              data-testid="post-card-repeat"
              className="flex h-5 w-3.5 shrink-0 items-center justify-center"
            >
              <Repeat className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
            </span>
          </TooltipHint>
        ) : null}
        {tags.length > 0 ? (
          <span
            data-testid="post-card-tags"
            className={cn(
              'min-w-0 flex-1 truncate font-sans text-[11px]',
              // Gives way to the actions, as the reference's tag names do.
              !overlay && 'group-focus-within/card:hidden group-hover/card:hidden',
            )}
          >
            {tagNames}
          </span>
        ) : null}
        {published ? (
          <Lock
            // Steps aside while the hover actions take the strip's end.
            className="ms-auto h-3 w-3 shrink-0 opacity-70 group-focus-within/card:hidden group-hover/card:hidden"
            strokeWidth={3}
            aria-hidden="true"
          />
        ) : null}

        {overlay ? null : (
          <span className="ms-auto hidden shrink-0 items-center gap-0.5 group-focus-within/card:flex group-hover/card:flex">
            {onDuplicate ? (
              <StripAction label="Duplicate Post">
                <button
                  type="button"
                  aria-label="Duplicate Post"
                  onClick={() => onDuplicate(post)}
                  className={STRIP_ACTION}
                >
                  <MotionIcon icon={CopyPlusIcon} size={14} className="h-3.5 w-3.5" />
                </button>
              </StripAction>
            ) : null}
            {onPreview ? (
              <StripAction label="Preview Post">
                <button
                  type="button"
                  aria-label="Preview Post"
                  onClick={() => onPreview(post)}
                  className={STRIP_ACTION}
                >
                  <MotionIcon icon={EyeIcon} size={14} className="h-3.5 w-3.5" />
                </button>
              </StripAction>
            ) : null}
            {onStatistics && locked ? (
              <StripAction label="Statistics">
                <button
                  type="button"
                  aria-label="Statistics"
                  onClick={() => onStatistics(post)}
                  className={STRIP_ACTION}
                >
                  <MotionIcon icon={ChartColumnIcon} size={14} className="h-3.5 w-3.5" />
                </button>
              </StripAction>
            ) : null}
            {onDelete && !locked ? (
              <StripAction label="Delete Post">
                <button
                  type="button"
                  aria-label="Delete Post"
                  onClick={() => onDelete(post)}
                  className={STRIP_ACTION}
                >
                  <MotionIcon icon={Trash2Icon} size={14} className="h-3.5 w-3.5" />
                </button>
              </StripAction>
            ) : null}
          </span>
        )}
      </div>

      <CardBody
        href={overlay ? undefined : editHref}
        label={[
          `${shown.label}: ${preview}, ${formatClock(when)}`,
          tags.length > 0 ? `tagged ${tagNames}` : null,
          repeatsEvery ? repeatLabel(repeatsEvery).toLowerCase() : null,
        ]
          .filter(Boolean)
          .join(', ')}
        className={cn(
          'flex min-w-0 flex-1 items-start gap-1.5 text-start outline-none',
          'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-focusRing',
          density === 'compact' ? 'p-1' : 'p-1.5',
          !overlay && ['hover:bg-actionPrimary/10', CHANNEL_STACK_HOVER_RING],
        )}
      >
        <ChannelStack
          channels={post.channels}
          publishDate={post.publishDate}
          now={now}
          max={density === 'roomy' ? 4 : 1}
          className="shrink-0"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              'break-words font-sans leading-snug',
              density === 'roomy' ? 'line-clamp-2 text-sm' : 'line-clamp-1 text-xs',
              !post.preview && 'opacity-60',
            )}
          >
            {post.state === 'DRAFT' ? <span className="type-ui">Draft: </span> : null}
            {preview}
          </span>
          {density === 'roomy' && shown.detail ? (
            <span className="truncate font-sans text-[11px] opacity-70">{shown.detail}</span>
          ) : null}
        </span>
      </CardBody>
    </div>
  );
}

const STRIP_ACTION = cn(
  'flex h-5 w-5 items-center justify-center rounded-sm outline-none',
  'hover:bg-black/15 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-1 focus-visible:outline-focusRing',
);

/** A strip icon with its name as a tooltip, as the reference shows on hover. */
function StripAction({ label, children }: { label: string; children: ReactElement }) {
  return (
    <TooltipHint label={label} side="top">
      {children}
    </TooltipHint>
  );
}

/** A link to the composer, or plain content in the drag overlay copy. */
function CardBody({
  href,
  label,
  className,
  children,
}: {
  href?: string;
  label: string;
  className: string;
  children: ReactNode;
}) {
  return href ? (
    <Link href={href} aria-label={label} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}
