# Clips And Operator Heuristic Review (2026-11-19)

The owner's brief for Modules 19 and 20: everything in Clips and the operator screens should look amazing and work well, following what UX research says about SaaS products and video editors, with StreamLadder's layout as the base and PostGear's own design system on top. This file is the checklist for the Module 20 look pass. Each line is ticked only when it was checked in the browser (or settled by the owner); what was not fixed says so in place.

Companion to [`design-system-rules.md`](design-system-rules.md) and the house critique [`workflow-module-critique-2026-11-03.md`](workflow-module-critique-2026-11-03.md). References are `docs/screenshots/streamladder`. Working shots live in `screenshots/`, never committed.

## How It Is Run

- **Tasks.** Paste a link and import, upload, run AI highlights, trim and caption a clip, export, send to Composer, download. For the operator screens: change a plan limit, give a workspace an override, adjust usage, hide a library item.
- **Two passes.** The first to learn the screens, the second to judge them against the lists below.
- **One finding per line:** the screen, what happened (with a screenshot name), the fix.
- **Severity, rated after the pass (Nielsen's 0 to 4):** 0 not a problem, 1 cosmetic, 2 minor, 3 major, 4 fix before release. Frequency, impact and persistence decide it. Breaking a heuristic is not automatically a problem.
- **Honest limit.** Research asks for three to five independent evaluators; this pass has one, so every severity here is provisional until the owner's own hand check.

## General (Nielsen's 10)

- [x] Every action answers at once, and the current state (selected item, playhead time, save state, a running job) shows without opening anything. *Top bar shows Saved or Saving, the transport shows the playhead time, the selected bar wears its ring, a running job shows its step and percent on the video card (ed-*, b-videos shots).*
- [x] Labels use creators' words (Clip, Trim, Caption, Export). No job ids, codec names or internal terms. *Errors come from `video-engine` sentences; no job id or codec name on any Clips screen in the look pass.*
- [x] Every flow and dialog has a clear way out (Cancel, Back, the close button). Undo and Redo cover every timeline and canvas edit. *Dialogs close on Escape and carry Cancel; the editor has its own Back; Undo and Redo (top bar, Ctrl+Z and Shift+Ctrl+Z) wrap every committed timeline and canvas edit through one history.*
- [x] The same action has the same name, colour and place across Clips, Composer, Media and the operator screens. *Send To Composer, Download, Remove and See Plans read the same on the video page, the clips table and the editor; delete is the solid red everywhere.*
- [x] Costly mistakes are stopped before they happen: a bad link is refused before import, a trim cannot pass the end of the video. *The link card shows title, picture and length before Import; a blocked or private link is refused before any fetch; trims clamp to what the source holds.*
- [x] Choices are shown, not remembered: layouts, caption styles and stickers appear as previews. *Layouts are drawn tiles, text styles show their look, stickers and GIFs are pictures, sounds carry their shape.*
- [x] Frequent actions have shortcuts (play and pause, split, undo, nudge), and nobody needs them. *Space, arrows, S split, Delete, Ctrl+D, plus and minus, Shift+Z fit, ? opens the sheet; every one also has a button.*
- [x] Each panel shows only what the task needs; advanced settings are folded away. *One tab's controls at a time, walked with Back and Next. Look pass widened the panel to 384 px from 1536 px so names fit (sound names were cut short at 320 px).*
- [x] Errors say what happened and why, in plain words, next to where it happened, with a button that fixes it (Try Again, Choose Another File). *Refusals are the design system Alert next to the box that caused them, with Try Again or See Plans (m19-04 shot).*
- [x] Help is in context: tooltips name the action and its shortcut. *Tooltips carry their key (`TooltipHint shortcut`): Undo, Redo, Split, Delete, frame steps, zoom. Long sound names now show in full on hover.*

## SaaS

- [x] An empty Clips page explains what to do and offers one main action (paste a link or upload). *Create tab: one link box, Upload, and Try A Sample (a-create shots).*
- [x] Every list (videos, clips, downloads, a search with no results) has an empty state saying why it is empty and what to do next. *`EmptyState` on videos, clips, downloads, uploads and the library panels, each with a next step.*
- [x] A new user goes from a link to a saved clip without reading docs or leaving the flow. *Link, Import, Make A Clip, editor, autosave; checked end to end in simulation.*
- [x] Usage meters show used and total, the unit and the reset date where the quota is spent (import, AI, export, download), not only on the billing page. *Storage meter "12.4 GB of 50 GB" with its breakdown, AI minutes chip with the reset day in its tooltip, on the Clips page and under Find Clips.*
- [x] Warnings start around 80 to 90 percent of a limit and get louder near it. *Storage turns warning at 80% and danger at 90%; AI minutes warn under a tenth left.*
- [x] At the limit, the screen names the limit, offers a way out (upgrade, free up space, wait for the reset), and work in progress is never lost. *Refusal sentences name the limit and offer See Plans; over the space after a downgrade, the Alert says what goes first and nothing is deleted early (Module 19).*
- [x] Actions that spend something (AI highlights, long imports, a high export quality) state the cost before you confirm. *"Find Clips (3 AI Minutes)" carries its price, worked out from the video's length; export shows quality and size before Export Clip.*
- [ ] A locked feature names the plan that unlocks it, and the upgrade offer can be dismissed. *Partly. Locks open a dismissable dialog with See Plans, but the sentence says "needs a higher plan" without naming it, because plan values are operator rows that can change. Severity 1; naming it needs a plans-by-entitlement read (Sprint 13 backlog).*
- [x] Long jobs (import, captions, AI, export) show the step plus a percentage after about 10 s, run in the background, can be cancelled, and survive a refresh. *Step plus percent from the job row, Cancel gives the charge back, the page reads the job again after a refresh.*
- [x] A finished or failed job leaves one notification that links to the result; one per job, never one per step. *`clip-notices.ts`: one per export ready or failed, video failed, expiring, removed, storage over; each links to the clip or the video.*
- [x] Send To Composer goes to the workspace the clip belongs to. *The Media row and the draft are made under the clip's own workspace (session org), checked in Module 17.*

## Video Editor

- [x] The playhead time is exact; clicking the ruler seeks there; scrubbing is smooth. *Typed `TimeField`, ruler press seeks, frame-accurate steps; playhead slider reads "12 seconds of 42 seconds".*
- [x] The timeline zooms by control and shortcut, with a fit option. *Minus, plus, Fit buttons and keys; it opens fitted.*
- [x] Trim handles show the in and out times while dragging, and a trim can be extended back to the original. *`clip-drag-time` chip follows the moving edge; a part can be dragged back out to the source's ends (hatched where only the proxy is held).*
- [x] Split at the playhead works from a button and a shortcut. *Scissors button and S.*
- [x] Clips snap to the playhead, clip edges and the start, with a visible mark. *Within 8 px to the playhead, ends and edges, with the blue `clip-snap-guide` line; the Snapping switch and Alt turn it off.*
- [x] The selection is highlighted on both the timeline and the canvas, and they stay in step. *Selecting a bar selects its canvas item and the other way round (one `EditorSelection`).*
- [x] Autosave shows its state ("Saving", "Saved", "Could not save, Try Again"); a failed save is loud; leaving with unsaved work warns. *Saved, Saving, "Offline, will retry", "Could not save. Retrying."; leaving with unsaved work asks first (`beforeunload`).*
- [x] The preview matches the export: fonts, caption place and wrapping, stickers, zoom and sound. *One `frameState` drives both the editor preview (`video-preview`) and the render plan (`video-engine`), so placement, wrapping and timing come from the same numbers.*
- [ ] A 9:16 safe zone shows where each platform's buttons sit; it can be switched off and is never exported. *Not built in Sprint 12 (no new features in Module 20). Planned with captions in Sprint 13 Module 03. Severity 2.*
- [x] Text edits on the canvas, with resize handles, guides, and stays readable on any background. *In-place text editing, handles, centre guides, outline and box styles for any background (Module 11).*
- [x] Each AI highlight says why it was picked (the moment, a transcript line, what the score means); it can be previewed, trimmed or dropped, and nothing is published by itself. *Score and up to three reasons in words on each pick; it opens in the full editor like any clip; nothing posts by itself.*
- [x] Export shows its settings first (quality, size), then progress; you can keep editing or leave while it runs. *Quality tiles and the summary line, then the ring with percent; the editor stays usable and the job keeps running if the tab closes.*
- [x] Import from a link shows the title, picture and length before committing; a private or unsupported link gets a reason and a next step. *Link card with poster, title, channel and length; private, members-only and too long each get their own sentence.*

## Operator Screens

- [x] The workspace and plan being changed are unmistakable on every screen. *Plans are the grid's column headers; Overrides and Usage open on a workspace picker and name the workspace and its plan above every list (m19-operator-01, 05, 07).*
- [x] A high-impact action names the item and the result; buttons say the outcome ("Save Plan", "Remove Override"), and the confirm button is not the default. *Review Changes lists each change as "Clips Storage, Pro: 50 GB to 60 GB"; buttons read Save Changes, Add Override, Remove Override, Adjust Usage; the dialogs open on the reason field, never on the confirm button (m19-operator-03, 06, 08).*
- [x] A change that affects customers asks for a reason, and the reason is in the change log. *Every plan save, override, usage adjustment and library hide, restore or remove needs a reason of 10 or more characters, written to the Change Log row.*
- [x] The change log shows who, what, when, before, after and the reason; it can be filtered and cannot be edited. *Filtered by scope, setting and workspace; the API has no write verb on it (`operator-routes.spec.ts`) (m19-operator-09).*
- [x] A limit change validates its input (no negatives, the unit shown). *Inline errors for a negative, a fraction or an empty value, the unit beside each field, and a warning when a tier gets less than the one below.*
- [x] Someone without the right never sees the screens at all (404, not a disabled page). *`notFound()` on the server before anything renders; member@ gets the 404 and no menu item (m19-operator-18).*

## Accessibility (WCAG 2.2)

- [x] Every control works by keyboard, including timeline items, trim handles, canvas objects and sliders. *Bars are focusable buttons (Enter opens, arrows nudge items and zooms, Shift for a second), the playhead is a slider plus a typed spinbutton, the timeline splitter takes arrows.*
- [x] Focus is visible everywhere and never hidden under a sticky bar or panel (2.4.11). *Measured: all 44 focusable controls in the editor draw an outline or ring on keyboard focus; nothing sticky sits over the panel or the timeline.*
- [x] Every drag has a single-pointer alternative: typed times, nudge buttons or arrow keys (2.5.7). *Typed times in When It Shows and the Effects panel, Split plus Remove for trims, the Playhead Time field, arrow keys on bars.*
- [x] Targets are at least 24 by 24 px or spaced well enough (2.5.8): trim handles, tool icons, a sticker's delete. *Measured: only two under 24 px. The playhead grip (12 by 14) has the Playhead Time field as its equivalent; the 8 px Resize Timeline strip now has a 24 px pointer area reaching into the stage padding (fixed in the audit). Trim grips (8 px wide) have typed times as their equivalent.*
- [x] Seek bars and sliders read their values in words (`aria-valuetext` such as "1 minute 30 seconds"). *Playhead "12 seconds of 42 seconds", zoom "1.5x", volume and opacity in percent, text size in px, the splitter in pixels.*
- [x] Progress, saves, finished jobs and errors are announced through a polite live region (`role="status"`), with `role="alert"` only for real errors. *Save state, the timeline announcer, the link box, job progress and the send dialog sit in `role="status"`; refusals use the Alert.*
- [x] Icon-only buttons have names. *Accessibility tree of the Clips page, the video page and the editor: no unnamed button, link, switch or slider.*
- [x] Nothing already entered is asked for again (3.3.7). *The link box keeps the pasted link after a refusal; the shape question is asked once per clip; no form asks again for what the account already holds.*

## What Reviews Of Similar Tools Complain About

Mostly from secondary review pages, so a direction, not proof. Each is a trap Clips should not fall into.

- [x] **OpusClip:** a clunky editor for fixing the AI's mistakes, slow processing, hidden credit rules. Clips: every AI pick opens in the full editor, and the AI minutes chip shows what is left. *Picks open in the full editor; the AI minutes chip sits under Find Clips.*
- [x] **Clipchamp:** exports need the tab kept open. Clips: exports run on the server; the tab can close. *Render runs in the worker on `postgear-render`; closing the tab changes nothing.*
- [x] **CapCut:** exports stuck at 1 and 99 percent. Clips: a stuck job is failed by the sweep's backstop and its charge given back. *The reconcile sweep fails a job Temporal lost or timed out (`timed_out`, Module 19) and reverses its charge.*
- [x] **Kapwing:** slow exports and lag on long projects. Clips: the editor works from the proxy, never the original. *The editor plays the proxy; only the render reads the original.*
- [x] **Descript:** a learning curve. Clips: the first screen offers one action and a sample video. *One link box and Try A Sample on the first screen.*

## Sources

1. Nielsen Norman Group, [10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/), [How to conduct a heuristic evaluation](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/), [Severity ratings](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/), [Designing for waits](https://www.nngroup.com/articles/designing-for-waits-and-interruptions/), [Confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/), [Error messages](https://www.nngroup.com/articles/error-message-guidelines/), [UI accelerators](https://www.nngroup.com/articles/ui-accelerators/).
2. [SaaS usage and quota limit patterns](https://www.saasui.design/blog/saas-usage-quota-limits-ux-patterns).
3. W3C, [What is new in WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/), [ARIA slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/), [Status messages](https://w3c.github.io/wcag/understanding/status-messages).
4. IMG.LY, [Designing a timeline for mobile video editing](https://img.ly/blog/designing-a-timeline-for-mobile-video-editing/) (snap only to visible points).
5. Cloudscape, [Delete with additional confirmation](https://cloudscape.design/patterns/resource-management/delete/delete-with-additional-confirmation/); Tella, [Social safe zones](https://docs.tella.com/help/editing/social-safe-zones).
6. No authoritative source ties a required reason to an audit log; that line is common practice, not research.

## Findings

Filled during the Module 20 look pass (2026-11-19): the Clips page, the video page and every editor tab in dark, white and Lilac at 1366 and 1920 (`screenshots/m20-look/`, contact sheets `editor-{width}-{theme}.png`), then an accessibility pass in the browser (accessibility tree, measured text contrast in all three themes, focus marks and target sizes on every focusable control).

| # | Screen | What happened | Severity | Fix |
|---|---|---|---|---|
| 1 | Editor, Audio tab | Sound names cut to "Alarm ..." and "Appla..." in the 320 px panel, even at 1920 | 2 | Panel is `w-96` from 1536 px; a long name shows in full on hover (`title`). Fixed. |
| 2 | Editor, timeline | A blank block after the last frame of the Video row looked like a missing picture | 0 | By design: the 96 px of room after the clip's end so its end can be dragged outward; the other empty lanes look the same. No change. |
| 3 | Editor, timeline | The Resize Timeline strip was an 8 px pointer target (WCAG 2.5.8) | 2 | Its pointer area is now 24 px, reaching into the stage's empty padding. Fixed. |
| 4 | Top bar (every page) | The search hint "Enter your search" measured 3.71:1 in light themes, 4.47:1 in dark (needs 4.5:1) | 2 | `opacity-50` became the `type-muted` role. Fixed. |
| 5 | Editor | No 9:16 safe zone overlay | 2 | Not built in Sprint 12 (Module 20 adds no features); planned with captions in Sprint 13 Module 03. |
| 6 | Export, quality lock | The lock says "needs a higher plan" without naming the plan | 1 | Plan values are operator rows that can change; naming the plan needs a plans-by-entitlement read. Sprint 13 backlog. |

Measured and clean: text contrast on the editor (Audio tab) and the video page in dark, white and Lilac (disabled controls excepted, as WCAG allows); all 44 focusable editor controls draw a focus mark; no unnamed control in the accessibility tree of the three screens. Not done: a screen reader run (NVDA or VoiceOver) and a 200% zoom check, both left for the owner's hand check.

