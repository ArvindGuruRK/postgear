/**
 * Settings > Team shapes (2026-10-19), mirroring what the API returns:
 * `GET /orgs/:id/members`, `POST /orgs/:id/invites` and the invitation
 * routes in `apps/api/src/modules/org/org.controller.ts`.
 *
 * Declared here rather than imported from `@postgear/db`, for the reason
 * `workspace.ts` gives: that package must never reach a browser bundle.
 */
import type { SessionAvatar } from '@/lib/session';
import type { WorkspaceRole } from './workspace';

/** The two roles a workspace grants; SUPERADMIN is a platform flag, never invited. */
export type InviteRole = 'ADMIN' | 'USER';

export interface TeamMember {
  membershipId: string;
  userId: string;
  email: string;
  /** First and last name joined, or null when the person never gave one. */
  name: string | null;
  role: WorkspaceRole;
  /** A suspended membership: still listed, no access. */
  disabled: boolean;
  joinedAt: string;
  avatar: SessionAvatar;
}

/** `POST /orgs/:id/invites`: the link, whether or not it was also emailed. */
export interface InviteLink {
  url: string;
  expiresAt: string;
}

/** `GET /orgs/invites/:token`: what the accept page shows. */
export interface InvitePreview {
  workspaceName: string;
  role: InviteRole;
  expiresAt: string;
  /** Present when the link is bound to an address; only that address may accept. */
  email?: string;
  /** Present when the request carried a session. */
  alreadyMember?: boolean;
}
