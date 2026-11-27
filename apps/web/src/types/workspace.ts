/**
 * Workspace shapes shared between server components and client islands.
 *
 * Declared here rather than imported from `@postgear/db` on purpose: that
 * package pulls in `@prisma/client`, which must never reach a browser bundle.
 * These mirror what `GET /orgs` actually returns.
 */

/**
 * A workspace role. `EDITOR` (Sprint 13, Module 14) makes clips and designs
 * and saves post drafts; what each role may do is decided by the capability
 * functions in `@postgear/entitlements`, never by comparing these names.
 */
export type WorkspaceRole = 'SUPERADMIN' | 'ADMIN' | 'USER' | 'EDITOR';

export interface Organization {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
}
