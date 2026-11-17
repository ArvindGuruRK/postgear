# Module 16: Hardening, E2E And Sprint Close-Out

> **Sprint 13, Clips AI** | Status: Not started | Size: L (one full session, may need a second)
> **Depends on**: Modules 01 to 15
> **Stories**: the section 6 checklist of the user stories
> **Next**: [the real-test plan](../real-test-plan.md), then [Module 17](module-17-p2-backlog.md) only on Arvind's word

## Goal

After this module Sprint 13 is ready for Arvind's real test: a security and privacy sweep with a test for each line, every edge case of the stories seen once, an end-to-end suite for the AI layer and the creator tools in simulation, proof that every Sprint 12 clip still opens and exports the same, a look and accessibility pass, the docs up to date, and the completion checklist written. No new feature is built here.

## Read First

- `CLAUDE.md`; both READMEs (every "Done with gaps" note in this sprint's Progress table is this module's to-do list); the sprint doc's Definition Of Done and Risks.
- User stories: sections 4, 5 and 6.
- Research: [`07-cost-deploy-and-risks.md`](../research/07-cost-deploy-and-risks.md) (privacy, "What We Never Do", the risks register); [`10-creator-tools-and-editor-seats.md`](../research/10-creator-tools-and-editor-seats.md) section 15 (the risks of Module 14); Sprint 12's [Module 20](../../sprint-12/clips-implementation-docs/module-20-hardening-e2e-worker-image-closeout.md) (the sweep table and the e2e suite this one extends) and its [`12-plans-entitlements-and-usage.md`](../../sprint-12/research/12-plans-entitlements-and-usage.md) section 12 (the meter's tests and abuse cases).
- Code: `e2e/clips.spec.ts`, `packages/video-engine/fixtures/v1-clips/` (the regression set from Module 01), `apps/api/src/common/guards/editor-access.json` and its spec (Module 14), `docs/local-testing-guide.md`, `.claude/skills/sprint-closeout/SKILL.md`, `.claude/skills/verify-change/SKILL.md`.

## Design

### 1. Security And Privacy Sweep

Sprint 12's sweep table still applies; run it again over the new code. In addition, one test per line:

| Area | What must hold |
|---|---|
| The Python service | It is never reachable from the internet in the documented deployment; every HTTP route but `/health` needs the internal token; it starts no outside program with a shell; it reads and writes only clip keys that match the strict pattern; its scratch folders are removed |
| The contract | Unknown fields are refused on both sides; a payload never carries a path or an address; a version mismatch is refused with a clear error |
| Speech text | No transcript text, request text, model prompt or model answer appears in any log, notification or error message, on either side |
| Text sent to the AI model | Transcript rows are marked as quoted material and never treated as instructions; the user's request is cleaned and bounded; a transcript that says "ignore your instructions" changes nothing (a test with such a row); model answers are validated (row numbers exist, lengths bounded, titles cleaned of markup) |
| Pictures sent to the AI model | Only when `CLIPS_ACTION_VISION` is on; stills are deleted after every run, on success and on failure |
| Faces | The face file holds boxes and times only (the schema test); nothing identifies a person; face thumbnails in the picker are drawn in the browser and never uploaded; face files go with their video |
| Voices | Text To Speech is off unless its switch is on and its licence decision is recorded; made voices are marked and deleted with the library rules |
| Hosted services | Nothing leaves our servers unless its switch is on (`TRANSCRIBER`, `CLIPS_ACTION_VISION`, `CLIPS_TTS`, the model client); each is named in the privacy text; keys never appear in logs |
| The usage meter (AI Minutes) | Every AI route calls `consume` before the job and cannot be made to run for free through the worker-facing or internal routes; the same idempotency key charges once (20 parallel duplicates give one row); a failed or cancelled run reverses in full and a second reversal is a no-op; a reversal never takes `used` below zero and never above the original charge; two parallel charges with room for one admit one; an old cycle's reversal does not change the current window; a lowered limit leaves `remaining` at 0 and claws nothing back; the price comes from `pricing.ts` on the server, never from the browser |
| Editor Seats | The route-matrix test is green and lists every route; every denied route answers an Editor with 403, including by direct API calls with a hand-made body; an Editor **cannot schedule or publish by any route**: `schedule`, `publish-now`, a create or update asking for `QUEUE`, Send To Composer, Module 13's slot assignment and Next Available, repeat, and calendar moves, each tried as an Editor; a disabled Editor is refused everywhere; an invite cannot create an Editor beyond `members.editors_max` (soft check at invite, hard check at accept, two accepts racing for the last seat admit one, a role change and a re-enable re-check); an Editor invite token cannot be used by another address; old invite tokens still verify; the channel list answer carries no token; an Editor cannot read API keys, webhooks, billing or analytics data by route or by typed address; `member.invited`, `member.joined`, `member.role_changed` and `member.removed` are logged with actor and target and no secret |
| Emote Maker | Crop, start and end are bounded by the covered range and by 3 seconds, and refused otherwise; the source video is checked against the workspace (no other workspace's video id works); the encoder is run with an argument array and a graph file, never a shell string; scratch files are removed on success and on failure; signed links expire and cover only that job's files; the download meter is charged once per job and reversed on failure; no watermark is added and no AI Minutes are charged |
| Schedule Maker | The login is validated before any call and cannot reach another address; the Twitch app token and client secret never appear in a log line, an error message or a response (a logger spy test); the cache never serves data older than 24 hours; the fetch is throttled per workspace; a rows document with more than seven rows or over-long text is refused by the design schema; a design opened by another workspace's user is not readable (Studio's existing tenancy tests extended to the new document version) |
| The ASS pipeline | A caption or text style whose font is not in the manifest fails with `font_missing` instead of drawing a fallback; text in Tamil and Hindi, a very long word and a caption with no spaces never overflows its box in the rendered frame (a pixel test per case); user text is escaped for ASS (braces, backslashes, newlines) and cannot inject an override tag; the graph and subtitle files are written to the scratch folder and removed after the job |
| Google Drive | The access token is never logged, never stored after the job, and only the picked file is read |
| New sites | No site uses a login or a user's cookies; a site that is off cannot be reached by crafting a link |
| Publisher | `madeWithAi` and the posting window cannot be set on another workspace's post or channel |
| Simulation | `MEDIA_SIMULATION=true` is refused in production by every process that reads it |

Run the `security-review` skill on the branch diff as a second opinion and fix or record what it finds.

### 2. Edge Cases

One test for each row of the stories' section 5. For states that can only be forced in simulation, extend Sprint 12's forcing switches: a sample with no speech, `[simulate:listen-fail]` in a video's title, a clip whose face file is empty, a queue held busy by a flag, `[simulate:model-bad-rows]` to make the simulated model answer with rows that do not exist, `[simulate:emote-too-big]` for an emote no ladder step can fit, and the schedule fixtures `simvacation`, `simnoschedule` and `simnouser`. List them in the local testing guide.

### 3. End To End (`e2e/clips-ai.spec.ts`)

Under `CLIPS_SIMULATION=true`, `MEDIA_SIMULATION=true` and `AI_SIMULATION=true`, with the seeded workspace:

1. The status shows the AI service; with it stopped, AI buttons are off and Sprint 12's tools work.
2. Add Captions on a sample clip: steps, captions on the clip, the price charged once in AI minutes; a second clip from the same stretch is free.
3. Switch style; fix a word; trim; captions stay in step.
4. Transcript pane: delete a sentence, undo; Remove Silences with its count.
5. Clip Setup: the price changes with the range; a request; Upload SRT skips listening and charges nothing for it; a Genre; run; titled clips that start on a sentence.
6. Look For Action adds its clips and its line.
7. Detect Camera on the stream sample; Follow The Speaker on the two-speakers sample; switch it off and the layout is back.
8. Bleep Bad Words; Add Hook Title; Add Hook Clip.
9. Save As Recipe; apply it to another clip; a recipe on Clip Setup.
10. **Starter recipe**: pick Captions Only on a clip and see captions on and nothing else changed; a starter recipe is copied and the copy edited.
11. **Auto-Edit Video**: one press on a video makes one edited clip from a recipe and reports a skipped part honestly (a sample with no face).
12. Tick three clips, Export All: one notice.
13. Create Montage from two videos; export it.
14. A link from a new site imports; a site that is off is refused.
15. **Posting slots**: a channel with two weekday windows; Next Available gives two posts different minutes inside the right window and weekday; the random time picker (Morning, Noon, Afternoon, Evening) fills a time; Made With AI reaches the simulated publisher.
16. **Emote**: open Emote Maker from a clip's menu, a 2.4 second stretch, a crop, Export For Twitch: three GIFs each under 512 KB and at most 60 frames (read back with `ffprobe`); a stretch over 3 seconds is stopped.
17. **Schedule picture**: `simstreamer` in the Cool theme, Portrait: the editor opens with the week filled in, a hand edit sticks, the PNG downloads at exactly 1080 by 1350; the Landscape export at 1920 by 1080.
18. **Editor seat**: the admin invites an Editor (the link read from the API console), a second browser context accepts it, the Editor's rail and pages are cut down, a draft saves, schedule and Post Now are absent, a direct `schedule` request is 403; a second Editor invite on a one seat plan is refused.
19. Remove a video: its transcript and face file are gone.

Keep it under seven minutes. Tests share setup so each piece of expensive work runs once:

| Group | Tests | Shared setup |
|---|---|---|
| Captions and transcript | 1 to 4 | One imported sample video and one captioned clip, in a `beforeAll` |
| Setup and AI | 5 to 7 | One listened sample (the transcript from group one is reused) |
| Recipes | 8 to 11 | The captioned clip; recipes are applied and the clip documents inspected, with **no export** in tests 10 and 11 |
| Batch and montage | 12, 13 | The only video exports: one small batch and one montage |
| Sources and posting | 14, 15 | The seeded composer session and the simulated publisher; no render |
| Creator tools | 16, 17 | One session and the sample clip; the emote encode and the schedule PNG are small and run once each |
| Editor | 18 | A second browser context created from a token read through the API, no email sent; the admin context of the other groups is reused |
| Cleanup | 19 | Last, after everything that needs the video |

Real FFmpeg exports happen in three places only (a single clip, the small batch, the montage) plus the two small emote and PNG jobs. `e2e/clips.spec.ts` must still pass unchanged.

### 4. The Sprint 12 Regression Set

- Parse and upgrade every document in `packages/video-engine/fixtures/v1-clips/`; assert the render plan (`buildRenderPlan` output, and `frameState` at five recorded moments) is identical to what Module 01 recorded.
- Export each under simulation and compare with the record: the same length, the same five frame hashes (or, if encoder differences make hashes unstable, a picture difference below a small threshold; say which was used), a size within a few percent.
- Open each in the editor (the e2e suite does one) and check nothing is flagged as changed.
- Open a Studio design saved before schema version 3 and check it loads, edits and exports unchanged.
- Any difference is a defect of this sprint and is fixed here, not accepted.

### 5. Performance, Accessibility And Look

- **Editor**: a clip with captions and forty cuts plays smoothly and its timeline stays responsive; the Transcript pane with a thousand words scrolls smoothly (only what is visible is drawn, or it is cheap enough not to matter: measure).
- **Preview**: captions do not cause the whole editor to re-render on every frame; **Preview Export** of a captioned clip matches the editor at five moments (words, place, style, timing).
- **Python**: a ten minute sample is listened to, and faces found, inside the times Module 02's and Module 07's benchmarks predict; memory stays flat across three runs.
- **Accessibility**: `TranscriptText` is usable by keyboard and announces selection; every AI progress bar has `aria-live` text; switches have labels; underlines and strike-throughs are not the only signal (a tooltip or text alternative); the Emote Maker crop box and trim window can be moved with the keyboard and announce their values; the schedule row editor is a labelled table. Run the `design:accessibility-review` skill on Clip Setup, the Captions tab, the Transcript pane, the Emote Maker and the Team page's invite dialog.
- **Look**: light, dark and Lilac at 1366 px and 1920 px for Clip Setup, the Captions tab, the Transcript pane (three columns at 1366 px), the bulk bar, the kit page, the Emote Maker, the Schedule Maker wizard, the Editor's reduced rail and the composer additions. A critique checklist in `docs/design-patterns/`, ticked as fixed.
- **Copy**: the title-case test is green; search user-facing strings for the banned words of both sprints.

### 6. Docs

- `docs/local-testing-guide.md`: the Clips section gains Clips AI: installing uv and Python, `uv sync` with and without the model libraries, the three simulation flags, the samples and forcing switches, the schedule fixtures, how to try an Editor (read the invite link from the API console), both e2e suites.
- `.env.example`: every variable of this sprint in the Clips block.
- `CLAUDE.md`: Architecture gains `apps/media` (what it is, how it is started, that it serves activities only), `packages/media-contract`, the Python queue, `packages/entitlements` and the Editor role; Commands gains the uv-backed scripts; Simulation modes gains `MEDIA_SIMULATION`; a line that `npm run validate` now needs uv installed (or skips Python with a visible notice when it is missing: state which).
- `SCHEMA_NOTES.md`: the Sprint 13 additions (the `Role.EDITOR` value and why it is its own migration, `EMOTE`, the Design Studio schema version 3).
- Both sprint docs' Deviations sections list every deviation recorded in the Decision Logs.
- The index READMEs: set the Sprint 13 rows' status.
- The completion checklist through the `sprint-closeout` skill: `docs/sprint-completion-checklists/sprint-13-completion-checklist.md`, with honest statuses (what ran with a real model, what only in simulation).

## Scope

**In**: the sweep, edge cases and forcing switches, the e2e suite, the regression set, performance, accessibility and look passes, docs, the completion checklist.
**Out**: any new feature, real-model and real-video testing (the real-test plan does that with Arvind), deployment.

## Tasks

- [ ] The sweep table: a test per line (including the new Editor, Emote, Schedule, meter and ASS rows); fixes; `security-review` on the diff.
- [ ] A test for each row of the stories' section 5; the forcing switches.
- [ ] `e2e/clips-ai.spec.ts` (19 tests in the groups above, under seven minutes) green; `e2e/clips.spec.ts` still green.
- [ ] The regression set: parse, render plan, export, compare; old Studio designs; fix any difference.
- [ ] Performance checks; accessibility review and fixes; the look pass with its checklist.
- [ ] Docs: testing guide, `.env.example`, `CLAUDE.md`, SCHEMA_NOTES, Deviations, index rows.
- [ ] `npm run validate` green, Python included.
- [ ] The completion checklist through `sprint-closeout`.
- [ ] Update the Progress table and the Decision Log; set the sprint doc's Definition Of Done boxes honestly.

## Tests

```powershell
npm run validate
npm run test:e2e -- e2e/clips.spec.ts e2e/clips-ai.spec.ts
npx jest --config packages/video-engine/jest.config.js fixtures
npx jest --config apps/api/jest.config.js apps/api/src/common/guards
```

## Done When

- Every line of both sweep tables has a passing test.
- Every row of the stories' section 5 has been seen once and has a test.
- Both e2e suites pass under simulation, the new one in under seven minutes.
- Every clip in the regression set upgrades, plays and exports the same as before this sprint, and an old Studio design is unchanged.
- An Editor cannot schedule or publish by any route, and no invite can exceed the seat limit.
- No speech text and no Twitch secret is in any log.
- The docs describe Clips AI as it is, and the completion checklist says plainly what was only checked in simulation.

## Hand Check

1. `npm run validate` and both e2e suites: green.
2. Walk Journeys A, B and C of the stories in simulation, in the dark theme, then Journey D's rows with the forcing switches.
3. Open three Sprint 12 clips made before this sprint: they look and export the same.
4. Search the API's, the worker's and the Python service's logs of that session for a word you know is in a sample's transcript, and for the Twitch client secret: not found.
5. As an Editor, try five admin addresses and the schedule route by hand: every one is refused.
6. Read the completion checklist's "Known gaps" and "What remains for you".
7. Then start [the real-test plan](../real-test-plan.md).

## Handoff

The sprint is closed for building. The real-test plan follows; its defects are fixed one per session with the fix prompt written there. Module 17 holds what was parked.
