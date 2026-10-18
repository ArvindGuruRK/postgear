/**
 * Appearance settings: the colour mode, the light theme and the dark theme.
 *
 * A server component that loads the current choice, the theme catalog and the
 * premium entitlement in one request, so the grids are right on first paint;
 * when that fails the island loads for itself and shows the failure with a
 * retry, rather than this page throwing. The choice is the user's, not the
 * workspace's: `orgId` is only for the upgrade link.
 */
import type { Metadata } from 'next';
import { AppearanceSettings } from '@/components/appearance/appearance-settings';
import { serverApi } from '@/lib/api';
import type { AppearanceResponse } from '@/lib/appearance';
import { getSessionCookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Appearance' };

export default async function AppearanceSettingsPage({
  params,
}: PageProps<'/[orgId]/settings/appearance'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();

  const initial = await serverApi<AppearanceResponse>('/users/me/appearance', { cookie }).catch(
    () => null,
  );

  return <AppearanceSettings orgId={orgId} initial={initial} />;
}
