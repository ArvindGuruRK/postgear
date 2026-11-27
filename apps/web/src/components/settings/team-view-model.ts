/**
 * The Team page's rules as plain functions, so they are tested without a
 * browser: what a role is called, what a person is called, and what a
 * viewer may do to a row.
 *
 * Presentation only. `RolesGuard` and `OrgService` are where every one of
 * these decisions binds; the page just avoids offering what the API would
 * refuse.
 */

import { canManageTeam, isEditor } from '@postgear/entitlements';
import type { EditorSeats, InviteRole, TeamMember } from '@/types/team';
import type { WorkspaceRole } from '@/types/workspace';

export { canManageTeam };

/** "Member", not "User": the word a person in a workspace uses for themselves. */
const ROLE_LABELS: Record<WorkspaceRole, string> = {
  SUPERADMIN: 'Super admin',
  ADMIN: 'Admin',
  USER: 'Member',
  EDITOR: 'Editor',
};

/** For sentences: "You are now an editor of Acme." */
const ROLE_WITH_ARTICLE: Record<WorkspaceRole, string> = {
  SUPERADMIN: 'a super admin',
  ADMIN: 'an admin',
  USER: 'a member',
  EDITOR: 'an editor',
};

/** The invite dialog's role tiles and the Team page's role picker, in this order. */
export const INVITE_ROLES: readonly { value: InviteRole; label: string }[] = [
  { value: 'USER', label: ROLE_LABELS.USER },
  { value: 'ADMIN', label: ROLE_LABELS.ADMIN },
  { value: 'EDITOR', label: ROLE_LABELS.EDITOR },
];

export function roleLabel(role: WorkspaceRole): string {
  return ROLE_LABELS[role] ?? role;
}

/** "a member" / "an admin" / "an editor", for sentences. */
export function roleWithArticle(role: WorkspaceRole): string {
  return ROLE_WITH_ARTICLE[role] ?? `a ${roleLabel(role).toLowerCase()}`;
}

// --- Editor seats (Sprint 13, Module 14) -------------------------------------

/** Under the Editor tile: what an Editor may and may not do. */
export const EDITOR_ROLE_LINE =
  'Editors can make clips and designs and save post drafts. They cannot connect channels, schedule or publish, see billing or analytics, or invite people.';

/** The API's 402 `members_editor_seats_full`, word for word. */
export const EDITOR_SEATS_FULL_CODE = 'members_editor_seats_full';
export const EDITOR_SEATS_FULL = 'No editor seats left. Remove an editor or change your plan.';

/** The address field while Editor is picked: the link is bound to the address. */
export const EDITOR_EMAIL_HELP = 'Required for an editor: only this address can use the link.';
export const EDITOR_EMAIL_REQUIRED = 'Enter the email address of the editor you are inviting.';

/** "2 of 3 editor seats used"; "1 of 1 editor seat used" when the plan has one. */
export function editorSeatLine(seats: Pick<EditorSeats, 'used' | 'limit'>): string {
  return `${seats.used} of ${seats.limit} editor ${seats.limit === 1 ? 'seat' : 'seats'} used`;
}

/**
 * The Team page's banner after a downgrade left more Editors than the plan
 * allows, or null when the count fits. Nobody is disabled: new Editors are
 * refused until enough are removed.
 */
export function editorsOverCap(seats: Pick<EditorSeats, 'used' | 'limit'>): string | null {
  if (seats.used <= seats.limit) {
    return null;
  }
  const editors = seats.used === 1 ? '1 editor' : `${seats.used} editors`;
  return `You have ${editors} and your plan allows ${seats.limit}. Remove ${seats.used - seats.limit} to add more.`;
}

/** Whether an Editor invite (or a change to Editor) would be refused for want of a seat. */
export function editorSeatsFull(role: InviteRole, seats: EditorSeats | null): boolean {
  return isEditor(role) && seats !== null && seats.remaining <= 0;
}

/**
 * The accept page's line about the role: an Editor is told the workspace and
 * the role together ("You have been invited to join Acme as an editor.");
 * the others keep the shorter line they had.
 */
export function invitedAsSentence(workspaceName: string, role: WorkspaceRole): string {
  return isEditor(role)
    ? `You have been invited to join ${workspaceName} as an editor.`
    : `You've been invited as ${roleWithArticle(role)}.`;
}

/**
 * An invite or role change refused by the API, as one sentence: the seat
 * refusal in the page's own words, anything else as the API wrote it.
 */
export function refusalMessage(cause: { code?: string; message: string }): string {
  return cause.code === EDITOR_SEATS_FULL_CODE ? EDITOR_SEATS_FULL : cause.message;
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

/**
 * Whether the viewer gets a role picker on this row. Admins (and the
 * platform's superadmins) manage the team (`canManageTeam`); members and
 * Editors read it. Not on a superadmin's row: that role is a platform flag,
 * and the picker only offers the roles a workspace grants.
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
 * send needs one, and so does an Editor invite (the API binds the link to
 * it); any other copied link may go without. A hint only; the API validates
 * the address again and says no more than "Invalid input".
 */
export function inviteEmailProblem(
  email: string,
  sendEmail: boolean,
  role: InviteRole = 'USER',
): string | null {
  const trimmed = email.trim();

  if (trimmed.length === 0) {
    if (sendEmail) {
      return 'Enter the email address to send the invitation to.';
    }
    return isEditor(role) ? EDITOR_EMAIL_REQUIRED : null;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) ? null : 'Enter a valid email address.';
}
