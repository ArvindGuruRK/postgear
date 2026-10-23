'use client';

/**
 * One post in the queue, as a row of its day's card (2026-10-23 revamp).
 *
 * Time first, because the queue is read as "what goes out, and when"; the day
 * is the tile beside the card, so the row no longer repeats the date. Then
 * the text, which is what a person recognises a post by, and one line under
 * it: the state, where it goes, and the worker's own account (the next retry,
 * the failure), so a problem is explained in the row rather than behind a
 * click. The state is also the coloured start edge (design-system-rules.md
 * section 16a). Rows share their card's border and drop their own shadows.
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { Badge, cn, MotionIcon, TooltipHint } from '@postgear/ui';
import { Repeat } from 'lucide-react';
import { PlatformIcon, platformLabel } from '@/components/platforms/platform-icon';
import type { PostSummary } from '@/types/post';
import { CHANNEL_STACK_HOVER_RING, ChannelStack } from '../posts/channel-stack';
import { PostActionsMenu } from '../posts/post-actions-menu';
import { describePost, formatClock, formatRelative, type PostTone } from '../posts/post-status';

const EDGE: Record<PostTone, string> = {
  draft: 'border-s-ink/40',
  scheduled: 'border-s-actionPrimary',
  publishing: 'border-s-actionAccent',
  retrying: 'border-s-actionAccent',
  published: 'border-s-actionSuccess',
  failed: 'border-s-actionDanger',
};

/** Keyboard focus drawn inside the row, so the card's edge never clips it. */
const INSET_FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-focusRing';

/** The square icon control beside the menu, matching its size and press. */
const ICON_LINK =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink shadow-brutalSm outline-none transition-[transform,box-shadow] duration-100 hover:bg-actionPrimary/10 active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

export function QueueRow({
  orgId,
  post,
  now,
  onOpen,
  onPublishNow,
  onReschedule,
  onDelete,
}: {
  orgId: string;
  post: PostSummary;
  now: Date;
  onOpen: (post: PostSummary) => void;
  onPublishNow: (post: PostSummary) => void;
  onReschedule: (post: PostSummary) => void;
  onDelete: (post: PostSummary) => void;
}) {
  const shown = describePost(post, now);
  const when = new Date(post.publishDate);
  const permalink = post.channels.find((channel) => channel.releaseURL)?.releaseURL ?? null;
  // How far off a scheduled post is, while that is still a useful number.
  const soon =
    shown.tone === 'scheduled' && when.getTime() - now.getTime() < 2 * 86_400_000
      ? formatRelative(when, now)
      : null;

  return (
    <li
      data-testid="queue-row"
      data-group={post.group}
      data-tone={shown.tone}
      // `grow`: a day with one post is as tall as its date tile, and the row
      // fills that height, so its edge and hover reach the card's bottom
      // rather than stopping above an empty band. The hover tints the whole
      // row, the menu side included.
      className={cn(
        'flex grow items-stretch border-s-4 hover:bg-actionPrimary/10',
        CHANNEL_STACK_HOVER_RING,
        EDGE[shown.tone],
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(post)}
        className={cn(
          'grid min-w-0 flex-1 grid-cols-[4.25rem_minmax(0,1fr)] content-start items-start gap-3 py-3 ps-3 pe-2 text-start sm:grid-cols-[5.25rem_minmax(0,1fr)] sm:gap-4 sm:py-4 sm:ps-4',
          INSET_FOCUS,
        )}
      >
        <span className="flex flex-col gap-1 pt-0.5">
          {/* Data, not chrome: the body face, tabular so the column lines up (§1, §15). */}
          <span className="whitespace-nowrap font-sans text-sm font-bold leading-none tabular-nums text-ink sm:text-base">
            {formatClock(when)}
          </span>
          {soon ? <span className="font-sans text-xs text-ink type-muted">{soon}</span> : null}
        </span>

        <span className="flex min-w-0 flex-col gap-2">
          <span
            className={cn(
              'line-clamp-2 break-words font-sans text-sm font-medium text-ink',
              !post.preview && 'type-muted',
            )}
          >
            {post.preview || 'Empty post'}
          </span>

          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Badge variant={shown.variant}>{shown.label}</Badge>
            {post.parts > 1 ? <Badge variant="outline">{post.parts} Parts</Badge> : null}

            <span className="flex min-w-0 items-center gap-2">
              <ChannelStack channels={post.channels} publishDate={post.publishDate} now={now} />
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-sans text-xs text-ink">
                {post.channels.map((channel) => (
                  <span key={channel.channelId} className="flex min-w-0 items-center gap-1">
                    <PlatformIcon
                      platform={channel.providerIdentifier}
                      title={platformLabel(channel.providerIdentifier)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate type-muted">{channel.name}</span>
                  </span>
                ))}
              </span>
            </span>

            {post.intervalInDays ? (
              <span className="flex items-center gap-1 font-sans text-xs text-ink type-muted">
                <Repeat aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
                {post.intervalInDays === 1 ? 'Every day' : `Every ${post.intervalInDays} days`}
              </span>
            ) : null}

            {shown.detail ? (
              <span className="font-sans text-xs font-bold text-ink">{shown.detail}</span>
            ) : null}
          </span>
        </span>
      </button>

      <span className="flex shrink-0 items-start gap-2 py-3 pe-3 sm:py-4 sm:pe-4">
        {permalink ? (
          <TooltipHint label="View The Published Post">
            <a
              href={permalink}
              target="_blank"
              rel="noreferrer"
              aria-label="View The Published Post"
              className={ICON_LINK}
            >
              <MotionIcon icon={ExternalLinkIcon} className="h-4 w-4" />
            </a>
          </TooltipHint>
        ) : null}
        <PostActionsMenu
          orgId={orgId}
          post={post}
          onPublishNow={onPublishNow}
          onReschedule={onReschedule}
          onDelete={onDelete}
        />
      </span>
    </li>
  );
}
