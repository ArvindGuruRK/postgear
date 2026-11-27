/**
 * The compile-time check that Prisma's `Role` and the pure capability table's
 * role names are the same list (Sprint 13, Module 14).
 *
 * `@postgear/entitlements` writes the names out (it is pure and the browser
 * reads it); this file is where the two meet. Adding a value to the enum and
 * not to `WORKSPACE_ROLE_NAMES`, or the other way round, fails `tsc` here.
 */
import type { Role } from '@postgear/db';
import type { WorkspaceRoleName } from '@postgear/entitlements';

/** True only when A and B are the same set of names. */
type SameNames<A extends string, B extends string> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

/** Each role, once: a missing or extra Prisma value is a compile error. */
export const ROLE_PARITY = {
  SUPERADMIN: true,
  ADMIN: true,
  USER: true,
  EDITOR: true,
} as const satisfies Record<Role, true> & Record<WorkspaceRoleName, true>;

/** Fails to compile when the two lists differ. */
export const ROLES_AGREE: SameNames<Role, WorkspaceRoleName> = true;
