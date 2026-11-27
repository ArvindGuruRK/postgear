import { cache } from 'react';
import type { Organization, WorkspaceRole } from '@/types/workspace';
import { serverApi } from './api';
import { getSessionCookieHeader } from './session';

/**
 * The signed-in user's workspaces and their role in each, for server
 * components (Sprint 13, Module 14).
 *
 * `cache` makes it one `GET /orgs` a request: `[orgId]/layout.tsx`, the
 * denied-page gates under it (`RoleGate`) and the pages that read the role
 * all render in parallel in Next 16 and all ask, and only the first goes to
 * the API. A failure is cached too and thrown to every caller, so the
 * workspace layout keeps its error page; `getWorkspaceRole` turns it into
 * "no role", which every capability answers no to.
 */
export const getOrganizations = cache(async (): Promise<Organization[]> => {
  const cookie = await getSessionCookieHeader();
  const { organizations } = await serverApi<{ organizations: Organization[] }>('/orgs', {
    cookie,
  });
  return organizations;
});

/** The viewer's role in one workspace, or null when they are not in it or the API did not answer. */
export async function getWorkspaceRole(orgId: string): Promise<WorkspaceRole | null> {
  try {
    const organizations = await getOrganizations();
    return organizations.find((organization) => organization.id === orgId)?.role ?? null;
  } catch {
    return null;
  }
}
