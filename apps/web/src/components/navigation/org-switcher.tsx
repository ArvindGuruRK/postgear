'use client';

import { WorkspaceSwitcher } from '@postgear/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useWorkspace } from './workspace-provider';

/**
 * The workspace switcher in the top bar.
 *
 * Reads real memberships from `WorkspaceProvider`, which `[orgId]/layout.tsx`
 * populated server-side — so the list is correct on first paint with no
 * loading state and no extra request.
 *
 * Switching is a **server** operation, not just a client route change:
 * `POST /orgs/:id/switch` verifies the membership and sets the `pg_org`
 * cookie, which is what every subsequent API call is scoped by. Navigating
 * without it would change the URL while leaving the API still answering for
 * the old workspace — the kind of mismatch that shows one tenant another
 * tenant's data.
 *
 * The optimistic local update is display-only, and is rolled back if the
 * server refuses.
 */
export function OrgSwitcher() {
  const router = useRouter();
  const { organizations, activeOrgId } = useWorkspace();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function onActiveChange(nextId: string) {
    if (nextId === activeOrgId) {
      return;
    }

    setPendingId(nextId);

    try {
      await api(`/orgs/${nextId}/switch`, { method: 'POST' });

      // Land on the same section of the new workspace. `refresh()` first so
      // the server components re-read the new cookie rather than replaying the
      // previous workspace's cached render.
      router.refresh();
      router.push(`/${nextId}/calendar`);
    } catch {
      // The API refused — most likely the membership was revoked in another
      // tab. Drop the optimistic selection and let the provider's value stand.
      setPendingId(null);
    }
  }

  return (
    <WorkspaceSwitcher
      workspaces={organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
      }))}
      activeId={pendingId ?? activeOrgId}
      onActiveChange={onActiveChange}
      label="Organizations"
      createLabel="Create organization"
      // Creating a workspace reuses the onboarding step-1 screen rather than a
      // second, near-identical modal. It is the same operation.
      onCreate={() => router.push('/onboarding')}
    />
  );
}
