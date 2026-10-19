'use client';

/**
 * The leaderboard (user story 6.3): the posts that did best in the range,
 * ranked by engagement.
 *
 * Each row is a button that opens the post's own numbers; the two links a
 * row carries ("Create similar", which hands the post's text to the AI
 * studio as a topic, and the platform permalink) sit beside the button,
 * not inside it, because a link inside a button is reachable by neither
 * keyboard nor screen reader. The rank is `type-heading` (it is chrome: a
 * big number meant to be read from across the room); everything else in
 * the row is data and stays in the body face (§15).
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { Card, cn, MotionIcon, SectionHeader, Text } from '@postgear/ui';
import { Eye, Heart, MessageCircle, Share2 } from 'lucide-react';
import Link from 'next/link';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import type { TopPost } from '@/types/analytics';
import { formatMetric, formatPercent, relativeTime } from './analytics-view-model';
import { ChannelAvatar } from './channel-avatar';

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

const LINK = cn(
  'inline-flex w-fit items-center gap-1 rounded-sm font-sans text-xs font-bold text-ink underline underline-offset-2',
  FOCUS,
);

export function TopPosts({
  orgId,
  posts,
  now,
  onOpen,
}: {
  orgId: string;
  posts: TopPost[];
  now: Date;
  onOpen: (post: TopPost) => void;
}) {
  return (
    <Card className="flex flex-col gap-4 p-5" aria-label="Top posts">
      <SectionHeader
        title="Top posts"
        description="Ranked by engagement in this range. Open one for its numbers against the channel's average."
      />

      {posts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border-2 border-outline p-8 text-center">
          <Text size="sm" muted>
            No published posts with metrics in this range.
          </Text>
          <Link href={`/${orgId}/queue?state=PUBLISHED`} className={LINK}>
            See what has published
          </Link>
        </div>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {posts.map((post) => {
            const published = relativeTime(post.publishDate, now);

            return (
              <li
                key={`${post.channelId}:${post.postId}`}
                data-testid="analytics-top-post"
                data-rank={post.rank}
                data-group={post.group}
                className="flex items-stretch gap-2 rounded-md border-2 border-outline bg-secondary"
              >
                <button
                  type="button"
                  onClick={() => onOpen(post)}
                  aria-label={`Open metrics for post ${post.rank}: ${post.preview.slice(0, 60)}`}
                  className={cn(
                    'flex min-w-0 flex-1 items-start gap-3 p-3 text-start hover:bg-actionPrimary/10 sm:gap-4',
                    'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-focusRing',
                  )}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary type-heading text-lg text-ink"
                    aria-hidden="true"
                  >
                    {post.rank}
                  </span>
                  <ChannelAvatar
                    id={post.channelId}
                    color={post.color}
                    name={post.channelName}
                    picture={post.picture}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="line-clamp-2 font-sans text-sm font-medium text-ink">
                      {post.preview || <span className="opacity-60">Empty post</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-xs text-ink opacity-70">
                      <span className="font-bold">{post.channelName}</span>
                      <span className="flex items-center gap-1">
                        <PlatformIcon platform={post.providerIdentifier} className="h-3.5 w-3.5" />
                        {post.providerName}
                      </span>
                      {published ? <span>Published {published}</span> : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-xs text-ink tabular-nums">
                      <Chip icon={Eye} label="Impressions" value={post.metrics.impressions} />
                      <Chip icon={Heart} label="Likes" value={post.metrics.likes} />
                      <Chip icon={MessageCircle} label="Comments" value={post.metrics.comments} />
                      <Chip icon={Share2} label="Shares" value={post.metrics.shares} />
                      <span className="font-bold">
                        {formatPercent(post.metrics.engagementRate)}
                        <span className="sr-only"> engagement rate</span>
                      </span>
                    </span>
                  </span>
                </button>

                <span className="flex shrink-0 flex-col items-start justify-center gap-2 border-s-2 border-outline p-3">
                  <Link
                    href={`/${orgId}/ai-copilot?topic=${encodeURIComponent(post.preview.slice(0, 200))}`}
                    className={LINK}
                  >
                    <MotionIcon icon={SparklesIcon} size={12} strokeWidth={3} className="h-3 w-3" />
                    Create similar
                  </Link>
                  {post.releaseURL ? (
                    <a href={post.releaseURL} target="_blank" rel="noreferrer" className={LINK}>
                      <MotionIcon
                        icon={ExternalLinkIcon}
                        size={12}
                        strokeWidth={3}
                        className="h-3 w-3"
                      />
                      View on {post.providerName}
                    </a>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function Chip({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3.5 w-3.5 opacity-70" strokeWidth={2.5} aria-hidden="true" />
      <span className="sr-only">{label} </span>
      {formatMetric(value)}
    </span>
  );
}
