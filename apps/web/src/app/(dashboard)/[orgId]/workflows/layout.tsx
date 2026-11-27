import { canUseWorkflows } from '@postgear/entitlements';
import type { ReactNode } from 'react';
import { RoleGate } from '@/components/access/role-gate';

/**
 * Workflows (the list, the connections and the builder, which stays full window): closed to a role `canUseWorkflows` answers no to, an Editor among them
 * (Sprint 13, Module 14). A typed address shows the plain denied page rather
 * than a page whose requests the API refuses.
 */
export default async function WorkflowsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  return (
    <RoleGate orgId={orgId} allow={canUseWorkflows}>
      {children}
    </RoleGate>
  );
}
