'use client';

import { createContext, type ReactNode, useContext } from 'react';
import type { Organization, WorkspaceRole } from '@/types/workspace';

/**
 * The active workspace, its role, and every workspace the user can switch to.
 *
 * Populated server-side by `[orgId]/layout.tsx` and passed down, rather than
 * fetched by the client on mount. That means the org switcher has real data on
 * first paint with no loading state, and one fewer request per navigation.
 *
 * The role here is for **presentation only** — hiding an admin-only menu item
 * a `USER` cannot use. It is not access control. Every privileged action is
 * re-checked by `RolesGuard` on the API, which is the only place a role
 * decision actually binds.
 */
export interface WorkspaceUser {
  name: string | null;
  email: string;
}

interface WorkspaceContextValue {
  organizations: Organization[];
  activeOrgId: string;
  role: WorkspaceRole;
  user: WorkspaceUser;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  organizations,
  activeOrgId,
  role,
  user,
  children,
}: WorkspaceContextValue & { children: ReactNode }) {
  return (
    <WorkspaceContext.Provider value={{ organizations, activeOrgId, role, user }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/**
 * Throws outside a provider rather than returning null. A component that needs
 * the active workspace and silently renders without one is a bug that shows up
 * as mysteriously empty UI; this makes it a loud error at the point of misuse.
 */
export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);

  if (!value) {
    throw new Error('useWorkspace must be used inside a WorkspaceProvider ([orgId]/layout.tsx)');
  }

  return value;
}
