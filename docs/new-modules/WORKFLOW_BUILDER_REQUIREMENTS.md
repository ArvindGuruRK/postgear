# PostGear Workflow Builder --- Detailed Requirements

## 1. Purpose

Workflow Builder is a visual automation module for post-scheduling and
related operations. Users connect nodes on a canvas to describe an
automation such as:

**Post published → append a row to a spreadsheet → notify a
Teams/Slack/WhatsApp destination**

or:

**Schedule trigger → AI content generation → generate/select visual
assets → human review → add to PostGear queue**

The visual editor should be inspired by node-based automation products,
but PostGear must implement its own UI and logic using the existing
repository's conventions.

## 2. Core concepts

-   **Workflow:** saved automation definition.
-   **Node:** trigger, action, condition, transformation, or utility
    step.
-   **Port:** typed input/output connection point on a node.
-   **Edge:** directed connection between compatible ports.
-   **Run:** one execution of a workflow.
-   **Trigger:** event or schedule that starts a run.
-   **Execution context:** data available to each node during a run.
-   **Integration connection:** authenticated connection to an external
    provider.

## 3. Main screen layout

### Header

-   Workflow name (editable).
-   Save status.
-   Draft/Active/Paused status.
-   **Test workflow**, **Activate/Pause**, and overflow menu.
-   Do not activate automatically after saving.

### Left panel --- Node library

Search field and categories: - Triggers. - PostGear. - Social
platforms. - AI & content. - Logic. - Data & spreadsheets. -
Notifications. - Utilities.

Each node card shows icon, name, concise description, availability
state, and whether an account connection is required.

### Center --- Canvas

-   Drag-and-drop nodes.
-   Connect output ports to compatible input ports.
-   Pan and zoom.
-   Fit to screen.
-   Select, move, duplicate, and delete nodes.
-   Add node from a connection affordance.
-   Minimap if practical.
-   Empty state with a starter example and "Add trigger" action.

### Right panel --- Node configuration

-   Node name/type.
-   Required fields.
-   Account/connection selector.
-   Input mapping from previous nodes.
-   Output preview/schema where available.
-   Help text, validation errors, and test action.
-   Secret values should be masked and never stored in plain graph
    configuration.

### Bottom/drawer --- Run inspector

-   Run status and duration.
-   Node-by-node execution list.
-   Input/output summaries with sensitive values redacted.
-   Retry eligible failed steps where safe.
-   Copyable error details without secrets.

## 4. Node types and examples

### Triggers

-   **Post Published:** starts when a PostGear publishing event
    succeeds.
-   **Post Failed:** starts when a publishing attempt fails.
-   **Schedule:** runs at a configured time/interval.
-   **Webhook:** starts from a verified incoming webhook.
-   **Manual Trigger:** starts when a user clicks Test/Run.

### PostGear actions

-   Create draft post.
-   Add post to queue.
-   Schedule post.
-   Publish post through existing supported publishing services.
-   Retrieve post status/metadata.

### Social platform nodes

Potential providers: Instagram, Facebook, X. Implement only actions
supported by the platform's official API, account type, scopes, and
current provider policies. Clearly show connection/setup requirements
and unsupported actions.

### AI & content nodes

-   Generate text/caption.
-   Generate hashtags.
-   Generate image.
-   Generate video (only when a configured provider supports it).
-   Generate carousel slide content.
-   Summarize or transform text.
-   Brand voice rewrite.

Every AI node should define output type, model/provider configuration
where applicable, prompt, optional brand profile, and constraints.
Generated content should be reviewable before a publishing side effect.

### Logic nodes

-   If/Else condition.
-   Filter.
-   Merge (define merge semantics explicitly).
-   Delay/wait.
-   Format/transform data.
-   Manual review gate.

### Data nodes

-   Spreadsheet: append row, read rows, or update row when supported.
-   Webhook/API request with allowlisted destinations and safe defaults.
-   Database nodes only if the product has a safe, scoped integration
    model.

### Notification nodes

-   Microsoft Teams.
-   Slack.
-   WhatsApp through an approved provider/API.
-   Email if supported.

Do not show any integration as connected unless a valid connection
exists. Do not promise delivery until the provider confirms success.

## 5. Example workflows

### Example A --- Publishing report

1.  Trigger: Post Published.
2.  Action: Append row to spreadsheet.
3.  Action: Send Slack or Teams notification.
4.  End: execution log records the result.

Suggested row fields: post ID, platform, account, caption/title,
published time, permalink when available, status, and error summary if
relevant.

### Example B --- AI-assisted post creation

1.  Trigger: Schedule or Manual Trigger.
2.  AI node: Generate content using a prompt and selected brand profile.
3.  AI image/video node: Generate asset if configured.
4.  Manual Review node: user checks generated content.
5.  PostGear action: save as draft or add to queue.
6.  Optional notification node: report completion.

Do not publish AI output automatically by default. Make auto-publishing
an explicit opt-in and require a successful test/validation.

### Example C --- Failed post alert

1.  Trigger: Post Failed.
2.  Condition: failure type matches selected criteria.
3.  Notification: Teams/Slack/WhatsApp.
4.  Optional spreadsheet action: append incident row.

## 6. Graph validation

Before a workflow can be activated, validate: - At least one valid
trigger exists. - All required node fields are configured. - Edges
connect compatible ports. - Required integration connections exist. -
There are no invalid node references or dangling edges. - Cycles are
rejected unless the engine explicitly supports bounded loop semantics. -
Publishing actions have destination account and content inputs. - Manual
review and error paths are configured where required by the chosen
workflow policy. - The workflow does not contain unsupported node
versions.

Display validation results with direct navigation to the node needing
attention.

## 7. Execution semantics

-   Persist workflow graph versions.
-   A run uses a fixed workflow version so edits do not mutate an
    in-progress run.
-   Execute nodes according to dependencies, not canvas position.
-   Store run and per-node statuses: queued, running, succeeded, failed,
    skipped, cancelled.
-   Support timeouts and provider rate limits.
-   Retry only retryable failures and avoid duplicate side effects.
-   Use idempotency keys for publishing or other non-repeatable
    operations where available.
-   Treat external webhooks as untrusted input and validate
    signatures/tokens.
-   Redact secrets and sensitive payload values from logs.
-   Record start/end timestamps, duration, node status, and a useful
    error summary.
-   Provide cancellation for eligible runs.
-   Use background jobs for long-running operations.
-   Enforce workspace/user authorization for workflow edits, activation,
    connections, and run history.

## 8. Security requirements

-   Never place access tokens, refresh tokens, API keys, or passwords in
    client-visible workflow JSON.
-   Store credentials in the existing secure secret/connection system.
-   Prevent SSRF in webhook/API nodes; block private/internal addresses
    and unsafe redirects unless explicitly supported by a trusted
    internal mechanism.
-   Use allowlists and scoped permissions where practical.
-   Validate node configuration server-side.
-   Rate-limit manual runs and webhook triggers.
-   Apply quotas to AI/media generation.
-   Prevent a user from running or viewing another workspace's workflow
    without authorization.
-   Require confirmation for activation and workflows that can publish
    or message external recipients.

## 9. MVP delivery phases

### Phase 1 --- Visual foundation

-   Workflow list and create flow.
-   Canvas with move/connect/delete/zoom.
-   Node library and configuration side panel.
-   Save/load graph.
-   Draft status and validation.

### Phase 2 --- Safe test runs

-   Manual trigger.
-   A small set of deterministic internal nodes.
-   Run history and node-level logs.
-   Test mode that avoids real publishing or external messages.

### Phase 3 --- First real integrations

-   PostGear post event trigger.
-   Spreadsheet append action.
-   One notification provider (choose based on existing
    credentials/customer demand).
-   Secure connection management.

### Phase 4 --- AI and social actions

-   AI text and asset generation.
-   Manual review gate.
-   Additional official social platform integrations.
-   Scheduling/publishing actions backed by existing PostGear services.

### Phase 5 --- Reliability and scale

-   Retries, idempotency, rate limiting, cancellation, quotas,
    monitoring, versioning, and recovery tooling.

## 10. Acceptance criteria

1.  Users can create, rename, save, reopen, duplicate, and delete
    workflows.
2.  Users can add nodes from the searchable library and connect
    compatible ports.
3.  Invalid connections are blocked or clearly marked.
4.  Node settings persist when the workflow is saved and reopened.
5.  Validation identifies missing configuration and broken connections.
6.  Test runs show run status and node-level outcomes.
7.  Failed nodes show actionable errors without exposing secrets.
8.  Activating a workflow requires explicit confirmation.
9.  Integration connection states are truthful and distinguish
    disconnected/available/coming soon.
10. AI-generated content can be reviewed before any publishing action.
11. External side effects cannot run in test mode unless explicitly
    designed and confirmed.
12. The interface follows PostGear's current dark UI and sidebar.
