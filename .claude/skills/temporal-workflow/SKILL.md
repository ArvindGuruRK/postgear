---
name: temporal-workflow
description: Add or change a PostGear background job on Temporal (worker workflow, activities, scheduling contract, API start/signal/cancel, tests). Use when the user says "add a background job", "run this on a schedule", "retry this later", "new workflow", "new activity", "send this async", or changes publishing, token refresh, analytics sync, webhook delivery or the maintenance reconcile.
---

# Temporal workflow

PostGear's durable jobs run on one Temporal worker (`apps/worker`). The API never does the work itself: it writes rows, then starts or signals a workflow; the worker runs it. Read the big picture in `CLAUDE.md` first.

The three places a job touches, and the one rule each has:

| Place | What lives there | Rule |
|---|---|---|
| `packages/scheduling/src` | Workflow and signal names, workflow id builders, input types, retry policies as data, status shapes | **Pure**: no Temporal, no Prisma, no Node built-ins. `package.json` has no dependencies and must stay that way |
| `apps/worker/src` | Workflows (`workflows/`), activities (`activities/`), helpers (`lib/`) | Workflows are deterministic; only activities touch the outside world |
| `apps/api/src/modules/scheduling/scheduling.service.ts` | Starting, signalling and cancelling workflows | Every call is best effort and must never fail the user's request |

## 1. Add the contract to `packages/scheduling`

In `packages/scheduling/src/workflows.ts`, next to the existing ones:

- A name constant, e.g. `export const WEBHOOK_DELIVERY_WORKFLOW = 'webhookDeliveryWorkflow';`. It must equal the exported workflow function's name.
- An id builder derived from a row id, e.g. `webhookDeliveryWorkflowId(deliveryId)`. A deterministic id is what makes start and `signalWithStart` idempotent and lets the API address a workflow without searching Temporal.
- New signal names, if any (see `WAKE_SIGNAL`, `PUBLISH_NOW_SIGNAL`, `CANCEL_SIGNAL`, `SYNC_NOW_SIGNAL`).
- The input interface (see `WebhookDeliveryInput`), and the retry policy as plain numbers (see `WEBHOOK_DELIVERY_RETRY_POLICY`, or `PUBLISH_RETRY_POLICY` in `retry-policy.ts`) so the API can describe it and the worker enforce it from one place.

Everything is re-exported from `packages/scheduling/src/index.ts`. Add pure-function tests to `packages/scheduling/src/scheduling.test.ts`.

## 2. Add the activities in the worker

- One file per area: `apps/worker/src/activities/<area>.activities.ts` exporting `create<Area>Activities(deps: ActivityDeps)` that returns an object of async functions. Copy the shape of `webhook.activities.ts`.
- Activities may import `prisma` from `@postgear/db`, call platforms, read the clock and read `deps`. They get their dependencies from `ActivityDeps` (`activities/deps.ts`: `env`, `publisher`, `analytics`, `publishGate`, `temporalClient`, `publicUrl`), never from singletons, so tests can pass fakes. A new dependency is added to `ActivityDeps` and built once in `apps/worker/src/index.ts`.
- Always scope row reads by `organizationId` as well as the id.
- Throw `ApplicationFailure` (from `@temporalio/activity`) with a `type` from `packages/scheduling` for failures the workflow must treat as final; list those types in the policy's `nonRetryableErrorTypes`.
- Spread the new factory into `createActivities` in `apps/worker/src/activities/index.ts` and export its public types there.

## 3. Add the workflow

- New file `apps/worker/src/workflows/<name>.workflow.ts`, exported from `apps/worker/src/workflows/index.ts`. That index is the `workflowsPath` the worker bundles (in `src/index.ts`), so a workflow not exported there does not exist.
- Import activities as a **type only**: `import type { Activities } from '../activities';` and call them through `proxyActivities<Activities>({ startToCloseTimeout, retry })`. A value import would pull Prisma into the sandbox.
- Sandbox rules (the header of `workflows/index.ts`): no Prisma, no network, no Node built-ins, no imports from `apps/worker/src/lib` that do I/O. Use `sleep`, `condition`, `defineSignal`/`setHandler`, `continueAsNew` from `@temporalio/workflow`. Temporal patches `Date.now` and `Math.random` inside workflows, so those are safe there, but nowhere else counts as deterministic.
- Treat the database as the truth: a signal means "look again", not "here is the new state" (see the wake handling in `post-publish.workflow.ts` and the notes at the top of `scheduling.service.ts`).
- A long-lived loop must `continueAsNew` to keep history short (see `maintenance.workflow.ts`, which does it once a day).
- Map retry values from `packages/scheduling` into the `proxyActivities` options, as `webhook-delivery.workflow.ts` does.

## 4. Start it from the API (or the worker)

In `apps/api/src/modules/scheduling/scheduling.service.ts`:

- Wrap every call in the private `attempt(label, run)` helper. It times out, logs `scheduling.unavailable`, and returns `false` instead of throwing, so a Temporal outage never breaks the user's request.
- Per-row jobs that may already be running: `client.workflow.signalWithStart(NAME, { workflowId: idFor(row.id), taskQueue: SCHEDULING_TASK_QUEUE, args, signal })`.
- One-shot jobs: `client.workflow.start(...)`, treating `WorkflowExecutionAlreadyStartedError` as success.
- Cancel by signalling `CANCEL_SIGNAL` through `client.workflow.getHandle(id)`, not by terminating.
- The worker can start workflows too, through `deps.temporalClient()` (see `apps/worker/src/lib/webhook-start.ts`).

Write the row first, then start the workflow. If the start is lost, the row is still there for the safety net.

## 5. Cover it in the maintenance reconcile

`maintenanceWorkflow` runs `reconcileSchedules` (`activities/maintenance.activities.ts`) every 15 minutes and starts any workflow that should exist but does not (queued posts, refreshable channels, pending webhook deliveries). If the new job is tied to rows that must always have a workflow, add them there and add a counter to `ReconcileReport`.

## 6. Simulation

The worker reads `PUBLISH_SIMULATION` and `ANALYTICS_SIMULATION` in `apps/worker/src/config/env.ts` (analytics follows publish when unset; both refused in production). Seeded channels hold fake tokens, so a job that calls a platform needs a simulated path, chosen in `lib/` like `createPublisher` (`lib/publisher.ts`) or `createAnalyticsSource` (`lib/analytics-source.ts`). A new flag goes in `config/env.ts` with the same production refusal and in `.env.example` with an explanation.

## 7. Tests

Follow `apps/worker/src/workflows/webhook-delivery.workflow.test.ts`:

- `TestWorkflowEnvironment.createTimeSkipping()` once in `beforeAll`, `teardown()` in `afterAll`, `jest.setTimeout(180_000)`.
- A `Worker.create({ connection: env.nativeConnection, taskQueue, workflowsPath: require.resolve('./index'), activities })` with mocked activities, then `worker.runUntil(env.client.workflow.execute(...))`.
- The mocks are typed `{ [K in keyof Activities]: jest.Mock }`, so **adding an activity breaks the build of every `*.workflow.test.ts`** (`post-publish`, `analytics-sync`, `webhook-delivery`) until its name is added to each `mocks()` helper.
- Pin retries by asserting call counts against the policy constants, not by sleeping.
- Unit-test pure helpers in `lib/` with plain Jest.

Run:

```bash
npm test --workspace=@postgear/worker -- webhook-delivery
npm test --workspace=@postgear/scheduling
npm run typecheck --workspace=@postgear/worker
```

The first run downloads Temporal's test server, so it is slow once.

## 8. Try it locally

`npm run dev` (or `npm run dev:worker` on its own) needs Temporal from `docker compose up -d`. Every workflow is visible in the Temporal UI at http://localhost:8233, with its timers, retries and signals. `GET /scheduling/status` on the API reports whether a worker is polling.
