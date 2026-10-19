'use client';

/**
 * One post's numbers (user story 6.2): per channel, each metric against the
 * channel's own average, with the engagement over every snapshot taken.
 *
 * Loaded on open (the leaderboard carries the latest snapshot but not the
 * averages or the history) with a skeleton that keeps the dialog's size
 * and an `ErrorState` with a retry when the request fails. Opening the same
 * post twice fetches twice: the numbers are cheap and a stale "vs avg"
 * after a sync is worse than a round trip.
 *
 * "Above / below average" is the API's verdict (`comparison`), not
 * recomputed here, so the arrow and the figure can never disagree. The
 * arrows are the StatCard pair (success up, danger down) plus a muted dash
 * for even. A channel whose metrics are null says "Not synced yet" rather
 * than a grid of zeros.
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import {
  Badge,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ErrorState,
  MotionIcon,
  Skeleton,
  Text,
  TrendChart,
} from '@postgear/ui';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import { ApiError, api } from '@/lib/api';
import type { Comparison, PostAnalytics, PostChannelAnalytics } from '@/types/analytics';
import { POST_METRIC_LABELS } from '@/types/analytics';
import { formatWhen } from '../posts/post-status';
import {
  comparisonFor,
  formatMetric,
  formatPercent,
  postMetricsToShow,
  relativeTime,
} from './analytics-view-model';
import { ChannelAvatar } from './channel-avatar';

type Loaded =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; post: PostAnalytics };

export function PostAnalyticsDialog({
  group,
  now,
  onOpenChange,
}: {
  /** The post to show; null closes the dialog. */
  group: string | null;
  now: Date;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<Loaded>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the explicit retry trigger
  useEffect(() => {
    if (!group) {
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });

    api<{ post: PostAnalytics }>(`/analytics/posts/${encodeURIComponent(group)}`)
      .then((result) => !cancelled && setState({ kind: 'ready', post: result.post }))
      .catch((cause: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message:
              cause instanceof ApiError ? cause.message : "The post's metrics could not be loaded.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [group, attempt]);

  if (!group) {
    return <Dialog open={false} onOpenChange={onOpenChange} />;
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto pg-scrollbar pg-scrollbar-secondary"
        data-testid="post-analytics"
        data-state-kind={state.kind}
      >
        {state.kind === 'loading' ? (
          <section
            className="flex flex-col gap-4"
            aria-busy="true"
            aria-label="Loading post metrics"
          >
            <DialogHeader>
              <DialogTitle>Post metrics</DialogTitle>
              <DialogDescription>Fetching the latest snapshot…</DialogDescription>
            </DialogHeader>
            <Skeleton className="h-20" />
            <Skeleton className="h-40" />
          </section>
        ) : state.kind === 'error' ? (
          <>
            <DialogHeader>
              <DialogTitle>Post metrics</DialogTitle>
              <DialogDescription>The numbers did not arrive.</DialogDescription>
            </DialogHeader>
            <ErrorState
              title="Couldn't load this post"
              description={state.message}
              action={{ label: 'Try again', onClick: () => setAttempt((count) => count + 1) }}
            />
          </>
        ) : (
          <Ready post={state.post} now={now} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Ready({ post, now }: { post: PostAnalytics; now: Date }) {
  const when = new Date(post.publishDate);

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{formatWhen(when)}</DialogTitle>
        <DialogDescription>
          Published {relativeTime(post.publishDate, now) ?? ''} · {post.channels.length}{' '}
          {post.channels.length === 1 ? 'channel' : 'channels'}
        </DialogDescription>
      </DialogHeader>

      <blockquote className="m-0 line-clamp-4 whitespace-pre-wrap break-words rounded-md border-2 border-outline bg-secondary p-4 font-sans text-sm font-medium text-ink">
        {post.preview || <span className="opacity-60">Empty post</span>}
      </blockquote>

      <ul className="m-0 flex list-none flex-col gap-4 p-0" aria-label="Channels">
        {post.channels.map((channel) => (
          <ChannelMetrics key={channel.channelId} channel={channel} now={now} />
        ))}
      </ul>
    </div>
  );
}

function ChannelMetrics({ channel, now }: { channel: PostChannelAnalytics; now: Date }) {
  const metrics = channel.metrics;
  const keys = metrics ? postMetricsToShow(metrics, channel.average) : [];
  const history = channel.history.map((snapshot) => ({
    x: snapshot.capturedAt,
    y: snapshot.metrics.engagements,
  }));
  const updated = relativeTime(channel.capturedAt, now);

  return (
    <li
      className="flex flex-col gap-3 rounded-md border-2 border-outline bg-secondary p-4"
      data-testid="post-analytics-channel"
      data-channel={channel.channelId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ChannelAvatar
          id={channel.channelId}
          color={channel.color}
          name={channel.name}
          picture={channel.picture}
        />
        <Text size="sm" weight="bold" as="span" className="truncate">
          {channel.name}
        </Text>
        <Badge variant="outline" className="gap-1">
          <PlatformIcon platform={channel.providerIdentifier} className="h-3.5 w-3.5" />
          {channel.providerName}
        </Badge>
        {metrics ? (
          <span className="ms-auto font-sans text-sm text-ink">
            <span className="font-bold">{formatPercent(metrics.engagementRate)}</span>
            <span className="ms-1 text-xs opacity-70">engagement</span>
            <Indicator comparison={comparisonFor(channel.comparison, 'engagementRate')} />
          </span>
        ) : null}
      </div>

      {!metrics ? (
        <Text size="sm" muted>
          {channel.support === 'unsupported'
            ? `${channel.providerName} does not expose post metrics PostGear can read.`
            : 'Not synced yet. The worker fetches post metrics with its next sync.'}
        </Text>
      ) : (
        <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {keys.map((key) => {
            const average = channel.average?.[key] ?? null;
            const comparison = comparisonFor(channel.comparison, key);
            return (
              <div
                key={key}
                className="flex flex-col gap-0.5 rounded-md border-2 border-outline p-2.5"
                data-metric={key}
              >
                <dt className="font-sans text-[10px] font-bold uppercase tracking-wide text-ink opacity-60">
                  {POST_METRIC_LABELS[key]}
                </dt>
                <dd className="m-0 type-heading text-xl text-ink tabular-nums">
                  {formatMetric(metrics[key])}
                </dd>
                {average !== null ? (
                  <dd className="m-0 flex items-center gap-1 font-sans text-xs text-ink opacity-80 tabular-nums">
                    <Indicator comparison={comparison} />
                    vs avg {formatMetric(average)}
                  </dd>
                ) : null}
              </div>
            );
          })}
        </dl>
      )}

      {history.length >= 2 ? (
        <TrendChart
          series={[
            { id: channel.channelId, label: 'Engagements', points: history, tone: 'primary' },
          ]}
          height={140}
          showLegend={false}
          formatValue={(value) => formatMetric(value)}
          formatX={(iso) => shortStamp(iso)}
          formatXLong={(iso) => new Date(iso).toLocaleString()}
          aria-label={`Engagements over ${history.length} snapshots`}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 font-sans text-xs text-ink opacity-70">
        <span>{updated ? `Last updated ${updated}` : 'No snapshot yet'}</span>
        {channel.releaseURL ? (
          <a
            href={channel.releaseURL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-sm font-bold underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
          >
            <MotionIcon icon={ExternalLinkIcon} size={12} strokeWidth={3} className="h-3 w-3" />
            View on {channel.providerName}
          </a>
        ) : null}
      </div>
    </li>
  );
}

/** Above / below / even against the channel's average, as an arrow with a spoken label. */
function Indicator({ comparison }: { comparison: Comparison | null }) {
  if (comparison === null) {
    return null;
  }
  const label =
    comparison === 'above'
      ? 'above average'
      : comparison === 'below'
        ? 'below average'
        : 'about average';
  return (
    <span
      className={cn(
        'inline-flex items-center',
        comparison === 'above' && 'text-successInk',
        comparison === 'below' && 'text-dangerInk',
        comparison === 'even' && 'opacity-50',
      )}
      title={label}
    >
      {comparison === 'above' ? (
        <ArrowUp className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
      ) : comparison === 'below' ? (
        <ArrowDown className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
      ) : (
        <Minus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** "14 Oct 09:00" for a snapshot's axis label. */
function shortStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
