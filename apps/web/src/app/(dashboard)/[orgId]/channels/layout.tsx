import { canViewChannels } from '@postgear/entitlements';
import type { ReactNode } from 'react';
import { RoleGate } from '@/components/access/role-gate';

/**
 * The Channels page: closed to a role `canViewChannels` answers no to, an Editor among them
 * (Sprint 13, Module 14). A typed address shows the plain denied page rather
 * than a page whose requests the API refuses.
 */
export default async function ChannelsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  return (
    <RoleGate orgId={orgId} allow={canViewChannels}>
      {children}
    </RoleGate>
  );
}
