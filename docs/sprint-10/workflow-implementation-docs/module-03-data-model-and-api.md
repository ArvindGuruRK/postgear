# Module 03: Data Model And Automations API

> **Sprint 10, Workflow Builder** | Status: Done (2026-10-29, see the README decision log for the calls made) | Size: M (one session)
> **Depends on**: [Module 01](module-01-engine-graph-and-catalog.md), [Module 02](module-02-engine-data-tokens-conditions.md)
> **Stories**: WF-1.2, WF-1.3, WF-1.4, WF-2.7, WF-5.1 (server side), WF-6.4 (route guard only)
> **Next**: [Module 04](module-04-connections.md)

## Goal

The database rows and the API that the builder saves into. After this module:

- `Automation`, `AutomationVersion`, `AutomationRun` and `AutomationRunStep` exist, migrated and generated;
- workflows can be listed, created (blank or from a template), read, saved with a revision guard, duplicated and deleted through `apps/api/src/modules/automations`;
- the server validates every saved graph with `@postgear/automation` and refuses anything that looks like a secret;
- `GET /automations/catalog` tells the web app which steps are Ready, Need A Connection or are Coming Soon in this workspace;
- the seed has one Publishing Report draft for `seed-demo-org`.

No UI yet, no runs yet. The run tables are created now so Module 07 only adds code, not a second migration for the core shape.

## Read First

1. [`README.md`](README.md) (names, rules, decision log).
2. Sprint doc: "Database", "API Routes", "Validation Rules".
3. Module 01 "Graph shape" and "validateGraph", Module 02 "Redaction" and "Starter templates".
4. Skills: `prisma-change` (schema, migration, notes, mirrored types) and `new-api-module` (controller, service, repository, Zod DTOs, messages, specs).
5. Code: `apps/api/src/modules/webhooks/` (the closest module in shape: admin routes with `@Roles(Role.ADMIN)`, repository, `*.messages.ts`), `apps/api/src/modules/studio/studio.service.ts` (revision check and 409 on stale), `apps/api/src/common/pipes/zod-validation.pipe.ts`, `apps/api/src/common/decorators/current-org.decorator.ts`, `packages/db/prisma/SCHEMA_NOTES.md`.

## Scope

**In**: four models and their enums, migration, `SCHEMA_NOTES.md` entry, the `automations` API module (CRUD, revision, duplicate, soft delete, validate, catalog, templates, pinned data, list with run stats), the `EXECUTABLE_TYPES` list in `packages/automation`, seed, specs.

**Out**: `AutomationConnection` (Module 04), `AutomationWebhookSecret` (Module 13), running anything (Module 07), activate and pause behaviour (Module 09: the routes exist now and answer 501), any web page (Module 05).

## Design

### Models (use the `prisma-change` skill)

```prisma
model Automation {
  id                    String            @id @default(uuid())
  organizationId        String
  name                  String            // "Untitled Workflow" by default
  status                AutomationStatus  @default(DRAFT)
  draftGraph            Json              // AutomationGraph from @postgear/automation
  draftRevision         Int               @default(1)
  pinnedData            Json              @default("{}")  // { [nodeKey]: { output, pinnedAt, pinnedById } }, never used by live runs
  activeVersionId       String?           @unique
  hasUnpublishedChanges Boolean           @default(false)
  triggerType           String?           // denormalised from the draft for the list ("trigger.postPublished")
  lastRunAt             DateTime?
  lastRunStatus         AutomationRunStatus?
  lastRunError          String?           // one sentence, for the list's hover
  consecutiveFailures   Int               @default(0)     // live runs only; Module 09 auto-pauses at 5
  templateId            String?           // which starter it came from, for analytics
  createdById           String
  updatedById           String?
  createdAt             DateTime          @default(now())
  updatedAt             DateTime          @updatedAt
  deletedAt             DateTime?
  organization          Organization      @relation(...)
  activeVersion         AutomationVersion? @relation("ActiveVersion", ...)
  versions              AutomationVersion[]
  runs                  AutomationRun[]

  @@index([organizationId, deletedAt, updatedAt])
  @@index([organizationId, status])
}

enum AutomationStatus { DRAFT ACTIVE PAUSED }

model AutomationVersion {
  id            String   @id @default(uuid())
  automationId  String
  version       Int
  graph         Json     // immutable snapshot; never updated after insert
  triggerType   String
  note          String?  // optional, typed in the activation dialog
  createdById   String
  createdAt     DateTime @default(now())

  @@unique([automationId, version])
}

model AutomationRun {
  id              String               @id @default(uuid())
  automationId    String
  versionId       String?              // null only for draft test runs
  organizationId  String
  mode            AutomationRunMode    // TEST, LIVE
  status          AutomationRunStatus  @default(QUEUED)
  triggerType     String
  triggerEventId  String?              // "post.published:<rootPostId>" etc. (Module 09)
  triggerPayload  Json                 // redacted, capped
  graphSnapshot   Json?                // TEST runs only: the draft as it was when the test started
  startedById     String?              // manual and test runs
  creditsUsed     Int                  @default(0)
  stepCount       Int                  @default(0)
  error           String?              // one sentence
  startedAt       DateTime?
  finishedAt      DateTime?
  createdAt       DateTime             @default(now())

  @@unique([automationId, triggerEventId])
  @@index([automationId, createdAt])
  @@index([organizationId, status])
  @@index([status, createdAt])          // reconcile and prune
}

enum AutomationRunMode { TEST LIVE }
enum AutomationRunStatus { QUEUED RUNNING WAITING SUCCEEDED FAILED CANCELLED REJECTED EXPIRED }

model AutomationRunStep {
  id          String                  @id @default(uuid())
  runId       String
  nodeKey     String
  nodeType    String
  nodeName    String                  // copied in: run rows describe themselves (TriForms lesson)
  status      AutomationStepStatus
  attempt     Int                     @default(1)
  input       Json?                   // redacted, capped at 64 KB
  output      Json?                   // redacted, capped at 64 KB
  truncated   Boolean                 @default(false)
  error       Json?                   // { message, code, retryable, details? }
  startedAt   DateTime?
  finishedAt  DateTime?
  durationMs  Int?
  createdAt   DateTime                @default(now())
  updatedAt   DateTime                @updatedAt

  @@unique([runId, nodeKey, attempt])
  @@index([runId, updatedAt])          // live run polling (Module 07)
}

enum AutomationStepStatus { QUEUED RUNNING SUCCEEDED DRY_RUN HANDLED_ERROR FAILED SKIPPED WAITING CANCELLED }
```

Notes for `SCHEMA_NOTES.md`:

- **REJECTED and EXPIRED are outcomes, not failures**: the list and the failure counter treat only `FAILED` as a failure (user stories WF-10.1).
- **`graphSnapshot` on TEST runs**: a test runs the draft at that moment; storing it means the run inspector can paint the right graph even after the draft moves on.
- **`nodeName` and `nodeType` on steps**: a deleted or renamed step still reads correctly in old runs.
- **Run rows cascade** from `Automation` (hard delete after the 30-day prune); `Automation` itself is soft deleted.
- **`pinnedData` lives on the row, not in the graph**, so versions never carry test data and live runs cannot read it.

### `EXECUTABLE_TYPES` in `packages/automation`

```ts
// src/catalog/executable.ts
export const EXECUTABLE_TYPES: ReadonlySet<NodeType> = new Set([]);  // modules 07, 10 to 13 add to it
```

`EXECUTABLE_TYPES` says which steps the worker can **run** today. It does not decide what can be **added**: the canvas (Module 05) must be usable before the run engine exists, so every `ready` definition can be placed on a draft. A step whose type is not executable yet carries `runnable: false` in the catalog, and `validateGraph` (through `ctx.availableTypes`) raises `node.not_runnable` (error: "This step cannot run yet."), which blocks Test and Activate but not saving. Each module that ships an executor adds its types here in the same commit. A unit test in the worker (Module 07) asserts every executable type has an executor and vice versa.

### API module `apps/api/src/modules/automations` (use the `new-api-module` skill)

| Route | Who | Notes |
|---|---|---|
| `GET /automations?search=&status=&cursor=` | members | list rows with `lastRunAt`, `lastRunStatus`, `lastRunError`, `runs30d` (count of LIVE runs in 30 days, one grouped query, not N+1), `triggerType`, `hasUnpublishedChanges` |
| `POST /automations` | members | body `{ name?, templateId? }`; blank creates `emptyGraph()`; template calls `instantiateTemplate` with server-made keys |
| `GET /automations/:id` | members | the row plus `draftGraph`, `draftRevision`, `pinnedData` summary (keys and pinnedAt only), active version number |
| `PATCH /automations/:id` | members | body `{ draftRevision, name?, draftGraph? }`; 409 with the current revision when stale; bumps the revision; sets `hasUnpublishedChanges` when `ACTIVE` or `PAUSED` and the graph differs from the active version |
| `DELETE /automations/:id` | members | soft delete; if `ACTIVE`, calls `AutomationTriggers.stop()` first (a no-op stub until Module 09) |
| `POST /automations/:id/duplicate` | members | "{name} (Copy)", status `DRAFT`, fresh node keys, tokens rewritten, pinned data not copied |
| `POST /automations/:id/validate` | members | `validateGraph(draftGraph, ctx)` with `ctx` filled from the DB (connections, channels, executable types) |
| `GET /automations/catalog` | members | every definition plus `state: 'ready' or 'needsConnection' or 'comingSoon'`, `runnable: boolean` and `reason` |
| `GET /automations/templates` | members | template metadata (no graphs) |
| `PUT /automations/:id/pinned/:nodeKey` | members | body `{ output }`; size capped at 64 KB; redacted on the way in |
| `DELETE /automations/:id/pinned/:nodeKey` | members | |
| `POST /automations/:id/activate`, `POST /automations/:id/pause` | `@Roles(Role.ADMIN)` | 501 with "Turning workflows on arrives in a later step of this sprint." until Module 09 |

- **The validate context builder** (`automation-context.service.ts`) is its own small service because Modules 04, 07 and 09 reuse it: it loads the workspace's connections (Module 04 fills them in; an empty list until then), connected channels (`Integration` rows not deleted or disabled, with their provider), and `EXECUTABLE_TYPES`.
- **Catalog state**: `comingSoon` only when the definition says so (never addable); `runnable` is false when the type is not in `EXECUTABLE_TYPES` (addable, but Test and Activate are blocked); `needsConnection` when the definition needs a connection kind and the workspace has no healthy connection of that kind (or, for `postgear.publish`, no connected channel of that provider); otherwise `ready`.
- **Saving is lenient, activating is strict**: PATCH accepts graphs with validation issues (users save half-built flows), but it always refuses:
  - a graph that fails the Zod graph schema (unknown keys, bad shapes, over the limits);
  - unknown node types;
  - any config string value that matches the redaction patterns (a key name like `apiKey` or `password`, or a value shaped like a bearer token, a Slack or Discord webhook URL, or a `sk-` key). Message: "Secrets cannot be saved in a step. Add them as a connection instead." This is the "secrets never live in graph JSON" rule enforced at the door.
- **Revision guard** follows the Studio pattern (read `studio.service.ts`): `updateMany where { id, organizationId, draftRevision }`; zero rows updated means stale: answer 409 with `{ currentRevision }`.
- **Tenancy**: every query is scoped by `@CurrentOrg()`; a workflow from another workspace is a 404, never a 403.
- Messages in `automations.messages.ts` (sentence case, plain words).

### Seed

Add the Publishing Report template as a `DRAFT` named "Publishing Report" for `seed-demo-org` (created by `demo@postgear.local`). Its Sheets and Slack steps stay unconnected so the seeded draft shows the Finish Setup markers in Module 05.

## Tasks

- [x] Models, enums and relations through the `prisma-change` skill; run the migration and `db:generate` yourself.
- [x] `SCHEMA_NOTES.md` entry with the notes above.
- [x] `EXECUTABLE_TYPES` in `packages/automation` (empty set) and its export.
- [x] `automations` module: controller, service, repository, `automation-context.service.ts`, DTOs (`.strict()` Zod, the graph schema imported from `@postgear/automation`), messages.
- [x] Secret detector (reuse the patterns from Module 02's `redact`; add a `findSecretLikeValues(graph)` helper in `packages/automation` so the web app can warn before saving).
- [x] List query with run stats in one or two queries.
- [x] Activate and pause routes answering 501, admin only.
- [x] Seed.
- [x] Register the module in `app.module.ts`.

## Tests

- Repository and service specs: create blank and from template; PATCH bumps the revision; stale PATCH is 409 with the current revision; another workspace's id is 404 on every route; duplicate gives fresh keys, "(Copy)", `DRAFT`, and working tokens; delete hides the row from the list.
- Secret refusal: a Slack webhook URL in a Set Fields value, a `password` key, a bearer token string, each refused with the message above; a harmless URL is accepted.
- Graph schema refusal: an unknown key on a node, 51 steps, an unknown node type.
- Catalog: a type not in `EXECUTABLE_TYPES` is `ready` with `runnable: false`, and `validate` reports `node.not_runnable` for it; a Slack step with no connection is `needsConnection` (fake the context); Generate Video is `comingSoon` with its reason.
- Roles: a member calling activate gets 403 (the guard), an admin gets 501.
- `hasUnpublishedChanges` flips only for `ACTIVE` or `PAUSED` workflows.

## Done When

- `npm run validate` passes; the migration applies cleanly on a fresh database (`migrate:deploy`) and the seed runs.
- `curl` with the demo session lists the seeded Publishing Report draft and returns its catalog.

## Hand Check

1. `npm run db:seed`, then sign in as `demo@postgear.local`.
2. In the browser console on the app (cookies attached): `await fetch('http://localhost:3001/automations', { credentials: 'include' }).then(r => r.json())` shows "Publishing Report".
3. `GET /automations/catalog` shows Slack and Google Sheets with `runnable: false` for now (no executors yet), and WhatsApp as Coming Soon. That is expected until Modules 07 and 12.

## Handoff

Update [`README.md`](README.md): progress row (routes shipped), decision log (the secret detector patterns, any model field you renamed), and note the migration name.
