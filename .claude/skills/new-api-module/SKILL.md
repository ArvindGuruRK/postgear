---
name: new-api-module
description: Add a NestJS module, endpoint or route to apps/api the PostGear way (controller, service, repository, Zod DTOs, messages, specs) and wire the web app to it. Use for "add an endpoint", "new API for X", "add a route", "CRUD for X", "expose X to the frontend", "add to the public /v1 API".
---

# New API module or endpoint

Copy the shape of a small, clean module. Best examples:
- `apps/api/src/modules/tags/` (CRUD, serializable writes, outcomes mapped to HTTP errors)
- `apps/api/src/modules/signatures/` (smaller CRUD)
- `apps/api/src/modules/seo/seo.controller.ts` (a streaming SSE route, `ZodQuery`)

Read the example before writing. Match its comment style: a header doc comment on every file explaining *why*, not *what*.

## 1. File layout

```
apps/api/src/modules/<name>/
  <name>.module.ts          controllers, providers, exports
  <name>.controller.ts      HTTP only: decorators, pipes, response shape
  <name>.service.ts         rules; maps repository outcomes to Nest exceptions
  <name>.repository.ts      the only file that touches Prisma for this table
  <name>.messages.ts        every user-facing string, `as const`
  dto/<name>.schema.ts      Zod schemas + inferred input types
  <name>.service.spec.ts    service against a fake repository
  <name>.repository.spec.ts repository against a mocked `@postgear/db`
```

Then add the module to the `imports` array in `apps/api/src/app.module.ts` (recent ones sit at the end with a dated comment). Export a service only when another module needs it (see `TagsModule` exporting `TagsService` for posts).

## 2. Auth and tenancy (security, not style)

- `JwtAuthGuard` and `RolesGuard` are global `APP_GUARD`s. Every route is authenticated by default.
- `@Public()` (`common/decorators/public.decorator.ts`) opts a route out. Only for things with no session: OAuth callbacks, Stripe webhooks, health.
- `@Roles(Role.ADMIN, Role.USER)` (`common/decorators/roles.decorator.ts`, `Role` from `@postgear/db`) on the controller class requires an active workspace membership. Without `@Roles()` a route needs a login but no workspace (onboarding, `/auth/me`).
- `@CurrentOrg() org: ActiveOrg` (`common/decorators/current-org.decorator.ts`) gives `{ id, role }`, resolved by `RolesGuard` from the `pg_org` cookie. **Every tenant query filters on `org.id`.** Never take an org id from the body or a route param.
- `@CurrentUser() user: AuthenticatedUser` gives `{ id, email, isSuperAdmin, onboardingCompletedAt }`.
- Admin-only writes: put `@Roles(Role.ADMIN)` on that handler.

## 3. Validation

- No global ValidationPipe, no class-validator. Validate per route:
  `@Body(new ZodBody(createXSchema, '<name>/create')) dto: CreateXInput`
  `@Query(new ZodQuery(listXQuerySchema, '<name>/list')) query: ListXQuery`
  (both in `common/pipes/zod-validation.pipe.ts`; the second argument is a log label).
- **Every object schema is `.strict()`** so unknown keys are refused.
- On failure the client only gets "Invalid input"; field detail goes to `securityLogger`. Keep field-level hints on the web side.
- Clean free text with `stripControlChars` from `common/sanitize.ts` before length checks (see `dto/tags.schema.ts`).
- An update schema with all-optional fields should `.refine(...)` that at least one key is present.

## 4. Repository and Prisma

- `import { prisma, Prisma, type PrismaTransactionClient } from '@postgear/db'`.
- Every `where` carries the workspace (`orgId`), and soft-deleted rows are filtered (`deletedAt: null`) wherever the table has that column.
- Use a fixed `select` constant instead of returning whole rows.
- Return outcome unions (`{ outcome: 'created', ... } | { outcome: 'name_taken' }`) instead of throwing. The service turns them into exceptions.
- When a rule depends on *other* rows (unique name, per-workspace cap), use a serializable transaction with retry, as `tags.repository.ts` does.
- Schema change needed? Use the `prisma-change` skill first.

## 5. Errors and messages

- Throw Nest exceptions from the service: `NotFoundException`, `ConflictException`, `UnprocessableEntityException`, `ForbiddenException`, with a string from `<name>.messages.ts`.
- `HttpExceptionFilter` (global) turns everything into `{ error, statusCode }` and hides Prisma errors and stack traces. To let the web branch on a refusal, throw with `{ message, code }`; `code` must match `/^[a-z][a-z0-9_]{0,63}$/` and reaches the web as `ApiError.code`.
- Treat a malformed id as not found without querying (see `UUID_PATTERN` in `tags.service.ts`).
- Plan limits: inject `EntitlementsService` from `modules/billing/entitlements.service.ts` (e.g. `assertCanConnect`). Never hard-code plan numbers; they live in `modules/billing/plans.ts`.

## 6. Response shape

Wrap results in a named key: `{ tags: [...] }`, `{ tag }`, `{ message: X_MESSAGES.DELETED }`. Use `@HttpCode(HttpStatus.CREATED)` on creates.

## 7. Rate limiting

A per-address limit already applies to every route (`common/throttling`, `RATE_LIMIT_PER_MIN`). Only add `@SkipThrottle()` for routes that must never be throttled (Stripe webhook, the long-lived notifications stream). Login-style endpoints use `LoginThrottleGuard` + `@ThrottleLimit(n)` from `common/guards/login-throttle.guard.ts`.

## 8. Streaming routes (SSE)

For progress streams (AI, SEO), follow `seo.controller.ts`:
- `@Post(...)` + `@HttpCode(HttpStatus.OK)`, validate the body with `ZodBody` first so bad input is a normal 400.
- Take `@Req() request` and `@Res() response`, call `openSseStream(request, response)` from `common/sse.ts`, run the work with `stream.send(type, data)`, and `stream.close()` in `finally`.
- Pass `stream.signal` to slow work so a closed tab stops it. Errors after the first byte are sent as an `error` event, not thrown.
- The web reads it with `apps/web/src/lib/sse.ts`.

## 9. Public API (/v1), only if asked

Public routes live in `modules/developers/v1/`:
- Controller class carries `@ApiKeyAuth()` (`developers/auth/api-key-auth.decorator.ts`). It bundles `@Public()`, the key guard and the per-key throttle; `@CurrentOrg()` still works.
- Map internal rows to public shapes in a `public-*.mapper.ts` with types in `v1.types.ts`; reuse the internal service.
- Register the controller in `developers.module.ts`, document it in `developers/openapi/openapi.document.ts` (bodies come from the Zod schemas), and update `openapi.document.spec.ts`.
- Add the method to `packages/sdk/src/client.ts` and `types.ts` with a test.

## 10. Web side

- Mirror the response types in `apps/web/src/types/<name>.ts` (header comment says "Mirrors `/<route>`").
- Browser code: `api<{ tags: Tag[] }>('/tags')` from `@/lib/api`. Server components: `serverApi<T>(path, { cookie })`, passing the incoming cookies (see `app/(dashboard)/[orgId]/settings/api-keys/page.tsx`).
- Show `ApiError.message` to the user as is; branch on `ApiError.code`, never on the copy.

## 11. Tests and checks

- Service spec: build a `jest.Mocked<XRepository>` by hand and `new XService(repository)` (no Nest testing module needed). Assert each outcome maps to the right exception.
- Repository spec: `jest.mock('@postgear/db', ...)` keeping `jest.requireActual`, mock `prisma.<table>.*` and `$transaction`. Assert every query is scoped by `orgId`.
- Run one file: `npm test --workspace=@postgear/api -- <name>.service`
- Then `npx turbo run lint typecheck test --filter=@postgear/api` (add `--filter=@postgear/web` if the web changed).
