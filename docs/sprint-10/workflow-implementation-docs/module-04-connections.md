# Module 04: Connections

> **Sprint 10, Workflow Builder** | Status: Done (2026-10-29, see the README decision log for the calls made) | Size: M (one session)
> **Depends on**: [Module 03](module-03-data-model-and-api.md)
> **Stories**: WF-4.1, WF-4.2, WF-4.3, edge case "A connection stops working"
> **Next**: [Module 05](module-05-list-templates-and-canvas.md)

## Goal

Outside apps (Slack, Microsoft Teams, Discord, HTTP secrets, Google) are linked to a workspace once, stored encrypted, shown honestly, and reused by any workflow. After this module:

- `AutomationConnection` exists, with credentials encrypted by `encrypt()` from `@postgear/db` and never returned to anyone;
- admins can add, rename, check, reconnect and delete connections; members can only see and pick them;
- a generic OAuth start and callback exists (single-use state, returns to the exact step), ready for Google in Module 13;
- the web app has the **Connections** page and a reusable `ConnectionPicker` that Module 06 drops into the step panel.

## Read First

1. [`README.md`](README.md), [`00-ux-blueprint.md`](00-ux-blueprint.md) section 10 (Connections page) and 5.4 (the connection field).
2. Sprint doc: "Database" (the `AutomationConnection` row and the secrets paragraph).
3. User stories: WF-4.1 to WF-4.3, section 4 rules 7 and 10, section 5 first row.
4. Code: `packages/db/src/crypto.ts` (`encrypt`, `decrypt`, `safeCompare`), `apps/api/src/modules/channels/channel-oauth.service.ts` (how OAuth `state` is stored server-side in Redis as an opaque key), `apps/api/src/modules/redis/redis.service.ts`, `apps/api/src/modules/webhooks/webhook-url.ts` (URL checks), `apps/api/src/common/decorators/roles.decorator.ts`.
5. Skills: `prisma-change`, `new-api-module`, `new-page`.

## Scope

**In**: model and migration, provider credential schemas, masking, usage counts, the connections API, the OAuth framework (no real provider yet), the Connections page, the connect dialogs for webhook-style apps, `ConnectionPicker`, specs.

**Out**: sending anything through a connection (Module 12), the Google provider and Picker (Module 13), HTTP Request's per-request headers UI (Module 13 uses the `http` connection kind defined here).

## Design

### Model

```prisma
model AutomationConnection {
  id              String                     @id @default(uuid())
  organizationId  String
  provider        String                     // 'slack' | 'teams' | 'discord' | 'http' | 'google'
  name            String                     // "Marketing Slack", unique per workspace and provider
  credentials     String                     // encrypt(JSON.stringify(validated credentials))
  maskedHint      String                     // "hooks.slack.com/...a9F2"; computed once at save
  status          AutomationConnectionStatus @default(CONNECTED)
  lastCheckedAt   DateTime?
  lastError       String?                    // one sentence, safe to show
  meta            Json?                      // non-secret extras (Google account email, Teams channel label)
  createdById     String
  updatedById     String?
  createdAt       DateTime                   @default(now())
  updatedAt       DateTime                   @updatedAt
  deletedAt       DateTime?

  @@index([organizationId, provider, deletedAt])
}

enum AutomationConnectionStatus { CONNECTED NEEDS_RECONNECT ERROR }
```

The graph stores only `connectionId` in a step's config. `credentials` is the only encrypted column; `maskedHint` and `meta` are safe to return.

### Provider credential schemas (`apps/api/src/modules/automations/connections/providers/*.ts`)

Each provider declares `{ kind, title, credentialsSchema (Zod .strict()), mask(credentials), check?(credentials), helpLink }`. The same list is mirrored (without `check`) in `packages/automation` as `CONNECTION_KINDS` so the catalog and the web app agree on titles and icons.

| Provider | Credentials | Accepted URL | Mask |
|---|---|---|---|
| `slack` | `{ webhookUrl }` | `https://hooks.slack.com/services/...` only | `hooks.slack.com/...` + last 4 |
| `discord` | `{ webhookUrl }` | `https://discord.com/api/webhooks/<id>/<token>` (also `discordapp.com`) | `discord.com/api/webhooks/...` + last 4 |
| `teams` | `{ webhookUrl }` | the URL the Teams **Workflows** app gives ("Send webhook alerts to a channel" template). Today these hosts look like `*.logic.azure.com` and `*.environment.api.powerplatform.com`. **Verify the current host patterns against Microsoft's docs when building**; old `*.webhook.office.com` connector URLs are refused with "This is an old Teams connector link. Create a new one with the Workflows app." because Office 365 Connectors were switched off in May 2026 | host + last 4 |
| `http` | `{ headers: [{ name, value }] }` (1 to 10 secret headers, for example `Authorization`) | none (the HTTP Request step holds the URL) | "2 secret headers: Authorization, X-Api-Key" (names only) |
| `google` | `{ accessToken, refreshToken, expiresAt, scope }` | set by the OAuth callback only, never by a form | the Google account email from `meta` |

All URLs must be `https`, pass the existing public-address checks (reuse `webhook-url.ts`), and be at most 2,048 characters. Unknown keys are refused (`.strict()`).

### "Used by N workflows": scan, not a join table

Count by scanning: for each workflow in the workspace (not deleted), look for the connection id in `draftGraph` and in the active version's graph. Workspaces have tens of workflows, each under 50 steps, so a scan in the service is cheap and cannot drift. A join table would have to be rewritten on every autosave (Module 05 saves every few seconds), which is where drift bugs come from. Put the scan in `automation-context.service.ts` (Module 03) as `connectionUsage(orgId)` returning `{ [connectionId]: { draft: AutomationRef[], live: AutomationRef[] } }`. Revisit only if a workspace passes a few hundred workflows.

### Health and the honest check

`POST /automation-connections/:id/check` runs the provider's cheapest **non-sending** check and records `status`, `lastCheckedAt` and `lastError`:

- `google`: refresh the token if needed and call a read-only endpoint (Module 13 fills this in).
- `slack`, `discord`, `teams`: an incoming webhook cannot be checked without posting a message. The check validates the stored URL shape and host only, and the UI says so plainly: **"Saved, not checked. Slack links can only be checked by sending a message: use Test Step."** Never show such a connection as verified. Module 08's Test Step with "Send for real in tests" is the real check, and a real send that succeeds or fails updates the connection status (Module 12).
- `http`: nothing to check; the status stays `CONNECTED`.

A run that fails because a connection is broken (401, 403, 404 from the provider, or a revoked Google token) sets the connection to `NEEDS_RECONNECT` with a one-sentence `lastError` (Module 12 and 13 call `markConnectionBroken(id, reason)`, defined here as a repository method the worker can reproduce with Prisma). Validation (`node.connection_broken`) then marks every step that uses it.

### API (`apps/api/src/modules/automations/connections/`)

| Route | Who | Notes |
|---|---|---|
| `GET /automation-connections` | members | `{ id, provider, name, status, maskedHint, meta, lastCheckedAt, lastError, usedBy }`, never `credentials` |
| `POST /automation-connections` | admins | `{ provider, name, credentials }`; validated by the provider schema; encrypted; answers the safe shape |
| `PATCH /automation-connections/:id` | admins | rename, or replace credentials (reconnect) |
| `DELETE /automation-connections/:id` | admins | soft delete; refused with 409 and the list of workflows while any **active** workflow uses it ("Pause these workflows first: ..."); drafts using it simply get a validation issue |
| `POST /automation-connections/:id/check` | admins | as above |
| `GET /automation-connections/oauth/:provider/start?returnTo=` | admins | redirects to the provider |
| `GET /automation-connections/oauth/:provider/callback` | public route, state-bound | finishes and redirects to `returnTo` |

- Writes are `@Roles(Role.ADMIN)`. **Reconnect is a write**: n8n's CVE-2026-45732 let a read-only user re-run OAuth on a shared credential and overwrite its token. Here, starting OAuth for an existing connection requires admin, and the callback re-checks that the state's user is still an admin of that workspace.
- Every response goes through one `toSafeConnection()` mapper; a spec asserts no response body contains the decrypted value or the `credentials` field.

### OAuth framework (`connection-oauth.service.ts`)

Follow `channel-oauth.service.ts`: `state` is an opaque random key; the payload `{ orgId, userId, provider, connectionId?, returnTo }` lives in Redis for 10 minutes and is **deleted on first read** (single use). `returnTo` must be a same-origin path under `/[orgId]/workflows/` (for example `/[orgId]/workflows/abc?step=k3f9a1b2c0&tab=setup`), so the user lands back on the exact step with the connection selected. Providers plug in `{ authorizeUrl(state, redirectUri), exchange(code) }`; only a fake test provider exists in this module.

### Web

- **Connections page** at `/[orgId]/workflows/connections` (blueprint section 10), reached from the Workflows `PageActions` ("Connections" secondary button) and from Settings. `PageActions`: Add Connection (admins), search. Rows: app logo, name, status sticker with words (Connected, Needs Reconnect, Error, and "Saved, not checked" as muted text under webhook ones), last checked, Used By (popover listing workflows, each linking to it), row menu: Check Connection, Rename, Reconnect, Delete (solid red, confirm naming the workflows that use it).
- **Connect dialogs**: one per webhook app: a name field ("Enter your connection name"), a link field ("Enter your Slack link"), and a collapsible **Where do I find this?** with 3 to 5 short steps and a link to the app's own docs:
  - Slack: create an app with Incoming Webhooks, add one to a channel, copy the link.
  - Discord: Channel settings, Integrations, Webhooks, New Webhook, Copy Webhook URL.
  - Teams: in the channel, open the **Workflows** app, pick "Send webhook alerts to a channel", finish the steps, copy the link it shows. Mention that the messages appear as posted by Flow bot and that the flow belongs to the person who made it.
- **`ConnectionPicker`** (`apps/web/src/components/workflows/connection-picker.tsx`): props `{ kind, value, onChange, returnTo }`. Shows the workspace's connections of that kind with status; an empty or broken state with **Connect {App}** (admins, opens the dialog, or starts OAuth with `returnTo`) or the sentence "Ask a workspace admin to connect {app}." (members). Selecting writes only the id.

## Tasks

- [x] Model and migration through `prisma-change`; `SCHEMA_NOTES.md` (why credentials are one encrypted blob, why usage is scanned).
- [x] Provider credential schemas, masks and URL checks; `CONNECTION_KINDS` mirror in `packages/automation`.
- [x] Connections API with `toSafeConnection()`, admin guards, delete refusal while live.
- [x] `connectionUsage()` in the context service; validation context now includes real connections.
- [x] OAuth framework with the fake provider and single-use state.
- [x] Connections page, connect dialogs with help, `ConnectionPicker` (render it on `/dev/components` so it can be checked before Module 06).
- [x] Catalog `needsConnection` state now driven by real connections.

## Tests

- Encryption: the stored `credentials` column is not the plaintext; decrypt round trips.
- Secrets: every route's response (list, create, patch, check) contains neither `credentials` nor any substring of the webhook token (snapshot the JSON and assert).
- Roles: member POST, PATCH, DELETE, check and OAuth start are 403; member GET works.
- Tenancy: another workspace's connection is 404 on every route; a graph cannot reference another workspace's connection id (validation issue `node.connection_missing`).
- URL checks: a non-https link, `localhost`, a private IP, an old `webhook.office.com` link, and a Slack link pasted into the Discord form are all refused with the right sentence.
- OAuth state: reused state fails; expired state fails; `returnTo` to another origin or outside `/workflows/` is refused.
- Delete: refused while an active workflow uses it (fake an active version graph); allowed for drafts.

## Done When

- `npm run validate` passes; the page works in light, dark and Lilac and at phone width.
- No response, log line or browser storage holds a decrypted credential (grep the API logs during the hand check).

## Hand Check

1. As `demo@postgear.local` (admin): Workflows, Connections, Add Connection, Slack. Paste any made-up `https://hooks.slack.com/services/T000/B000/abcd1234` link. The row shows the masked hint and "Saved, not checked".
2. Open the browser's network tab and look at the list response: no full link anywhere.
3. Sign in as `member@postgear.local`: the page is read-only and Add Connection is not offered.
4. Check `/dev/components` for the `ConnectionPicker` in its three states (has connections, none as admin, none as member).

## Handoff

Update [`README.md`](README.md): progress row, decision log (usage by scan; the Teams host patterns you verified and the date), and the exact `ConnectionPicker` props for Module 06.
