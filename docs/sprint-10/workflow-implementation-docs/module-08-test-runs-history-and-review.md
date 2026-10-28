# Module 08: Test, Live Run View, Run History And Manual Review

> **Sprint 10, Workflow Builder** | Status: Not started | Size: L
> **Depends on**: [Module 06](module-06-step-panel-and-data-mapping.md) (panel, Output pane slots), [Module 07](module-07-run-engine.md) (run engine, run endpoints, run events stream)
> **Stories**: WF-3.4, WF-5.2, WF-5.3, WF-10.1, WF-12.2 (Cancel; Retry From Here is P1 here)
> **Next**: [Module 09](module-09-triggers-activation-versions.md)

## Goal

The builder comes alive. This is the "watch it work" moment that makes Make and n8n click for people:

- **Test Workflow** plays the run on the canvas: steps light up, data flows along the lines, each step gets a result badge;
- **Test Step** runs one step with pinned or sample input and shows the result in the Output pane;
- the **Runs** tab lists every run and paints any of them on a read-only canvas with per-step input and output;
- **Debug In Editor** and **Retry From Here** turn a failed run into a fix in two clicks;
- a run waiting at **Manual Review** can be approved, edited or rejected from the run view and from the notification.

## Read First

1. [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 5.1 (Test tab), 7 (Running And Watching) and 3 (run bar).
2. [Module 07](module-07-run-engine.md) "Design": run statuses, step statuses, the events stream, the test-run and step-test endpoints, the review endpoint, dry runs, and how "send for real in tests" is passed.
3. `apps/web/src/lib/sse.ts` and one existing consumer (the SEO or AI page) for the SSE pattern; `apps/web/src/components/notifications/` for how notifications render and link.
4. User stories WF-5.2, WF-5.3, WF-10.1 and section 5's edge cases.

## Scope

**In**: Test Workflow button and Ctrl/Cmd+Enter, sample source choice, the run bar, live canvas painting from the events stream with polling fallback, step result badges, Test tab (Test Step, dry run notice, Send For Real In Tests with confirm, Pin), Output pane live results, Runs tab (list, filters, read-only canvas replay, step list with Data/Table/Raw, Copy Details), Debug In Editor, Cancel, Retry From Here (P1, with a small worker addition), review UI (Approve, Edit Then Approve (P1), Reject) in the run view, the canvas and from the in-app notification.

**Out**: live trigger firing and Run Now (Module 09); failed-run notifications (Module 09); integration-specific result rendering beyond generic output (each integration module may add a nicer preview).

## Design

### Run view model (`apps/web/src/components/workflows/runs/run-model.ts`)

A pure reducer turns the run detail plus streamed events into `{ runStatus, steps: Record<nodeKey, { state, attempt, durationMs, startedAt, dryRun, error?, waiting? }>, edgesTaken: Set<edgeId>, edgesSkipped: Set<edgeId> }`. Unit tested with recorded event sequences (linear success, If / Else false path, failure with continue, review wait then approve, cancel). The canvas and the run bar only read this model.

`edgesTaken` is derived: an edge is taken when its source finished on that port (from the step's output port in the event) and its target started.

### Test Workflow

- Button in PageActions (primary) and Ctrl/Cmd+Enter. It flushes autosave first, then `POST /automations/:id/test-runs`.
- **Sample source** (split button menu): "Use the last real {event}" (default when one exists), "Use the built-in sample", "Use pinned data". Manual trigger: a dialog asks for its input fields first. Webhook trigger (Module 13): "Use the last received data".
- While running, the Test button turns into **Stop** (cancel endpoint). One test run at a time per builder; throttling errors read "Too many test runs. Try again in a minute."
- **Send For Real In Tests**: a per-step switch in the Test tab with a confirm ("This test will really send a Slack message."). Kept in builder memory only and reset when the page closes (safe by default), sent with the test-run request as Module 07 defines. Steps with it on show a red "Live In Tests" sticker.

### Live painting (blueprint 7.1 and 7.2)

- Subscribe to `GET /automation-runs/:runId/events` with `lib/sse.ts`. On disconnect, fall back to polling `GET /automation-runs/:runId` every 1.5 s until terminal.
- Step cards get the state class from the model; badges show the check, cross or pause plus duration; dry run steps get the Dry Run sticker; handled errors are amber with "Error Handled"; retried steps show "2 attempts".
- Lines: the line into a running step uses React Flow's `animated` dashed style with a CSS flow keyframe; taken lines turn solid success colour; skipped branches dashed and faint.
- The **run bar** (bottom): "Test run 14:02, 4 of 6 steps, 3.1 s", Stop, Close (clears the paint; structural edits also clear it, moves do not).
- Clicking a result badge opens the step in the Expanded view on that run's input and output.
- Reduced motion: no flow animation or pulse, the state changes still show with words.

### Test Step (WF-3.4)

- In the Test tab and the hover toolbar. Calls `POST /automations/:id/steps/:nodeKey/test` with the current (flushed) draft.
- Input: pinned data of upstream steps, else the last test run's outputs, else built-in samples; the tab says which ("Using: pinned data from Set Fields").
- Result in the Output pane and the Test tab: success output (Data, Table, Raw), or the error in one sentence plus **Copy Details**. Dry run steps show "Dry run: this is what would have been sent." with the would-send content rendered readably.
- **Pin This Result** saves it as the step's pinned data.

### Runs tab (blueprint 7.3)

- Editor/Runs switch in PageActions (`?tab=runs`). Left: run list from `GET /automations/:id/runs` (cursor pagination, infinite scroll, smooth with hundreds of runs). Each row: status sticker with words, Test or Live, trigger phrase ("Post published on Instagram"), started (relative, exact on hover), duration, version ("v3"), credits used when above zero. Filters: All, Succeeded, Failed, Waiting, Test.
- Statuses in words: Running, Waiting For Review, Succeeded, Failed, Cancelled, Rejected (neutral, not red), Review Expired (neutral).
- Right: the run's graph **version** rendered read-only on the canvas (not the current draft) and painted with the run model; under it the step list in run order with status, attempts, duration, and expandable input and output (Data, Table, Raw). Secrets are already redacted by the API; if the step was cut, show "This data was cut to 64 KB."
- A failed step shows the message in one sentence, what to do, and **Copy Details** (copies a plain text block: workflow, run id, step, error code, time).
- `?run=<runId>` deep link opens it.

### Debug In Editor

On a run: copies the run's trigger data into the trigger's pinned data (and optionally every successful step's output, a checkbox "Also pin the results of steps that worked"), switches to the Editor tab, selects the failed step. Toast: "Run data pinned. Fix the step, then test again." (n8n's Debug In Editor.)

### Cancel (WF-12.2)

Running and waiting runs show **Cancel Run** (confirm). Calls the cancel endpoint; the run ends Cancelled; the painted canvas updates from the stream.

### Retry From Here (P1, WF-12.2)

- Offered on a failed step only when its definition has `retry: 'safe'` and the run is terminal.
- `POST /automation-runs/:runId/retry { fromNodeKey }` creates a **new** run (same version, same trigger payload, `retryOf: runId`), seeding every step that succeeded before `fromNodeKey` with its stored output and starting the interpreter at `fromNodeKey`. Steps after it run normally. Worker change: the run workflow input accepts `seed: { nodeKey, output, port }[]` and `startAt`; `planNext` treats seeded steps as finished. Add this to Module 07's workflow with a test.
- Disabled with the reason when the step is not safe to repeat ("Publishing steps cannot be retried from here. Start a new run instead.") or when the run's version is no longer the active one ("This run used an older version.").

### Manual Review (WF-10.1)

- **In the run view and on the canvas**: a waiting Manual Review step shows the review card: the content configured for the reviewer (resolved text and image), instructions, the expiry ("Expires in 6 days"), and **Approve**, **Edit Then Approve** (P1: an editable text area; the edited text becomes the step's output `text`), **Reject** (optional reason).
- **From the notification**: Module 07 writes a notification "Your {workflow} is ready for review." with a link to `/workflows/{id}?tab=runs&run={runId}&review=1`, which opens the review card directly. (No approve buttons inside the bell itself in v1; one click away is enough and keeps the review in context.)
- Calls `POST /automation-runs/:runId/reviews/:nodeKey { decision, editedText?, reason? }`; double submission is safe (the API answers the second with the first decision).
- After Approve the run continues live on the canvas. Reject ends the run as Rejected (neutral sticker), unless the Rejected output is connected.
- Records who decided and when; shown on the step ("Approved by Priya, 09:14").

### Output pane wiring (Module 06 slots)

The Expanded view's Output pane and Input pane now read the last test run of this workflow from the run model, labelled "Last test 14:02". Pinned data still wins for Input.

## Tasks

- [ ] `run-model.ts` reducer (+ recorded-event tests).
- [ ] Test Workflow button, sample source menu, Manual inputs dialog, Stop, throttling message.
- [ ] SSE subscription with polling fallback; canvas painting, result badges, line animation, run bar.
- [ ] Test tab: Test Step, dry run rendering, Send For Real In Tests with confirm, Pin This Result; hover toolbar Test Step.
- [ ] Runs tab: list, filters, pagination, read-only version canvas, step list, Copy Details, deep link.
- [ ] Debug In Editor.
- [ ] Cancel Run.
- [ ] (P1) Retry From Here: API route, worker seed and startAt, UI rules (+ workflow test in the worker).
- [ ] Review card in run view and canvas, notification link, Edit Then Approve (P1), Reject, decided-by line.
- [ ] Output and Input panes fed from the last test.

## Tests

- Unit: run model with five recorded sequences; edge-taken derivation; badge text per state ("Succeeded after 2 attempts").
- Component: review card buttons call the API once; Rejected is not styled as failure; Retry From Here disabled reasons.
- Worker: retry with seeds starts at the right step and does not re-run seeded side effects.
- Playwright (big flow): Failed Post Alert template under simulation, Test Workflow with the built-in sample, watch steps paint, open the run in the Runs tab, see the dry run Slack output. Then AI Weekly Post with pinned text: the run stops at review, approve it, see the draft step succeed. Screenshots in light, dark, Lilac, and one with reduced motion.

## Done When

- WF-3.4, WF-5.2, WF-5.3, WF-10.1 (except the restart survival check, verified in Module 14) and Cancel work in the running app.
- Nothing outside PostGear is reached in a test unless Send For Real In Tests was switched on and confirmed.
- `npm run validate` passes.

## Hand Check

1. Open Failed Post Alert, Test Workflow: watch the steps light up and the badges appear; the Slack step says Dry Run and shows the message it would send.
2. Turn on Send For Real In Tests for Slack, confirm, test again (simulation logs the send in the worker console).
3. Make a step fail: add `[simulate:500]` to the Slack message (with Send For Real In Tests on), test, open the run in the Runs tab, Copy Details, Debug In Editor.
4. AI Weekly Post: pin a short text on Generate Text to save credits, test, approve from the notification link, see the draft in Drafts.
5. Start a test with a Delay of 10 minutes and cancel it.

## Handoff

Update [`README.md`](README.md): progress row, the event names the UI relies on, and whether Retry From Here shipped.
