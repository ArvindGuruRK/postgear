# Sprint 2 — Authentication, Organizations & RBAC

> **PRD Coverage**: Section 5.1 (Authentication & User Management), Section 5.11 (Organization & Team Module).
> **Depends on**: [Sprint 1](sprint-01-foundation-and-data-model.md) (schema for `User`, `Organization`, `Member`).
> **Reference repo**: `D:\rk-personal-projects\postiz-app-main` (study only).

## Sprint Goal

Users can register, log in (password + OAuth), belong to one or more organizations, switch between them, and have their role (`SUPERADMIN`/`ADMIN`/`USER`) enforced on every subsequent API route.

## Reference Study Guide

| Concept | Postiz Reference (study, don't copy) | What to Extract |
|---|---|---|
| JWT/session issuance & login/register flow | `libraries/nestjs-libraries/src/../` → `apps/backend/src/services/auth/auth.service.ts`, consumed by `apps/backend/src/api/routes/auth.controller.ts` | Cookie-based JWT pattern (httpOnly), how registration + activation email is triggered, password hashing (bcrypt). |
| Request-level auth middleware | `apps/backend/src/services/auth/auth.middleware.ts`, `public.auth.middleware.ts` | How they distinguish "authenticated app routes" from "public/unauthenticated routes" (two middleware classes) — a clean pattern worth mirroring conceptually. |
| OAuth social login | `apps/backend/src/services/auth/providers/google.provider.ts`, `github.provider.ts`, `providers.manager.ts`, `providers.interface.ts` | The provider-interface + manager-registry pattern (one interface, N implementations, one manager that dispatches by provider name) — this exact pattern repeats in Sprint 3 for social channels, so understanding it once pays off twice. |
| RBAC / permissions | `apps/backend/src/services/auth/permissions/permissions.guard.ts`, `permissions.ability.ts`, `permissions.service.ts` (built on `@casl/ability`), registered as a global `APP_GUARD` in `app.module.ts` | CASL-based ability checks vs. a simpler hand-rolled role check — decide which fits PostGear's 3-role model (a hand-rolled `RolesGuard` is likely sufficient for MVP; CASL pays off later if permissions become attribute-based). |
| Organization switching & impersonation | `apps/backend/src/api/routes/users.controller.ts` (`changeOrg()`, `/impersonate` routes), `libraries/nestjs-libraries/src/database/prisma/organizations/organization.service.ts`, request-scoped resolver `libraries/nestjs-libraries/src/user/org.from.request.ts` (`@GetOrgFromRequest()` decorator) | The "current org" is resolved per-request from a cookie/header via a custom decorator, not stored in the JWT — keeps the JWT stable across org switches. Worth adopting. |
| Multi-tenant data isolation | Every Prisma model in Postiz's schema carries `organizationId` and every query is scoped by it | Confirms the inherited schema's design (see [Sprint 1](sprint-01-foundation-and-data-model.md) — PostGear kept this schema as-is); make sure PostGear's query layer never allows an unscoped read. |

**Note on model names**: PostGear's schema (inherited from Postiz per Sprint 1's decision) already names the org-membership join table `UserOrganization` — use that name directly rather than inventing a `Member` alias.

## PostGear Implementation Plan

Target locations (per `project_structure.md`): `apps/api/src/modules/auth/`, `apps/api/src/modules/org/`, `apps/api/src/modules/users/`, `apps/api/src/common/{guards,middleware,decorators}/`, `apps/web/src/app/(auth)/*`.

### Task 1 — Local auth
- `apps/api/src/modules/auth`: register/login/logout endpoints, bcrypt password hashing, JWT issuance in an httpOnly cookie.
- Email activation token + send via the email provider chosen in [Sprint 8](sprint-08-billing-notifications-api-launch.md) (stub the send for now if that sprint hasn't landed yet).

### Task 2 — OAuth login (Google, GitHub)
- Design a small `AuthProvider` interface (`getAuthUrl()`, `handleCallback()`) — same shape idea as Postiz's `providers.interface.ts`, written fresh for PostGear's types.
- Implement Google + GitHub against that interface.

### Task 3 — Organizations & membership
- `apps/api/src/modules/org`: create org, list orgs for current user, switch active org (cookie/header-based, not JWT-based — see reference note above), invite member by email with a role, persisted via the schema's `UserOrganization` model.
- `@CurrentOrg()` param decorator in `apps/api/src/common/decorators/` resolving the same way Postiz's `@GetOrgFromRequest()` does.

### Task 4 — RBAC guard
- `RolesGuard` in `apps/api/src/common/guards/` checking `UserOrganization.role` against a `@Roles(...)` decorator on each route. Start hand-rolled; only reach for a CASL-style ability system if a concrete PostGear feature needs attribute-level (not just role-level) checks.

### Task 5 — Frontend
- `apps/web/src/app/(auth)/{login,register,reset-password}` pages.
- Org switcher component + `[orgId]` route param already scaffolded under `apps/web/src/app/(dashboard)/[orgId]/`.

## Definition of Done
- [ ] Register → activate → login → logout works end-to-end via password auth.
- [ ] Google and GitHub OAuth login both work and correctly attach to an existing user by email or create a new one.
- [ ] A user in two orgs can switch between them and API calls scope correctly to the active org.
- [ ] A `USER`-role member is blocked (403) from an `ADMIN`-only route by the guard.

## Risks
- Don't let RBAC design balloon into a full permissions engine this early — three roles, route-level checks, ship it. Revisit only if a real PostGear feature (e.g. agency mode) demands finer granularity.
