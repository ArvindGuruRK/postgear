# PostGear --- Product Requirements Document

**Document type:** Product requirements / implementation reference\
**Product:** PostGear\
**Status:** Initial build specification\
**Primary modules covered:** Social Media Carousel Builder and Workflow
Builder

## 1. Product vision

PostGear is a social media management platform that lets teams create
branded content, schedule and publish posts across supported social
networks, monitor performance, and automate repeatable
publishing-related workflows from one workspace.

The product already has a dashboard concept with a dark interface, left
navigation, blue primary actions, compact metric cards, and clear status
banners. New modules should feel native to that application rather than
like separate embedded products.

## 2. Existing product context

The dashboard screenshot shows: - A persistent left sidebar with Home,
Calendar, Copilot, Queue, Analytics, Media, SEO, and Settings. - A top
bar with search, theme control, notifications, and profile. - Summary
cards for Week Streak, Weekly Goal, AI Credits, and Team. - "Up Next"
and "Comments" panels. - Connection and publishing-error banners.

### Design principles to preserve

1.  Keep the existing dark theme as the default.
2.  Reuse the current sidebar, top bar, typography scale, spacing, card
    treatment, and blue primary-button styling.
3.  Use clear empty, loading, success, warning, disconnected, and error
    states.
4.  Avoid introducing a second design language inside the new modules.
5.  Make complex workflows understandable through progressive
    disclosure, tooltips, searchable galleries, and contextual side
    panels.
6.  Make layouts responsive; the canvas and node editor may use a wide
    desktop-first layout but must remain usable at narrower widths.

## 3. Product goals

-   Create branded social graphics and multi-slide carousels without
    requiring a separate design application.
-   Make template customization simple enough for non-designers.
-   Let users automate publishing-related processes visually using
    connected nodes.
-   Support AI-assisted text, image, and video generation as optional
    steps in content workflows.
-   Keep all content, workflows, assets, and publishing outcomes
    organized within PostGear.

## 4. Out of scope for the first release

Unless the existing codebase already supports them, do not attempt to
build all of the following in the first iteration: - A complete
replacement for Canva or a general-purpose design suite. - Every social
platform integration at launch. - A full enterprise approval-management
system. - Arbitrary user-written code execution in workflow nodes. -
Unrestricted web scraping or bypassing website access controls. -
Guaranteed publishing to a social platform without valid platform APIs,
permissions, and connected accounts.

Build extensible foundations and clearly label integrations that are not
yet operational.

## 5. Navigation

Add two sidebar entries: - **Carousel Studio** (preferred user-facing
label for the template/carousel module). - **Workflow Builder**.

Use the existing icon style and active navigation treatment. If the
product team prefers a more literal label, "Post Templates" is an
acceptable alternative for Carousel Studio.

## 6. Core entities

Use the existing project conventions and database patterns where
possible. Conceptually, the feature set needs:

-   **BrandProfile:** name, website URL, logo/assets, brand colors,
    typography preferences, optional brand notes.
-   **Template:** name, description, category, thumbnail, supported
    aspect ratios, editable regions, default design tokens, version.
-   **DesignDocument:** owner/workspace, template reference, brand
    profile, dimensions, slide list, editable content, asset references,
    timestamps.
-   **DesignExport:** design reference, output format, dimensions,
    storage location, export status.
-   **Workflow:** name, description, status, trigger, graph definition,
    owner/workspace, version.
-   **WorkflowNode:** stable ID, node type, configuration, canvas
    position.
-   **WorkflowEdge:** source node/port and target node/port.
-   **WorkflowRun:** workflow version, trigger payload, status,
    start/end times, logs, error summary.
-   **IntegrationConnection:** provider, account/workspace reference,
    connection status, securely stored credential reference.
-   **GeneratedAsset:** type, prompt/metadata, storage location,
    generation status, creator.
-   **ScheduledPost / PublishAttempt:** reuse existing entities if
    already present; do not create competing sources of truth.

## 7. Functional requirements

### 7.1 Carousel Studio

-   Show the user's recent designs and saved templates.
-   Provide a clear **Create new** action.
-   Allow users to select an existing design or start a new one.
-   Offer a brand setup step with website URL, brand name, logo, and
    color inputs.
-   If a website URL is supplied, attempt a bounded, respectful
    extraction of publicly accessible brand information. Show the
    extracted values for user confirmation; do not silently overwrite
    user-entered values.
-   If no website is supplied, allow manual brand setup and continue
    directly to the template gallery.
-   Provide a searchable/filterable template gallery with an initial
    target of 30--40 quality templates and a scalable path to 100+.
-   Support multi-slide carousel editing.
-   Support text, images, logo, background, colors, and supported layout
    properties.
-   Keep editable elements within defined regions unless the template
    explicitly allows free positioning.
-   Support aspect-ratio selection and platform-aware export presets.
-   Provide undo/redo, reset-to-template, save status, preview, and
    export.
-   Allow a finished design to be sent into PostGear's existing
    queue/scheduler when the relevant integration path exists.
-   Do not represent a design export as a published post.

### 7.2 Workflow Builder

-   Provide a visual node canvas with draggable nodes and connectable
    ports.
-   Support zoom, pan, fit-to-screen, minimap (if practical), selection,
    delete, duplicate, and keyboard shortcuts.
-   Include a searchable node library grouped by trigger, social
    platforms, content, AI, logic, data, notifications, and utilities.
-   Support node configuration in a side panel.
-   Validate required configuration and connection compatibility before
    activation.
-   Allow users to save a draft, validate, test-run, activate, pause,
    duplicate, and inspect run history.
-   Show node-level execution status and useful errors.
-   Store a versioned workflow graph.
-   Require explicit user action before activation or publishing side
    effects.
-   Provide a safe way to test workflows without publishing real posts.

### 7.3 AI nodes

-   Accept a prompt and optional context, brand profile, content source,
    output format, and constraints.
-   Support structured outputs such as text, image asset references,
    video asset references, captions, hashtags, and carousel slide
    content.
-   Allow a user to review generated output before publishing.
-   Track generation status, failures, and usage/credit consumption if
    the existing credit system supports it.
-   Do not assume that one model can generate every output type. Route
    requests through configured providers/capabilities.

### 7.4 Integration nodes

Initial node definitions should be extensible. Potential nodes
include: - PostGear publishing/scheduling trigger or action. -
Instagram, Facebook, and X actions where official APIs and permissions
support them. - Spreadsheet row append/read. - Microsoft Teams, Slack,
and WhatsApp notifications, subject to credentials, permissions,
provider policies, and API support. - Webhook trigger/action. -
Delay/schedule. - Filter/condition. - AI content generation. - Manual
review gate. - Log/output node.

A node in the gallery must clearly distinguish **Available**, **Requires
connection**, **Coming soon**, and **Unsupported for this account**.
Never display a fake "connected" state.

## 8. Non-functional requirements

-   Reuse the repository's established framework, component library,
    state management, API conventions, and authentication.
-   Use server-side validation for all important workflow and publishing
    actions.
-   Protect integration secrets; do not place tokens in client-side
    graph JSON or logs.
-   Use asynchronous jobs for long-running generation, exports,
    scraping, and workflow execution.
-   Make workflow runs idempotent where possible and guard against
    duplicate publishing.
-   Add timeouts, retry policies, rate-limit handling, and cancellation
    where appropriate.
-   Record actionable logs without exposing secrets or unnecessary
    personal data.
-   Ensure accessible keyboard focus, readable contrast, and labels for
    icon-only controls.
-   Add tests for graph validation, node configuration, persistence, and
    core user flows.
-   Avoid hard-coded mock data in production paths. If mock data is used
    for UI scaffolding, label it and isolate it behind a development
    fixture.

## 9. Success measures

-   A user can create and export a branded carousel without leaving
    PostGear.
-   A user can build, save, validate, and test a workflow.
-   A workflow run provides understandable status and error details.
-   Users can identify which integrations require setup before
    activation.
-   New templates and node types can be added without rewriting the
    editor.

## 10. Delivery strategy

1.  Inspect the existing repository and report its framework, routing,
    component library, data model, and current social publishing
    implementation.
2.  Implement navigation and page shells using existing patterns.
3.  Build Carousel Studio's gallery and editor with a small set of
    high-quality templates.
4.  Add brand profiles and export.
5.  Build the Workflow Builder canvas, graph model, node library,
    configuration panel, and validation.
6.  Add test execution and run history.
7.  Integrate actual providers one at a time using official APIs and
    secure connection handling.
8.  Expand template/node coverage based on verified requirements.

## 11. Definition of done

-   No existing dashboard features regress.
-   New pages match the PostGear visual language.
-   Core flows work with persistent data, or clearly identified
    development fixtures where backend integration is not yet available.
-   Empty/loading/error/success states exist.
-   Main flows have tests and are keyboard navigable.
-   No secret credentials are exposed in browser state, graph JSON, or
    logs.
-   Any unsupported platform action is clearly communicated rather than
    simulated as a successful operation.
