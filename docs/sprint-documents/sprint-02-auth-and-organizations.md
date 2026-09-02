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
- `apps/web/src/app/(auth)/{login,register,reset-password}` pages — **built in Sprint 0** as the design system's smoke test, in `packages/ui` components with no one-off markup. The forms are deliberately inert; this task wires them up rather than building them.
- Org switcher component + `[orgId]` route param already scaffolded under `apps/web/src/app/(dashboard)/[orgId]/`.

### Task 6 — Post-signup onboarding flow (product decision, 2026-09-03)
Signup collects credentials only — the register form deliberately has no organization/workspace field. Creating the workspace happens here instead, in a real onboarding flow modelled on how established SaaS products do it: a short guided sequence on first sign-in that names the workspace, connects a first channel, and then drops the user into the product.

- Sequence: **create workspace → connect first channel → land in the app.** The channel step must be skippable — a user who can't finish an OAuth handshake right now still needs to reach the dashboard. Channel connection itself is [Sprint 3](sprint-03-social-integrations.md); this flow just launches it, and degrades to "skip for now" until that sprint lands.
- `OnboardingStepper` already exists in `packages/ui` (Sprint 0) — compose it, don't build new stepper chrome.
- **Two separate route gates, not one**: "not authenticated → `/login`" belongs in the `(dashboard)` group layout; "authenticated but not onboarded → `/onboarding`" sits between that and the `[orgId]` layout, since an un-onboarded user has no org id to route with.
- A `User` with **zero `UserOrganization` rows is a valid, persistable state** for the whole duration of this flow. Nothing may assume otherwise — see the data-model consequences recorded in [Sprint 1, Task 3a](sprint-01-foundation-and-data-model.md), including where "onboarding complete" is stored and the fact that the seed only covers the already-onboarded happy path.

## Definition of Done
- [ ] Register → activate → login → logout works end-to-end via password auth.
- [ ] A brand-new user is routed into the onboarding flow, creates a workspace, can skip the channel step, and lands in the dashboard — and a user who abandons onboarding midway can sign back in without hitting an error page.
- [ ] Google and GitHub OAuth login both work and correctly attach to an existing user by email or create a new one.
- [ ] A user in two orgs can switch between them and API calls scope correctly to the active org.
- [ ] A `USER`-role member is blocked (403) from an `ADMIN`-only route by the guard.

## Risks
- Don't let RBAC design balloon into a full permissions engine this early — three roles, route-level checks, ship it. Revisit only if a real PostGear feature (e.g. agency mode) demands finer granularity.
