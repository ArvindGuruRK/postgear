# Module 12: Notify Steps And Simulation

> **Sprint 10, Workflow Builder** | Status: Done with gaps (2026-10-31) | Size: M (one session)
> **Depends on**: [Module 09](module-09-triggers-activation-versions.md); Module 04 (Slack, Teams and Discord connections); Module 07 (provider interface, `AUTOMATION_SIMULATION`, dry runs); Module 10 (the internal step gateway, for Email)
> **Stories**: WF-11.1 (done in 07, checked here), WF-11.2 (Slack P0, Teams and Discord P1), WF-11.3 (P1), WF-12.1 (grouping, checked here), Journey C, Journey D (Slack retries)
> **Next**: [Module 13](module-13-sheets-http-and-webhook.md)

## Goal

Workflows can tell people things, and every outside app can be exercised locally without touching the real one:

- **Slack** (P0), **Microsoft Teams** (P1), **Discord** (P1): a message with data chips to the chosen connection. The step succeeds only when the app confirms it received the message.
- **Email** (P1): up to 10 recipients, subject and message with data chips, through PostGear's existing mail path.
- Under `AUTOMATION_SIMULATION=true`, each provider is replaced by a stand-in that logs to the worker console, returns a realistic success, and obeys the same `[simulate:...]` markers as `PUBLISH_SIMULATION`.
- The **Failed Post Alert** template runs end to end under simulation.

## Read First

1. [`README.md`](README.md), [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 5.1, 5.4 (connection picker), 7.1 (Retried state), 10 (Connections page).
2. Sprint doc: Node Catalog Notify rows, "Test runs vs live runs" (`AUTOMATION_SIMULATION`), Risks "Provider policy changes". User stories WF-11.2, WF-11.3, section 5 "The outside app is briefly down".
3. Code:
   - `apps/worker/src/lib/webhook-sender.ts`: `sendWebhook()` resolves and checks the URL with `assertSafeUrl` from `@postgear/seo-engine`, then connects with `node:http(s)` and a `lookup` **pinned** to the checked address (no DNS-rebinding window), `servername` for TLS, a timeout, a 64 KB response cap, and maps 2xx to delivered, 408/429/5xx/timeout/network to retry, other 4xx to rejected, a failed guard to unsafe. It is POST-only, always signs, and **drops** the response body.
   - `apps/worker/src/lib/publisher.ts`: `parseSimulationDirective()` (exported, regex `\[simulate:(429|5xx|401|400|403|slow)(?::(\d+)|x(\d+))?\]`) and `currentAttempt()`. Reuse both; do not invent a second marker syntax.
   - `apps/worker/src/config/env.ts`: how `PUBLISH_SIMULATION` and `WEBHOOK_ALLOW_PRIVATE_URLS` are declared and refused in production.
   - `apps/api/src/modules/mail/mail.service.ts`: nodemailer when `SMTP_HOST` is set, a console transport otherwise; `sendPlain(to, subject, lines)` returns a boolean.

## Design

### 1. One safe HTTP client for every outside call

Extract the core of `sendWebhook` into `apps/worker/src/lib/safe-http.ts`:

```ts
safeHttpRequest({
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url, headers, body?: string,
  timeoutMs, maxResponseBytes /* default 64 KB */, keepBody: boolean,
  allowPrivate?: boolean /* from WEBHOOK_ALLOW_PRIVATE_URLS */, resolve?,
}): Promise<
  | { outcome: 'ok', statusCode, headers, body?: string, durationMs }
  | { outcome: 'retry', statusCode: number | null, error, retryAfterMs?, durationMs }
  | { outcome: 'rejected', statusCode, error, body?: string, durationMs }
  | { outcome: 'unsafe', error, durationMs }>
```

- Same guard, pinned lookup, `servername`, timeout, size cap and status mapping as today. New: any method, caller headers, an optional kept body (still capped), `Retry-After` parsed into `retryAfterMs`.
- `sendWebhook` becomes a thin wrapper (signing headers plus `keepBody: false`). Its existing tests (`webhook-sender.test.ts`) must pass unchanged: they are the proof the refactor kept behaviour.
- Every Notify provider (and Module 13's HTTP Request and Google calls) uses `safeHttpRequest`. Nothing in `apps/worker/src/automation/` calls `fetch` directly; add a lint-style test that greps for it.

### 2. Simulation stand-ins

- `AUTOMATION_SIMULATION` was added to the worker env in Module 07 (refused in production). If Module 07 did not, add it here, following `PUBLISH_SIMULATION`'s declaration and refusal exactly, and document it in `.env.example`.
- Each provider implements `simulate(request, attempt)` from Module 07's interface. The stand-in:
  - logs one line to the worker console: `[automation:simulate] slack to #bloom-bakery-alerts (hooks.slack.com/...a9F2): "Post failed on Bloom Bakery Instagram: ..."`;
  - applies `parseSimulationDirective()` to the **resolved message text**, with the same meanings as publishing: `[simulate:429]` and `[simulate:5xx]` are retryable failures (with `x2` failing only the first two attempts), `[simulate:400]` is the app refusing the message (permanent, the "invalid" case), `[simulate:401]` and `[simulate:403]` mean the connection is broken (permanent, marks the connection **Needs Reconnect**), `[simulate:slow:5]` waits;
  - otherwise returns a realistic success output (a fake Discord message id, Slack's `"ok"`).
- Simulation applies to live runs and to tests with "Send for real in tests" on. Plain test runs stay **dry runs** (Module 07): they never call `send` or `simulate`, they return "Would send to Slack #bloom-bakery-alerts: ...".

### 3. Retry classification (all Notify steps)

| Situation | Class | Step result |
|---|---|---|
| 2xx and the app's success signal (see each provider) | - | Succeeded |
| 408, 429 (honour `Retry-After`, capped at 60 s), 5xx, timeout, network error | transient | retried by the activity policy; "Succeeded after 2 attempts" when it recovers |
| 400 or the app's invalid-message answer | permanent | Failed: what the app said, in plain words |
| 401, 403, 404 (Slack `no_service`, `channel_not_found`), 410 (`channel_is_archived`), Discord 404 Unknown Webhook | connection | Failed: "{App} is disconnected. Reconnect it in Connections."; connection status set to **Needs Reconnect** with `lastError` |
| URL fails the safety guard | permanent | Failed: "This link is not allowed." (security log line) |

The connection-status write goes through the same repository Module 04 uses for Check Connection, so the Connections page and the step markers update without a refresh.

### 4. Slack (`notify.slack`, P0)

- Connection kind `slack`: an incoming webhook URL. Module 04 validates the shape `https://hooks.slack.com/services/T.../B.../...` (add it if missing) and shows "Where do I find this?" linking to Slack's incoming webhooks help.
- Config: `{ connectionId, message: string /* template */, includeLink?: string /* template, optional button URL */, footer: boolean /* "Sent by the workflow {name}" */ }`.
- Body: `{ text /* fallback, plain */, blocks: [section(mrkdwn message), actions(one url button "Open In PostGear" when includeLink), context(footer)] }`. Escape `&`, `<`, `>` in user data (Slack's mrkdwn rules) so a post text cannot inject links or mentions; `@channel`-style mentions in user data are neutralised the same way.
- Success: HTTP 200 **and** body `ok`. Anything else is classified by the table (Slack answers 400 `invalid_payload`, 403 `action_prohibited`, 404 `no_service`, 410 `channel_is_archived`).
- Output: `{ sent: true, channel /* connection name */, preview /* first 120 chars */ }`.

### 5. Microsoft Teams (`notify.teams`, P1)

- Office 365 Connectors in Teams were switched off in May 2026. The connection is a **Teams Workflows** URL created with the Workflows app template "Send webhook alerts to a channel" (or "When a Teams webhook request is received" plus "Post card in a chat or channel"). Help text says exactly that, in two short steps. Accept hosts ending in `.logic.azure.com` or `.api.powerplatform.com` with `https`; refuse `webhook.office.com` URLs with "That is an old Teams connector link, which Microsoft has switched off. Create a new link with the Teams Workflows app."
- Body: an Adaptive Card 1.2 in a message envelope:

```json
{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","contentUrl":null,
  "content":{"$schema":"http://adaptivecards.io/schemas/adaptive-card.json","type":"AdaptiveCard","version":"1.2",
  "body":[{"type":"TextBlock","text":"<title>","weight":"Bolder","wrap":true},{"type":"TextBlock","text":"<message>","wrap":true}],
  "actions":[{"type":"Action.OpenUrl","title":"Open In PostGear","url":"<link>"}]}}]}
```

- Config: `{ connectionId, title?: string, message: string, includeLink?: string }`.
- Limits: the whole body at most 28 KB (cut the message with "... (shortened)" and say so in the step output); over 4 requests per second is throttled, so 429 is transient with backoff.
- Success: any 2xx (the Workflows endpoint answers 202 when it accepts). The output says "Teams accepted the message." (honest: the flow runs after acceptance). Messages appear as the Workflows bot, not as PostGear; the panel says so.
- Before building, re-check Microsoft's current guidance (the sprint doc asks for it) and write what you found in the decision log.

### 6. Discord (`notify.discord`, P1)

- Connection kind `discord`: `https://discord.com/api/webhooks/{id}/{token}` (also `discordapp.com`).
- Send to `...?wait=true` so Discord returns the created message (200 with JSON) instead of 204. Body: `{ content, allowed_mentions: { parse: [] } }` so user data can never ping `@everyone` or roles.
- `content` at most 2000 characters: cut with "... (shortened)" and note it in the output.
- 429 carries `retry_after` in the JSON body: use it (capped at 60 s).
- Output: `{ sent: true, messageId, channelId }` from the response (kept body, parsed, capped).

### 7. Email (`notify.email`, P1)

- **Decision**: send through the Module 10 gateway, `POST /internal/automation/email`, which calls `MailService.sendPlain` once per recipient. This reuses SMTP config and the console fallback (without `SMTP_HOST`, emails print to the API console, as for activation links). The alternative, a new outbox table the API dispatcher drains (the notifications pattern), is heavier and gives nothing extra here. If Module 10 recorded no gateway, use that outbox instead and record it.
- Config: `{ to: string[] /* 1..10, each a template that must resolve to a valid address */, subject: string, message: string }`. Addresses are checked after resolution; an invalid one fails the step with "'{value}' is not an email address." (permanent).
- Abuse guard: at most 200 workflow emails per workspace per day (a constant in `LIMITS`, plan-based later); over it the step fails with "This workspace has sent its 200 workflow emails for today." Plain text only, subject on one line (strip newlines, like `MailService` does).
- The gateway's `AutomationEffect` row makes a retried step not email twice. If `sendPlain` returns false for a recipient, the step fails as transient (retried); recipients already sent are recorded in the effect result and skipped on retry.
- Output: `{ sent: number, recipients: string[] /* masked: k***@example.com */ }`.

### 8. In-App Notification and grouping (check only)

`notify.inApp` shipped in Module 07 and failed-run grouping in Module 09. Confirm both under this module's hand check; fix only real bugs.

### 9. Message preview (Configure tab)

Under the message fields, a live preview resolved with `sampleScope` (Module 02) and the last test run's data when there is one:

- Slack: a Slack-like message block (workspace avatar, bold app name "PostGear", the text with link styling, the button, the footer line).
- Teams: a card-like box (title in bold, text, the button).
- Discord: a Discord-like message (bot name, text, the 2000-character counter turning red near the limit).
- Email: subject and plain body.

Built from design-system parts in PostGear's look (a recognisable layout, not the apps' exact styling or logos beyond the small brand icon). The preview never shows a connection URL.

## Scope

**In**: `safe-http.ts` refactor, stand-ins, Slack, Teams, Discord, Email, previews, connection URL shape checks (if Module 04 lacks them), the Failed Post Alert template runnable.

**Out**: WhatsApp (Module 15, Coming Soon), interactive approvals inside Slack or Teams (a later idea: n8n's "send and wait"), Google Sheets and HTTP Request (Module 13).

## Tasks

- [x] `safe-http.ts`; `sendWebhook` rewritten on top; existing webhook tests green.
- [x] Simulation stand-in base using `parseSimulationDirective` and `currentAttempt`.
- [x] Slack, Teams, Discord providers with escaping, caps, success checks and the retry table.
- [x] Connection URL shape checks and help links for the three apps (confirm Module 04).
- [x] Gateway `/email` route with the daily cap and effect-based recipient tracking.
- [x] Catalog: mark the four types executable.
- [x] Web: Configure fields, previews, Teams help text, the "posts as the Workflows bot" note. (Catalog side done: forms, `preview` on all four, Teams notes; web side done: Slack, Teams, Discord and email previews with the Discord counter, Simulated sticker on connections.)
- [ ] Failed Post Alert: test and live run under simulation. (Test done on Temporal's test server; the live run is the lead's hand check.)

## Tests

- `safe-http`: every outcome, `Retry-After`, kept body cap, the DNS-pinning test from the webhook sender re-run against the new core.
- Each provider: request body snapshot (including Slack escaping of `<!channel>` and `<https://evil|x>` in user text, Discord `allowed_mentions`), success check (Slack 200 without `ok` is a failure), cut-and-note at the limits, classification per status.
- Stand-ins: each marker produces the right class; `x2` succeeds on attempt 3.
- Email: invalid address, 11 recipients refused by the schema, the daily cap, retry skips recipients already sent.
- A worker test runs Failed Post Alert with a simulated Post Failed payload: Filter passes, Slack simulated, In-App row written.

## Done When

- `npm run validate` passes; `webhook-sender.test.ts` unchanged and green.
- Failed Post Alert runs end to end under simulation, and a `[simulate:429x1]` message shows "Succeeded after 2 attempts" (`x2` succeeds on attempt 3).

## Hand Check

With `AUTOMATION_SIMULATION=true` and `PUBLISH_SIMULATION=true`:

1. Create a Slack connection with a made-up `hooks.slack.com/services/...` link. Open Failed Post Alert, pick it, activate.
2. Queue a post with `[simulate:400]` in its text and publish it: it fails, the worker console prints the simulated Slack line, the run shows Succeeded, and a bell notification appears.
3. Put `[simulate:429x1]` in the Slack message, run again: "Succeeded after 2 attempts".
4. Put `[simulate:401]`: the step fails with the reconnect sentence and the connection shows **Needs Reconnect** on the Connections page.
5. Optional, only with the user's OK: a real Slack or Discord webhook with simulation off.

## Handoff

README: progress row, the `safe-http` refactor, the Teams guidance you found, the Email path (gateway or outbox), the daily email cap, and which providers were tested only in simulation.
