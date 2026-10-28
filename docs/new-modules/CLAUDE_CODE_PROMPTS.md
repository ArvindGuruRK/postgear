# Claude Code Prompts: Design Studio and Workflow Builder

Copy one prompt at a time into a fresh Claude Code session in this repository. Each prompt is one phase: it builds, verifies and stops, so you can test by hand before the next one.

**Why phases and not one big prompt**: a single "build both modules" prompt produces a wide, shallow demo. One phase per session keeps the context small, the checks real, and every step reviewable.

**Order**: Studio S1 to S7, then Workflows W1 to W7. The two modules are independent until W7 (Render Design), so you can also run them in parallel on separate branches.

**Before each prompt**: Docker services up (`docker compose up -d`), on the right branch, working tree clean.

**User stories**: every prompt points at a sprint doc, and each sprint doc links its user stories ([Design Studio](user-stories-design-studio.md), [Workflow Builder](user-stories-workflow-builder.md)). The stories' acceptance criteria and UX rules apply to every phase, and their completion checklist is what the last phase ticks off.

---

## Design Studio

Spec: [`../sprint-documents/sprint-09-design-studio.md`](../sprint-documents/sprint-09-design-studio.md)

### S1: Engine package and first presets

```text
Read CLAUDE.md, then docs/sprint-documents/sprint-09-design-studio.md in full. We are doing Task 1 only.

Branch: sprint-9-design-studio (create it from ui-revamp if it does not exist). Do not push.

Build packages/design-engine exactly as the "Technical Design" section describes: types, Zod document schema with schemaVersion and upgrade(), the four formats, regions and slots in percentages, clampToRegion, applyBrand with an AA contrast guarantee, the undo/redo reducer, and the SlideView renderer with "edit" and "export" modes. It must stay browser-safe (no Node built-ins). Wire it into tsconfig paths and the shared Jest preset like the other packages.

Ship 6 layouts (cover headline, split headline, list, quote, statistic, closing CTA) and 6 themes, each layout working in all 4 formats, and bundle a small set of OFL fonts with their licence files.

Add a /dev/studio playground page that renders every preset in every format, so I can check them by eye.

Unit test clampToRegion, the strict schema, applyBrand contrast, and upgrade(). Then run the verify-change skill. Finish with what I should check by hand at /dev/studio (light, dark and Lilac).
```

### S2: Database and API

```text
Read CLAUDE.md and docs/sprint-documents/sprint-09-design-studio.md. We are doing Task 2 only (Task 1, packages/design-engine, is done).

Use the prisma-change skill for BrandKit and Design (DesignShare comes later, in S7). Run the migration and db:generate yourself. Add the reasons to packages/db/prisma/SCHEMA_NOTES.md.

Use the new-api-module skill for apps/api/src/modules/studio: designs CRUD with the revision check (409 on stale), duplicate, soft delete, brand kits CRUD, and POST /studio/brand-kits/extract. Creating a design takes { presetId, format, brandKitId? } and the server builds the document from the preset, so the client cannot invent one. The PATCH body is validated with the design-engine Zod schema.

The extraction must reuse the SEO engine's assertSafeUrl and safe-fetch (packages/seo-engine/src/crawler). Do not write a new fetcher. Follow the extraction rules in the spec: name, logo candidates, colours, size caps, 10 s deadline, throttle. It returns candidates only and never saves.

Seed one brand kit and two designs for seed-demo-org.

Specs: another workspace's design is a 404; stale revision is a 409; extraction refuses localhost, 169.254.169.254, a private IP, and a redirect to one. Run verify-change. Tell me which curl or UI steps prove it works.
```

### S3: Rail entry, landing page and wizard

```text
Read CLAUDE.md, docs/sprint-documents/sprint-09-design-studio.md (screens 1 to 3) and docs/design-patterns/design-system-rules.md. We are doing Task 3 only.

Use the new-page skill. Add Studio to the rail after Media with an animated icon, the same way the other RAIL entries in apps/web/src/components/navigation/dashboard-shell.tsx are wired. Build the Studio landing page (PageActions row first, recent designs grid, brand kits strip, empty state), and the Create Design wizard: Brand (pick, create, or extract from website with the editable review screen), Format (with the hover hints), Template gallery (search, filters, favourites, live recolouring with the chosen brand kit, thumbnails rendered by SlideView, not stored images).

Keep wizard state in the URL. Follow my UI rules: no in-page titles, Title Case names, sentence case messages, "Enter your ..." placeholders, design-system Alert for errors, bg-chrome for big surfaces, MotionIcon for clickable icons.

Choosing a template creates the design through the API and routes to /[orgId]/studio/[designId] (an empty editor shell is fine for now). Run verify-change, then list what I should click through by hand.
```

### S4: The editor

```text
Read CLAUDE.md and docs/sprint-documents/sprint-09-design-studio.md (Screen 4 and the document shape). We are doing Task 4 only.

Build the editor at /[orgId]/studio/[designId]: PageActions bar (inline title rename, saved state, undo, redo, reset, preview button placeholder, export and send placeholders), slides rail (thumbnails, add with a slide-layout choice, duplicate, delete, drag reorder with @dnd-kit/sortable, limit 20), canvas, and properties panel.

Must-haves from the spec: in-canvas text editing and panel fields editing the same state; constrained drag clamped to the element's region with the region outline and label while dragging and an edge highlight at the limit; arrow-key nudging; text auto-fit with the "too long" warning (never cut text silently); the contrast warning with Fix Contrast; undo/redo/reset via the design-engine reducer with keyboard shortcuts; autosave debounced 1.5 s that shows Saved only after the API confirms, Offline and error states, and the "changed in another tab" conflict; a leave guard; drawers on small screens.

Logo and image slots use the existing media picker dialog. Add component tests for the reducer wiring and the drag clamp. Run verify-change. This is a big UI change, so use Playwright to check one full edit and save flow, save screenshots to the screenshots folder, and tell me what to check by hand.
```

### S5: Preview, export and send

```text
Read CLAUDE.md and docs/sprint-documents/sprint-09-design-studio.md (screens 5 and 6, "Export renderer"). We are doing Task 5 only.

Preview: the eye icon opens an overlay with a platform switch (Instagram, Facebook, LinkedIn, X, only those that fit the format), a platform frame with the workspace avatar and name, an editable caption, a swipeable slide carousel, engagement icons with no counts, and a clear Preview badge. Reuse pieces of apps/web/src/components/composer/preview-panel.tsx where they fit.

Export: POST /studio/designs/:id/export over SSE (common/sse.ts on the API, lib/sse.ts on the web). Render SlideView in export mode to static HTML with react-dom/server, inline fonts and images as data URIs, and screenshot it with the SEO engine's Playwright browser pool. Read packages/seo-engine/src/crawler/browser.pool.ts first and expose a small renderHtmlToImage() rather than starting a second browser. Save one Media row per slide in order, JPEG quality 92 by default (Instagram's composer rule), PNG optional, through the existing storage. Clear error if Chromium is missing.

Send To Composer: export if stale, then create a DRAFT post through the posts API with the images in order and the caption, the same way the AI copilot's draft_post tool does it (apps/api/src/modules/ai/tools/copilot-tools.ts), and open it in the composer.

Add a render test that checks an exported PNG's size and a few pixel samples. Add an e2e spec for create, edit, export and send. Run verify-change and tell me what to check by hand.
```

### S6: Grow the template library

```text
Read docs/sprint-documents/sprint-09-design-studio.md ("Getting to 100+ templates" and Task 6). We are doing Task 6 only.

Grow packages/design-engine to at least 12 layouts and 40 curated presets across the categories in the spec (Tips, Educational, Announcement, Product, Quote, Listicle, Statistic, Case Study, Promotion, Story, Event, Hiring), each with good sample content and the right category, formats and style tags.

Keep PostGear's neobrutalist character available (borders, hard shadows, stickers) but make sure the set also has calm, corporate-friendly presets, because users post for their own brands. Every preset gets a render test in all its formats that fails on overflow of its sample content.

Show me the /dev/studio playground when done, and list the presets by category so I can review them.
```

### S7: Share links (P1)

```text
Read docs/sprint-documents/sprint-09-design-studio.md (Task 7). We are doing Task 7 only.

Add DesignShare with the prisma-change skill (token shown once, stored hashed, expiry default 7 days, max 30, revocable). Endpoints: create and revoke under /studio/designs/:id/shares, and a @Public() GET /public/design-shares/:token that returns the slides (the exported images, exporting first if stale) and the workspace name only. Throttle the public route.

Web: Share button in the editor (create, copy link, revoke, list active links), and a public page at /share/design/[token] outside the dashboard layout, noindex, showing the slides and the platform preview with the Preview badge. No sign-in, no comments, no approve buttons.

Specs: expired and revoked links 404, another workspace cannot revoke. Run verify-change.

Then close the sprint: go through every line of the completion checklist in docs/new-modules/user-stories-design-studio.md (section 6), check each against the running app and the code, and tell me which lines are not done and why. Then write the completion checklist with the sprint-closeout skill.
```

---

## Workflow Builder

Spec: [`../sprint-documents/sprint-10-workflow-builder.md`](../sprint-documents/sprint-10-workflow-builder.md)

### W1: Engine core package

```text
Read CLAUDE.md, then docs/sprint-documents/sprint-10-workflow-builder.md in full, especially "Lessons Carried Over From TriForms". We are doing phase 1 only.

Branch: sprint-10-workflow-builder (create it from ui-revamp if it does not exist). Do not push.

First study my own TriForms engine for ideas (it is my code, adapting it is fine): D:\rk-personal-projects\TriForms\INTEGRATIONS.md, docs/analysis/workflow-audit-findings.md, and packages/trpc/src/lib/workflow-graph.ts, workflow-engine.ts, workflow-variables (web), workflow-node-outputs.ts. Summarise in 10 lines what you will reuse and what you will do differently, then build.

Create packages/automation, pure like packages/scheduling (no Temporal, Prisma or Node built-ins): the node catalog metadata and Zod config schemas for every node in the spec's catalog table (Coming Soon ones included, marked as such), the graph schema with stable node keys, validateGraph() with every rule in "Validation Rules", dependency ordering and branch planning, the token parser and resolver with the fixed filter list (no eval of any kind), condition evaluation, redaction rules, and the three starter templates as graph JSON.

Unit test heavily: cycles, unreachable nodes, port types, tokens pointing at non-upstream nodes, filters, conditions, redaction, and that each starter template validates once its connections are filled. Run verify-change.
```

### W2: Database and API

```text
Read CLAUDE.md and docs/sprint-documents/sprint-10-workflow-builder.md ("Database", "API Routes"). We are doing phase 2 only (packages/automation exists).

Use the prisma-change skill for Automation, AutomationVersion, AutomationRun, AutomationRunStep and AutomationConnection (the webhook secret model waits for P1). Run the migration and db:generate yourself; add the reasons to SCHEMA_NOTES.md.

Use the new-api-module skill for apps/api/src/modules/automations: CRUD with draftRevision (409 on stale), duplicate, validate (returns validateGraph issues), GET /automations/catalog with each node's live state for this workspace (ready, needs connection, coming soon), and the connections endpoints. Connection credentials are encrypted with encrypt() from @postgear/db, never returned (only provider, name, status and a masked hint), and the graph stores only connection ids. Activate and pause are @Roles(Role.ADMIN) like the webhooks controller, and come in phase 5 (stub them as 501 for now).

Seed one draft workflow (the Publishing Report template) for seed-demo-org. Specs: tenancy 404s, stale revision 409, a graph containing a secret-looking value in a node config is refused, connection responses never contain the credential. Run verify-change.
```

### W3: The builder UI

```text
Read CLAUDE.md, docs/sprint-documents/sprint-10-workflow-builder.md ("Screens"), and docs/design-patterns/design-system-rules.md. We are doing phase 3 only.

Use the new-page skill. Add Workflows to the rail after Studio (or after Media if Studio is not on this branch) with an animated icon. Build the list page and the builder.

Canvas: @xyflow/react version 12 (check what TriForms' apps/web/src/components/form-builder/workflow-canvas.tsx and workflow-node.tsx do well, then build PostGear's own). Pan, zoom, fit, minimap, drag from the library, connect port to port with incompatible ports dimmed, the "+" on an output port opening the library filtered to compatible nodes, multi-select, duplicate, delete. Nodes are design-system cards with the category stripe and a one-line config summary; check light, dark and Lilac.

Library: search, categories, state badges from GET /automations/catalog; Coming Soon nodes visible but not addable. Settings panel: fields generated from each node's Zod config schema, connection picker, Insert Data token picker listing upstream outputs only. Live validation markers from validateGraph on the client. Autosave with the revision guard and an honest saved state. Avoid stale closures in panels (the TriForms audit bug).

Starter template cards on the list page create a draft from the template. Run verify-change, use Playwright for one build-and-connect flow, save screenshots to the screenshots folder, and tell me what to check by hand.
```

### W4: Run engine and test runs

```text
Read CLAUDE.md and docs/sprint-documents/sprint-10-workflow-builder.md ("Execution", "Test runs vs live runs"). We are doing phase 4 only. Use the temporal-workflow skill.

Add the contract to packages/scheduling (AUTOMATION_RUN_WORKFLOW, automationRunWorkflowId, REVIEW_DECISION_SIGNAL, retry policy). Build automationRunWorkflow in apps/worker as a deterministic interpreter of the pinned graph: dependency order, skipped branches, parallel branches capped at 4, Delay via sleep, Manual Review via the signal with a 7-day timeout, cancel via CANCEL_SIGNAL. Each node runs through executeNodeActivity, which resolves tokens, executes, and writes the AutomationRunStep row with redacted, size-capped input and output. Side-effect nodes check their own step row and pass the idempotency key ${runId}:${nodeKey}.

Implement these nodes for real now: Manual trigger, If / Else, Filter, Delay, Manual Review, Set Fields, In-App Notification (writes a Notifications row so the existing outbox emails it). Test mode runs side-effect nodes dry.

API: test runs (throttled), runs list, run detail with steps, cancel, review decisions. Web: Test Workflow button, run inspector drawer, node status painted on the canvas, Approve and Reject for a waiting review (also from the in-app notification).

Workflow tests with Temporal's test environment like the existing *.workflow.test.ts files: branching, skip, delay, review approve, review timeout, cancel, and a replayed activity that must not act twice. Run verify-change.
```

### W5: Real triggers and activation

```text
Read docs/sprint-documents/sprint-10-workflow-builder.md ("Triggers", "Activation"). We are doing phase 5 only. Use the temporal-workflow skill.

Post Published and Post Failed: in apps/worker/src/activities/publish.activities.ts, next to enqueueWebhookDeliveries and inside the same transaction, add enqueueAutomationRuns that inserts QUEUED runs for ACTIVE automations whose pinned trigger and filters match, then start them after commit like startWebhookDeliveries. The unique (automationId, triggerEventId) must make a replayed publish a no-op; test that.

Schedule: Temporal Schedules created on activate, deleted on pause, replaced on reactivate, in the workspace time zone; refuse schedules faster than hourly for workflows with AI nodes.

Activate and pause: full validation, the confirm dialog that says in plain words what the workflow will do (with the extra tick for automatic publishing without a review), a new immutable AutomationVersion pinned on activate, the "Unpublished changes" badge for later edits.

Create Draft node: first read the post creation path in apps/api/src/modules/posts/posts.service.ts and choose how the worker creates a draft without hand-duplicating validation (see the spec's note). Explain the choice before building it.

Run verify-change and give me a manual test script: publish a post with PUBLISH_SIMULATION=true and watch the workflow run.
```

### W6: Integrations and AI nodes

```text
Read docs/sprint-documents/sprint-10-workflow-builder.md (Node Catalog, "AUTOMATION_SIMULATION"). We are doing phase 6 only.

Add AUTOMATION_SIMULATION to the API and worker env schemas (refused when NODE_ENV=production, documented in .env.example): external providers are replaced by a stand-in that logs to the worker console, with [simulate:429]-style markers forcing failures, the same convention as PUBLISH_SIMULATION.

Put every external node behind a provider interface (TriForms' WorkflowActionProvider in INTEGRATIONS.md is the model). Build in this order and stop after each for verify-change: Slack (incoming webhook connection), Generate Text (packages/ai-engine content agent, credits through the existing ledger with refund on failure, follows AI_SIMULATION), Microsoft Teams (check current Microsoft guidance for Workflows webhooks first and tell me what you found), Discord, Email, HTTP Request (through the SSRF-checked sender in apps/worker/src/lib/webhook-sender.ts), Google Sheets Append Row (Google OAuth connection; tell me which Google Cloud setup and env vars I need), Generate Image, Add To Queue, Publish To Channel per platform.

Make the three starter templates fully runnable under simulation. Add an e2e spec for build, connect, validate, test run and activate.

Then close the sprint: go through every line of the completion checklist in docs/new-modules/user-stories-workflow-builder.md (section 6), check each against the running app and the code, and tell me which lines are not done and why. Then write the completion checklist with the sprint-closeout skill, including which integrations were only run in simulation.
```

### W7: P2 backlog (only when you decide)

```text
Read docs/sprint-documents/sprint-10-workflow-builder.md (phase 7) and docs/sprint-documents/sprint-09-design-studio.md. Before building, give me a short plan with the order and the risks, and wait for my go.

Candidates: Render Design node (fills a Studio preset's slots from upstream AI text and exports the slides through the Studio export path), Webhook trigger with hashed secrets, WhatsApp Cloud API (Coming Soon until Meta verification), Excel via Microsoft Graph, Merge node, plan quotas through apps/api/src/modules/billing/entitlements.service.ts, Retry From Here.
```

---

## Handy follow-ups

- Review before a commit: `Use the postgear-reviewer agent on the uncommitted changes.`
- Close a module: `Use the sprint-closeout skill for sprint 9` (or 10).
- Stuck starting the app: `Use the run-postgear skill.`
