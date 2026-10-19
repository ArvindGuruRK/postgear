'use client';

/**
 * Home (UI revamp, 2026-10-19): Buffer's home dashboard with a Postiz-style
 * streak, in the order the owner approved ("Full Buffer + Postiz mix"):
 *
 * 1. the greeting, in place of a page title (the top bar already says Home);
 * 2. the week in three numbers: streak, weekly goal, AI credits;
 * 3. what needs attention, only when something does;
 * 4. the first steps, until all three are done;
 * 5. Up next beside Comments;
 * 6. starter templates that open the composer with text in it;
 * 7. from the blog.
 *
 * One column on a phone in the same order. Data: see the page and
 * `use-home-data.ts`; the dialogs here are the same ones the calendar's
 * channel card opens, so connecting or fixing a channel works the same from
 * either place.
 */
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ConnectChannelDialog } from '@/components/channels/connect-channel-dialog';
import { FinishSetupDialog } from '@/components/channels/finish-setup-dialog';
import { useWorkspace } from '@/components/navigation/workspace-provider';
import { channelConnectUrl } from '@/lib/api';
import type { AiCredits } from '@/types/ai';
import type { Channel, ChannelLimit, ProviderSummary } from '@/types/channel';
import type { DashboardSummary } from '@/types/dashboard';
import type { QueuePage } from '@/types/post';
import { BlogRow } from './blog-row';
import { FirstSteps } from './first-steps';
import { Greeting } from './greeting';
import { HomeBanners } from './home-banners';
import { bannersFor } from './home-model';
import { HomePanels } from './home-panels';
import { StatsStrip } from './stats-strip';
import { TemplatesRow } from './templates-row';
import { useClock, useDashboard, useUpNext } from './use-home-data';

export function HomeView({
  orgId,
  pending,
  channels,
  limit,
  providers,
  credits,
  initialQueue,
  initialSummary,
}: {
  orgId: string;
  /**
   * True when the server rendered before the active-workspace cookie matched
   * this workspace, so it fetched nothing scoped (see the page). The layout's
   * switch refreshes the page; until then missing data is loading, not lost.
   */
  pending: boolean;
  /** Null when the list failed to load: nothing is then said about channels. */
  channels: Channel[] | null;
  limit: ChannelLimit | null;
  providers: ProviderSummary[];
  credits: AiCredits | null;
  initialQueue: QueuePage | null;
  /** The dashboard counted in UTC: its first steps and failed count only. */
  initialSummary: DashboardSummary | null;
}) {
  const router = useRouter();
  const { role, user } = useWorkspace();
  // Presentation only: the API's RolesGuard is the real check.
  const canManage = role === 'ADMIN' || role === 'SUPERADMIN';
  const atChannelLimit = limit !== null && limit.used >= limit.max;

  const now = useClock();
  const dashboard = useDashboard(initialSummary);
  const upNext = useUpNext(initialQueue);

  const [connectOpen, setConnectOpen] = useState(false);
  const [setupChannel, setSetupChannel] = useState<Channel | null>(null);

  const banners = useMemo(
    () =>
      bannersFor({
        channels,
        failed: dashboard.failed,
        statsFailed: dashboard.error !== null && !dashboard.loading,
      }),
    [channels, dashboard.failed, dashboard.error, dashboard.loading],
  );

  function reconnect(channel: Channel) {
    // The channel menu's Reconnect: the handshake again, with PostGear's own
    // id so the API can check the same account came back.
    window.location.href = channelConnectUrl(channel.providerIdentifier, channel.id);
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 md:gap-8" data-testid="home">
      <div className="flex flex-col gap-4">
        <Greeting now={now} name={user.name} />
        <StatsStrip
          summary={dashboard.summary}
          failed={dashboard.error !== null && !dashboard.loading}
          credits={credits}
          creditsPending={pending}
          mounted={now !== null}
          canEditGoal={canManage}
          onSaveGoal={dashboard.saveGoal}
        />
        <HomeBanners
          orgId={orgId}
          banners={banners}
          canManage={canManage}
          onConnect={() => setConnectOpen(true)}
          onReconnect={reconnect}
          onFinishSetup={setSetupChannel}
          onRetryStats={dashboard.reload}
        />
      </div>

      <FirstSteps
        orgId={orgId}
        steps={dashboard.firstSteps}
        canManage={canManage}
        atChannelLimit={atChannelLimit}
        onConnect={() => setConnectOpen(true)}
      />

      <HomePanels
        orgId={orgId}
        posts={upNext.posts}
        error={upNext.error}
        now={now}
        onRetry={upNext.reload}
      />

      <TemplatesRow orgId={orgId} />

      <BlogRow />

      <ConnectChannelDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        providers={providers}
      />
      <FinishSetupDialog
        channel={setupChannel}
        onOpenChange={(open) => !open && setSetupChannel(null)}
        onDone={() => {
          setSetupChannel(null);
          // The channel list and the banners come from the server render.
          router.refresh();
        }}
      />
    </div>
  );
}
