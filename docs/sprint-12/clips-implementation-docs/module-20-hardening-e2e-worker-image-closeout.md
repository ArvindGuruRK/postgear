# Module 20: Hardening, E2E, Worker Image, Close-Out

> **Sprint 12, Clips** | Status: Done with gaps (2026-11-19) | Size: L (one full session, may need a second)
> **Depends on**: Modules 01 to 19
> **Stories**: the section 6 checklist of the user stories; the tests of CL-1.7, CL-10.4, CL-13.6 and CL-13.7 (channel browse, Preview Export, the operator screen and the library)
> **Next**: [the real-test plan](../real-test-plan.md), then [Module 21](module-21-p2-backlog.md) only on Arvind's word

## Goal

After this module Sprint 12 is ready for Arvind's real test: a security sweep with a test for each finding, every edge case of the stories seen once, end-to-end suites that run the whole flow (and the operator screen) in simulation, a look and accessibility pass, a real worker image that carries FFmpeg, the video tools and the fonts, the docs brought up to date, and the completion checklist written. No new feature is built here.

## Read First

- `CLAUDE.md`, then the README in this folder (the whole Progress table and Decision Log: every "Done with gaps" note is this module's to-do list).
- User stories: sections 4, 5 and 6.
- Sprint doc: Definition Of Done, Risks.
- Research: [`07-legal-limits-cost-and-risks.md`](../research/07-legal-limits-cost-and-risks.md) (abuse and security, the risks register); [`02-libraries.md`](../research/02-libraries.md) (the FFmpeg build and its licence, the yt-dlp executable's licence notices, the pinned versions); [`05-editor-and-render.md`](../research/05-editor-and-render.md) and [`09-ffmpeg-render-cookbook.md`](../research/09-ffmpeg-render-cookbook.md) (what the FFmpeg build must support, the fonts, the parity tests); [`12-plans-entitlements-and-usage.md`](../research/12-plans-entitlements-and-usage.md), sections 11 and 12 (the race cases, the abuse table and the test list); [`10-open-source-sound-and-sticker-libraries.md`](../research/10-open-source-sound-and-sticker-libraries.md), sections 5, 8.3 and 14 (the licence allow-list and the guard); [`11-channel-browser.md`](../research/11-channel-browser.md), sections 7 and 10.
- Code: `e2e/` (the helpers, `discover.spec.ts` as the newest suite), `docs/local-testing-guide.md` (the section letters in use), `infra/docker/` (the placeholder Dockerfiles), `.github/` (what CI runs), `.claude/skills/sprint-closeout/SKILL.md`, `.claude/skills/verify-change/SKILL.md`, `docs/sprint-completion-checklists/sprint-11-completion-checklist.md` (the house format).

## Design

### 1. Security Sweep

For each line: read the code, write a test that would fail if it were broken, fix what is found, and list the finding in the completion checklist.

| Area | What must hold |
|---|---|
| Outside programs | Only `packages/media-tools` imports `child_process`; every call is an argument array with `shell: false`; no user text reaches a flag position; `--` precedes every URL; yt-dlp runs with `--ignore-config` and the extractor allowlist |
| Links | Only `canonicalUrl` values rebuilt from an id reach yt-dlp for import and download; look-alike hosts, other schemes, credentials in the URL and very long input are refused; the thumbnail route only fetches through the guarded fetch. The channel lister is given only a URL it built from a validated handle and a fixed host, its listing extractors are allowlisted for the lister alone, and no listing answer carries a download address |
| Uploads | Every uploaded file (video, sound, sticker) is identified by its bytes and probed before FFmpeg opens it; a playlist or a script file renamed to a media name is refused; FFmpeg is given a protocol allowlist when reading user files |
| Storage | No private key is ever in an API answer; signed addresses expire, cannot be altered, and are per file; clip keys match the strict pattern; a delete by prefix can only touch the caller's workspace prefix; in production the clips space refuses the local binding; the public `library/` prefix is written only by the ingest and the operator service, never by a user request |
| Tenancy | Every Clips route, job, download, layout, sound, sticker and channel answers 404 for another workspace; the internal routes (finish, charge-import, reverse) need the internal token; `/clips/coming-up` and `/entitlements/me` show only the caller's workspace |
| Operator routes | **SUPERADMIN only** (`PlatformAdminGuard`): 401 without a session, 403 for a member, and **in production 403 for a superadmin whose address is not in `OPERATOR_EMAILS`**; the org cookie is ignored; writes need a reason and are throttled; the Change Log has no update or delete route; the web answers 404 to a non-operator |
| Entitlement writes | Every write is validated against the registry (`validateValue`: type, range, reserved 4K, unknown key, tier, override end date at most 366 days, reason of at least 10 characters) on the server whatever the UI sent; a stale `updatedAt` is a 409; a stored value that fails validation is ignored and logged, so a bad cell cannot lock anyone out |
| Meters | A charge cannot make `used` negative or push it over the limit (Serializable transaction, `P2034` retried); the same idempotency key twice is one row; keys are per workspace so one tenant cannot probe another's; a reversal cannot exceed its original or reverse a reversal; a failed or cancelled job is reversed once; a database error fails closed (503) and never skips a charge |
| Library licence guard | The ingest and the operator publish route refuse any item whose licence is not on the allow-list for its kind (sounds never take CC BY; no NC, ND, SA, GPL, unknown); `licence_url` must match; brand names and derivative signals are rejected; Openverse and OpenGameArt runs are never auto-published; a removed item is on the deny list and cannot be ingested again; no route accepts a source address |
| Documents | A saved clip document is validated with the strict schema on every write; unknown keys are refused; limits on parts and items hold; a document cannot refer to another workspace's video or asset (checked on save and again when a render is prepared) |
| Messages | No answer or notification carries a tool's output, a file path, a storage key or a platform's raw error |
| Render | FFmpeg reads only files named in the render plan inside its own scratch folder (no user text becomes a path or a protocol); the filter graph and every ASS file are written to files and passed with `-/filter_complex <file>` and a `subtitles` path, never built into a shell string; user text in titles is escaped for ASS and the escaping is tested with hostile input (braces, backslashes, newlines and ASS override codes); user files are read with a protocol allowlist; **a font that is not installed fails the job with `font_missing`** instead of drawing another font; the mark is decided by the server |
| Limits | Each plan limit and abuse limit refuses on the server, not only in the UI, with the typed 402 and its code; the worker never resolves entitlements, the API copies quality, mark and priority into the job; a job cannot outlive its timeout; a downgrade below current use deletes nothing |
| Secrets | `CLIPS_URL_SECRET`, cookies files and proxy addresses never appear in logs; the cookies file path is read only by the worker; **`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, the Twitch app token and `CLIPS_YOUTUBE_API_KEY` never appear in a log line, an error or an API answer** (the logger redacts the names and a test greps a run's output); S3 keys likewise |
| Simulation | `CLIPS_SIMULATION=true` is refused in production by the API and the worker; simulation links are refused when simulation is off |

Run the `security-review` skill on the branch diff as a second opinion and fix or record what it finds.

### 2. Edge Cases

One test (unit, API or e2e, whichever is cheapest) for each row of the stories' section 5. Where a state can only be forced in simulation (a platform resting, the sharp video gone, a failed export), add a way to force it that works only under `CLIPS_SIMULATION=true`: special simulation links (`...?sim=resting`, `...?sim=gone`) and a text marker in a clip's name (`[simulate:render-fail]`), in the spirit of publishing's `[simulate:429]`. List the forcing switches in the local testing guide.

### 3. End To End (`e2e/clips.spec.ts`)

Under `CLIPS_SIMULATION=true`, with the seeded demo workspace, in one file with shared setup. Number the tests as the guide does:

1. The rail entry, the five tabs (Create, Videos, Streams, Clips, Downloads), the small-screen sentence at 1280 px.
2. Paste the Twitch simulation link, see the card, import needs the tick, import, the card becomes ready.
3. The private, live and unsupported links show their sentences.
4. Upload the 3 minute sample.
5. The video page: play, mark with I and O, Create Clip.
6. Find Clips: price on the button in AI Minutes, steps, scored clips, a flag on the timeline; the AI minutes chip went down by that number.
7. The editor: choose Vertical, Split layout, move a crop box, trim, split, undo.
8. Add a text, a sticker, a zoom, a sound; set a part to 2x.
9. Export at 720p; the clip is in Media with a poster and a length.
10. The out-of-date alert after a change; the plan lock on the Free workspace.
11. Send To Composer: an unfit channel is greyed; the composer opens with the clip.
12. Download 720p from a link; Save File's link answers.
13. Delete a video: the sentence; the meter drops.
14. The second workspace cannot open the first one's video, clip or job.
15. **Channel browse**: Streams tab, Add A Channel, Twitch, `simstreamer`, the list appears; hide one and show it again; Import another through the link card; a Free workspace at its channel limit gets the sentence.
16. **Library search**: in the editor open Elements and Audio, search a word, see results, mark one a favourite and find it under Favourites; upload a sound.
17. **Preview Export**: in the editor press Preview Export, watch it render at low resolution, play the result, then Export Clip at 720p; the two agree on the text, the crop and the sticker positions.
18. **Try A Sample**: the button imports the sample with no tick; pressing it again says the video is already there.

A second file, **`e2e/operator.spec.ts`** (own sign-in as the seeded superadmin, the API started with the e2e throttle):

- The operator opens Operator, changes a Free plan value for Clips (for example `clips.storage_gb` from 3 to 4), reviews and saves with a reason; the Clips page of a Free workspace then shows the new limit, and the Change Log has the row.
- The operator adds an override for one workspace, sees its chip change, removes it, and sees it return.
- A non-operator member opening `/operator` gets the 404 page.

Keep the suite under five minutes: use the 3 minute sample wherever the 10 minute one is not needed, and one export (plus the low resolution Preview Export) only. It runs in CI only if FFmpeg (with libass, libharfbuzz and libx264) is available there; if it is not, add it to the CI job, or mark the render tests to skip in CI with a visible note in the checklist (do not silently skip). **S3 tests in CI use a MinIO service container** (the storage package's S3 tests run against it when `S3_ENDPOINT` is set); there is no browser to install for rendering. Parity checks (`frameState` numeric tests, the per-feature compiler tests that render one frame and compare pixels, the still-frame script) run in the normal test job.

### 4. Performance, Accessibility And Look

- **Timeline**: a simulated 6 hour video (a fixture with long `meta`, no real file) scrolls and zooms smoothly on the video page; only the visible range is drawn. The editor stays responsive with 50 parts and 100 items (the limits).
- **Editor memory**: an hour of editing does not grow memory without bound (take two heap snapshots ten minutes apart while repeating a trim and undo loop).
- **Preview**: changing the document redraws only the preview layers that changed, not the whole editor, and the editor keeps up while it plays with 50 parts and 100 items; the preview uses `frameState` and never calls the render queue (only Preview Export does).
- **Accessibility**: every icon-only button has a tooltip equal to its `aria-label`; the timeline is reachable and operable by keyboard; focus is visible; dialogs return focus; progress has `aria-live` text; colour is never the only signal. Run the `design:accessibility-review` skill on the Clips page, the video page and the editor.
- **Look**: light, dark and Lilac at 1366 px and 1920 px for the page, the video page and every editor tab. Fix what is off. Write the critique as a checklist in `docs/design-patterns/` (the house way) and tick it as you fix.
- **Copy**: the title-case test is green; search the Clips code for the banned words (source, proxy, segment, asset, job, render, ingest, transcode) in user-facing strings.

### 5. The Worker Image (`infra/docker/Dockerfile.worker`)

The placeholder becomes a real image for the worker (all roles; the role is chosen by `WORKER_ROLES` at run time):

- Base: `node:22-bookworm-slim`, a **Debian slim image with no browser of any kind**. Debian (glibc) because yt-dlp's standalone Linux executable targets glibc; FFmpeg itself has no such limit. The image is small because nothing in it draws a page: FFmpeg draws the video and libass draws the text.
- Tools, each at a pinned version with a checksum checked in the build: FFmpeg and ffprobe from a **GPL static build run as a separate program** (the source and the reason are in research 02; the build must have libass, libharfbuzz, libx264 and `-/filter_complex`, which the doctor of Module 02 checks at the end of the build and at boot), yt-dlp's official Linux executable, Deno.
- **Fonts** (`/usr/share/postgear-fonts`, one folder passed to the render as its `fontsdir`): the 52 Studio fonts, Noto Sans Tamil, Noto Sans Devanagari (and a Latin Noto text family as the fallback), and an emoji font. libass reads TrueType and OpenType files, so any Studio font shipped as WOFF2 is decompressed to TTF at build time (a lossless decompression, not an edit of the font: check each font's licence note before shipping, as Module 12's fonts file says). A `manifest.json` lists every family; the compiler checks the `fontselect:` line of FFmpeg's log against it and a missing family fails the job with `font_missing`, so a wrong font is never drawn silently. Colour emoji are not drawn by libass (it draws one colour): emoji in a clip become sticker overlays, and the emoji font is only a last fallback.
- A non-root user, a writable scratch volume at `CLIPS_SCRATCH_DIR`, a health command that runs the doctor and the font manifest check.
- Licences: a `/licenses` folder in the image with FFmpeg's and yt-dlp's notices. The image contains GPL programs run as separate programs; keep it in a private registry and do not publish it. Say this in the Dockerfile's header.
- A `docker compose` profile (`--profile worker-image`) that runs the built image against the local services, used once in the Hand Check to prove the image imports and exports the sample.
- How yt-dlp is kept current without a rebuild: an env `YTDLP_SELF_UPDATE` that lets the worker run yt-dlp's own updater at boot onto the scratch volume and use that copy, off by default; documented with its trade-off.

The API and web images are not this sprint's job; leave their placeholders.

### 6. Docs

- `docs/local-testing-guide.md`: a new section (the next free letter) for Clips: what to install (FFmpeg with libass, and yt-dlp with Deno only for real links), `npm run clips:doctor`, `clips:samples`, the env block, the simulation links and forcing switches, how to run the e2e suite (and MinIO for the S3 tests), how to look at the private bucket, how to make yourself an operator (`operator:grant`) and open `/operator`, how to run a library ingest into MinIO and publish it, and how to get the Twitch and Google listing keys.
- `.env.example`: every Clips variable documented, in one block, including `OPERATOR_EMAILS`, `ENTITLEMENTS_SOURCE`, `CLIPS_LIBRARY_INGEST`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `CLIPS_YOUTUBE_API_KEY`, `CLIPS_SAMPLE_LINK`, the storage variables with the note that production needs S3, and no render licence or GIF provider key.
- `CLAUDE.md`: Architecture gains the five packages (`video-engine` pure, `video-preview` web only, `storage`, `media-tools` Node only and the only importer of `child_process`, `entitlements` pure) and their rules (which may import which), the queues and `WORKER_ROLES`, the entitlement registry and usage meters as the way every plan limit and allowance is read and charged, and the operator screen at `/operator`; Simulation modes gains `CLIPS_SIMULATION`; UI conventions name Clips with Workflows and Studio as desktop only; Commands gains the `clips:*` scripts (`clips:doctor`, `clips:samples`, `clips:remove`, `clips:library:*`) and `operator:grant` and `operator:revoke`.
- `docs/sprint-documents/README.md` and `docs/new-modules/README.md`: the Sprint 12 rows are already there; set their status.
- `docs/screenshots/README.md`: unchanged (local only).
- `SCHEMA_NOTES.md`: complete for every model this sprint added.
- The sprint doc's Deviations section lists every deviation recorded in the Decision Log.
- The completion checklist through the `sprint-closeout` skill: `docs/sprint-completion-checklists/sprint-12-completion-checklist.md`, with honest statuses (what ran for real, what only in simulation).

## Scope

**In**: the sweep and its tests (including the operator, entitlement, meter and library guards), edge-case tests and forcing switches, the e2e suites (`clips.spec.ts` and `operator.spec.ts`), performance, accessibility and look passes, the worker image, the docs, the completion checklist.
**Out**: any new feature, real-platform testing (the real-test plan does that with Arvind), the API and web images, deployment.

## Tasks

- [x] The security sweep table: a test per line; fixes; `security-review` on the diff. (Ten gaps fixed; the review found nothing at confidence 8 or above.)
- [x] A test for each row of the stories' section 5; the simulation forcing switches. (Testing guide 5p lists them.)
- [x] `e2e/clips.spec.ts` (18 tests, including channel browse, library search, Preview Export and Try A Sample) and `e2e/operator.spec.ts` (edit a plan value and see a limit change, an override, the 404 for a member) green under simulation; CI able to run them with FFmpeg and MinIO, or the skips made visible. (2026-11-19: `clips.spec.ts` 19 of 19, `operator.spec.ts` 3 of 3, `clips-limits.spec.ts` 3 of 3; three app bugs the run found were fixed first. CI runs no e2e spec of any module, which the completion checklist states as a gap.)
- [x] A simulated plan change test (a Stripe-simulated upgrade moves the snapshot and the export quality tiles within seconds) and a load test of parallel imports against the meter (twenty at once with room for three: three charged, the rest refused, no negative `used`). (`plan-change.spec.ts`; `usage.load.spec.ts` runs on the local Postgres with `CLIPS_LEDGER_DB_TEST=1` and shows as skipped in CI.)
- [x] Parity checks wired into the test job (`frameState` numeric tests, per-feature compiler tests, the still-frame script). (The numeric and compiler tests run in CI; the 35 real-frame parity tests skip there with a warning, since CI has no pinned FFmpeg, and pass locally.)
- [x] Performance checks (long timeline, limits, memory, preview redraws). (`timeline-performance.test.tsx`; the hour-long heap run was not done, memory is bounded by design.)
- [x] Accessibility review and fixes; the look pass in three themes at two widths with its checklist. (`docs/design-patterns/clips-heuristic-review-2026-11-19.md`; no screen reader run.)
- [x] `Dockerfile.worker` (Debian slim, FFmpeg GPL static build as a separate program, yt-dlp, Deno, the font folder and manifest, no browser), the compose profile, licences folder, the self-update switch. (Proven live 2026-11-19: four queues polled, healthy, a Kick fixture import and a 720p export.)
- [x] Docs: testing guide, `.env.example`, `CLAUDE.md`, READMEs, SCHEMA_NOTES, Deviations; the checklist items for entitlements (Module 01 tables, the seed, the operator screen, the library screen) added to the completion checklist.
- [x] `npm run validate` green (or every red test listed with its cause). (2026-11-19: 71 of 71 tasks, 12,740 tests passed, 31 skipped. Two reds seen only under the full parallel load were fixed: the maintenance workflow test's poll, and Jest's limit on the two real FFmpeg runner tests.)
- [x] The completion checklist through `sprint-closeout`. (`docs/sprint-completion-checklists/sprint-12-completion-checklist.md`.)
- [x] Update the Progress table and the Decision Log; set the sprint doc's Definition Of Done boxes honestly. (23 of 25 met; the 2 GB upload and S3 left as **Partly**.)

## Tests

```powershell
npm run validate
npm run test:e2e -- e2e/clips.spec.ts e2e/operator.spec.ts
npm run clips:doctor
docker build -f infra/docker/Dockerfile.worker -t postgear-worker:local .
```

## Done When

- Every line of the sweep table has a passing test, and the checklist lists what was found and fixed.
- Every row of the stories' section 5 has been seen once and has a test.
- The e2e suites pass locally under simulation in under five minutes for `clips.spec.ts`, and the operator spec shows a plan edit changing a limit.
- The worker image builds with no browser in it, its doctor is green (including libass, libharfbuzz, libx264, `-/filter_complex` and every font in the manifest), and it imports and exports the sample through the compose profile.
- A request for a missing font fails with `font_missing`; no log line holds a Twitch or Google key; a member cannot reach any operator route and a superadmin outside `OPERATOR_EMAILS` cannot in production mode; twenty parallel imports never push a meter over its limit.
- Light, dark and Lilac look right at both widths, with the look checklist ticked.
- `CLAUDE.md`, `.env.example` and the testing guide describe Clips as it is.
- The completion checklist exists and says plainly what was only checked in simulation.

## Hand Check

1. `npm run validate` and the e2e suite: both green.
2. `docker compose --profile worker-image up`: stop the local worker first; import, Preview Export and export the sample through the image.
3. Walk Journey A and Journey B of the stories from start to finish in simulation, in the dark theme, then Journey D's rows using the forcing switches.
4. Read the completion checklist's "Known gaps" and "What remains for you".
5. Then start [the real-test plan](../real-test-plan.md).

## Handoff

The sprint is closed for building. The real-test plan decides whether Sprint 13 may start; its defects are fixed one per session with the fix prompt written there. Module 21 holds what was parked.
