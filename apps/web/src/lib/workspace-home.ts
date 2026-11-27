import { isEditor, type RoleInput } from '@postgear/entitlements';

/**
 * Where a person lands in a workspace (Sprint 13, Module 14): Home for admins
 * and members, Clips for an Editor, whose work is clips and designs. Used by
 * the root route, accepting an invitation, switching workspace and the end
 * of onboarding, so every way in agrees. Pure, so the browser and the server
 * both read it.
 */
export function workspaceHome(orgId: string, role: RoleInput): string {
  return `/${orgId}/${isEditor(role) ? 'clips' : 'home'}`;
}
