'use client';

import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from 'react';
import type { SessionAvatar } from '@/lib/session';
import type { Organization, WorkspaceRole } from '@/types/workspace';

/**
 * Whether the API will answer the browser's workspace-scoped requests for a
 * given workspace yet.
 *
 * The API scopes on the `pg_org` cookie, and when the layout finds that
 * cookie naming another workspace (or none: a user with two workspaces signs
 * in with no default) it mounts `SyncActiveWorkspace`, whose switch request
 * is what sets it. A client component that fetches on mount would otherwise
 * race that request: answered 403 with no cookie, or with the previous
 * workspace's data with a stale one. So the switch is recorded here, before
 * any passive effect of the same commit runs, and such a component waits
 * for `ready`.
 *
 * `ready` is the default: without a sync in flight the layout has already
 * seen the cookie agree with the URL.
 */
export type WorkspaceScopeStatus = 'ready' | 'switching' | 'failed';

export interface WorkspaceScope {
  status: (orgId: string) => WorkspaceScopeStatus;
  subscribe: (listener: () => void) => () => void;
  /** A switch to `orgId` is in flight. */
  begin: (orgId: string) => void;
  /** The switch landed (`true`) or was refused. */
  settle: (orgId: string, ok: boolean) => void;
}

export function createWorkspaceScope(): WorkspaceScope {
  const pending = new Map<string, 'switching' | 'failed'>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    status: (orgId) => pending.get(orgId) ?? 'ready',
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin: (orgId) => {
      pending.set(orgId, 'switching');
      emit();
    },
    settle: (orgId, ok) => {
      if (ok) {
        pending.delete(orgId);
      } else {
        pending.set(orgId, 'failed');
      }
      emit();
    },
  };
}

/**
 * The active workspace, its role, and every workspace the user can switch to.
 *
 * Populated server-side by `[orgId]/layout.tsx` and passed down, rather than
 * fetched by the client on mount. That means the org switcher has real data on
 * first paint with no loading state, and one fewer request per navigation.
 *
 * The role here is for **presentation only**: hiding an admin-only menu item
 * a `USER` cannot use. It is not access control. Every privileged action is
 * re-checked by `RolesGuard` on the API, which is the only place a role
 * decision actually binds.
 */
export interface WorkspaceUser {
  name: string | null;
  email: string;
  /** UI revamp (2026-10-17): drawn by the account menu; null = initials. */
  avatar: SessionAvatar;
}

interface WorkspaceProviderProps {
  organizations: Organization[];
  activeOrgId: string;
  role: WorkspaceRole;
  user: WorkspaceUser;
}

interface WorkspaceContextValue extends WorkspaceProviderProps {
  scope: WorkspaceScope;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  organizations,
  activeOrgId,
  role,
  user,
  children,
}: WorkspaceProviderProps & { children: ReactNode }) {
  const [scope] = useState(createWorkspaceScope);

  return (
    <WorkspaceContext.Provider value={{ organizations, activeOrgId, role, user, scope }}>
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

/** The same, or null outside a provider: for a component the playground shows too. */
export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}

/**
 * The active workspace's scope status, re-rendering when it changes. An
 * effect gated on it must also re-check `scope.status()` when it runs: the
 * switch is recorded in a layout effect of the same commit, after this
 * component rendered `ready`.
 */
export function useWorkspaceScope(): {
  orgId: string;
  scope: WorkspaceScope;
  status: WorkspaceScopeStatus;
} {
  const { activeOrgId, scope } = useWorkspace();
  const read = () => scope.status(activeOrgId);
  const status = useSyncExternalStore(scope.subscribe, read, read);
  return { orgId: activeOrgId, scope, status };
}
