'use client';

import { UserMenu } from '@postgear/ui';
import { LogOut, Settings, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useWorkspace } from './workspace-provider';

/**
 * The avatar menu in the top bar.
 *
 * Signing out is a **server** call, not a client-side state reset: the session
 * cookie is httpOnly, so JavaScript cannot clear it. `POST /auth/logout` is the
 * only thing that can, and skipping it would leave the user apparently signed
 * out while the cookie kept working on the next reload.
 *
 * `router.refresh()` after it invalidates the server-rendered layouts, so
 * route gate 1 re-runs against the now-absent session instead of the router
 * replaying a cached authenticated tree.
 */
export function AccountMenu() {
  const router = useRouter();
  const { user, activeOrgId } = useWorkspace();

  async function signOut() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      // Navigate even if the request failed. A logout that appears to do
      // nothing is worse than one that clears the client and lets the next
      // request discover the session is still live.
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <UserMenu
      name={user.name ?? user.email}
      email={user.email}
      items={[
        {
          label: 'Profile',
          icon: User,
          onSelect: () => router.push(`/${activeOrgId}/settings/team`),
        },
        {
          label: 'Settings',
          icon: Settings,
          onSelect: () => router.push(`/${activeOrgId}/settings/team`),
        },
        { label: 'Log out', icon: LogOut, danger: true, onSelect: signOut },
      ]}
    />
  );
}
