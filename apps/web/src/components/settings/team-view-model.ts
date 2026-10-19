/**
 * The Team page's rules as plain functions, so they are tested without a
 * browser: what a role is called, what a person is called, and what a
 * viewer may do to a row.
 *
 * Presentation only. `RolesGuard` and `OrgService` are where every one of
 * these decisions binds; the page just avoids offering what the API would
 * refuse.
 */

import type { InviteRole, TeamMember } from '@/types/team';
import type { WorkspaceRole } from '@/types/workspace';

/** "Member", not "User": the word a person in a workspace uses for themselves. */
const ROLE_LABELS: Record<WorkspaceRole, string> = {
  SUPERADMIN: 'Super admin',
  ADMIN: 'Admin',
  USER: 'Member',
};

export const INVITE_ROLES: readonly { value: InviteRole; label: string }[] = [
  { value: 'USER', label: ROLE_LABELS.USER },
  { value: 'ADMIN', label: ROLE_LABELS.ADMIN },
];

export function roleLabel(role: WorkspaceRole): string {
  return ROLE_LABELS[role] ?? role;
}

/** "a member" / "an admin", for sentences. */
export function roleWithArticle(role: WorkspaceRole): string {
  return role === 'USER' ? 'a member' : `an ${roleLabel(role).toLowerCase()}`;
}

/**
 * What the row calls someone: their name, or the part of their address
 * before the @ when they never gave one (the address is on the line below).
 */
export function displayName(member: Pick<TeamMember, 'name' | 'email'>): string {
  return member.name?.trim() || member.email.split('@')[0] || member.email;
}

/**
 * What the avatar is drawn from: the name, else the full address. The same
 * value the account menu passes to `UserMenu`, so a person's initials and
 * colour match between their own menu and everyone else's Team page.
 */
export function avatarSeed(member: Pick<TeamMember, 'name' | 'email'>): string {
  return member.name ?? member.email;
}

/** Admins (and the platform's superadmins) manage the team; members read it. */
export function canManageTeam(viewerRole: WorkspaceRole): boolean {
  return viewerRole !== 'USER';
}

/**
 * Whether the viewer gets a role picker on this row. Not on a superadmin's
 * row: that role is a platform flag, and the picker only offers the two a
 * workspace grants.
 */
export function canChangeRole(
  viewerRole: WorkspaceRole,
  member: Pick<TeamMember, 'role'>,
): boolean {
  return canManageTeam(viewerRole) && member.role !== 'SUPERADMIN';
}

/** Never on your own row: there you leave, you are not removed. */
export function canRemove(
  viewerRole: WorkspaceRole,
  member: Pick<TeamMember, 'role'>,
  isSelf: boolean,
): boolean {
  return canManageTeam(viewerRole) && !isSelf && member.role !== 'SUPERADMIN';
}

/**
 * What is wrong with the invite form's address, or null when nothing is: a
 * send needs one, a copied link may go without. A hint only; the API
 * validates the address again and says no more than "Invalid input".
 */
export function inviteEmailProblem(email: string, sendEmail: boolean): string | null {
  const trimmed = email.trim();

  if (trimmed.length === 0) {
    return sendEmail ? 'Enter the email address to send the invitation to.' : null;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) ? null : 'Enter a valid email address.';
}
