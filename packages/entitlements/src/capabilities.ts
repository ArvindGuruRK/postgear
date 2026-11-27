/**
 * What each workspace role may do (Sprint 13, Module 14).
 *
 * One pure table read by the API (the type check against Prisma's `Role`) and
 * the web app (the rail, the denied pages, the composer). Each decision is
 * its own function of the role, so a screen asks `canSchedule(role)` instead
 * of comparing role names, and a new role is a change to this file only.
 *
 * ## Fails closed
 *
 * A missing role (no active workspace, a session still loading) answers no to
 * everything. An unknown string does too. `SUPERADMIN` behaves as `ADMIN`
 * inside a workspace, as the API's `RolesGuard` already does.
 *
 * ## The API is the wall
 *
 * These functions decide what a screen shows. The API's `@Roles(...)` lists
 * and `assertEditorMayWrite` decide what a request may do, and the route
 * matrix (`apps/api/src/common/guards/editor-access.json`) proves the two say
 * the same thing. Hiding a button here never grants or removes a right.
 *
 * The role names are written out rather than imported from `@postgear/db`,
 * because this package is pure and the browser reads it. The API checks the
 * two lists are equal at compile time (`common/guards/role-parity.ts`).
 */

/** Every workspace role, as stored on `UserOrganization.role` (plus the superadmin stand-in). */
export const WORKSPACE_ROLE_NAMES = ['SUPERADMIN', 'ADMIN', 'USER', 'EDITOR'] as const;

/** A workspace role. */
export type WorkspaceRoleName = (typeof WORKSPACE_ROLE_NAMES)[number];

/** A role as a caller may hold it: absent while loading or outside a workspace. */
export type RoleInput = WorkspaceRoleName | string | null | undefined;

/** The roles an invite may grant. A superadmin is never invited. */
export const INVITABLE_ROLE_NAMES = ['ADMIN', 'USER', 'EDITOR'] as const;

/** A role an invite may grant. */
export type InvitableRoleName = (typeof INVITABLE_ROLE_NAMES)[number];

/** Whether a value names a workspace role. */
export function isWorkspaceRole(value: unknown): value is WorkspaceRoleName {
  return typeof value === 'string' && (WORKSPACE_ROLE_NAMES as readonly string[]).includes(value);
}

function isAdmin(role: RoleInput): boolean {
  return role === 'ADMIN' || role === 'SUPERADMIN';
}

/** An admin or a member: the two roles that had every non-admin right before Editors existed. */
function isAdminOrMember(role: RoleInput): boolean {
  return isAdmin(role) || role === 'USER';
}

/** Any role inside a workspace, Editors included. */
function isAnyMember(role: RoleInput): boolean {
  return isAdminOrMember(role) || role === 'EDITOR';
}

/** Whether the role is the Editor seat. */
export function isEditor(role: RoleInput): boolean {
  return role === 'EDITOR';
}

// --- Every member, Editors included ------------------------------------------

/** Clips: import, find, edit and export clips. */
export const canWorkOnClips = isAnyMember;
/** Design Studio and the Creator Tools built on it. */
export const canUseStudio = isAnyMember;
/** The media library. */
export const canUseMedia = isAnyMember;
/** The AI Copilot. Editors spend the workspace's one pool of AI credits. */
export const canUseCopilot = isAnyMember;
/** The calendar and queue, read only for an Editor (see `canSchedule`). */
export const canReadCalendar = isAnyMember;
/** Create, edit and delete posts that are drafts. */
export const canSaveDrafts = isAnyMember;
/** Tags on posts. */
export const canUseTags = isAnyMember;

// --- Admins and members ------------------------------------------------------

/** Put a post on the calendar or the queue, move it, or change a scheduled post. */
export const canSchedule = isAdminOrMember;
/** Post now, or anything else that sends a post to a platform. */
export const canPublish = isAdminOrMember;
/** Analytics and the Home page's numbers. */
export const canViewAnalytics = isAdminOrMember;
/** The SEO tools. */
export const canUseSeo = isAdminOrMember;
/** Discover. */
export const canUseDiscover = isAdminOrMember;
/** See the workspace's plan and usage (the billing page's reads). */
export const canViewBilling = isAdminOrMember;
/** See the channels page and the workflows list. Connecting and building stay with admins. */
export const canViewChannels = isAdminOrMember;
/** Open the Workflows module (the list, the runs). Building and turning on is `canManageWorkflows`. */
export const canUseWorkflows = isAdminOrMember;
/**
 * Start connecting a channel. Members may (connecting is part of a solo
 * user's onboarding, as the channels controller says); renaming, removing and
 * reordering stay with admins (`canManageChannels`).
 */
export const canConnectChannels = isAdminOrMember;

/** See the API keys and webhooks pages (read only for members; managing is admin). */
export const canViewDeveloperSettings = isAdminOrMember;

// --- Admins only -------------------------------------------------------------

/**
 * Workspace-wide settings that are not a module of their own: saved
 * signatures' writes, Discover's workspace place and competitors, the Home
 * weekly goal. Each is `@Roles(ADMIN)` in the API.
 */
export const canManageWorkspaceSettings = isAdmin;

/** Rename, disconnect, reorder or change the posting times of channels. */
export const canManageChannels = isAdmin;
/** Invite, remove or change the role of a member. */
export const canManageTeam = isAdmin;
/** Change the plan, the card or the subscription. */
export const canManageBilling = isAdmin;
/** Create or revoke API keys. */
export const canManageApiKeys = isAdmin;
/** Create, edit or delete outgoing webhooks. */
export const canManageWebhooks = isAdmin;
/** Create, edit, turn on or delete a workflow. */
export const canManageWorkflows = isAdmin;

/** The one sentence shown wherever an Editor meets something they may not do. */
export const EDITOR_FORBIDDEN_SENTENCE = 'Editors cannot do this. Ask an admin.';

/** The sentence on a page a role may not open. */
export const PAGE_DENIED_SENTENCE = 'You do not have access to this page.';
