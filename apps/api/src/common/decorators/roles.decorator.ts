import { SetMetadata } from '@nestjs/common';
import type { Role } from '@postgear/db';

export const ROLES_KEY = 'auth:roles';

/**
 * Restricts a route to the listed roles within the caller's **active
 * organization**.
 *
 * Applying this decorator also makes membership mandatory: a route with
 * `@Roles(...)` cannot be reached by an authenticated user who has no active
 * workspace, even if the role list would otherwise be permissive. A route
 * with no `@Roles()` requires authentication but not membership — which is
 * what `/auth/me`, `/orgs` and the whole onboarding flow need, since an
 * un-onboarded user belongs to no organization at all.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
