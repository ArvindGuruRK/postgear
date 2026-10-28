# PostGear User Stories & End-to-End Product Walkthrough

**Product:** PostGear\
**Scope:** Carousel Studio and Workflow Builder\
**Audience:** Product, design, frontend, backend, QA, and AI coding
agents\
**Purpose:** Define how users discover, configure, use, and complete
work in both modules.

------------------------------------------------------------------------

## 1. Product context

PostGear is a social media management SaaS application. Users can create
branded social content, schedule and publish posts to supported social
accounts, and automate post-related tasks from a single workspace.

The existing application has a dark dashboard, persistent left sidebar,
top navigation, summary cards, queue and comments panels, and
connection/error banners. New modules must feel like natural extensions
of this product.

### Product principles

1.  **Familiarity:** Reuse PostGear's existing navigation, components,
    theme tokens, typography, spacing, and interaction conventions.
2.  **Progressive disclosure:** Show only the information needed for the
    current step; place advanced settings behind expandable sections.
3.  **Save safely:** Preserve user work, show honest save status, and
    warn before losing unsaved changes.
4.  **Be explicit:** Distinguish draft, ready, scheduled, published,
    failed, and disconnected states.
5.  **Trust over illusion:** Never display a successful publish,
    connection, save, or workflow run unless it actually succeeded.
6.  **Accessible by default:** Use keyboard-accessible controls, visible
    focus, readable contrast, labels, and non-color status cues.
7.  **Integrate incrementally:** Build reusable foundations first, then
    connect providers through supported official APIs.

## 2. Roles and assumptions

### Primary user

A social media manager, small-business owner, marketer, creator, or
agency team member who needs to produce branded posts and automate
repetitive publishing tasks.

### Optional workspace roles

Use the roles already supported by the application. If role-based
permissions exist, map actions to them rather than creating a parallel
permission system. A future role model may include Owner, Admin, Editor,
and Viewer.

### Preconditions

-   The user is authenticated.
-   The user has access to a PostGear workspace.
-   The user has appropriate permissions to create designs and
    workflows.
-   Integrations may or may not be connected.
-   AI generation and social publishing depend on configured services,
    available credits, account permissions, and provider policies.

## 3. Global navigation and shared experience

### Entry points

Add two sidebar destinations: - **Carousel Studio** - **Workflow
Builder**

Keep existing navigation items and dashboard behavior unchanged.

### Shared behavior

-   Page title and breadcrumb where consistent with the existing app.
-   Primary action placed consistently in the page header.
-   Search, filters, and empty states when relevant.
-   Clear loading, saving, success, warning, offline, and error
    feedback.
-   Toasts for brief confirmations; inline errors for field-level
    issues; persistent banners for unresolved connection or publishing
    issues.
-   Destructive actions require confirmation where recovery is not
    available.
-   Opening a module must not clear unsaved work in another module
    without warning.
-   Use the current workspace and authenticated user context.

------------------------------------------------------------------------

# Part A --- Carousel Studio User Journey

## 4. User goal

As a social media manager, I want to create branded multi-slide
carousels from reusable templates, customize the design, preview it, and
export it or send it to PostGear's queue without using a separate design
tool.

## 5. Journey overview

**Carousel Studio → Recent designs → Create new → Brand setup → Format →
Template gallery → Editor → Preview → Export / Send to Queue**

Users may also reopen a saved draft from Recent designs.

## 6. Detailed step-by-step walkthrough

### Step 1 --- Open Carousel Studio

**User action** - Clicks **Carousel Studio** in the left sidebar.

**System response** - Opens the Carousel Studio landing page. - Shows
recent designs, saved/favorite templates if available, search/filter
controls, and a prominent **Create new** button. - If the user has no
designs, shows an empty state explaining the benefit and a clear CTA.

**Acceptance criteria** - Sidebar active state reflects the current
route. - Existing dashboard navigation remains functional. - The page
has loading, populated, and empty states.

### Step 2 --- Start a design

**User action** - Clicks **Create new**.

**System response** - Creates a draft session or starts the new-design
wizard. - Presents brand setup as the first step. - Shows progress (for
example: Brand → Format → Template → Edit → Preview).

**Acceptance criteria** - The user can cancel or return to previous
steps without losing entered data. - If a draft is created in the
backend, its state is shown accurately.

### Step 3 --- Configure brand identity

**User action** - Enters brand name (optional but recommended). -
Optionally enters a public website URL. - Optionally uploads a logo. -
Selects primary, secondary, and accent colors with text fields or a
color picker. - Optionally adds brand notes or voice guidance.

**System response** - If a website URL is provided, offers **Extract
brand details**. - If no URL is provided, allows manual setup and
continuation. - Extracted data is shown as suggestions that the user can
edit and confirm. - Extraction failures provide a useful explanation and
a manual fallback.

**Acceptance criteria** - Website URL is validated. - Extraction does
not silently overwrite user-entered brand details. - The user can
proceed without a website. - Unsafe destinations are blocked
server-side; extraction has timeouts and size limits. - Logo upload
validates file type and size.

### Step 4 --- Choose output format

**User action** - Selects Square (1:1), Portrait Feed (4:5), Landscape
(16:9), or Story/Reel (9:16).

**System response** - Displays the selected dimensions and relevant
platform guidance. - Preserves the selected format when the user browses
templates unless a template does not support it.

**Acceptance criteria** - Aspect ratio and pixel dimensions are
explicit. - Unsupported combinations are disabled or explained. -
Platform recommendations are configurable and not presented as universal
guarantees.

### Step 5 --- Browse and choose a template

**User action** - Searches, filters by category/format, views template
details, and selects a template.

**System response** - Shows template cards with thumbnail, name,
category, slide count, and supported formats. - Provides categories such
as Educational, Tips, Announcement, Product, Case Study, Listicle,
Quote, Data/Statistics, Promotional, and Storytelling. - Creates a new
editable design copy from the selected template.

**Acceptance criteria** - Initial gallery can contain 30--40 templates
and scale to 100+. - Selecting a template never edits the shared master
template. - The gallery supports loading, no-results, and error
states. - A Start from Blank option may be included if feasible.

### Step 6 --- Edit the carousel

**User action** - Edits headlines, subheadlines, body copy, footer/CTA,
logo, images, background, and supported style properties. - Adds,
duplicates, deletes, reorders, and selects slides. - Uses undo/redo and
reset-to-template when available.

**System response** - Displays slide thumbnails on the left, the active
canvas in the center, and contextual properties on the right. - Shows
clear region boundaries for constrained elements. - Autosaves changes
and shows Saving, Saved, Offline, or Error status truthfully. - Warns if
the user tries to leave with unsaved changes.

**Acceptance criteria** - Text editing is possible inline and/or through
accessible properties. - Elements respect template constraints and safe
margins. - Slide order and element content persist after reopening. -
Undo/redo does not silently discard persisted changes. - The editor
handles empty, loading, save-failure, and asset-loading states.

### Step 7 --- Preview

**User action** - Clicks **Preview**.

**System response** - Shows the complete carousel in order and the
selected dimensions. - Provides a platform-style preview where
supported. - Clearly labels illustrative engagement UI as a mock
preview. - Allows the user to return to editing without losing changes.

**Acceptance criteria** - Preview reflects saved/current editor state. -
No preview implies that content has been published. - All slides are
accessible in sequence.

### Step 8 --- Export or send to queue

**User action** - Chooses **Export** or **Send to Queue**.

**Export system response** - Renders all slides at the selected
dimensions. - Provides ordered files or a bundle, depending on the
existing export capabilities. - Shows progress, completion, and
recoverable errors.

**Queue system response** - Opens the existing PostGear
destination/account and scheduling flow. - User selects supported
destination accounts, caption, date/time, and other required publishing
details. - User reviews and confirms the action.

**Acceptance criteria** - Exported files are ordered and have
predictable filenames. - Send to Queue is available only when the
existing publishing path supports it. - The system never marks a post as
scheduled or published before backend confirmation. - Unsupported
destinations have a clear explanation and an export fallback.

### Step 9 --- Return and continue later

**User action** - Returns to Carousel Studio and opens a recent draft.

**System response** - Restores the design, slides, assets, format, and
supported edit state. - Displays its current status and last-updated
timestamp.

**Acceptance criteria** - Saved work is recoverable after navigation or
a new session. - Access is restricted to authorized workspace members.

------------------------------------------------------------------------

# Part B --- Workflow Builder User Journey

## 7. User goal

As a social media manager, I want to connect triggers, post actions, AI
steps, data tools, and notifications in a visual workflow so that
PostGear can handle repetitive publishing-related tasks reliably.

## 8. Journey overview

**Workflow Builder → Create workflow → Name it → Add trigger → Add
actions → Connect nodes → Configure → Validate → Test → Activate →
Monitor runs → Edit/Pause**

## 9. Detailed step-by-step walkthrough

### Step 1 --- Open Workflow Builder

**User action** - Clicks **Workflow Builder** in the sidebar.

**System response** - Shows saved workflows with name, status, last run,
last modified time, and recent outcome. - Provides **Create
workflow**. - Offers search/filter by status if useful. - Shows an empty
state with example workflows for first-time users.

**Acceptance criteria** - Draft, Active, and Paused states are
visible. - Failed recent runs are discoverable. - The list only shows
workflows the user is authorized to access.

### Step 2 --- Create a workflow

**User action** - Clicks **Create workflow** and enters a workflow name
and optional description, or chooses a starter template.

**System response** - Opens the visual canvas with an initial trigger
placeholder. - Saves a draft workflow. - Shows the current save status
and a simple hint explaining how to add nodes.

**Acceptance criteria** - A workflow can be saved before it is
complete. - The user can rename it later. - Leaving with unsaved changes
triggers a warning.

### Step 3 --- Add a trigger

**User action** - Opens the node library, searches for a trigger, and
selects one, such as Post Published, Post Failed, Schedule, Webhook, or
Manual Trigger.

**System response** - Adds the trigger node to the canvas. - Opens its
configuration panel. - Explains required fields and whether an
integration connection is needed.

**Acceptance criteria** - The workflow graph has one or more valid
trigger nodes according to supported engine semantics; the MVP may
require exactly one trigger per workflow. - Required configuration is
validated. - Unsupported triggers are labelled Coming soon rather than
behaving as if operational.

### Step 4 --- Add and connect action nodes

**User action** - Adds actions such as Append Spreadsheet Row, Send
Teams/Slack Message, Generate AI Caption, Generate Image, Add to Queue,
or Schedule Post. - Connects output ports to compatible input ports.

**System response** - Shows valid connection targets. - Rejects or flags
incompatible ports. - Allows node repositioning without changing
execution order. - Shows an add-node affordance on connections if
supported.

**Acceptance criteria** - The execution order is determined by graph
dependencies, not visual position. - Nodes and edges persist when
saved. - Deleting a node handles connected edges predictably and asks
for confirmation if data loss is significant.

### Step 5 --- Configure node settings and mappings

**User action** - Selects a node and configures required fields. -
Chooses an authenticated account/connection. - Maps inputs from earlier
nodes (for example, published post URL → spreadsheet column). - Writes a
prompt for AI nodes and chooses output requirements.

**System response** - Displays required fields, helpful descriptions,
connection status, and input/output schemas where available. - Masks
secret values. - Shows field-level validation errors. - Provides
test/preview for nodes that can safely run in isolation.

**Acceptance criteria** - Configuration is saved in the workflow
version. - Credentials are referenced securely and are not embedded in
graph JSON. - A missing account connection is actionable. - Output
mappings validate against known node output schemas where possible.

### Step 6 --- Validate the workflow

**User action** - Clicks **Validate** or **Test workflow**.

**System response** - Checks trigger presence, node configuration,
connection compatibility, missing credentials, dangling edges,
unsupported nodes, and graph cycles. - Shows a validation summary and
direct links to problematic nodes.

**Acceptance criteria** - The workflow cannot be activated while
blocking errors remain. - Warnings are distinguished from errors. -
Validation runs server-side for activation-critical checks.

### Step 7 --- Test run safely

**User action** - Clicks **Test workflow** and supplies any required
sample input.

**System response** - Runs in test mode. - Shows
queued/running/succeeded/failed status for each node. - Displays safe
input/output summaries and actionable error messages. - Does not publish
a real post or send an external notification unless the user explicitly
chooses and confirms a test action designed to do so.

**Acceptance criteria** - Test runs are clearly marked as tests. - Logs
redact tokens and sensitive values. - Retry behavior avoids duplicate
side effects. - A failed run does not activate the workflow.

### Step 8 --- Activate the workflow

**User action** - Reviews validation and test results, clicks
**Activate**, and confirms the activation.

**System response** - Confirms the selected workflow version and trigger
behavior. - Sets the workflow to Active only after backend
confirmation. - Shows a clear Active status and activation timestamp.

**Acceptance criteria** - Activation requires explicit confirmation. -
The workflow is not activated if required connections or validation
checks fail. - The user can pause the workflow later.

### Step 9 --- Monitor workflow runs

**User action** - Opens a workflow's Run History and selects a run.

**System response** - Shows trigger time, duration, final status, and
node-by-node results. - Displays relevant logs and provider errors with
secrets redacted. - Provides Retry for eligible failures and explains
when retry may repeat an external action.

**Acceptance criteria** - Run history is scoped to authorized
users/workspaces. - Failed runs can be diagnosed without exposing
credentials. - Retrying is idempotent where possible and warns about
possible duplicate external effects when not guaranteed.

### Step 10 --- Edit, pause, duplicate, or delete

**User action** - Pauses an active workflow before making consequential
changes, edits it, tests, and reactivates it; or duplicates/deletes it.

**System response** - Preserves an immutable version for
existing/in-progress runs. - Makes the new draft version explicit. -
Requires confirmation before deleting workflows or their history if
deletion is destructive.

**Acceptance criteria** - In-progress runs use the workflow version with
which they started. - Pausing prevents new triggers but handles
in-progress runs according to a documented policy. - Delete and
duplicate actions are authorization-checked.

------------------------------------------------------------------------

# Part C --- Cross-module journeys

## 10. Journey: Create AI content and schedule it

1.  User opens Carousel Studio.
2.  User configures a brand profile or selects a saved one.
3.  User selects a template and edits a carousel.
4.  User uses AI assistance where available to draft text or create
    media.
5.  User reviews and edits generated output.
6.  User previews and exports or sends the design to the queue.
7.  User selects supported destination accounts and a schedule.
8.  User confirms.
9.  PostGear displays the actual queue/publishing status.

**Rule:** AI-generated content must not be silently published unless the
user has explicitly configured and activated a workflow that permits it.

## 11. Journey: Automate post-published reporting

1.  User opens Workflow Builder and creates a workflow.
2.  Adds Post Published trigger.
3.  Adds Spreadsheet Append Row action.
4.  Maps post ID, platform, account, caption, published timestamp, URL,
    and status to columns.
5.  Adds a Teams or Slack notification action.
6.  Connects and configures the notification account.
7.  Validates and test-runs using sample event data.
8.  Reviews the run output.
9.  Activates the workflow.
10. On future successful publish events, PostGear starts runs and shows
    their status in history.

## 12. Journey: Recover from a failed publishing action

1.  PostGear records a failed publish attempt.
2.  A configured Post Failed workflow starts.
3.  Optional condition node filters the error type.
4.  Notification node alerts the selected destination.
5.  Optional spreadsheet node records the incident.
6.  User opens the failed run, inspects the error, fixes the connection
    or post, and retries through the supported path.

------------------------------------------------------------------------

# Part D --- State, errors, and edge cases

## 13. Required UI states

Across both modules, handle: - Initial loading. - Empty
list/gallery/canvas. - Saving and saved. - Offline or save failure. - No
search results. - Missing permissions. - Disconnected integration. -
Provider rate limit. - Unsupported action. - AI/media generation in
progress, failed, or cancelled. - Export in progress, failed, or
completed. - Workflow validation error. - Workflow run queued, running,
succeeded, failed, or cancelled. - Stale or conflicting edits where
concurrent editing is supported.

Every error should explain what happened, what remains safe, and the
next action.

## 14. Important edge cases

-   Website extraction fails: continue with manual brand setup.
-   Logo or media upload fails: retain other form/editor state.
-   User loses network while editing: preserve local changes if the
    existing architecture permits, clearly mark unsaved work, and retry
    safely.
-   A template is retired: existing designs using it remain editable or
    provide a migration/fallback path.
-   A social account disconnects after workflow activation: pause or
    fail affected steps visibly; do not silently skip a publishing
    action.
-   A provider rate limit occurs: apply bounded retry/backoff and show
    status.
-   AI generation returns malformed output: validate and allow
    retry/edit.
-   A workflow has a deleted or unavailable node type: flag it and
    prevent activation until repaired.
-   A workflow is triggered twice for the same event: deduplicate where
    provider/event identifiers permit.
-   A user edits a workflow during a run: current run continues on its
    original version.
-   Export or publishing is cancelled: report the actual final state and
    avoid duplicate output/actions.

## 15. SaaS best practices

-   Respect workspace boundaries for all records and assets.
-   Reuse existing authorization and role checks.
-   Keep external credentials in a secure connection/secret store.
-   Use background jobs for long-running work.
-   Use retries with bounded backoff for transient failures.
-   Use idempotency/deduplication for non-repeatable actions.
-   Log actionable events while redacting secrets and sensitive data.
-   Track audit events for workflow activation, pausing, connection
    changes, and publishing actions where supported.
-   Keep integration availability explicit.
-   Support keyboard navigation and accessible status announcements.
-   Avoid relying on color alone for status.
-   Add telemetry only in line with the product's privacy policy and
    consent model.

## 16. Suggested user stories and acceptance checklist

### CS-01 --- Create design

**As a** social media manager, **I want** to start a new carousel, **so
that** I can create content for a campaign.

-   Given I can access Carousel Studio, when I select Create new, then
    the new-design flow opens.
-   Given I have no website URL, when I continue, then I can still
    create a design.
-   Given I have a URL, when extraction succeeds, then suggested brand
    values are shown for confirmation.

### CS-02 --- Customize template

**As a** creator, **I want** to customize a template, **so that** the
content matches my brand.

-   Given a template is selected, when I edit text/colors/logo, then the
    design updates.
-   Given I save and reopen the design, then the content and slide order
    are preserved.
-   Given an element has constrained bounds, when I move it, then it
    remains within its allowed region or a clear constraint message is
    shown.

### CS-03 --- Export or schedule

**As a** marketer, **I want** to export or schedule my finished
carousel, **so that** I can publish it.

-   Given export is supported, when I export, then all slides are
    produced in order.
-   Given scheduling is supported for the chosen account, when I confirm
    scheduling, then the queue status reflects backend confirmation.
-   Given scheduling is not supported, then I receive a clear
    explanation and can export instead.

### WB-01 --- Build workflow

**As a** social media manager, **I want** to connect trigger and action
nodes, **so that** repetitive tasks can run automatically.

-   Given I create a workflow, when I add and connect compatible nodes,
    then the graph can be saved.
-   Given an edge is incompatible, then the UI blocks it or marks it
    invalid.
-   Given I reopen a saved workflow, then its nodes, edges, and
    configuration are restored.

### WB-02 --- Validate and test

**As a** workflow creator, **I want** to validate and test a workflow,
**so that** I can identify problems before activation.

-   Given required configuration is missing, when I validate, then
    blocking errors identify the affected nodes.
-   Given I test a workflow, then node-level statuses and safe logs are
    shown.
-   Given test mode is active, then external side effects do not occur
    unless explicitly confirmed.

### WB-03 --- Activate and monitor

**As a** workflow owner, **I want** to activate and monitor a validated
workflow, **so that** I can trust its operation.

-   Given validation passes, when I confirm activation, then the
    workflow becomes Active only after backend success.
-   Given a run fails, then the run history explains the failure and
    provides a safe next step.
-   Given I edit the workflow, then existing runs remain associated with
    the version they started with.

------------------------------------------------------------------------

# Part E --- Suggested build checklist for an AI coding agent

## 17. Recommended implementation sequence

1.  Inspect existing architecture and summarize findings.
2.  Add sidebar entries and routes.
3.  Build Carousel Studio landing page and create flow.
4.  Add brand setup, template gallery, and template schema.
5.  Build editor, persistence, preview, and export.
6.  Build Workflow Builder list and canvas.
7.  Add graph persistence, node configuration, and validation.
8.  Add safe manual test execution and run history.
9.  Integrate one real event trigger and one real action end-to-end.
10. Add AI nodes through existing AI services.
11. Add remaining integrations incrementally.
12. Run tests, lint, type checks, and production build.

## 18. Final acceptance gate

Do not mark the feature complete unless: - Both modules are reachable
from the existing sidebar. - Main user journeys can be completed. -
Saved work survives navigation/reload. - Loading, empty, error, and
success states are implemented. - Workflow validation and safe test runs
work. - External integrations reflect real connection and execution
state. - Existing dashboard functionality has not regressed. - Tests and
build results are reported honestly. - Remaining limitations and
required configuration are documented.
