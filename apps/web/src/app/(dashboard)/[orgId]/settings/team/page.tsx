/**
 * Settings > Team (2026-10-19).
 *
 * A server component that loads the members once and hands them to the
 * island, with the signed-in user's id so the island can mark their row.
 * The list route checks membership of the URL's workspace, not the active
 * cookie, so it answers correctly on first paint even while the dashboard is
 * still syncing that cookie. A failed request hands the island `null`, which
 * it shows as a retry rather than as an empty team.
 */
import type { Metadata } from 'next';
import { TeamMembers } from '@/components/settings/team-members';
import { serverApi } from '@/lib/api';
import { getSession, getSessionCookieHeader } from '@/lib/session';
import type { TeamMember } from '@/types/team';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage({ params }: PageProps<'/[orgId]/settings/team'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();

  const [members, session] = await Promise.all([
    serverApi<{ members: TeamMember[] }>(`/orgs/${encodeURIComponent(orgId)}/members`, { cookie })
      .then((response) => response.members)
      .catch(() => null),
    getSession(),
  ]);

  return <TeamMembers orgId={orgId} initialMembers={members} currentUserId={session?.id ?? null} />;
}
