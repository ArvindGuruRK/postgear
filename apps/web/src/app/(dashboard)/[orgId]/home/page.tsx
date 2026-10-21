/**
 * Home: the landing page after sign-in (UI revamp, 2026-10-19), after
 * Buffer's home with a Postiz-style streak. A greeting, the week's numbers,
 * what needs attention, the first steps, what goes out next, and a way to
 * start writing.
 *
 * A server component that loads, in one round of parallel requests, what
 * does not depend on the viewer's clock: the channels (the banners, the
 * connect dialog's providers and the plan's limit), the AI credit balance,
 * the next queued posts, the dashboard counted in UTC, whose first steps
 * and failed count no time zone changes, and the team with the plan's seats
 * (2026-10-22). The streak and the weekly goal are
 * counted in the viewer's own weeks, so the client asks for those itself
 * (`use-home-data.ts`).
 *
 * Each request has its own fallback, so one failure costs one section: no
 * channel list means nothing is said about channels (rather than "connect
 * one"), no balance leaves the credits cell saying so, and no queue or
 * dashboard leaves the client to try again.
 *
 * Nothing workspace-scoped is fetched while the active-workspace cookie names
 * another workspace, or none: right after signing in to an account with two
 * workspaces, say. The API scopes on that cookie, and without it `/channels`
 * answers an empty list, which read as "connect a channel" for a moment.
 * `SyncActiveWorkspace` (in the layout) switches the cookie and refreshes, and
 * this renders again with the right workspace; until then the cells wait.
 */
import type { Metadata } from 'next';
import { HomeView } from '@/components/home/home-view';
import { serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { AiCredits } from '@/types/ai';
import type { SubscriptionResponse } from '@/types/billing';
import type { ChannelsResponse, ProviderSummary } from '@/types/channel';
import type { DashboardSummary } from '@/types/dashboard';
import type { QueuePage } from '@/types/post';
import type { TeamMember } from '@/types/team';

export const metadata: Metadata = { title: 'Home' };

export default async function HomePage({ params }: PageProps<'/[orgId]/home'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();
  const pending = (await getActiveOrgId()) !== orgId;

  const upNext = new URLSearchParams({
    state: 'QUEUE',
    from: new Date().toISOString(),
    sort: 'asc',
    page: '1',
  });

  /** A workspace-scoped read, skipped while the cookie is still being switched. */
  function scoped<T>(load: () => Promise<T>): Promise<T | null> {
    return pending ? Promise.resolve(null) : load().catch(() => null);
  }

  const [channels, { providers }, credits, queue, summary, members, subscription] =
    await Promise.all([
      scoped(() => serverApi<ChannelsResponse>('/channels', { cookie })),
      serverApi<{ providers: ProviderSummary[] }>('/channels/providers', { cookie }).catch(() => ({
        providers: [] as ProviderSummary[],
      })),
      scoped(() =>
        serverApi<{ credits: AiCredits }>('/ai/credits', { cookie }).then(
          (result) => result.credits,
        ),
      ),
      scoped(() => serverApi<QueuePage>(`/posts/queue?${upNext.toString()}`, { cookie })),
      scoped(() => serverApi<DashboardSummary>('/dashboard', { cookie })),
      // Read by the URL's workspace, so it needs no wait for the cookie.
      serverApi<{ members: TeamMember[] }>(`/orgs/${encodeURIComponent(orgId)}/members`, { cookie })
        .then((result) => result.members)
        .catch(() => null),
      scoped(() => serverApi<SubscriptionResponse>('/billing/subscription', { cookie })),
    ]);

  return (
    <HomeView
      orgId={orgId}
      pending={pending}
      channels={channels?.channels ?? null}
      limit={channels?.limit ?? null}
      providers={providers}
      credits={credits}
      initialQueue={queue}
      initialSummary={summary}
      members={members}
      memberLimit={subscription ? subscription.subscription.plan.members : undefined}
    />
  );
}
