/**
 * Settings, Clips (Sprint 13, Module 17 item 26): for whoever works on clips,
 * Editors included. A typed address from anyone else is refused here, as the
 * settings nav hides the entry.
 */
import { canWorkOnClips } from '@postgear/entitlements';
import type { ReactNode } from 'react';
import { RoleGate } from '@/components/access/role-gate';

export default async function ClipsSettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  return (
    <RoleGate orgId={orgId} allow={canWorkOnClips}>
      {children}
    </RoleGate>
  );
}
