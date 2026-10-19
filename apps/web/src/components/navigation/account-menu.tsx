'use client';

import { Building2Icon } from '@animateicons/react/lucide/building-2-icon';
import { LogOutIcon } from '@animateicons/react/lucide/log-out-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { SettingsIcon } from '@animateicons/react/lucide/settings-icon';
import { UserIcon } from '@animateicons/react/lucide/user-icon';
import { UserMenu } from '@postgear/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { avatarSrc } from '@/lib/avatars';
import { useWorkspace } from './workspace-provider';

/**
 * The avatar menu in the top bar: the person, the workspaces they can switch
 * between, and their own settings.
 *
 * ## Workspaces (UI revamp, 2026-10-18)
 *
 * Switching moved here from its own top-bar control, so the bar holds only
 * the page's name and a few icons. It is still a **server** operation, not
 * just a client route change: `POST /orgs/:id/switch` verifies the
 * membership and sets the `pg_org` cookie, which is what every subsequent
 * API call is scoped by. Navigating without it would change the URL while
 * leaving the API answering for the old workspace: the kind of mismatch that
 * shows one tenant another tenant's data. The check mark moves at once and
 * moves back if the server refuses.
 *
 * Creating a workspace reuses the onboarding step-1 screen rather than a
 * second, near-identical modal. It is the same operation.
 *
 * ## Signing out
 *
 * A **server** call, not a client-side state reset: the session cookie is
 * httpOnly, so JavaScript cannot clear it. `POST /auth/logout` is the only
 * thing that can, and skipping it would leave the user apparently signed out
 * while the cookie kept working on the next reload. `router.refresh()` after
 * it invalidates the server-rendered layouts, so route gate 1 re-runs against
 * the now-absent session instead of the router replaying a cached tree.
 */
export function AccountMenu() {
  const router = useRouter();
  const { user, organizations, activeOrgId } = useWorkspace();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const shownActive = pendingId ?? activeOrgId;

  async function switchTo(nextId: string) {
    if (nextId === activeOrgId) {
      return;
    }

    setPendingId(nextId);

    try {
      await api(`/orgs/${nextId}/switch`, { method: 'POST' });
      // `refresh()` first so the server components re-read the new cookie
      // rather than replaying the previous workspace's cached render.
      router.refresh();
      router.push(`/${nextId}/home`);
    } catch {
      // The API refused: most likely the membership was revoked in another
      // tab. Drop the optimistic selection and let the provider's value stand.
      setPendingId(null);
    }
  }

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
      // Preset → bundled SVG, image → its URL, none → `UserMenu` draws
      // initials. Same resolution as `UserAvatar` (components/profile).
      avatarUrl={avatarSrc(user.avatar)}
      groups={[
        {
          label: 'Organizations',
          items: [
            ...organizations.map((organization) => ({
              label: organization.name,
              animatedIcon: Building2Icon,
              checked: organization.id === shownActive,
              onSelect: () => void switchTo(organization.id),
            })),
            {
              label: 'Create organization',
              animatedIcon: PlusIcon,
              onSelect: () => router.push('/onboarding'),
            },
          ],
        },
      ]}
      items={[
        {
          label: 'Profile',
          animatedIcon: UserIcon,
          onSelect: () => router.push(`/${activeOrgId}/settings/team`),
        },
        {
          label: 'Settings',
          animatedIcon: SettingsIcon,
          onSelect: () => router.push(`/${activeOrgId}/settings/team`),
        },
        { label: 'Log out', animatedIcon: LogOutIcon, danger: true, onSelect: signOut },
      ]}
    />
  );
}
