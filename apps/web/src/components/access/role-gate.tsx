import type { RoleInput } from '@postgear/entitlements';
import type { ReactNode } from 'react';
import { getWorkspaceRole } from '@/lib/workspace-role';
import { AccessDenied } from './access-denied';

/**
 * The server-side gate of a section a role may not open (Sprint 13, Module
 * 14). A section's `layout.tsx` wraps its pages in it with the capability that
 * decides, for example `canViewAnalytics`; a role it answers no to (an
 * Editor, or no role at all, since every capability fails closed) gets
 * `AccessDenied` in place of the page.
 *
 * The role comes from `getWorkspaceRole`, cached per request, so the gate
 * adds no request to the one `[orgId]/layout.tsx` already makes. The page
 * still renders in parallel (Next 16) and its requests are refused by the
 * API; what it drew is simply not shown.
 */
export async function RoleGate({
  orgId,
  allow,
  children,
}: {
  orgId: string;
  allow: (role: RoleInput) => boolean;
  children: ReactNode;
}) {
  const role = await getWorkspaceRole(orgId);

  if (!allow(role)) {
    return <AccessDenied orgId={orgId} workspaceRole={role} />;
  }

  return children;
}
