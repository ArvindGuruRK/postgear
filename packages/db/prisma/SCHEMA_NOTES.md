# Schema Notes

Companion to [`schema.prisma`](./schema.prisma). Written in Sprint 1 to answer
the question every later sprint hits within five minutes of opening that file:
**"is this model something we use, or leftovers?"**

## Where this schema came from

It is Postiz's production schema, adopted wholesale rather than redesigned — a
deliberate, one-time exception to this project's "reference, don't copy" rule,
recorded in [Sprint 1](../../../docs/sprint-documents/sprint-01-foundation-and-data-model.md).
The reasoning: a battle-tested multi-tenant schema is exactly the kind of
foundational, hard-to-get-right asset worth inheriting. Controllers, workflows,
UI and providers are still built fresh.

It arrived with **48 models**, more than half of which PostGear's MVP will never
touch. **27 were dropped** across two migrations — see
[Deliberately removed](#deliberately-removed) — leaving **21**.

Every model still in the file is either MVP-active or a deliberate, justified
keep. If a table is here, it is here on purpose.

## Model status

Sprint numbers below refer to [`docs/sprint-documents/`](../../../docs/sprint-documents/).

### MVP-active

| Model | Role | First used |
|---|---|---|
| `Organization` | The tenant. Root of nearly every scoping query. | Sprint 2 |
| `User` | An account. **Not** tenant-scoped — a user may belong to many orgs, or none. | Sprint 2 |
| `UserOrganization` | The membership join table, carrying `role`. This is the name to use — do not invent a `Member`. | Sprint 2 |
| `Integration` | **A connected social channel.** The name is Postiz's history; read it as "channel" everywhere. Holds the encrypted OAuth `token`/`refreshToken`. | Sprint 3 |
| `Post` | One row **per platform target**. A cross-posted batch is tied together by `group`; thread/reply chains by `parentPostId`. There is no separate `PostItem` table. | Sprint 4 |
| `Media` | Uploaded images/video, S3/MinIO-backed. | Sprint 4 |
| `Tags` / `TagsPosts` | Post labelling and its join table. | Sprint 4 |
| `Sets` | Saved groupings of channels, for "post to my usual five". | Sprint 4 |
| `Signatures` | Reusable sign-off blocks appended to post content. | Sprint 4 |
| `Errors` | Publish-failure records, surfaced in the queue UI. | Sprint 5 |
| `Notifications` | In-app notification feed. | Sprint 5 |
| `Subscription` | Billing plan + `totalChannels` entitlement. Gates channel connection. | Sprint 8 |
| `Credits` | AI usage metering. | Sprint 6 |
| `Customer` | Stripe customer mapping. Also doubles as a client-grouping label on `Integration`. | Sprint 8 |
| `Webhooks` / `IntegrationsWebhooks` | Outbound webhooks and their channel scoping. | Sprint 8 |
| `OAuthApp` / `OAuthAuthorization` | PostGear acting as an OAuth *provider* for its public API. | Sprint 8 |

### Kept, though not yet used

| Model | Why it stays |
|---|---|
| `Comments` | Postiz's in-app post commenting. Plausible if team review lands post-MVP, and it costs nothing. |
| `Announcement` | Product announcement banner. Cheap and plausible. |

> If a later sprint activates one of these, move its row up to the table above
> rather than starting a third list.

## Conventions — and where the schema breaks its own

Follow these when **adding** models. Two of the four are not actually uniform
in the inherited file, so check before assuming.

1. **Primary keys are `String @id`, but the generator is not consistent.**
   16 models use `@default(uuid())`; only `Subscription`, `Integration` and
   `Post` use `@default(cuid())`. The rest have no default and are assigned by
   application code. Sprint 1's own planning doc calls the convention "cuid" —
   that is wrong as a description of the file. **Use `uuid()` for new models**,
   matching the overwhelming majority; do not migrate existing tables to match.

2. **Tenant scoping is `organizationId`, except in two places.**
   14 models use `organizationId`. `Tags` and `Customer` use `orgId` for the
   identical concept. (`UsedCodes`, a third offender, was pruned.) Use
   `organizationId` in new models. The
   practical hazard is a query written from memory against the wrong one — it
   is a compile error with the generated Prisma types, so it fails fast, but
   expect to look it up.

3. **Soft delete is `deletedAt DateTime?`** and it is far more widespread than
   it first appears — 11 of the 21 models carry it: `Comments`, `Customer`,
   `Integration`, `Media`, `Notifications`, `OAuthApp`, `Post`,
   `Signatures`, `Subscription`, `Tags`,
   `Webhooks`. **Every read of these must filter `deletedAt: null`.** Prisma
   has no global soft-delete filter here, so this is on each query. Missing it
   is the single most likely data bug in this codebase.

4. **Timestamps are `createdAt DateTime @default(now())` and
   `updatedAt DateTime @updatedAt`.** `Integration.updatedAt` is nullable
   (`DateTime?`) where others are not — an upstream quirk, not a pattern.

## Field meanings that are not self-evident

- **`User.timezone` is a UTC offset in *minutes*, not an IANA zone name or
  index.** Postiz's client sends `String(dayjs.tz().utcOffset())`, and dayjs
  returns minutes: `0` = UTC, `-300` = US Eastern (EST), `330` = IST.
  An offset cannot represent DST on its own, so a "9am local" schedule stored
  this way drifts by an hour twice a year. If Sprint 5's scheduler needs DST
  correctness, add a nullable `timezoneName` (IANA string) *alongside* this
  field rather than reinterpreting it.
- **`User` is unique on `[email, providerName]`, not on `email`.** The same
  address can therefore exist once as `LOCAL` and again as `GOOGLE`. Auth code
  in Sprint 2 must query on the pair, never on email alone.
- **`Integration.token` / `refreshToken` are ciphertext**, not plaintext — see
  the next section.
- **`Integration.internalId`** is the *provider's* account id, unique per org
  (`@@unique([organizationId, internalId])`). `Integration.id` is ours.
- **`Post.group`** ties a cross-post batch together; **`Post.parentPostId`**
  builds thread/reply chains. Both are needed to reconstruct what a user
  thinks of as "one post".
- **`Post.state`** is the `State` enum — `QUEUE`, `PUBLISHED`, `ERROR`,
  `DRAFT` — driving the queue and calendar views.

## The encryption boundary

`Integration.token` and `Integration.refreshToken` hold live OAuth credentials.
They are encrypted **at the repository layer** with AES-256-GCM — see
[`../src/crypto.ts`](../src/crypto.ts), built in Sprint 1 and wired up in
Sprint 3.

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

## A user may legitimately belong to zero organizations

Signup collects credentials only; the workspace is created afterward, in a real
post-authentication onboarding flow (Sprint 1 Task 3a; built in Sprint 2).
"Authenticated but not onboarded" is therefore a real, persistable state.

The schema already permits it — `User.organizations` is a to-many relation with
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

Still open for Sprint 2: where onboarding-completion lives. A derived check
("has at least one `UserOrganization`") is free and needs no migration but
cannot represent a partially-finished multi-step flow; a flag on `User` can.
Decide once, not per-step.

## Deliberately removed

**27 of the inherited 48 models were dropped**, across two migrations. They held
zero rows, the repo had a single prior migration, and no production database
existed — so this was the cheapest moment it would ever be. It is a deliberate
reversal of Sprint 1's original "leave dormant models in place" decision, whose
reasoning (avoiding migration churn) was load-bearing on having data to migrate.

### `20260905090442_prune_dormant_tier1_tier2` — 20 tables

| Removed | Was |
|---|---|
| `GitHub`, `Trending`, `TrendingLog`, `Star`, `ItemUser`, `PopularPosts` | GitHub-trending-repo tracking — a Postiz-specific content source with no PostGear equivalent. |
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

### `20260905091907_prune_marketplace_tier3` — 7 tables

`Orders`, `OrderItems`, `Messages`, `MessagesGroup`, `PayoutProblems`,
`SocialMediaAgency`, `SocialMediaAgencyNiche` — Postiz's creator marketplace
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
was removed from both sides. Relation names are Prisma-side only — this produced
no SQL.

The payoff is that `Post` — the table every sprint from 4 onward reads most —
now contains only fields that mean something to PostGear.

### Before re-adding any of these

**Don't resurrect them from git history.** If a real requirement arrives for RSS
auto-posting, auto-engagement, or paid collaborations, design it fresh against
PostGear's needs. The originals were shaped for a different product, and their
column names carry assumptions that no longer hold here.

## Changing this schema later

The schema is **not frozen**. When a sprint needs a capability it does not
cover — SEO auditing (Sprint 7), AI copilot specifics (Sprint 6), PostGear-only
analytics — that sprint adds models to this same file following the conventions
above, and updates the tables in this document.

Resist renaming inherited fields. `Integration` for "channel" and
`token`/`refreshToken` will keep reading oddly, but renaming a live schema's
fields is real migration risk for cosmetic gain. Add a clarifying comment in
`schema.prisma` instead.
