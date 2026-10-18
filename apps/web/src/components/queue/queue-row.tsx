'use client';

/**
 * One post in the queue list.
 *
 * Time first, because the queue is read as "what goes out, and when"; then the
 * state and the text; then where it goes. The status line under the text is
 * the worker's own account (the next retry, the failure), so a problem is
 * explained in the row rather than hidden behind a click. Restrained, like the
 * calendar cards: a dense list keeps its borders and drops the shadows.
 */
import { Badge, cn } from '@postgear/ui';
import { ExternalLink } from 'lucide-react';
import { PlatformIcon, platformLabel } from '@/components/platforms/platform-icon';
import type { PostSummary } from '@/types/post';
import { ChannelStack } from '../posts/channel-stack';
import { PostActionsMenu } from '../posts/post-actions-menu';
import { describePost, formatClock, type PostTone } from '../posts/post-status';

const EDGE: Record<PostTone, string> = {
  draft: 'border-s-ink/40',
  scheduled: 'border-s-actionPrimary',
  publishing: 'border-s-actionAccent',
  retrying: 'border-s-actionAccent',
  published: 'border-s-actionSuccess',
  failed: 'border-s-actionDanger',
};

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

  return (
    <li
      data-testid="queue-row"
      data-group={post.group}
      data-tone={shown.tone}
      className={cn(
        'flex items-stretch gap-3 rounded-md border-2 border-s-4 border-outline bg-secondary',
        EDGE[shown.tone],
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(post)}
        className={cn(
          'flex min-w-0 flex-1 items-start gap-3 p-3 text-start outline-none hover:bg-actionPrimary/10 sm:gap-4 sm:p-4',
          'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-focusRing',
        )}
      >
        <span className="flex w-12 shrink-0 flex-col items-center pt-0.5 sm:w-14">
          {/* Data, not chrome: the body face, tabular so the column lines up (§1, §15). */}
          <span className="font-sans text-lg font-bold leading-none tabular-nums text-ink">
            {formatClock(when)}
          </span>
          <span className="mt-1 font-sans text-[10px] font-bold uppercase text-ink opacity-60">
            {when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </span>
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={shown.variant}>{shown.label}</Badge>
            {post.parts > 1 ? <Badge variant="outline">{post.parts} parts</Badge> : null}
            {shown.detail ? (
              <span className="font-sans text-xs font-medium text-ink opacity-70">
                {shown.detail}
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              'line-clamp-2 break-words font-sans text-sm font-medium text-ink',
              !post.preview && 'opacity-60',
            )}
          >
            {post.preview || 'Empty post'}
          </span>
          <span className="flex flex-wrap items-center gap-3 pt-0.5">
            <ChannelStack channels={post.channels} publishDate={post.publishDate} now={now} />
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-sans text-xs text-ink">
              {post.channels.map((channel) => (
                <span key={channel.channelId} className="flex min-w-0 items-center gap-1">
                  <PlatformIcon
                    platform={channel.providerIdentifier}
                    title={platformLabel(channel.providerIdentifier)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="truncate opacity-70">{channel.name}</span>
                </span>
              ))}
            </span>
          </span>
        </span>
      </button>

      <span className="flex shrink-0 flex-col items-end justify-between gap-2 p-3">
        <PostActionsMenu
          orgId={orgId}
          post={post}
          onPublishNow={onPublishNow}
          onReschedule={onReschedule}
          onDelete={onDelete}
        />
        {permalink ? (
          <a
            href={permalink}
            target="_blank"
            rel="noreferrer"
            aria-label="View the published post"
            className="flex h-9 w-9 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink shadow-brutalSm outline-none transition-[transform,box-shadow] duration-100 hover:bg-actionPrimary/10 active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
          >
            <ExternalLink className="h-4 w-4" strokeWidth={2.5} />
          </a>
        ) : null}
      </span>
    </li>
  );
}
