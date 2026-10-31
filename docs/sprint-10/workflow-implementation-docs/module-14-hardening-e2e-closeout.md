# Module 14: Hardening, E2E And Sprint Close-Out

> **Sprint 10, Workflow Builder** | Status: Done (2026-10-31) | Size: M (L if many gaps turn up)
> **Depends on**: Modules 01 to 13 Done (or Done with gaps that are written down)
> **Stories**: the user stories' section 4 (UX rules), section 5 (edge cases), section 6 (completion checklist)
> **Next**: the sprint PR, then [Module 15](module-15-p2-backlog.md) only if the user decides

## Goal

Turn "every module works" into "the sprint is done and provably so":

- the edge cases in the user stories' section 5 behave as written;
- security, tenancy and secret handling are proven by specs, not by reading code;
- an end-to-end spec covers build, connect, validate, test run and activate;
- performance holds with a 50-step workflow and hundreds of runs;
- accessibility, themes and phone width are checked;
- the completion checklist is written with the `sprint-closeout` skill, including what was only run in simulation.

## Read First

1. [`README.md`](README.md): the Progress table and the whole Decision Log (every gap a module left is listed there).
2. The sprint doc's "Definition Of Done" and "Risks"; the user stories' sections 4, 5 and 6.
3. The `sprint-closeout` skill and the most recent example: `docs/sprint-completion-checklists/sprint-09b-completion-checklist.md`.
4. `e2e/` (existing Playwright specs and helpers) and the `run-postgear` skill.

## Scope

**In**: gap fixing from the Decision Log, edge case pass, security and tenancy specs, the e2e spec, performance pass, accessibility and theme pass, `.env.example` and `docs/local-testing-guide.md` updates, the completion checklist, the sprint doc's deviation table, and the README's final state.

**Out**: new features. Anything new goes to Module 15 or a later sprint.

## Design

### 1. Gap sweep

Read every "Done with gaps" row and every Decision Log line that says "later" or "not done". For each: fix it if it is a P0 story, or record it as a known gap with the reason. Never silently drop one.

### 2. Edge cases (user stories section 5), each with a test or a written manual check

| Situation | Proof |
|---|---|
| A connection stops working | provider spec: 401 from the stand-in marks the connection Needs Reconnect and the step message says how to fix it |
| Outside app briefly down | `[simulate:429]` then success: "Succeeded after 2 attempts" (worker test) |
| Out of AI credits | ledger at zero: the run stops at Generate Text with the exact message and a notification (worker test) |
| Channel disconnected | validation marker "{Channel} is disconnected. Reconnect it on the Channels page."; a live run fails with the API's "One of the selected channels is no longer connected. Remove it and save again." |
| Earlier step deleted | chips red, activation refused (package and API spec) |
| Same post event twice | one run (worker test replaying the publish activity) |
| Worker restart during a run | manual check: start a run with a Delay of 2 minutes and a review, stop and restart `dev:worker`, the run continues and the review still waits |
| Active workflow edited | Unpublished Changes, live runs use the old version (API spec + worker test) |
| Paused schedule resumed | no catch-up (schedule spec with the Temporal test env or a manual check with a 2-minute schedule) |
| Member tries to activate | 403 (API spec) and disabled button with the reason |
| Review never answered | 7-day timeout (workflow test with time skipping) |
| Too many steps or tests | 51st step refused; 4th test in a minute refused with the message |
| Another workspace's link | 404 for workflow, run, connection, version, and the events stream |

### 3. Security specs (API)

- **No secret anywhere**: create Slack, Teams, Discord, HTTP (secret header) and Google connections with recognisable fake secrets; run a test that uses each; then fetch every automation, catalog, connection, run, run step, version and events endpoint and assert none of the secret strings appear (one sweeping spec).
- **Graph refusal**: a PATCH with a secret-looking value in a config field, or an unknown key, is refused.
- **Tenancy**: every route with another workspace's ids answers 404.
- **Roles**: activate, pause, connection writes, OAuth start: member gets 403.
- **Webhook trigger**: wrong secret 401, oversized body 413, paused workflow does not start a live run, throttling.
- **HTTP Request and webhook sends**: localhost, 169.254.169.254, a private IP and a redirect to one are refused.
- **No `eval`**: the guard test in `packages/automation` passes.

### 4. E2E spec (`e2e/workflows.spec.ts`)

Prerequisites as in `CLAUDE.md` (docker services, seeded DB, `dev:api:e2e`, simulation flags on). One spec file, serial:

1. Create from the Failed Post Alert template; Finish Setup lists the Slack connection.
2. Connect Slack by pasting a fake webhook link (simulation accepts it); the issues chip reads "No issues found".
3. Insert data into the Slack message through Insert Data.
4. Test Workflow with the built-in sample; every step reaches its final state; Slack shows Dry Run.
5. Activate as admin: the dialog sentence is shown; confirm; the badge reads Active v1.
6. Edit the message: Unpublished Changes; Discard Changes restores it.
7. As the member account: Activate is disabled with the reason.
8. Publish a post with `[simulate:400]` (PUBLISH_SIMULATION; a permanent `rejected` failure the template's filter lets through) so it fails: a Live run appears in the Runs tab and succeeds.

### 5. Performance

- A generated 50-step graph (the limit) pans and zooms smoothly; Tidy Up completes under 300 ms; typing in a chip input does not re-render the whole canvas (React profiler check; memoise step cards on their own data).
- Validation of a 50-step graph under 20 ms in the browser (measure; `validateGraph` uses the shared index).
- Runs list with 500 seeded runs scrolls smoothly; the list endpoint uses the indexes from Module 03 (check the query plan with `EXPLAIN` through `docker exec postgear_postgres psql`).

### 6. Accessibility, themes, phone

- Keyboard only: build Failed Post Alert without a mouse (N, arrows, Enter, the "+" menu, the panel fields), test it, read the result.
- Screen reader spot check of a step card, the picker and the run list.
- Light, dark and Lilac on the list, builder, panel, Expanded view, Runs tab, Connections and every dialog; reduced motion; phone width.
- No jargon: grep the web copy for "payload", "cron", "JSON" (outside the Raw tab), "node", "execution".

### 7. Docs

- `.env.example`: `AUTOMATION_SIMULATION`, the Google keys from Module 13, with comments.
- `docs/local-testing-guide.md`: a Workflows section (how to run each template under simulation, how to test a schedule quickly, how to send for real).
- Sprint doc: tick the Definition Of Done with evidence (the Sprint 9 doc's style: "**Verified live**: ..."), add a **Deviations** table (every Decision Log line that changed the plan, including the Create Draft path choice and the credits ledger move).
- `packages/db/prisma/SCHEMA_NOTES.md` covers every new model.

### 8. Close-out

Run the `sprint-closeout` skill for Sprint 10. It writes `docs/sprint-completion-checklists/sprint-10-completion-checklist.md`, checks every line of the user stories' section 6 against the code and the running app, and records:

- which integrations ran only in simulation (expected: Teams, Discord, Google Sheets, Email without SMTP, HTTP Request) and which were run for real with the user's OK;
- the two human checks that need a person (Journeys A to D walked by hand, a first-time user activating a template in under 10 minutes);
- known gaps and what remains.

Finally update the README: every module's status, and the Progress table's last line.

## Tasks

- [x] Gap sweep from the Decision Log.
- [x] Edge case table: every row proven.
- [x] Security specs (secret sweep, refusal, tenancy, roles, webhook trigger, SSRF).
- [x] `e2e/workflows.spec.ts` passing.
- [x] Performance pass with numbers written down.
- [x] Accessibility, themes, phone width, jargon grep. (Reduced motion was not checked in the browser: see Known gaps in the completion checklist.)
- [x] `.env.example`, local testing guide, sprint doc DoD and deviations, SCHEMA_NOTES.
- [x] `sprint-closeout` skill run; README final update.
- [x] `npm run validate` passes (43 of 43 tasks, on the working tree; Modules 10 to 14 are not committed yet).

## Done When

Every line of the sprint doc's Definition Of Done is ticked with evidence or listed as a known gap with a reason, and the completion checklist exists.

## Hand Check

Walk Journeys A to D from the user stories yourself, start to finish, without help. Time a first activation from a template. Tell the session what felt slow or confusing; small fixes land here, bigger ones go to Module 15.

## Handoff

The README's Progress table shows the final state of every module. Suggest the PR title and body (do not open it unless asked).
