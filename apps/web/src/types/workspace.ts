/**
 * Workspace shapes shared between server components and client islands.
 *
 * Declared here rather than imported from `@postgear/db` on purpose: that
 * package pulls in `@prisma/client`, which must never reach a browser bundle.
 * These mirror what `GET /orgs` actually returns.
 */

export type WorkspaceRole = 'SUPERADMIN' | 'ADMIN' | 'USER';

export interface Organization {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
}
