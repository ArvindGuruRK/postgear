# Module 13: Google Sheets, HTTP Request And Webhook Trigger

> **Sprint 10, Workflow Builder** | Status: Not started | Size: L (one session)
> **Depends on**: [Module 12](module-12-notify-steps-and-simulation.md) (`safe-http.ts`, stand-ins), Module 04 (connections, OAuth start and callback framework with single-use state), Module 09 (live runs, activation)
> **Stories**: WF-11.4 (P1), WF-11.5 (P1), WF-7.5 (P1), Journey A (Sheets), Journey D (Sheets disconnected)
> **Next**: [Module 14](module-14-hardening-e2e-closeout.md)

## Goal

Data in and data out:

- **Google Sheets: Append Row**: pick (or create) a spreadsheet with Google's own Picker, choose a tab, map its header columns to data chips, append one row per run.
- **HTTP Request**: call another system over https, with secret headers kept in a connection, the response available to later steps.
- **Webhook** trigger: another app starts a workflow with a secret link; the last received data becomes test sample data.
- The **Publishing Report** and **Blog To Draft** templates run end to end under `AUTOMATION_SIMULATION=true`.

## Read First

1. [`README.md`](README.md) (decision log: Google uses `drive.file` plus the Picker), [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 5.1, 5.4 (key and value list, connection picker), 10.
2. Sprint doc: Node Catalog Data rows, "Triggers" (Webhook), Database (`AutomationWebhookSecret`), Risks "Google Sheets OAuth". User stories WF-11.4, WF-11.5, WF-7.5, Journey A steps 3 to 4.
3. Code:
   - `apps/worker/src/lib/safe-http.ts` (Module 12) for every outbound call.
   - `packages/db/src/crypto.ts`: `encrypt`, `decrypt`, `safeCompare` (~179).
   - `apps/api/src/config/env.ts`: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (~87, used by sign-in in `apps/api/src/modules/auth/providers/google.provider.ts`), `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` (~107, used by `packages/social-core/src/providers/youtube/index.ts`).
   - `apps/api/src/main.ts`: `rawBody: true` (Stripe signatures) and `useBodyParser('json', { limit: '1mb' })`.
   - `apps/api/src/common/throttling/` (`AppThrottlerGuard`, the Redis-backed `default` throttler) and `apps/api/src/modules/developers/v1/*.controller.ts` (`@Controller('v1/...')` naming).
   - Module 04's OAuth start and callback code in `apps/api/src/modules/automations/connections/`.

## Design

### 1. Google connection (OAuth, `drive.file`)

- **Scope**: `https://www.googleapis.com/auth/drive.file` (non-sensitive, "recommended" by Google) plus `openid email` to label the connection with the account address. Not `spreadsheets` (sensitive, needs Google's verification) and never `drive` (restricted).
- What `drive.file` means for users, said plainly in the panel: PostGear can only open spreadsheets **you pick with Google's file picker** or that **PostGear created**. Pasting a sheet link will not work, and the field does not offer it.
- **Env** (API and, for refresh, worker; document in `.env.example`):
  - `GOOGLE_AUTOMATION_CLIENT_ID`, `GOOGLE_AUTOMATION_CLIENT_SECRET`: optional; when unset, fall back to `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (the sign-in app). One Google Cloud project is fine; the redirect URI must be added to that OAuth client.
  - `GOOGLE_PICKER_API_KEY` (a browser key restricted to the Picker API and PostGear's origins) and `GOOGLE_CLOUD_APP_ID` (the project number; the Picker needs it to grant `drive.file` access to picked files).
  - Without the client id and secret, the Google cards show **Needs Connection** with "Ask a workspace admin to set up Google." for admins on the Connections page, and the catalog marks the step unavailable rather than broken.
- **Redirect URI**: `${API_URL}/automation-connections/oauth/google/callback` (Module 04's route shape). `access_type=offline`, `prompt=consent` so a refresh token is always returned; `include_granted_scopes=true`.
- **Storage**: `AutomationConnection.credentials` (encrypted) holds `{ refreshToken, accessToken, expiresAt, scope, email }`. The masked hint is the email (`k***@gmail.com`).
- **Refresh in the worker**: `apps/worker/src/automation/providers/google-auth.ts` refreshes when the token expires within 60 s, writes the new access token back (encrypted), and on `invalid_grant` marks the connection **Needs Reconnect** and fails the step with "Google Sheets is disconnected. Reconnect it in Connections." (Journey D).
- **Reconnect permission**: only admins (the n8n CVE-2026-45732 lesson: reconnecting overwrites a shared token, so it needs change rights, not just use rights).
- **Testing mode**: while the Google Cloud app is in testing mode, only listed test users can connect and refresh tokens expire after 7 days. Add both facts to `docs/local-testing-guide.md` and the module's hand check.

### 2. Google Sheets: Append Row (`data.googleSheetsAppendRow`)

Config:

```ts
{ connectionId, spreadsheet: { id, name } , sheet: { id, title },
  columns: { header: string, value: string /* template */ }[],   // 1..50
  createdByPostGear?: boolean }
```

- **Setup tab**: connection picker; **Pick A Spreadsheet** opens the Google Picker (loaded on demand from Google's script, with the access token from a short-lived `GET /automation-connections/:id/picker-token` that returns only an access token, never the refresh token, admins and members alike since picking only grants file access); **Create A New Spreadsheet** asks for a name and creates it (`POST https://sheets.googleapis.com/v4/spreadsheets`) with a header row from the template's columns, so it is usable at once.
- **Tab**: a select filled from `GET spreadsheets/{id}?fields=sheets.properties(sheetId,title)`.
- **Columns**: read the first row (`GET spreadsheets/{id}/values/{Sheet}!1:1`). Each header becomes a row in a key and value list with a chip input. Columns the user leaves empty write an empty cell. **Refresh Columns** re-reads the header; columns that disappeared are flagged red, new ones are added empty. A sheet with no header row gets the Alert "This tab has no header row. Add one in Google Sheets, or create a new spreadsheet."
- These read calls run from the **API** (a `GET /automation-connections/:id/google/...` helper set, admins and members), through an SSRF-safe client as well (the hosts are fixed, but keep one path).
- **Execution** (worker): `POST https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{Sheet}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS` with `{"values":[[...]]}` in header order. **RAW**, never `USER_ENTERED`, so a post text starting with `=` stays text (formula injection). Values are strings; lists joined with ", ".
- Output: `{ rowNumber /* parsed from updates.updatedRange, e.g. Posts!A42:F42 gives 42 */, spreadsheet: { id, name, url }, sheet: title }`.
- Retry classes: 429 and 5xx transient; 403 `PERMISSION_DENIED` or 404 (file not picked any more, or deleted) is permanent with "PostGear can no longer open {name}. Pick it again in this step."; `invalid_grant` is the reconnect case.
- Idempotency: Sheets has no idempotency key. The step-row check (Module 07) prevents a second append after a recorded success; the narrow window (append succeeded, activity crashed before recording) is accepted and documented in `SCHEMA_NOTES.md`-style notes in the provider file.
- **Dry run**: "Would add a row to Social Report 2026, tab Posts: Date 2026-11-03, Channel Instagram, ...".
- **Simulation**: the stand-in logs the row and returns a fake `rowNumber` that increments per connection in memory; markers apply to the joined row text.

### 3. HTTP Request (`data.httpRequest`)

Config:

```ts
{ method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string /* template, must resolve to https */,
  headers: { name, value /* template */ }[],          // non-secret only
  secretHeadersConnectionId?: string,                 // connection kind 'http': { headers: { name, value }[] } encrypted
  bodyType: 'none' | 'json' | 'form' | 'text', body?: string /* template */,
  responseType: 'auto' | 'json' | 'text' }
```

- **Secrets**: header values that are secret (Authorization, API keys) live only in an `http` connection (Module 04 kind, admins manage it, masked as `Authorization: Bearer ...9f2c`). The graph has only the connection id. A plain header whose name matches the redaction pattern (`authorization`, `api-key`, `token`, ...) is a validation error: "Put this header in a connection so it stays secret."
- **Rules**: https only (even locally, unless `WEBHOOK_ALLOW_PRIVATE_URLS=true`, which also allows http and private hosts for local testing, refused in production); `safeHttpRequest` with the address guard and pinning; timeout 15 s; response kept up to 64 KB (cut with a note); redirects not followed (a 3xx is returned as the result, so a redirect cannot reach a private address).
- **JSON body**: the template is resolved, then must parse as JSON; chips inside strings are JSON-escaped by the resolver's `json` mode (add it to Module 02's resolver if missing: values inserted into a JSON body are encoded, never spliced raw).
- **Output**: `{ status, ok, headers /* content-type, content-length, location only */, body /* parsed JSON when the type is JSON, else text */ }`. Upstream chips can read `body.*` once a test has shown the shape (the Output view in Module 06 learns fields from the last result).
- **Retry classes**: 408, 429, 5xx, timeout, network transient; other 4xx permanent with "The other app answered 422: {first 200 chars of its message}"; guard failure permanent "This address is not allowed." Non-idempotent methods (POST, PATCH) send `Idempotency-Key: ${runId}:${nodeKey}`.
- **Dry run**: "Would send POST to api.example.com/hooks/new-post with 3 fields." and the resolved body (redacted) in the output view.

### 4. Webhook trigger (`trigger.webhook`, P1)

- **Model** (`prisma-change`): `AutomationWebhookSecret { id, automationId, organizationId, secretHash String, last4 String, createdAt, revokedAt DateTime? }`. Only a hash is stored (SHA-256 of a 32-byte random secret is enough; the secret is high entropy). One active secret per automation; **Regenerate** revokes the old one.
- **Route**: `POST /v1/automations/:id/hook` in `apps/api/src/modules/automations/hook.controller.ts` with `@Controller('v1/automations')`, `@Public()`.
  - Header `X-PostGear-Secret`, compared against every active hash for that automation with `safeCompare` on the hex digests. Missing or wrong: 401 with no detail. Unknown automation: also 401 (do not reveal which ids exist).
  - Body cap 256 KB: check `request.rawBody.length` (the global JSON limit is 1 MB) and answer 413 "This request is too large."
  - Accepts JSON objects only (415 otherwise).
  - Throttle: the global per-address ceiling plus a per-automation limit of 60 per minute (a `@Throttle` override with a tracker keyed on the automation id; read `AppThrottlerGuard` for how trackers are built). Over it: 429.
  - Only **ACTIVE** automations whose pinned version's trigger is `trigger.webhook` start a **live** run (202 with `{ runId }`). Draft or paused: 409 "This workflow is not turned on." The body is still saved as the latest sample (below), so a builder can wire up their app before activating.
  - `triggerEventId` = `webhook:<Idempotency-Key header>` when the caller sends one (max 128 chars), else none. The unique `(automationId, triggerEventId)` from Module 03 makes a repeated key a no-op answering 200 with the first `runId`.
- **Sample data**: the last received body, redacted (Module 02) and capped at 64 KB, stored on `Automation.webhookSample Json?` with `webhookSampleAt`. The trigger's Test tab shows "Last received 3 minutes ago" and uses it as the sample for test runs; its fields feed Insert Data (shape inferred from the sample, labelled with the JSON keys in plain words).
- **Panel**: the link with **Copy**; the secret shown **once** right after creation or regeneration in a copy box with "Copy it now. It will not be shown again."; afterwards only `...last4`; a ready-made curl example with a placeholder secret; **Regenerate Secret** (confirm dialog, admins only).
- Output of the trigger: `{ body, receivedAt, headers: { contentType } }`.

### 5. Templates under simulation

- **Publishing Report**: Post Published, Set Fields, Sheets Append Row (simulated), Slack (simulated). Seed or test with a simulated Google connection (a connection row with `simulated: true` credentials is acceptable only when `AUTOMATION_SIMULATION=true`; the Connections page labels it "Simulated").
- **Blog To Draft**: Webhook, Generate Text (`AI_SIMULATION`), Create Draft, In-App Notification. Hand check sends a curl to the hook.

## Scope

**In**: Google OAuth connection with Picker and refresh, Sheets Append Row, HTTP Request with secret header connections, Webhook trigger with hashed secrets and samples, simulation for both data steps, the two templates runnable, env docs.

**Out**: Excel (Module 15, Coming Soon), reading or updating existing rows, Google Drive file steps, webhook signature schemes beyond the shared secret (HMAC signing of inbound requests is a later idea).

## Tasks

- [ ] Env vars in API and worker schemas and `.env.example`; local testing guide section for Google testing mode.
- [ ] Google OAuth provider in Module 04's framework (`drive.file`, offline, consent), picker-token route, worker refresh helper.
- [ ] API Google helpers: list tabs, read header row, create spreadsheet.
- [ ] Sheets executor, stand-in, dry run; web Setup (Picker, Create A New Spreadsheet) and Configure (columns) fields.
- [ ] `http` connection kind (if Module 04 lacks it); HTTP Request executor, JSON-safe resolution, redirects not followed; web fields.
- [ ] `prisma-change`: `AutomationWebhookSecret`, `Automation.webhookSample`, `webhookSampleAt`; migrate and generate yourself.
- [ ] Hook controller with secret check, caps, throttle, idempotency, sample storage; trigger panel.
- [ ] Catalog: the three types executable.
- [ ] Publishing Report and Blog To Draft run under simulation.

## Tests

- OAuth: state is single use; a callback without a refresh token is refused with "Google did not grant offline access. Try again."; refresh writes back encrypted; `invalid_grant` marks Needs Reconnect.
- Sheets: append body is RAW and in header order; `=SUM(A1)` in post text arrives as text; `rowNumber` parsing; 403 and 404 messages; simulation increments.
- HTTP: http URL refused; private address refused (guard); redirect returned not followed; secret-looking plain header is a validation error; JSON chips escaped (a value with quotes keeps the body valid); `Idempotency-Key` on POST.
- Hook: no secret 401, wrong secret 401, unknown id 401, 300 KB 413, non-JSON 415, paused 409 but sample saved, active 202, repeated Idempotency-Key returns the first run, throttle 429.
- Redaction: a webhook body with `{"password":"x"}` is stored as `[hidden]` in the sample and the step input.

## Done When

- `npm run validate` passes. Both templates run under simulation; the hook answers correctly to every case above.
- No secret (refresh token, secret header, webhook secret) appears in any API response, graph, run step or log line (API specs grep the responses).

## Hand Check

1. Without Google keys: the Sheets step says Google is not set up, honestly.
2. With `AUTOMATION_SIMULATION=true`: open Publishing Report, use the simulated Google connection, map columns, test (dry run sentence), turn on Send for real in tests (simulated row number), activate, publish a post with `PUBLISH_SIMULATION=true`: the worker console shows the row and the Slack line.
3. HTTP Request to `https://httpbin.org/post` only with your OK (a real outside call); otherwise test it under simulation.
4. Blog To Draft: copy the hook link and secret, activate, `curl -X POST <link> -H "X-PostGear-Secret: <secret>" -H "content-type: application/json" -d '{"title":"Spring Menu","url":"https://example.com/spring"}'`: a draft appears and a notification arrives. Send it again with the same `Idempotency-Key`: no second draft.
5. Optional, with real Google keys in testing mode and your account as a test user: pick a real sheet and append a row.

## Handoff

README: progress row, Google env vars and whether the sign-in client is reused, the picker-token route, the `http` connection kind, the webhook sample columns, the accepted Sheets idempotency window, and which steps were tested for real versus only in simulation.
