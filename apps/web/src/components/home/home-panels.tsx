'use client';

/**
 * The two panels side by side (Buffer's "Up next" and "Comments"), stacked
 * on a phone.
 *
 * Up next is the next five queued posts: when each goes out, in the viewer's
 * own zone and words ("Today", "Tomorrow"), the channels it goes to with
 * their usual colours, and its first line. A row opens that post in the
 * composer. Times wait for the browser (`now`), so the server never renders
 * a time in its own zone.
 *
 * Comments is an empty state for now, in the reference's words: platform
 * comments are not synced yet, and a panel that pretended otherwise would be
 * worse than one that says what will be there.
 */
import { ArrowRightIcon } from '@animateicons/react/lucide/arrow-right-icon';
import { Card, cn, EmptyState, ErrorState, MotionIcon, Skeleton } from '@postgear/ui';
import { CalendarDays, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CHANNEL_STACK_HOVER_RING, ChannelStack } from '@/components/posts/channel-stack';
import { formatClock } from '@/components/posts/post-status';
import type { PostSummary } from '@/types/post';
import { dayLabel, firstLine } from './home-model';
import { FOCUS, HomeSection, TEXT_LINK } from './home-ui';
import { UP_NEXT_COUNT } from './use-home-data';

/** Both panels keep one height, so the pair reads as a row. */
const PANEL = 'flex min-h-64 flex-1 flex-col';

export function HomePanels({
  orgId,
  posts,
  error,
  now,
  onRetry,
}: {
  orgId: string;
  /** Null while the first load is in flight. */
  posts: PostSummary[] | null;
  error: string | null;
  /** The viewer's clock; null until mounted. */
  now: Date | null;
  onRetry: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-4">
      <HomeSection
        title="Up next"
        data-testid="home-up-next"
        action={
          <Link href={`/${orgId}/queue`} className={TEXT_LINK}>
            Open queue
            <MotionIcon icon={ArrowRightIcon} className="h-4 w-4" />
          </Link>
        }
      >
        <Card className={PANEL}>
          <UpNext orgId={orgId} posts={posts} error={error} now={now} onRetry={onRetry} />
        </Card>
      </HomeSection>

      <HomeSection title="Comments" data-testid="home-comments">
        <Card className={cn(PANEL, 'items-center justify-center')}>
          <EmptyState
            icon={MessageCircle}
            title="No comments yet."
            description="You'll see the latest comments here."
            className="p-6"
          />
        </Card>
      </HomeSection>
    </div>
  );
}

function UpNext({
  orgId,
  posts,
  error,
  now,
  onRetry,
}: {
  orgId: string;
  posts: PostSummary[] | null;
  error: string | null;
  now: Date | null;
  onRetry: () => void;
}) {
  const router = useRouter();

  if (error && !posts) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState
          title="The queue didn't load"
          description={error}
          action={{ label: 'Try again', onClick: onRetry, variant: 'secondary' }}
          className="p-6"
        />
      </div>
    );
  }

  if (!posts || !now) {
    return (
      <ul className="m-0 flex list-none flex-col gap-1 p-2" aria-label="Loading the queue">
        {Array.from({ length: 3 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders with nothing else to key on
          <li key={index} className="flex items-center gap-3 px-3 py-3">
            <Skeleton className="h-9 w-20 shrink-0" />
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <Skeleton className="h-4 flex-1" />
          </li>
        ))}
      </ul>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={CalendarDays}
          title="No posts scheduled yet."
          description="You'll see upcoming posts here."
          action={{ label: 'Create Post', onClick: () => router.push(`/${orgId}/composer`) }}
          className="p-6"
        />
      </div>
    );
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-2" data-count={posts.length}>
      {posts.slice(0, UP_NEXT_COUNT).map((post) => {
        const when = new Date(post.publishDate);
        const line = firstLine(post.preview);

        return (
          <li key={post.group}>
            <Link
              href={`/${orgId}/composer?group=${encodeURIComponent(post.group)}`}
              data-testid="home-up-next-row"
              className={cn(
                'flex min-w-0 items-center gap-3 rounded-md px-3 py-2.5 hover:bg-actionPrimary/10',
                CHANNEL_STACK_HOVER_RING,
                FOCUS,
                'focus-visible:outline-offset-0',
              )}
            >
              {/* Data, not chrome: the body face, like the queue's time column. */}
              <span className="flex w-20 shrink-0 flex-col font-sans leading-tight sm:w-24">
                <span className="truncate text-xs font-bold text-ink">{dayLabel(when, now)}</span>
                <span className="text-xs tabular-nums text-ink opacity-70">
                  {formatClock(when)}
                </span>
              </span>
              <ChannelStack
                channels={post.channels}
                publishDate={post.publishDate}
                now={now}
                size="md"
                max={3}
                className="shrink-0"
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate font-sans text-sm text-ink',
                  !line && 'opacity-60',
                )}
              >
                {line ?? 'Empty post'}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
