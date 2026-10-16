/**
 * Notification settings (Sprint 8): the two email preferences.
 *
 * A server component that loads the current values so the toggles are right
 * on first paint; when the request fails the island loads for itself and
 * shows the failure with a retry, rather than this page throwing.
 */
import type { Metadata } from 'next';
import { NotificationPreferencesForm } from '@/components/notifications/notification-preferences';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { NotificationPreferences } from '@/types/notifications';

export const metadata: Metadata = { title: 'Notification settings' };

export default async function NotificationSettingsPage() {
  const cookie = await getSessionCookieHeader();

  const preferences = await serverApi<{ preferences: NotificationPreferences }>(
    '/users/me/notification-preferences',
    { cookie },
  )
    .then((result) => result.preferences)
    .catch(() => null);

  return <NotificationPreferencesForm initial={preferences} />;
}
