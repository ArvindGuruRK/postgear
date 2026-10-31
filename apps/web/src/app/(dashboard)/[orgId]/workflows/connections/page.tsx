/**
 * Connections used to be a page of their own (Sprint 10, Module 04). Since
 * 2026-10-31 they are a modal over the Workflows list, so this address only
 * forwards: an old link, or an OAuth sign-in that was started from the page
 * and returns here, lands on the list with the modal open and the result
 * (`?connection=`, `?connectError=`) carried along.
 */
import { redirect } from 'next/navigation';

export default async function ConnectionsPage({
  params,
  searchParams,
}: PageProps<'/[orgId]/workflows/connections'>) {
  const { orgId } = await params;
  const { connectError, connection } = await searchParams;

  const query = new URLSearchParams({ connections: '1' });
  if (typeof connectError === 'string' && connectError) query.set('connectError', connectError);
  if (typeof connection === 'string' && connection) query.set('connection', connection);
  redirect(`/${orgId}/workflows?${query.toString()}`);
}
