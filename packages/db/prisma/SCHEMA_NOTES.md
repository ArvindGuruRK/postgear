# Schema Notes

Companion to [`schema.prisma`](./schema.prisma). Written in Sprint 1 to answer
the question every later sprint hits within five minutes of opening that file:
**"is this model something we use, or leftovers?"**

## Where this schema came from

It is Postiz's production schema, adopted wholesale rather than redesigned: a
deliberate, one-time exception to this project's "reference, don't copy" rule,
recorded in [Sprint 1](../../../docs/sprint-documents/sprint-01-foundation-and-data-model.md).
The reasoning: a battle-tested multi-tenant schema is exactly the kind of
foundational, hard-to-get-right asset worth inheriting. Controllers, workflows,
UI and providers are still built fresh.

It arrived with **48 models**, more than half of which PostGear's MVP will never
touch. **27 were dropped** across two migrations (see
[Deliberately removed](#deliberately-removed)), leaving **21**. Sprint 2 added
one back (`OnboardingResponse`), so the file now holds **22**.

Every model still in the file is either MVP-active or a deliberate, justified
keep. If a table is here, it is here on purpose.

## Model status

Sprint numbers below refer to [`docs/sprint-documents/`](../../../docs/sprint-documents/).

### MVP-active

| Model | Role | First used |
|---|---|---|
| `Organization` | The tenant. Root of nearly every scoping query. | Sprint 2 |
| `User` | An account. **Not** tenant-scoped: a user may belong to many orgs, or none. | Sprint 2 |
| `UserOrganization` | The membership join table, carrying `role`. This is the name to use: do not invent a `Member`. | Sprint 2 |
| `OnboardingResponse` | The five onboarding survey answers, one row per user. **Not** tenant-scoped: collected before the workspace exists. | Sprint 2 |
| `Integration` | **A connected social channel.** The name is Postiz's history; read it as "channel" everywhere. Holds the encrypted OAuth `token`/`refreshToken`. | Sprint 3 |
| `Post` | One row **per platform target per thread part**. A cross-posted batch is tied together by `group`; thread/reply chains by `parentPostId`. There is no separate `PostItem` table. See [How a post is stored](#how-a-post-is-stored-sprint-4). | Sprint 4 |
| `Media` | Uploaded images/video: local disk in development, any S3-compatible store in production. | Sprint 4 |
| `Tags` / `TagsPosts` | Post labelling and its join table. | Not yet: PRD P1. Sprint 4 did not need it. |
| `Sets` | Saved groupings of channels, for "post to my usual five". | Not yet: PRD P2. |
| `Signatures` | Reusable sign-off blocks appended to post content. | Not yet: PRD P2. |
| `Errors` | Publish-failure records, surfaced in the queue UI. | Sprint 5 |
| `Notifications` | In-app notification feed. | Sprint 5 |
| `Subscription` | Billing plan + `totalChannels` entitlement. Gates channel connection. Sprint 8 added `status`, `currentPeriodEnd`, `trialEndsAt`, `scheduledTier`/`scheduledPeriod` and `lastStripeEventAt`; see [Sprint 8 additions](#sprint-8-additions). | Sprint 8 |
| `Credits` | AI usage metering. | Sprint 6 |
| `Customer` | **Not** the Stripe customer mapping: `Organization.paymentId` is. Kept as the client-grouping label on `Integration` (PRD "Agency mode", P1). | Not yet |
| `Webhooks` / `IntegrationsWebhooks` | Outbound webhooks and their channel scoping. Sprint 8 added `secret` (ciphertext), `events` and `disabled`. | Sprint 8 |
| `WebhookDelivery` | One attempt-series per event per hook (Sprint 8). | Sprint 8 |
| `ApiKey` | Public API keys, hashed (Sprint 8). Replaces the inherited single `Organization.apiKey`, which stays unused. | Sprint 8 |
| `BillingEvent` | Processed Stripe events, keyed on the event id (Sprint 8). | Sprint 8 |
| `NotificationCursor` | Per-(user, workspace) read marker for the notification feed (Sprint 8). | Sprint 8 |
| `OAuthApp` / `OAuthAuthorization` | PostGear acting as an OAuth *provider* for its public API. | Not yet: PRD P2. Sprint 8 built API keys instead. |
| `BrandKit` | A brand's name, logo and five colours. Several per workspace, one per client for an agency. See [Sprint 9 additions](#sprint-9-additions); fonts, Lock Brand Look and CTA defaults in [Sprint 9b additions](#sprint-9b-additions). | Sprint 9, 9b |
| `Design` | One post or carousel. Slides live in the `document` JSON, guarded by the design engine's Zod schema; `revision` is the optimistic lock. | Sprint 9 |
| `DesignShare` | A read-only share link to a design, token stored hashed. | Sprint 9 |
| `DesignFavourite` | A template starred by the workspace, keyed on the code-side preset id. | Sprint 9 |
| `Automation` | One workflow (the UI says Workflow). The draft lives in the `draftGraph` JSON, guarded by `@postgear/automation`'s graph schema; `draftRevision` is the optimistic lock; soft deleted. See [Sprint 10 additions](#sprint-10-additions). | Sprint 10 |
| `AutomationVersion` | An immutable snapshot of a workflow, made when it is turned on. Live runs read only these. | Sprint 10 (rows from Module 09) |
| `AutomationRun` / `AutomationRunStep` | One run of a workflow and each step's attempt in it, inputs and outputs redacted and capped. | Sprint 10 (rows from Module 07) |
| `AutomationConnection` | An outside app (Slack, Teams, Discord, secret HTTP headers, Google) linked to a workspace once and picked by any workflow. `credentials` is one encrypted blob, never returned; soft deleted. | Sprint 10 |

### Kept, though not yet used

| Model | Why it stays |
|---|---|
| `Comments` | Postiz's in-app post commenting. Plausible if team review lands post-MVP, and it costs nothing. |
| `Announcement` | Product announcement banner. Cheap and plausible. |

> If a later sprint activates one of these, move its row up to the table above
> rather than starting a third list.

## Conventions, and where the schema breaks its own

Follow these when **adding** models. Two of the four are not actually uniform
in the inherited file, so check before assuming.

1. **Primary keys are `String @id`, but the generator is not consistent.**
   16 models use `@default(uuid())`; only `Subscription`, `Integration` and
   `Post` use `@default(cuid())`. The rest have no default and are assigned by
   application code. Sprint 1's own planning doc calls the convention "cuid":
   that is wrong as a description of the file. **Use `uuid()` for new models**,
   matching the overwhelming majority; do not migrate existing tables to match.

2. **Tenant scoping is `organizationId`, except in two places.**
   14 models use `organizationId`. `Tags` and `Customer` use `orgId` for the
   identical concept. (`UsedCodes`, a third offender, was pruned.) Use
   `organizationId` in new models. The
   practical hazard is a query written from memory against the wrong one: it
   is a compile error with the generated Prisma types, so it fails fast, but
   expect to look it up.

3. **Soft delete is `deletedAt DateTime?`** and it is far more widespread than
   it first appears; 11 of the 22 models carry it: `Comments`, `Customer`,
   `Integration`, `Media`, `Notifications`, `OAuthApp`, `Post`,
   `Signatures`, `Subscription`, `Tags`,
   `Webhooks`. **Every read of these must filter `deletedAt: null`.** Prisma
   has no global soft-delete filter here, so this is on each query. Missing it
   is the single most likely data bug in this codebase.

4. **Timestamps are `createdAt DateTime @default(now())` and
   `updatedAt DateTime @updatedAt`.** `Integration.updatedAt` is nullable
   (`DateTime?`) where others are not: an upstream quirk, not a pattern.

## Field meanings that are not self-evident

- **`User.timezone` is a UTC offset in *minutes*, not an IANA zone name or
  index.** Postiz's client sends `String(dayjs.tz().utcOffset())`, and dayjs
  returns minutes: `0` = UTC, `-300` = US Eastern (EST), `330` = IST.
  An offset cannot represent DST on its own, so a "9am local" schedule stored
  this way drifts by an hour twice a year. If Sprint 5's scheduler needs DST
  correctness, add a nullable `timezoneName` (IANA string) *alongside* this
  field rather than reinterpreting it.
- **`User` is unique on `[email, providerName]`, not on `email`.** The same
  address can therefore exist once as `LOCAL` and again as `GOOGLE`.
  Sprint 2's auth code deliberately queries on **email alone** and reuses
  whichever row it finds, so a person who signed up with a password and later
  clicks "Sign in with Google" gets their existing account rather than a second
  one. The constraint still permits the split; the application refuses to
  create it. The safety condition is that both OAuth providers reject an
  unverified address: without that, matching on email would be an
  account-takeover path.
- **The `User` auth-lifecycle columns hold hashes, not tokens.**
  `activationTokenHash` and `passwordResetTokenHash` store the SHA-256 of the
  value that was emailed, so a database leak yields nothing usable. SHA-256
  rather than argon2 precisely because the column has to be searchable by
  equality: the tokens are 32 bytes of CSPRNG output, so there is no
  dictionary to slow down. (Contrast `Integration.token` below, where the
  random IV makes equality search impossible.)
- **Lockout state lives in Postgres, not Redis.** `failedLoginAttempts`,
  `lastFailedLoginAt` and `lockedUntil` are on `User` so that restarting or
  evicting Redis is not a lockout bypass. The per-IP request throttle is the
  ephemeral half and does live in Redis.
- **`Integration.token` / `refreshToken` are ciphertext**, not plaintext: see
  the next section.
- **`Integration.internalId`** is the *provider's* account id, unique per org
  (`@@unique([organizationId, internalId])`). `Integration.id` is ours.
- **`Post.group`** ties a cross-post batch together; **`Post.parentPostId`**
  builds thread/reply chains. Both are needed to reconstruct what a user
  thinks of as "one post".
- **`Post.state`** is the `State` enum (`QUEUE`, `PUBLISHED`, `ERROR`,
  `DRAFT`) driving the queue and calendar views. The schema's default is
  `QUEUE`; the composer always writes the state explicitly, and a person can
  only ever set `DRAFT` or `QUEUE`. See `apps/api/src/modules/posts/post-state.ts`
  for the transition table.

## How a post is stored (Sprint 4)

What a person calls "a post" is a **group**: one `Post` row for every channel
it targets, times every part of its thread, all sharing one `group` UUID minted
before the first row is written. Within one channel, each part points at the
part before it through `parentPostId`, so a channel's thread is a chain from
the row whose `parentPostId` is null.

```
group g ─┬─ X:        part 1 ← part 2 ← part 3
         └─ LinkedIn: part 1 ← part 2 ← part 3
```

Four columns carry more than their names say:

- **`Post.content` is a JSON document, not text or HTML**: the TipTap/ProseMirror
  shape defined in `packages/social-core/src/composer/document.ts`, restricted
  by the API's schema to paragraphs, one heading level, lists, bold, italic,
  links and line breaks. Read it with `parseDocument()`, which also accepts plain
  text from any other writer; get platform text with `renderPlainText()`. Never
  render it as HTML: nothing in PostGear does.
- **`Post.image` is a JSON array of media references, `[{"id": "<Media.id>"}]`**,
  and never a URL. The file behind an id is looked up when the post is read or
  published, so moving storage or changing the API's address does not strand
  every saved post. An id whose `Media` row has since been deleted is reported
  as a removed attachment, not silently dropped.
- **`Post.settings` is `{"customized": boolean}`** on the root row of each
  channel: whether that channel has its own content or follows the shared post.
  Provider-specific options (a YouTube title, a Pinterest link) belong beside it
  when they are built.
- **Rows are matched by position on edit, never by an id from the client.**
  Saving a thread updates each channel's rows in chain order, creates rows for
  new parts and soft-deletes surplus ones. The root row of each channel keeps its
  id through every edit and reorder, which is what Sprint 5's publish workflow
  can key on.

The whole group is written in one **serializable** transaction, and a save must
carry the `updatedAt` it loaded: a save from a stale copy is refused with a
409 rather than overwriting a newer one.

## How media is stored (Sprint 4)

- **`Media.path` and `Media.thumbnail` are storage keys** (`2026/09/<32 hex>.jpg`),
  not URLs. The configured backend turns a key into a public URL at read time.
  Keys are 128 random bits and never reused, which is what lets objects be served
  publicly with year-long immutable caching.
- **`Media.fileSize` is the stored size, after compression**: the upload's
  original size is not kept.
- **`mimeType`, `width` and `height`** (added in
  `20260914074756_sprint4_media_metadata`) are read from the stored file, so
  platform rules such as Instagram's JPEG-only and 4:5–1.91:1 limits can be
  checked without downloading it again. Video records its `mimeType` but no
  dimensions: PostGear does not probe video files yet.
- **`Media.name` is display text** from the original filename, cleaned of paths
  and control characters. It is never used to build a key or a path.
- **`Media.type` is `image` or `video`.** An animated GIF is an `image` with
  `mimeType` `image/gif`.

## The encryption boundary

`Integration.token` and `Integration.refreshToken` hold live OAuth credentials.
They are encrypted **at the repository layer** with AES-256-GCM: see
[`../src/crypto.ts`](../src/crypto.ts), built in Sprint 1 and **wired up in
Sprint 3**.

The repository is
[`apps/api/src/modules/channels/channels.repository.ts`](../../../apps/api/src/modules/channels/channels.repository.ts),
the first in the codebase. Two properties of it are worth knowing before writing
another one:

- **It selects explicitly, and the credential columns are not in the list.**
  `listForOrg()` cannot leak a token even by accident, because it never reads
  one. `getWithCredentials()` is the only method that decrypts, and exists for
  publishing and refreshing alone.
- **Disconnect empties the columns** rather than leaving live credentials in a
  soft-deleted row. `token` is `NOT NULL`, so the cleared value is `''`, which
  `decrypt()` would reject, and the repository handles explicitly.

Repository-layer, specifically, so that:
- callers above it always see plaintext and can never forget to decrypt;
- the database only ever holds ciphertext, so a dump or a Prisma Studio session
  leaks nothing usable;
- key rotation has exactly one place to change.

Two consequences that will otherwise bite:

- **Encrypted columns cannot be searched by equality.** A fresh random IV per
  call means the same token encrypts differently every time, so
  `where: { token: someValue }` never matches. Look rows up by `id` or
  `organizationId`.
- **Rotating `ENCRYPTION_KEY_AES256` orphans every stored token.** They become
  permanently undecryptable and affected channels must be re-connected. Use
  `isEncrypted()` to distinguish already-encrypted rows from pre-encryption
  plaintext when backfilling.

## Sprint 8 additions

Migration `20261016120000_sprint8_billing_notifications_api`. Additive only:
four tables, three enums, columns on three inherited models, nothing removed
or renamed. The design is in
[`docs/sprint-documents/sprint-08-contract.md`](../../../docs/sprint-documents/sprint-08-contract.md) §1.

- **`Subscription`** is now live. `status` (`SubscriptionStatus`:
  TRIALING / ACTIVE / PAST_DUE / CANCELED / INCOMPLETE), `currentPeriodEnd`,
  `trialEndsAt`, `scheduledTier` + `scheduledPeriod` (a downgrade waiting for
  the period end) and `lastStripeEventAt` (the ordering guard: an event older
  than it is ignored). The inherited columns keep their meanings:
  `identifier` is the Stripe subscription id, `cancelAt` the moment a
  scheduled cancellation ends access, `totalChannels` the channel
  entitlement; `Organization.paymentId` is the Stripe customer id and
  `Organization.isTrailing` means a trial is live. **Entitlement is computed
  on read** (`apps/api/src/modules/billing/plans.ts` → `resolveEntitlement`),
  so an expired trial is FREE without any job flipping it.
- **`BillingEvent`**: the primary key *is* the Stripe event id (`evt_…`, or
  `sim_…` in simulation). Inserted inside the same transaction as the state
  change, so a replayed event is a unique-constraint failure, not a second
  application.
- **`Notifications`** gained `type` (the catalogue in
  `apps/api/src/modules/notifications/notifications.types.ts`), `title`,
  `meta` (what an email needs beyond `content`) and `emailStatus`
  (`NotificationEmailStatus`): the row is an **outbox**; whoever writes the
  event sets `PENDING`, the API's dispatcher sends through the one mail path
  and records the outcome. `NotificationCursor` is the read marker per
  (user, workspace); no row means "unread is everything newer than the
  membership". `User.lastReadNotifications` (inherited) is unused.
- **`Webhooks`** gained `secret` (AES-256-GCM ciphertext of the HMAC signing
  secret: the worker needs the plaintext to sign, so it cannot be a hash;
  the UI sees it only at creation and rotation), `events` (a Postgres text
  array) and `disabled`. **`WebhookDelivery`** holds one row per event per
  hook, unique on `deliveryKey` (`<webhookId>:<event>:<subjectId>`) so a
  retried activity never enqueues twice; the worker's delivery workflow owns
  it from PENDING to DELIVERED or FAILED.
- **`ApiKey`**: `keyHash` is the SHA-256 of a `pg_…` secret of 30 random
  bytes, `prefix` the first 11 characters for identification, `revokedAt`
  instead of deletion, `lastUsedAt` written at most once a minute. The
  inherited `Organization.apiKey` (a single plaintext-equivalent key in the
  reference) is left in place and unused.

Every read of the new soft-deletable rows (`Webhooks`) still filters
`deletedAt: null`; the new tables cascade with their organization.

## Sprint 9 additions

Migration `20261027120000_sprint9_design_studio`. Additive only: four tables
and three enums, nothing changed on an existing model. The design is in
[`docs/sprint-documents/sprint-09-design-studio.md`](../../../docs/sprint-documents/sprint-09-design-studio.md).

- **`BrandKit`**: a name, a logo and five colours, several per workspace. An
  agency runs one kit per client, and the kit is what stops one client's logo
  reaching another client's post. `colors` is one JSON value rather than five
  text columns because the real contract is `brandColorsSchema` in
  `@postgear/design-engine`, and five nullable columns would make half a
  palette representable. `source` records whether the colours were typed in or
  read off a website. Editing a kit **changes new designs only**: a design
  copies the five colours into its own document when the kit is applied, and
  the editor offers Update Colours instead of rewriting approved work.

- **`Design`**: one post or carousel. The slides live in `document`, a JSON
  value validated on every read and every write by `designDocumentSchema`.
  There is deliberately no `DesignSlide` table:

  1. A design is edited and saved as a unit. The autosave fires 1.5 s after
     the last keystroke and writes the whole thing; a row per slide would turn
     one save into a dozen writes for no gain anyone can see.
  2. The shape is already defined, versioned (`schemaVersion` plus
     `upgrade()`) and `.strict()`-validated in the engine. A client cannot
     store a style, a URL or an unknown slot, so the column is a value, not a
     bag.
  3. Nothing queries inside it. Every list, filter and count the product needs
     reads a column: `title`, `format`, `status`, `updatedAt`.

  `revision` is the optimistic lock behind "This design changed in another
  tab." (DS-6.2): a `PATCH` carries the revision the editor loaded, a mismatch
  is a 409, and nothing is merged. `exportedMediaIds` holds one Media id per
  slide in slide order, and `lastExportedRevision` is the revision those were
  rendered from, which is how Send knows whether to re-export first.

  `lastSlideIndex` is the slide the editor reopens on. It is written only with
  a document save (the API clamps it to the slide count), so moving between
  slides never costs a write of its own.

- **`DesignShare`**: a read-only link for somebody without an account. Only
  `tokenHash` is stored, the same rule as activation and password-reset tokens
  (see [The encryption boundary](#the-encryption-boundary)): the token is shown
  once, at creation, and a database leak yields no working link.

  It has no `organizationId`, `updatedAt` or `deletedAt`, on purpose. A link is
  only ever reached through its design, whose `organizationId` scopes every
  query, and it goes with the design (`onDelete: Cascade`). It is never edited,
  only revoked, and `revokedAt` is that state: a soft-delete column beside it
  would be a second way to say the same thing. A deleted design's links stop
  resolving because the public route refuses a deleted design.
  `lastViewedAt` feeds "Last viewed 5 hours ago" in the Share dialog; the
  public route writes it at most once a minute per link, so a link passed
  around a team does not turn every page view into a write.

- **`createdById` is nullable on all three tables** (Prisma's default for an
  optional relation, `SET NULL`). Kits, designs and links belong to the
  workspace, not to the member who made them, so deleting a user row never
  takes a client's brand kit or an approved carousel with it.

- **`DesignFavourite`**: a starred template, unique per (workspace, preset), so
  Favourites is a team filter rather than something in one person's browser.

**`presetId` on `Design` and `DesignFavourite` is plain text, not a foreign
key.** Templates are data in code (`packages/design-engine/src/presets/`),
reviewed and versioned with git, so there is no templates table to point at.
That is also what makes "choosing a template never changes the template" true
by construction: a design holds its own copy of the content from the moment it
is created, and the preset id is a provenance label used by Reset.

**Slide layouts are versioned inside the document**, as `"split-picture@1"`.
An old version stays in the code library when a layout changes, so a design
made a year ago still renders the way its author saw it; moving it forward is
a deliberate step in `upgrade()`.

## Sprint 9b additions

Migration `20261028120000_sprint9b_brand_kit_fonts_and_cta`. Additive only:
five columns on `BrandKit`, each nullable or defaulted, so every existing kit
keeps working. The design is in
[`docs/sprint-documents/sprint-09b-studio-premium-pack.md`](../../../docs/sprint-documents/sprint-09b-studio-premium-pack.md).

- **`headingFont` and `bodyFont`** are font ids from the design engine
  (`FontId`), null meaning "keep the theme's". They are plain text rather than
  an enum because the font library is code that grows without a migration;
  the API checks every id against the engine's `FONT_IDS` on write, the same
  way `Design.presetId` is a code id and not a foreign key. Applying a kit
  copies them into the design's own document (`brand.fonts`), so, like the
  colours, editing a kit changes new designs only until Update is pressed.
- **`lockLook`**: while a locked kit is applied to a design, the design's
  colours, logo and fonts are the kit's alone. It is enforced in the editor
  (the controls are hidden), not by refusing saves, because the kit's own
  colours and fonts are already in the document.
- **`ctaText` and `ctaUrl`**: what a new design's closing slide asks for and
  where it points, filled in once at creation and the design's own after.

## Sprint 10 additions

Migration `20261029120000_sprint10_workflow_builder`. Additive only: four
tables and four enums, nothing changed on an existing model. The UI says
Workflow and Step; the code and these tables say Automation and node. The
design is in
[`docs/sprint-10/workflow-implementation-docs/`](../../../docs/sprint-10/workflow-implementation-docs/README.md)
(Module 03). The run tables are created before anything runs, so the run
engine (Module 07) only adds code.

- **`Automation.draftGraph`** is one JSON value, for the reasons
  `Design.document` is: the builder autosaves the whole graph, and the shape is
  defined, versioned (`schemaVersion` plus `upgradeGraph`) and `.strict()`
  validated by `automationGraphSchema` in `@postgear/automation` on every
  write. The API also refuses any graph holding something that looks like a
  secret (`findSecretLikeValues`): **secrets never live in graph JSON**, they
  go in a connection. `draftRevision` is the optimistic lock, as in Studio: a
  stale save is a 409 with the current revision, and nothing is merged.
- **`pinnedData` lives on the row, not in the graph**, so a version never
  carries test data and a live run can never read it. It is redacted and
  capped at 64 KB per step before it is stored.
- **`triggerType`, `lastRun*` and `hasUnpublishedChanges`** are copies kept
  for the list, so listing workflows never parses a graph or scans runs.
  `hasUnpublishedChanges` only flips for an active or paused workflow whose
  draft differs from its active version.
- **`AutomationVersion.graph` is never updated after insert.** Turning a
  workflow on snapshots the draft; live runs read only versions, so editing a
  live workflow's draft never changes what is running.
- **REJECTED and EXPIRED are outcomes, not failures.** A Manual Review that
  says no, or that nobody answers in time, ends the run that way; the list and
  `consecutiveFailures` (the auto-pause counter) count only `FAILED`.
- **`graphSnapshot` on TEST runs**: a test runs the draft as it was at that
  moment; keeping it lets the run inspector paint the right graph after the
  draft moves on. Live runs point at their version instead.
- **`triggerEventId`** dedupes trigger events (`post.published:<rootPostId>`,
  Module 09) through `@@unique([automationId, triggerEventId])`. Manual and
  test runs leave it null, and Postgres lets many nulls share a unique index.
- **`nodeName` and `nodeType` are copied onto each run step**, so a step that
  was renamed or deleted since still reads correctly in old runs.
- **Run rows cascade from `Automation`**, which is itself soft deleted: the
  rows go only when the 30-day prune hard deletes it. `organizationId` is
  copied onto `AutomationRun` so workspace-wide run queries need no join.
- **User columns are nullable, `ON DELETE SET NULL`** (`createdById`,
  `updatedById`, `startedById`), as in Studio: a workflow belongs to the
  workspace, so deleting a user never takes it with them.
- **`templateId` is plain text**, like `Design.presetId`: starter templates
  are code in `packages/automation/src/templates`, not rows.
- **`options` and `seedOutputs` on test runs** (Module 07, migration
  `20261029140000_sprint10_automation_run_options`): `options` is
  `AutomationRunOptions` from `@postgear/scheduling` (whole run or one step,
  the steps sent for real, where the trigger data came from); `seedOutputs`
  holds the upstream data a step test reads. JSON, not columns, because only
  the API writes them and only the worker reads them, both through that type.
- **A review's decision lives in the step's `output`** (`AutomationReviewOutput`:
  decision, `decidedById`, `decidedAt`), not in columns: one step type uses
  it, and the run inspector already reads outputs.
- **`AutomationRunStep.ports`, `AutomationRun.temporalWorkflowId` and the
  `finishedAt` index** (Modules 08 and 09, migration
  `20261029160000_sprint10_runs_ports_and_schedules`, additive): `ports` are
  the output ports a finished step fired, so the run view lights the lines
  taken and Retry From Here seeds finished steps without running them again
  (a retry stores `options.retry` and the seeds in `seedOutputs`).
  `temporalWorkflowId` is set only on runs a Temporal Schedule starts, whose
  workflow id is not `automationRunWorkflowId(id)`. The index serves the
  30 day prune of finished runs.

### Connections (Module 04)

Migration `20261029130000_sprint10_automation_connections`, additive: the
`AutomationConnection` table and the `AutomationConnectionStatus` enum.

- **`credentials` is one encrypted blob**: the provider's credentials, already
  checked by its strict Zod schema, as one JSON value through `encrypt()`.
  Every provider has a different shape (a link, a list of headers, OAuth
  tokens), so one column keeps the table the same for all of them, and only
  one column has to be hidden from every select, every response and the
  read-only role (`infra/postgres/readonly-role.sql`). A step's config in the
  graph holds only the connection id.
- **`maskedHint` is computed once at save**, so listing connections never
  decrypts anything.
- **"Used by N workflows" is scanned, not stored.** The API reads the
  workspace's draft graphs and active version graphs and looks for the id.
  A join table would have to be rewritten on every autosave (every few
  seconds while someone edits), which is where drift comes from; tens of
  workflows of under 50 steps each are cheap to scan.
- **Names are unique per workspace and app among live rows**, checked by the
  API rather than an index, so a deleted connection's name can be reused.

## A user may legitimately belong to zero organizations

Signup collects credentials only; the workspace is created afterward, in a real
post-authentication onboarding flow (Sprint 1 Task 3a; built in Sprint 2).
"Authenticated but not onboarded" is therefore a real, persistable state.

The schema already permits it: `User.organizations` is a to-many relation with
no minimum cardinality, so **no migration is needed.** What is needed is
discipline in queries: nothing may assume `user.organizations[0]` exists.
Doing so is the classic way this pattern breaks, usually as a crash on the
first post-login page load.

The seed creates `onboarding@postgear.local` with **no** `UserOrganization`
row precisely so this path is reproducible from a plain `npm run db:seed`,
rather than something each developer has to hand-craft.

Route protection is correspondingly **two gates, not one**:
1. not authenticated → `/login` (the `(dashboard)` group layout);
2. authenticated but not onboarded → `/onboarding`, which must sit *between*
   that layout and the `[orgId]` layout, since an un-onboarded user has no org
   id to route with.

### Where onboarding-completion lives: decided (Sprint 2)

**`User.onboardingCompletedAt` (nullable timestamp), alongside
`User.onboardingStep` (1-based int) and a dedicated `OnboardingResponse` row.**

The cheaper option (deriving it from "has at least one `UserOrganization`")
was rejected, and the reason is worth keeping because it is not obvious until
the flow has more than one step. Onboarding is five steps, and **creating the
workspace is step 1**. A derived check therefore flips to "onboarded" the
instant step 1 completes: the route gate stops sending the user to
`/onboarding`, and steps 2 through 5 become unreachable. Someone who closes the
tab at step 3 would never be asked the rest.

`onboardingStep` records the furthest point reached and only ever moves
forward, so a resumed flow lands exactly where it stopped rather than
restarting or being inferred. `onboardingCompletedAt` is what route gate 2
actually tests.

The zero-organization state is unchanged and still real: it now spans from
"account created" to the end of step 1, rather than to the end of the whole
flow.

## Deliberately removed

**27 of the inherited 48 models were dropped**, across two migrations. They held
zero rows, the repo had a single prior migration, and no production database
existed, so this was the cheapest moment it would ever be. It is a deliberate
reversal of Sprint 1's original "leave dormant models in place" decision, whose
reasoning (avoiding migration churn) was load-bearing on having data to migrate.

### `20260905090442_prune_dormant_tier1_tier2`: 20 tables

| Removed | Was |
|---|---|
| `GitHub`, `Trending`, `TrendingLog`, `Star`, `ItemUser`, `PopularPosts` | GitHub-trending-repo tracking: a Postiz-specific content source with no PostGear equivalent. |
| `Plugs`, `ExisingPlugData` | Auto-engagement automations ("auto-reply to comments after N hours"). |
| `AutoPost` | RSS-feed-driven auto-posting. |
| `ThirdParty` | Generic third-party API credential storage. |
| `UsedCodes` | Redeemed lifetime-deal / promo codes. |
| `Mentions` | Mention autocomplete cache. |
| The 8 `mastra_*` tables | The Mastra agent framework's own runtime storage. PostGear's AI work does not use Mastra; several weren't even handled by Prisma Client. |

No surviving table lost a column here: 20 `DROP TABLE` plus 8 `DROP CONSTRAINT`
on the dropped tables themselves. Eight now-dangling back-relations went with
them (`Organization.github`, `Organization.autoPost`, `Organization.plugs`,
`Organization.thirdParty`, `Organization.usedCodes`, `User.items`,
`Integration.plugs`, `Integration.exisingPlugData`).

### `20260905091907_prune_marketplace_tier3`: 7 tables

`Orders`, `OrderItems`, `Messages`, `MessagesGroup`, `PayoutProblems`,
`SocialMediaAgency`, `SocialMediaAgencyNiche`: Postiz's creator marketplace
(buying sponsored posts from other users, with an escrow and messaging layer)
and its agency directory. Explicitly out of PostGear's scope.

This one **did** reach into surviving tables, which is why it was done
separately. `Post` lost four real columns, three FK constraints and three
indexes:

```
Post.submittedForOrderId          Post.approvedSubmitForOrder
Post.submittedForOrganizationId   Post.lastMessageId
```

Back-relations also removed from `Organization` (`buyerOrganization`,
`submittedPost`), `User` (`groupBuyer`, `groupSeller`, `orderBuyer`,
`orderSeller`, `payoutProblems`, `agencies`), `Media` (`agencies`),
`Integration` (`orderItems`) and `Post` (`payoutProblems`, `lastMessage`,
`submittedForOrder`, `submittedForOrganization`). Three enums became orphaned
and were dropped: `OrderStatus`, `From`, `APPROVED_SUBMIT_FOR_ORDER`.

One tidy-up rode along: `Post.organization` had a named relation
(`@relation("organization")`) that existed only to disambiguate it from
`submittedForOrganization`. With the latter gone the name was redundant, so it
was removed from both sides. Relation names are Prisma-side only: this produced
no SQL.

The payoff is that `Post` (the table every sprint from 4 onward reads most)
now contains only fields that mean something to PostGear.

### Before re-adding any of these

**Don't resurrect them from git history.** If a real requirement arrives for RSS
auto-posting, auto-engagement, or paid collaborations, design it fresh against
PostGear's needs. The originals were shaped for a different product, and their
column names carry assumptions that no longer hold here.

## Changing this schema later

The schema is **not frozen**. When a sprint needs a capability it does not
cover, such as SEO auditing (Sprint 7), AI copilot specifics (Sprint 6) or PostGear-only
analytics, that sprint adds models to this same file following the conventions
above, and updates the tables in this document.

Resist renaming inherited fields. `Integration` for "channel" and
`token`/`refreshToken` will keep reading oddly, but renaming a live schema's
fields is real migration risk for cosmetic gain. Add a clarifying comment in
`schema.prisma` instead.
