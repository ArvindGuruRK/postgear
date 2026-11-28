# Sprint 13 Clips AI Look Pass (2026-11-28)

Module 16, section 5: the Clips AI screens looked at in light, dark and Lilac at 1366 and 1920 px, an accessibility review of the screens a creator meets most, and the performance numbers the module asks for. Each line is ticked only once it was fixed and checked again in the browser (or settled with a reason in place). Nothing here restyles a screen that already followed the rules: the owner has rejected restyles before.

Companion to [`design-system-rules.md`](design-system-rules.md) and the Sprint 12 checklists [`clips-ui-redo-2026-11-19.md`](clips-ui-redo-2026-11-19.md) and [`clips-heuristic-review-2026-11-19.md`](clips-heuristic-review-2026-11-19.md).

## How It Was Measured

- **The app as it runs locally,** every simulation flag on, signed in as the seeded demo admin. Two clips of the seeded ten minute stream were made for the pass (one cut into forty parts with captions, one of the whole stream with its 912 words) and deleted at the end through the API. A throwaway Editor account was made for the rail check and removed with its seat override.
- **Headless Chromium** (Playwright, build 1255) at 1366 by 768 and 1920 by 1080, in dark, light and Lilac (the theme cookie plus the body's theme attributes). Screenshots are `screenshots/s13-m16-<screen>-<theme>-<width>.png`, never committed.
- **An in-page audit** on every screen: horizontal page overflow, text cut off by its box (wider than its box with overflow hidden; an ellipsis with a `title` counts as intended), text contrast against the colour behind it (WCAG AA, 4.5:1 for small text), and any shadow on a toggle or dropdown. Numbers below are what it measured; "audit clean" means all four were zero.
- **Accessibility** followed the WCAG 2.1 AA review (keyboard only, names, roles, values, live regions, contrast), with a scan that lists every focusable control without a name, every slider's value text and every live region, and keyboard runs in the browser. No real screen reader was used: see Left For Later.

## Clip Setup

- [x] **S1. The starter tiles' names sat at different heights (measured 19 to 52 px from the tile's top at 1366, since each tile centred its own words and the lines wrap to one, two or three lines).** Fix: `ChoiceTiles` starts a tile of words (a line, no drawing) at its top; a tile with a drawing stays centred. *Done: all five names at 19 px at 1366 and 1920, in dark, light and Lilac (`setup-after` shots). Test in `packages/ui/src/components/choice-tiles.test.tsx`.*
- [x] **S2. The chosen tile's line was muted on the blue fill: "1080 by 1350" measured 4.1:1 in dark (white at 70 percent on 29, 78, 216).** Fix: `ChoiceTiles` mutes the line only on the tiles not chosen. *Done: the audit finds no contrast problem on Clip Setup or the Schedule Maker in any theme. Test in `choice-tiles.test.tsx`.*
- [x] Everything else on the page: audit clean in all six runs; the summary card stays in its column (352 px).

## Captions Tab

- [x] **C1. Translate To ran out of its button: "Translate To Hindi (1 AI Minute)" needed 284 px of a 280 px box at 1366, and a longer language name up to 72 px more.** Fix: the button may wrap (`h-auto min-h-11 whitespace-normal`, the Hook Title rows' pattern) and its icon keeps its size. *Done: two lines, 60 px tall, nothing cut off, in all three themes. Test in `captions-panel.test.tsx`.*
- [x] **C2. Add Captions was the blue primary although it spends AI minutes; every other AI action in Clips (Listen, Find Clips, Bleep, Voice, Auto Edit, Clip Setup's start) is the violet highlight.** Fix: `variant="highlight"`. *Done: violet (118, 87, 239) in all three themes, audit clean. Test in `captions-panel.test.tsx`.*
- [x] **C3. Its listening bar was the primary blue, while every other AI listening bar is the violet `tone="ai"`.** Fix: `tone="ai"`. *Done. Test in `captions-panel.test.tsx`.*
- [x] Sliders, switches and the style tiles: audit clean once C1 was fixed.

## Transcript Pane

- [x] Three columns at 1366: rail 80 px, pane 320 px, stage 918 px, no overflow; at 1920 the stage is 1472 px. Audit clean in all six runs.
- [x] Keyboard, names and what is only seen: see Accessibility (T1 to T5).

## Clips Tab Bulk Bar

- [x] Three clips ticked: the bar shows the count and its actions, audit clean apart from long video names on the cards, which end in an ellipsis with the whole name as their tooltip (17 at 1366, 7 at 1920). That is the intended look.

## Recipes And Brand Kit

- [x] **K1. Logo On Video's five choices broke onto two rows (76 px tall) in a half-width kit card: they need 514 px and had 507 px beside the corner drawing.** Fix: the row wraps, so the drawing goes under the choices instead of splitting them. *Done: one row, 40 px tall, at 1366 (drawing below) and 1920 (drawing beside), dark and Lilac. Test in `kit-view.test.tsx`.*
- [x] **K2. The closing line's Save was squeezed by the field: 59 px of text in a 56 px button.** Fix: `shrink-0`. *Done: 65 px, nothing cut off. Test in `kit-view.test.tsx`.*
- [x] Recipes tab: audit clean in all six runs.

## Emote Maker

- [x] Audit clean in all six runs, top and bottom of the page. Keyboard and screen reader findings: see Accessibility (E1 to E3).

## Schedule Maker

- [x] Audit clean in light and Lilac; dark had the chosen tile's line at 4.1:1, fixed by S2 (dark audit clean after).
- [x] The theme cards use the same press and chosen ring as Design Studio's theme tiles. Left as they are: they follow the Studio pattern, so changing them would be a restyle.

## The Editor's Reduced Rail

- [x] A throwaway Editor joined through an invite: the rail shows Home, Calendar, Copilot, Queue, Media, Studio, Clips and Settings in all three themes at both widths, the Analytics address shows the refusal page, and the composer opens for drafts only. Audit clean. The account, its membership and the seat override were removed afterwards (no account left; override deleted with 200).

## Composer Additions

- [x] Posting slots dialog, Next Available, the random time picker and Made With AI: audit clean apart from the two pre-existing items under Left For Later.
- [x] **P1. With a video in the post at 1366 (Made With AI shows), the action group (Next Available, the date, Save As Draft, Add to calendar) wrapped under the save line and sat on the left.** Fix: `ms-auto` on the group, so a wrapped group stays on the right. *Done: 22 px from the dialog's right edge at 1366 (wrapped) and 1920 (`composer-after` shots). No unit test: the composer footer has no test that renders the whole dialog; checked in the browser.*

## Accessibility

Screens: Clip Setup, the Captions tab, the Transcript pane, Emote Maker, the Schedule Maker's hand-filled week and the Team page's invite dialog. Every fix has a test in the component's own test file.

- [x] **A1. No AI step was read out while a job ran: each AI progress bar has a name, but the words under it (queued, listening, the step) were plain text.** Fix: those words are a polite `role="status"` in the eight places that lacked it (the video's transcript, Find Clips, the Transcript pane, Captions, Bleep, Voice, Follow The Speaker, Detect Camera; Auto Edit already had it). Find Clips reads the step, not the percentage, which would chatter. *Done; tests in `transcript-sheet`, `find-clips`, `transcript-pane`, `captions-panel`, `ai-effects`, `follow-speaker` and `detect-camera` test files.*
- [x] **T1. A word could be fixed only by a double press.** Fix: F2 opens the caret's word (not a cut one), and the text names its keys to a screen reader ("Arrow keys move word by word, Shift and an arrow selects, Enter jumps there, Delete cuts, F2 fixes the word.", naming only the keys its caller answers). *Done: F2 opens the fix field in the editor. Tests in `transcript-text.test.tsx`.*
- [x] **T2. Restore showed only on hover, so a keyboard could not bring cut words back.** Fix: the caret on a cut word shows its run's Restore, and Enter restores the run. *Done: Restore shows under the caret in the editor (`transcript-restore-caret` shot). Test in `transcript-text.test.tsx`.*
- [x] **T3. Struck through (cut) and dotted (hard to hear) were only seen.** Fix: each such word points at a hidden note, "Cut. Enter restores it." or "Hard to hear.", read after the word. The word's own text stays just the word, and nothing changes on screen (the pane's own note already explains the dotted line when many words were hard to hear). *Done. Test in `transcript-text.test.tsx`.*
- [x] **T4. Shift and the arrows changed the selection with nothing saying how many words it held.** Fix: a polite status, "3 words selected.", once the selection is longer than one word. *Done: reads "3 words selected." after two Shift steps in the editor. Test in `transcript-text.test.tsx`.*
- [x] **T5. Escape in the fix field dropped focus onto the page.** Fix: when the field closes with nothing focused, the text takes focus back. *Done: focus returns to the transcript in the editor. Test in `transcript-text.test.tsx`.*
- [x] **E1. The crop box moved with the arrows but nothing said where it went.** Fix: after a keyboard step a polite status says "432 pixels square, 428 from the left, 144 from the top." *Done in the browser. Test in `emote-components.test.tsx`.*
- [x] **E2. The Start slider had no name and read its value as "60100".** Fix: the thumb is named Start and reads a time ("1:00.0"). *Done: the scan lists "Start=1:00.0". Test in `emote-components.test.tsx`.*
- [x] **E3. The stretch's length could only be set with a pointer (its edges are drag handles).** Fix: Up and Down on the stretch make it a tenth longer or shorter (still at most 3.0 seconds), it says so in its description, and its value reads "1:00.0 to 1:03.0, 3.0 s". *Done in the browser (2.9 s, then 3.0 s). Test in `emote-components.test.tsx`.*
- [x] **R1. The week's seven Off boxes were all called "Off".** Fix: each is named with its day ("Monday off"; the visible word stays Off). *Done in the browser. Test in `schedule-field.test.tsx`.*
- [x] **R2. The schedule row editor as a labelled table.** Settled, not changed: it is a list named "Week" of day cards, every field named with its day ("Monday label", "Monday time", "Monday stream"). That reads the same to a screen reader as a table's row and column headers would, and turning the cards into a table would restyle the Studio editor they share.
- [x] **I1. The invite dialog announced a missing address (`role="alert"`), but the field was not marked wrong.** Fix: the email field takes `aria-invalid` and points at the sentence. *Done in the browser. Test in `invite-member-dialog.test.tsx`.* The rest of the dialog: the role tiles are a named group, a full seat count is an alert and the send button is off with the reason shown, audit clean in light and Lilac.
- [x] Switches are all named (Clip Setup's five, Safe Area Guide, Snapping, Flip, Still frame for Twitch, Snap crops to guides) and every slider reads a value with its unit.
- [x] The focusable boxes without a name in the editor's top bar and timeline tools are the design system's wrapper around a disabled button (Undo, Redo, Split and the like), so the reason in its tooltip can be reached by keyboard; the button inside carries the name. The AI minutes chip on Clip Setup is the same idea for its tooltip, and its text is its name. Left as designed.

## Performance

Measured in the dev build (React development mode, Turbopack) on the owner's Mac (Intel i7-8750H, 16 GB), headless Chromium at 1366 px with the GPU on (Metal). Frames are the gaps between animation frames; long tasks come from the long-task and long-animation-frame observers; renders are counted with a React DevTools hook (components that did work per commit). A production build will be faster; the shape of the numbers is what matters. Runs on this machine vary by about 15 fps from one to the next.

- [x] **F1. Playback of the forty-cut clip with captions (Captions tab, 5 s):** 50.9 fps, 2 frames over 50 ms (both at the press of Play, while the video starts), no long task. **A timeline drag** (60 moves over 2 s): 44.9 fps, 1 frame over 50 ms (the first press), no long task.
- [x] **F2. Without the GPU** (the headless browser's default software drawing) the same playback ran at 14 to 23 fps with 29 to 48 frames over 50 ms and long tasks up to 321 ms: 62 percent of the busy time was `drawImage`, 12.4 ms per draw of the 1280 by 720 proxy into the 1080 by 1920 area canvas (0.4 ms with the GPU). A real browser draws on the GPU, so this is the test machine, not the app. See Left For Later for the canvas size.
- [x] **F3. The Transcript pane with 912 words:** every word is in the page, not only the visible ones (912 options, 2,097 elements; it is not virtualised). Scrolling stays smooth: 59.8 fps over a 3 s scroll and 59.3 fps on the wheel, no frame over 50 ms. Kept as it is: at a thousand words drawing them all costs nothing while scrolling.
- [x] **F4. Playing with the Transcript pane open and following was slow: 30.6 fps, 18 frames over 50 ms, a 458 ms long task.** Each new spoken word drew the whole transcript again (every word) and the whole pane (its header buttons, icons and tooltips, 101 to 104 components per commit). Fix: `TranscriptText` draws by paragraph and only the paragraphs the spoken word leaves and enters draw again, and the pane reads the spoken word in a small child (`SpokenTranscriptText`), so its header no longer draws as the clip plays. *Done: 50.8 fps, 4 frames over 50 ms (the longest, 268 ms, was a network response, not playback); in a CPU profile the time spent making elements in the design system fell from 1000 ms to 400 ms per 5 s and the transcript no longer appears. Test in `transcript-text.test.tsx` (a move inside a paragraph draws one paragraph of forty; across two draws two).*
- [x] **F5. Renders per frame while playing:** about 0.5 commits per frame (one per new video frame), a median of 30 components each: the transport's time, Playhead Time, the playhead and its layer on the timeline, and Split with its tooltip and icon. Recorded, not changed: small, and each is something that must move with the playhead. Split works out whether a split is allowed on every frame (42 ms per 5 s in the dev build); see Left For Later.
- [x] **F6. Preview Export against the editor at five moments** (0:00.8, 0:02.4, 0:30.2, 1:15.6, 2:20.4 of the captioned clip). How: the editor's stage picture was shot after typing each time into Playhead Time; the rendered preview file (360 by 640, 160 s, made in 113 to 161 s on this Mac) was seeked to the same second in a plain video; both went side by side on one sheet (`screenshots/s13-m16-preview-vs-editor-dark-1920.png`), compared by eye and by a grey difference at 90 by 160. Same frame at every moment (the burnt-in timecodes match), the captions say the same words in the same place with the same highlighted word. Mean grey difference 2.8 to 14.8 of 255, worst 10 by 10 block 12 to 35: the dark frames agree closely (2.8 and 5.8); the colour bars differ in colour, not place (cyan 0, 191, 190 in the editor against 58, 209, 189 in the preview; yellow 255, 240, 0 against 253, 253, 0). See Left For Later.
- [x] **F7. The Python media service benchmark** (speech to text, faces, motion, stills) needs a real run: locally `MEDIA_SIMULATION` answers from recorded files and no model runs, so there is no number to record yet.

## Left For Later

- **The stage's area canvas is the export's size** (1080 by 1920 for a vertical clip) even when the stage shows it at 180 by 320 px. On a GPU each draw is 0.4 ms, so it is not a problem today; drawing at the shown size times the screen's pixel ratio would cut the work by about nine times, but the zoom (a CSS scale) would then need a larger canvas, so it is a decision for the preview engine, not a quick fix.
- **One large draw when playback starts on the Layouts tab:** 976 components in one commit (the forty parts on the timeline and their grips), a 345 ms long task in the dev build.
- **Split decides whether a split is allowed on every frame** while playing. It could decide only when the playhead stops.
- **Preview Export's colours are brighter than the editor's on saturated colours.** Positions, timing and captions agree; the difference looks like a colour matrix difference (BT.601 against BT.709) between the proxy the editor draws and the exported file. Worth checking the colour tags the proxy and the export carry.
- **Composer, before Sprint 13:** the main button reads "Add to calendar" (not Title Case), and the channel avatars not chosen are drawn at 45 percent, so their initials measure 2.3:1. Neither is a Sprint 13 addition, so neither was changed here.
- **A real screen reader run** (VoiceOver and NVDA) over the same screens, and a 200 percent zoom check. This pass checked names, roles, values and live regions in the page, not what a screen reader speaks.
- **The two Preview Export render jobs** of the deleted clips stay in the jobs history, as every deleted clip's jobs do.

## Decisions Taken

- The Schedule Maker's theme cards keep the Studio theme tiles' press and ring.
- The transcript is not virtualised: drawing by paragraph is enough at a thousand words, and the find and keyboard code keeps every word in the page.
- The stretch's length is set with Up and Down on the stretch itself rather than two focusable edges, since a slider cannot hold other sliders inside it.
- The schedule row editor stays a list of day cards (R2).
- The design system's focusable wrapper for disabled controls, and the AI minutes chip, stay as they are.
