/**
 * Connections (Sprint 10, Module 04): the outside apps this workspace's
 * workflows use. Reached from the Workflows page's Connections button.
 *
 * Loads the list and the viewer's role in parallel; a failed list renders a
 * retry rather than an empty page.
 */
import type { Metadata } from 'next';
import { ConnectionsView } from '@/components/workflows/connections/connections-view';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { Connection } from '@/types/workflows';

export const metadata: Metadata = { title: 'Connections' };

export default async function ConnectionsPage({
  params,
  searchParams,
}: PageProps<'/[orgId]/workflows/connections'>) {
  const { orgId } = await params;
  const { connectError } = await searchParams;
  const cookie = await getSessionCookieHeader();

  const [connections, me] = await Promise.all([
    serverApi<{ connections: Connection[] }>('/automation-connections', { cookie })
      .then((result) => result.connections)
      .catch(() => null),
    serverApi<{ organizations: { id: string; role: string }[] }>('/orgs', { cookie })
      .then(
        (result) => result.organizations.find((organization) => organization.id === orgId) ?? null,
      )
      .catch(() => null),
  ]);

  return (
    <ConnectionsView
      orgId={orgId}
      initialConnections={connections}
      canManage={me ? me.role !== 'USER' : false}
      connectErrorCode={typeof connectError === 'string' ? connectError : null}
    />
  );
}
