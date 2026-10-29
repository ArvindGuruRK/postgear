/**
 * Settings' Connections entry (Sprint 10): the page itself lives under
 * Workflows (`/[orgId]/workflows/connections`), where its workflows are, so
 * this only sends the person there.
 */
import { redirect } from 'next/navigation';

export default async function SettingsConnectionsPage({
  params,
}: PageProps<'/[orgId]/settings/connections'>) {
  const { orgId } = await params;
  redirect(`/${orgId}/workflows/connections`);
}
