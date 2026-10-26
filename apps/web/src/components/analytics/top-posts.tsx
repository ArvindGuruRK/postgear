'use client';

/**
 * The leaderboard (user story 6.3): the posts that did best in the range,
 * ranked by engagement. Revamped 2026-10-22 from one tall card per post into
 * a compact ranked list: the first five, then "Show All" for the rest.
 *
 * Each row is a button that opens the post's own numbers; the two links a
 * row carries ("Create Similar", which hands the post's text to the AI
 * copilot as a topic, and the platform permalink) sit beside the button as
 * icon links, not inside it, because a link inside a button is reachable by
 * neither keyboard nor screen reader. From `md` the numbers line up as
 * columns (views, engagements, rate); on a phone they run as one line under
 * the post.
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { Button, cn, MotionIcon, TooltipHint } from '@postgear/ui';
import Link from 'next/link';
import { useState } from 'react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import type { TopPost } from '@/types/analytics';
import { AnalyticsPanel, FOCUS, PanelHeader } from './analytics-ui';
import {
  formatMetric,
  formatPercent,
  relativeTime,
  TOP_POSTS_PREVIEW,
} from './analytics-view-model';
import { ChannelAvatar } from './channel-avatar';

const ICON_LINK = cn(
  'flex h-8 w-8 items-center justify-center rounded-md border-2 border-transparent text-ink hover:border-outline hover:bg-primary',
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
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? posts : posts.slice(0, TOP_POSTS_PREVIEW);
  const hidden = posts.length - TOP_POSTS_PREVIEW;

  return (
    <AnalyticsPanel
      className="flex flex-col gap-4 p-4 md:p-5"
      aria-labelledby="analytics-top-posts"
    >
      <PanelHeader
        id="analytics-top-posts"
        title="Top Posts"
        sub={
          <span className="font-sans text-sm text-ink type-muted">
            Ranked by engagement. Open one to compare it with its channel's average.
          </span>
        }
      />

      {posts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border-2 border-outline bg-inset p-8 text-center">
          <span className="font-sans text-sm text-ink type-muted">
            No published posts with metrics in this range.
          </span>
          <Link
            href={`/${orgId}/queue?state=PUBLISHED`}
            className={cn(
              'rounded-sm font-sans text-sm font-bold text-ink underline underline-offset-2',
              FOCUS,
            )}
          >
            See What Has Published
          </Link>
        </div>
      ) : (
        <>
          <ol className="m-0 flex list-none flex-col overflow-hidden rounded-md border-2 border-outline bg-inset p-0">
            {shown.map((post) => (
              <Row
                key={`${post.channelId}:${post.postId}`}
                orgId={orgId}
                post={post}
                now={now}
                onOpen={onOpen}
              />
            ))}
          </ol>

          {hidden > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              className="self-center"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
            >
              {expanded ? 'Show Top 5' : `Show All ${posts.length}`}
            </Button>
          ) : null}
        </>
      )}
    </AnalyticsPanel>
  );
}

function Row({
  orgId,
  post,
  now,
  onOpen,
}: {
  orgId: string;
  post: TopPost;
  now: Date;
  onOpen: (post: TopPost) => void;
}) {
  const published = relativeTime(post.publishDate, now);

  return (
    <li
      data-testid="analytics-top-post"
      data-rank={post.rank}
      data-group={post.group}
      // On a phone the two links sit in a strip under the post: beside it
      // they took the room the numbers need.
      className="flex flex-col border-b-2 border-outline last:border-b-0 sm:flex-row sm:items-stretch"
    >
      <button
        type="button"
        onClick={() => onOpen(post)}
        aria-label={`Open metrics for post ${post.rank}: ${post.preview.slice(0, 60)}`}
        className={cn(
          'flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 text-start hover:bg-primary md:flex-nowrap md:gap-4 md:px-4',
          'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-focusRing',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-clip-padding type-heading text-base tabular-nums',
            post.rank === 1 ? 'bg-actionSecondary text-onActionLight' : 'bg-secondary text-ink',
          )}
        >
          {post.rank}
        </span>
        <ChannelAvatar
          id={post.channelId}
          color={post.color}
          name={post.channelName}
          picture={post.picture}
        />
        <span className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
          <span className="truncate font-sans text-sm font-bold text-ink">
            {post.preview || 'Empty post'}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 font-sans text-xs text-ink type-muted">
            <PlatformIcon platform={post.providerIdentifier} className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {post.channelName}
              {published ? `, published ${published}` : ''}
            </span>
          </span>
        </span>

        {/* Columns from md; one line under the post on a phone (the row wraps). */}
        <span className="flex w-full items-center gap-4 ps-11 md:w-auto md:shrink-0 md:gap-0 md:ps-0">
          <Figure label="Views" value={formatMetric(post.metrics.impressions)} />
          <Figure label="Engagements" value={formatMetric(post.metrics.engagements)} />
          <Figure label="Rate" value={formatPercent(post.metrics.engagementRate)} strong />
        </span>
      </button>

      <span className="flex shrink-0 items-center justify-end gap-1 border-t-2 border-outline px-2 py-1 sm:border-t-0 sm:border-s-2 sm:py-0">
        <TooltipHint label="Create Similar" side="left">
          <Link
            href={`/${orgId}/ai-copilot?topic=${encodeURIComponent(post.preview.slice(0, 200))}`}
            aria-label={`Create similar to post ${post.rank}`}
            className={ICON_LINK}
          >
            <MotionIcon icon={SparklesIcon} className="h-4 w-4" />
          </Link>
        </TooltipHint>
        {post.releaseURL ? (
          <TooltipHint label={`View On ${post.providerName}`} side="left">
            <a
              href={post.releaseURL}
              target="_blank"
              rel="noreferrer"
              aria-label={`View post ${post.rank} on ${post.providerName}`}
              className={ICON_LINK}
            >
              <MotionIcon icon={ExternalLinkIcon} className="h-4 w-4" />
            </a>
          </TooltipHint>
        ) : null}
      </span>
    </li>
  );
}

/** One number in a row: its name small above it from md, beside the value's meaning on a phone. */
function Figure({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <span className="flex flex-col md:w-24 md:items-end">
      <span className="font-sans text-xs text-ink type-muted">{label}</span>
      <span
        className={cn(
          'font-sans text-sm text-ink tabular-nums',
          strong ? 'font-bold' : 'font-medium',
        )}
      >
        {value}
      </span>
    </span>
  );
}
