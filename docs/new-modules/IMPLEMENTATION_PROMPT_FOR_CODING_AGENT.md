# Implementation Prompt --- PostGear Carousel Studio + Workflow Builder

You are working inside the existing PostGear application repository.
Implement the requirements in `POSTGEAR_PRODUCT_PRD.md`,
`CAROUSEL_STUDIO_REQUIREMENTS.md`, and
`WORKFLOW_BUILDER_REQUIREMENTS.md`.

## Critical working rules

1.  **Inspect before editing.** First inspect the repository structure,
    package files, routing, existing dashboard, UI/component library,
    styling/theme tokens, authentication, database schema, API patterns,
    background jobs, media storage, and current publishing/scheduling
    implementation.
2.  Do not assume a framework, ORM, database, file structure, or
    state-management library. Discover and reuse what the project
    already uses.
3.  Do not rebuild the existing dashboard or replace the design system.
4.  Keep changes incremental, testable, and consistent with current
    conventions.
5.  Do not delete unrelated code or make broad refactors to simplify
    your implementation.
6.  Do not fake successful integrations. If credentials or backend
    support are missing, implement a truthful disconnected/coming-soon
    state and document what is needed.
7.  Do not expose secrets in browser state, local graph JSON, logs, or
    API responses.
8.  Use real persistence when the repository provides it. If a UI
    prototype must use fixtures, isolate them clearly and state what
    remains to be integrated.
9.  Before implementing a third-party publishing or messaging action,
    verify the current repository's integration service and use official
    APIs/permissions. Do not bypass provider restrictions.
10. Keep the existing dark theme and visual language from the supplied
    PostGear dashboard screenshot: near-black page background, charcoal
    cards, blue primary actions, high-contrast text, compact status
    cards, rounded panels, and persistent left navigation. Reuse
    existing tokens instead of hard-coding new colors if tokens exist.

## Step 1 --- Report the repository baseline

Before making code changes, provide a concise summary: - Framework and
version. - Routing approach. - UI component/styling system. -
Database/ORM and relevant models. - Existing post creation, queue,
scheduler, and social integrations. - Existing AI/media generation
services. - Recommended files to change/add. - Risks or unknowns.

Then proceed with implementation without waiting unless a genuinely
blocking ambiguity or destructive decision exists.

## Step 2 --- Add navigation and page shells

Add **Carousel Studio** and **Workflow Builder** to the existing sidebar
using its current icon, spacing, and active-state conventions. Create
routes/pages using the existing routing system. Ensure existing pages
continue to work.

## Step 3 --- Implement Carousel Studio

Build in this order: 1. Recent designs landing page and Create new
action. 2. Brand setup form with optional website URL, manual colors,
and logo. 3. Safe website brand-extraction endpoint/service if the
backend supports it. Apply SSRF protections, timeouts, response-size
limits, and user confirmation before applying extracted data. 4. Format
selection. 5. Searchable template gallery with a scalable template
schema. Seed a small, polished initial set if appropriate; make the
gallery architecture support 100+ templates. 6. Multi-slide editor with
canvas, slide list, element properties, and supported constraints. 7.
Persistence/autosave and clear save/error states. 8. Preview and ordered
image export. 9. Connect to the existing queue/scheduler only through
existing services and supported capabilities.

Do not attempt a full Canva clone. Focus on reliable template-driven
editing and polished UX.

## Step 4 --- Implement Workflow Builder

Build in this order: 1. Workflow list and create/edit page. 2. Node
canvas using a suitable library already installed in the repository; if
none exists, evaluate a maintained node-editor library compatible with
the current stack before adding a dependency. 3. Versioned graph data
model with nodes, ports, and edges. 4. Searchable node library, node
configuration panel, graph save/load. 5. Connection compatibility checks
and workflow validation. 6. Manual test-run engine for safe,
deterministic nodes. 7. Run history and per-node logs. 8. Integration
connection status and secure secret references. 9. Add real provider
nodes only when corresponding server-side integrations are available.
10. Add AI content nodes using existing AI services where possible, with
output review before publishing.

Use these conceptual example flows for UX and test fixtures: - Post
Published → Append Spreadsheet Row → Notify Teams/Slack. - Schedule
Trigger → AI Generate Caption → AI Generate Image → Manual Review → Save
Draft/Add to Queue. - Post Failed → Filter Error Type → Send
Notification.

## Step 5 --- Engineering expectations

-   Validate all user input on the server for consequential operations.
-   Keep API handlers thin and reuse service-layer logic.
-   Use background jobs for long-running workflows, media generation,
    scraping, and exports where the architecture supports them.
-   Prevent duplicate side effects using idempotency or deduplication
    where feasible.
-   Apply authorization checks to all workspace resources.
-   Handle loading, empty, success, offline, and error states.
-   Add schema validation and useful user-facing errors.
-   Add unit/integration tests for graph validation, persistence, and
    critical flows.
-   Add accessibility labels and keyboard focus states.
-   Avoid unnecessary dependencies.
-   Do not hard-code credentials, provider IDs, user IDs, or production
    URLs.
-   Do not mark TODO-only or mock-only features as complete.

## Step 6 --- Verify

Run the repository's available lint, type-check, test, and build
commands. Fix regressions introduced by your changes. If a command
cannot run, state the exact command and reason.

Manually verify: - Sidebar navigation and route access. - Carousel
creation, edit, save, reopen, preview, and export. - Workflow creation,
node connection, save/reopen, validation, and safe test run. -
Responsive layout and dark theme. - No false success state for
unavailable integrations. - No secret leakage in graph data or logs.

## Step 7 --- Final report

At the end, report: - Features implemented. - Files changed. - Database
migrations or environment variables required. - Tests and commands run,
with results. - Integrations that are real versus placeholders/coming
soon. - Known limitations and recommended next steps.

## Definition of success

The feature must look and feel native to PostGear, be built on the
existing architecture, and deliver the two core experiences: branded
template-driven carousel creation and a visual automation workflow
editor. Prefer a smaller working implementation with honest integration
states over a broad demo that only looks functional.
