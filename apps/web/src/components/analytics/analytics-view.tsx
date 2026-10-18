'use client';

/**
 * The analytics dashboard (Sprint 7, user stories 6.1–6.5): totals, a
 * trend, the channels compared, the posts that did best, for a range and,
 * optionally, one channel.
 *
 * ## Shape
 *
 * The header is the chrome and carries the full treatment: range tabs, the
 * channel select, Sync now, Export CSV and the sync pill. Everything under
 * it is data in the restrained profile (§15): cards with no halftone, a
 * table with no shadow, charts drawn from tokens.
 *
 * ## States, in the order they are checked
 *
 * No channels at all is a setup problem, not an analytics one, so it points
 * at the Channels page. A failed overview is an `ErrorState` with a retry.
 * Channels with nothing recorded yet get "No metrics yet" and the Sync now
 * button, with the channels table under it so the reason (unsupported,
 * never synced, needs reconnect) is visible without guessing. Otherwise the
 * dashboard. Before mount the server renders skeletons in the dashboard's
 * own layout: every number and time is formatted in the viewer's locale,
 * which the server does not share (see `use-mounted.ts`).
 *
 * ## The simulated banner
 *
 * `ANALYTICS_SIMULATION=true` makes the worker read a deterministic stand-in
 * instead of the platforms, and the API says so on every overview. The
 * banner is one plain line in the default `Alert`, not the AI violet,
 * which marks model output, and not a warning, which this is not: it is
 * the local setup working as intended.
 */
import {
  Alert,
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  PageActions,
  SectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stack,
  Tabs,
  TabsList,
  TabsTrigger,
  useToast,
} from '@postgear/ui';
import { BarChart3, Download, Plug, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api, BROWSER_API_URL } from '@/lib/api';
import type {
  AnalyticsOverview,
  AnalyticsRange,
  AnalyticsSyncOverview,
  SyncNowResult,
} from '@/types/analytics';
import { ANALYTICS_RANGES } from '@/types/analytics';
import type { Channel, ProviderSummary } from '@/types/channel';
import { useMounted } from '../posts/use-mounted';
import { AnalyticsStats, AnalyticsStatsSkeleton } from './analytics-stats';
import { AnalyticsSyncPill } from './analytics-sync-pill';
import { type AnalyticsFilters, exportUrl, hasMetrics } from './analytics-view-model';
import { ChannelsTable } from './channels-table';
import { PostAnalyticsDialog } from './post-analytics-dialog';
import { TopPosts } from './top-posts';
import { TrendSection } from './trend-section';
import { useAnalytics } from './use-analytics';

const ALL_CHANNELS = '__all__';

export function AnalyticsView({
  orgId,
  channels,
  providers,
  initialOverview,
  initialSync,
  initialFilters,
}: {
  orgId: string;
  channels: Channel[];
  providers: ProviderSummary[];
  /** Null when the server could not load it; the client then tries once more. */
  initialOverview: AnalyticsOverview | null;
  initialSync: AnalyticsSyncOverview | null;
  initialFilters: AnalyticsFilters;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const mounted = useMounted();
  const analytics = useAnalytics(initialOverview, initialFilters);
  const [requesting, setRequesting] = useState(false);
  const [syncRefresh, setSyncRefresh] = useState(0);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const overview = analytics.data;
  const supported = new Set(
    providers.filter((provider) => provider.analytics).map((provider) => provider.identifier),
  );

  async function syncNow() {
    setRequesting(true);
    try {
      const result = await api<SyncNowResult>('/analytics/sync', {
        method: 'POST',
        body: analytics.filters.channelId ? { channelId: analytics.filters.channelId } : {},
      });
      if (result.requested) {
        toast({
          title: `Sync requested for ${result.channels} ${result.channels === 1 ? 'channel' : 'channels'}`,
          description:
            'The worker fetches the latest numbers now; this page refreshes as they land.',
        });
        analytics.watchSync();
      } else {
        toast({
          variant: 'danger',
          title: 'Sync not requested',
          description:
            'The scheduler is unreachable, so nothing was queued. Start Temporal and the worker, then try again.',
        });
      }
      setSyncRefresh((count) => count + 1);
    } catch (cause) {
      toast({
        variant: 'danger',
        title: 'Could not request a sync',
        description: cause instanceof ApiError ? cause.message : 'Please try again.',
      });
    } finally {
      setRequesting(false);
    }
  }

  function exportCsv() {
    window.location.assign(exportUrl(BROWSER_API_URL, analytics.filters));
  }

  const headerActions = (
    <div className="flex flex-wrap items-center gap-3">
      <AnalyticsSyncPill initial={initialSync} refreshKey={syncRefresh} now={analytics.now} />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void syncNow()}
        disabled={requesting || analytics.syncing || channels.length === 0}
      >
        <RefreshCw
          className={cn('h-4 w-4', analytics.syncing && 'animate-spin motion-reduce:animate-none')}
          strokeWidth={2.5}
        />
        Sync now
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={exportCsv}
        disabled={!overview || !hasMetrics(overview)}
      >
        <Download className="h-4 w-4" strokeWidth={2.5} />
        Export CSV
      </Button>
    </div>
  );

  return (
    <Stack gap="lg">
      <PageActions>{headerActions}</PageActions>

      <div className="flex flex-col gap-3 rounded-md border-2 border-outline bg-secondary p-3 shadow-surfaceSm md:flex-row md:flex-wrap md:items-center">
        <Tabs
          value={String(analytics.filters.range)}
          onValueChange={(value) =>
            analytics.setFilters({ range: Number(value) as AnalyticsRange })
          }
        >
          <TabsList aria-label="Range" data-testid="analytics-range">
            {ANALYTICS_RANGES.map((range) => (
              <TabsTrigger key={range} value={String(range)}>
                {range} days
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Select
          value={analytics.filters.channelId ?? ALL_CHANNELS}
          onValueChange={(value) =>
            analytics.setFilters({ channelId: value === ALL_CHANNELS ? null : value })
          }
          disabled={channels.length === 0}
        >
          <SelectTrigger className="h-9 text-xs md:w-64" aria-label="Channel">
            <SelectValue placeholder="All channels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CHANNELS}>All channels</SelectItem>
            {channels.map((channel) => (
              <SelectItem key={channel.id} value={channel.id}>
                {channel.name} · {channel.providerName}
                {supported.has(channel.providerIdentifier) ? '' : ' (no metrics)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {overview?.simulated ? (
        <Alert className="py-3" data-testid="analytics-simulated">
          Metrics are a local stand-in (ANALYTICS_SIMULATION). Real platform numbers appear once the
          worker syncs connected accounts.
        </Alert>
      ) : null}

      {channels.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="Connect a channel first"
          description="Analytics follow the accounts PostGear publishes to. Connect one and the worker starts syncing its metrics."
          action={{ label: 'Go to Channels', onClick: () => router.push(`/${orgId}/channels`) }}
        />
      ) : analytics.error && !overview ? (
        <ErrorState
          title="The metrics didn't load"
          description={analytics.error}
          action={{ label: 'Try again', onClick: analytics.reload }}
        />
      ) : !mounted || !overview ? (
        <DashboardSkeleton />
      ) : !hasMetrics(overview) ? (
        <Stack gap="lg" aria-busy={analytics.loading}>
          <EmptyState
            icon={BarChart3}
            title="No metrics yet"
            description="The worker syncs every connected channel daily. Ask for a sync now and the first numbers appear within a minute or two."
            action={{
              label: analytics.syncing ? 'Syncing…' : 'Sync now',
              onClick: () => void syncNow(),
              variant: 'secondary',
            }}
          />
          <ChannelsTable
            channels={overview.channels}
            selectedId={analytics.filters.channelId}
            now={analytics.now}
            onSelect={(channelId) => analytics.setFilters({ channelId })}
          />
        </Stack>
      ) : (
        <Stack
          gap="lg"
          aria-busy={analytics.loading}
          className={cn('transition-opacity', analytics.loading && 'opacity-70')}
        >
          {analytics.error ? (
            <Alert variant="danger" className="py-3">
              {analytics.error} Showing the last numbers that loaded.
              <Button variant="secondary" size="sm" className="ms-3" onClick={analytics.reload}>
                Try again
              </Button>
            </Alert>
          ) : null}

          <AnalyticsStats totals={overview.totals} />

          <TrendSection overview={overview} />

          <Card className="flex flex-col gap-4 p-5" aria-label="Channels">
            <SectionHeader
              title="Channels"
              description="Every connected account in the range. Click a channel to see only it."
              actions={
                analytics.filters.channelId ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => analytics.setFilters({ channelId: null })}
                  >
                    Show all channels
                  </Button>
                ) : null
              }
            />
            <ChannelsTable
              channels={overview.channels}
              selectedId={analytics.filters.channelId}
              now={analytics.now}
              onSelect={(channelId) => analytics.setFilters({ channelId })}
            />
          </Card>

          <TopPosts
            orgId={orgId}
            posts={overview.topPosts}
            now={analytics.now}
            onOpen={(post) => setOpenGroup(post.group)}
          />
        </Stack>
      )}

      <PostAnalyticsDialog
        group={openGroup}
        now={analytics.now}
        onOpenChange={(open) => !open && setOpenGroup(null)}
      />
    </Stack>
  );
}

/** The dashboard's layout with nothing in it, so the real one lands without a reflow. */
function DashboardSkeleton() {
  return (
    <Stack gap="lg" aria-busy="true" aria-label="Loading analytics">
      <AnalyticsStatsSkeleton />
      <Card className="flex flex-col gap-4 p-5">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-60" />
      </Card>
      <Card className="flex flex-col gap-4 p-5">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48" />
      </Card>
      <Card className="flex flex-col gap-4 p-5">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </Card>
    </Stack>
  );
}
