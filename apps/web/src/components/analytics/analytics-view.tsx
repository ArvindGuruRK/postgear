'use client';

/**
 * The analytics dashboard (Sprint 7, user stories 6.1–6.5): totals, a
 * trend, the channels compared, the posts that did best, for a range and,
 * optionally, one channel.
 *
 * ## Shape (revamp, 2026-10-22)
 *
 * One toolbar row, as the calendar's: the range and the channel on the left,
 * the sync status, Sync Now and Export PDF on the right, all the same 40px
 * chrome controls. Then, top to bottom, the four KPI cards (Home's layout),
 * Performance with By Channel beside it, the top posts and the channels
 * table. Every section is a chrome panel with its data on the light layer
 * inside (`analytics-ui.tsx`); charts and the table stay restrained (§15).
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
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import {
  Alert,
  Button,
  cn,
  EmptyState,
  ErrorState,
  MotionIcon,
  PageActions,
  Skeleton,
  Stack,
  Tabs,
  TabsList,
  TabsTrigger,
  useToast,
} from '@postgear/ui';
import { BarChart3, Plug } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChannelSelect } from '@/components/channels/channel-select';
import { ApiError, api } from '@/lib/api';
import type {
  AnalyticsOverview,
  AnalyticsRange,
  AnalyticsSyncOverview,
  SyncNowResult,
} from '@/types/analytics';
import { ANALYTICS_RANGES } from '@/types/analytics';
import type { Channel, ProviderSummary } from '@/types/channel';
import { useWorkspace } from '../navigation/workspace-provider';
import { useMounted } from '../posts/use-mounted';
import { AnalyticsStats, AnalyticsStatsSkeleton } from './analytics-stats';
import { AnalyticsSyncPill } from './analytics-sync-pill';
import { AnalyticsPanel, PanelHeader, SEGMENTED_LIST, SEGMENTED_TRIGGER } from './analytics-ui';
import { type AnalyticsFilters, hasMetrics, lacksMetrics } from './analytics-view-model';
import { ChannelsTable } from './channels-table';
import { PostAnalyticsDialog } from './post-analytics-dialog';
import { exportAnalyticsPdf } from './report/export-report';
import { TopPosts } from './top-posts';
import { TrendSection } from './trend-section';
import { useAnalytics } from './use-analytics';

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
  const [exporting, setExporting] = useState(false);
  const { organizations } = useWorkspace();
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

  /** The PDF of what is on screen (2026-10-22, in place of the CSV). */
  async function exportPdf() {
    if (!overview) return;
    setExporting(true);
    try {
      const channel = channels.find((entry) => entry.id === analytics.filters.channelId);
      await exportAnalyticsPdf(overview, {
        workspace:
          organizations.find((organization) => organization.id === orgId)?.name ?? 'Workspace',
        channelName: channel?.name ?? null,
      });
    } catch {
      toast({
        variant: 'danger',
        title: "Couldn't create the PDF",
        description: 'Please try again. If it keeps failing, reload the page first.',
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Stack gap="lg">
      {/* One row from md: the filters on the left, the actions on the right.
          On a phone each half takes the full width and wraps under the other. */}
      <PageActions className="justify-between">
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          {/* On a phone the range and the channel each take a full row. */}
          <Tabs
            className="w-full sm:w-auto"
            value={String(analytics.filters.range)}
            onValueChange={(value) =>
              analytics.setFilters({ range: Number(value) as AnalyticsRange })
            }
          >
            <TabsList
              aria-label="Range"
              data-testid="analytics-range"
              className={cn(SEGMENTED_LIST, 'flex w-full sm:inline-flex sm:w-auto')}
            >
              {ANALYTICS_RANGES.map((range) => (
                <TabsTrigger
                  key={range}
                  value={String(range)}
                  className={cn(SEGMENTED_TRIGGER, 'flex-1 sm:flex-none')}
                >
                  {range} Days
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <ChannelSelect
            channels={channels}
            value={analytics.filters.channelId}
            onValueChange={(channelId) => analytics.setFilters({ channelId })}
            label={(channel) =>
              lacksMetrics(channel, overview, supported)
                ? `${channel.name} (no metrics)`
                : channel.name
            }
            disabled={channels.length === 0}
            className="h-10 w-full rounded-lg bg-chrome shadow-none sm:w-64"
          />
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          <AnalyticsSyncPill initial={initialSync} refreshKey={syncRefresh} now={analytics.now} />
          <Button
            variant="secondary"
            size="sm"
            className="h-10"
            onClick={() => void syncNow()}
            disabled={requesting || analytics.syncing || channels.length === 0}
          >
            <MotionIcon
              icon={RefreshCwIcon}
              className={cn(
                'h-4 w-4',
                analytics.syncing && 'animate-spin motion-reduce:animate-none',
              )}
            />
            Sync Now
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-10"
            onClick={() => void exportPdf()}
            disabled={exporting || !mounted || !overview || !hasMetrics(overview)}
            aria-busy={exporting}
          >
            <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
            {exporting ? 'Creating PDF…' : 'Export PDF'}
          </Button>
        </div>
      </PageActions>

      {overview?.simulated ? (
        <Alert className="py-2.5 text-sm" data-testid="analytics-simulated">
          Simulated metrics (ANALYTICS_SIMULATION). Real numbers appear once the worker syncs
          connected accounts.
        </Alert>
      ) : null}

      {channels.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="Connect a channel first"
          description="Analytics follow the accounts PostGear publishes to. Connect one and the worker starts syncing its metrics."
          action={{ label: 'Go To Channels', onClick: () => router.push(`/${orgId}/channels`) }}
        />
      ) : analytics.error && !overview ? (
        <ErrorState
          title="The metrics didn't load"
          description={analytics.error}
          action={{ label: 'Try Again', onClick: analytics.reload }}
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
              label: analytics.syncing ? 'Syncing…' : 'Sync Now',
              onClick: () => void syncNow(),
              variant: 'secondary',
            }}
          />
          <ChannelsPanel
            overview={overview}
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
                Try Again
              </Button>
            </Alert>
          ) : null}

          <AnalyticsStats overview={overview} />

          <TrendSection overview={overview} />

          <TopPosts
            orgId={orgId}
            posts={overview.topPosts}
            now={analytics.now}
            onOpen={(post) => setOpenGroup(post.group)}
          />

          <ChannelsPanel
            overview={overview}
            selectedId={analytics.filters.channelId}
            now={analytics.now}
            onSelect={(channelId) => analytics.setFilters({ channelId })}
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

/**
 * The channels table in its panel, with "Show All Channels" while one is
 * picked. The table itself is the filter: a row shows only its channel.
 */
function ChannelsPanel({
  overview,
  selectedId,
  now,
  onSelect,
}: {
  overview: AnalyticsOverview;
  selectedId: string | null;
  now: Date;
  onSelect: (channelId: string | null) => void;
}) {
  const count = overview.channels.length;

  return (
    <AnalyticsPanel className="flex flex-col gap-4 p-4 md:p-5" aria-labelledby="analytics-channels">
      <PanelHeader
        id="analytics-channels"
        title="Channels"
        sub={
          <span className="font-sans text-sm text-ink type-muted">
            {count} {count === 1 ? 'account' : 'accounts'} in the range. Pick one to see only it.
          </span>
        }
        aside={
          selectedId ? (
            <Button variant="secondary" size="sm" onClick={() => onSelect(null)}>
              Show All Channels
            </Button>
          ) : null
        }
      />
      <ChannelsTable
        channels={overview.channels}
        selectedId={selectedId}
        now={now}
        onSelect={onSelect}
      />
    </AnalyticsPanel>
  );
}

/** The dashboard's layout with nothing in it, so the real one lands without a reflow. */
function DashboardSkeleton() {
  return (
    <Stack gap="lg" aria-busy="true" aria-label="Loading analytics">
      <AnalyticsStatsSkeleton />
      <div className="grid grid-cols-1 gap-3 md:gap-4 xl:grid-cols-3">
        <AnalyticsPanel className="flex flex-col gap-4 p-4 md:p-5 xl:col-span-2">
          <Skeleton className="h-14 w-56" />
          <Skeleton className="h-64" />
        </AnalyticsPanel>
        <AnalyticsPanel className="flex flex-col gap-4 p-4 md:p-5">
          <Skeleton className="h-14 w-40" />
          <Skeleton className="h-64" />
        </AnalyticsPanel>
      </div>
      <AnalyticsPanel className="flex flex-col gap-4 p-4 md:p-5">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-72" />
      </AnalyticsPanel>
    </Stack>
  );
}
