# Workflow Module Critique (2026-11-03)

The owner's brief: an entire workflow should look great, read as a real SaaS product and never as AI slop, with no mistakes in alignment or positioning. The method: test it, critique every aspect, write what is bad here, fix it, tick it. Findings are mine to own, including what I shipped badly. Companion to section 16h of [`design-system-rules.md`](design-system-rules.md). References are `docs/screenshots/33` to `55`. Working shots live in `screenshots/`, which is never committed.

Every line below is ticked: each was fixed and looked at again in the browser, or settled by the owner. What I would not decide alone is under Questions For The Owner at the end, with the answers so far.

## Anti-slop checks, for every screen

- No decorative gradients, glows or fades.
- No decorative pills, accent bars, or stickers that say nothing.
- No filler copy, taglines or repeated titles. Every label says what it does.
- One blue button per view.
- The same spacing steps everywhere, tokens only, no hand-picked colours.
- Things that share a job share an edge.

## Findings

### Canvas

- [x] **Steps were small square tiles.** The owner rejected them: a workflow read as icons and scattered captions. Two rounds followed. The slim 240 by 72 card was built first, as chosen; on seeing it the owner said it looked small with the font too large. The final answer is the previous big card: 320 by 120, a tab naming the kind, port stickers and the big "+", with the 48 px logo kept.
- [x] **Shortcut tooltips were plain text** ("Search Ctrl+K"). `ShortcutKeys` now draws the design system's key caps on the rail, canvas controls, hover toolbar, palette and context menu.
- [x] **The trigger has to stand out from other steps.** Its tab reads "When" in yellow, and it has no input port.
- [x] **Stickers collided, and sat in the wrong place.** Status marks are now bare icons in one row in the card's bottom right corner, inside the card, like n8n's: run result, Live In Tests, pin, turned off, then the issue sign last in the very corner.
- [x] **Two outputs must not grow the card.** Ports sit on a 40 px flow pitch, so two outputs fit in 120 and only three or more grow it (`cardHeight`).

### Step editor layout

- [x] **Columns had no shared line.** The Input and Output headings sat about 7 px above the tab row. All three now use one `h-14` pane header.
- [x] **Three stacked rows before any data** in Input: heading, select, tabs. The view switch moved onto the select's row.
- [x] **Connected steps were small unnamed squares** floating outside the dialog, which also cost it 11rem of width. They are named buttons in the pane headers, with a dropdown when there are several.
- [x] **The step name was a boxed input with a hard shadow**, the heaviest thing in the header. It is a quiet field now.
- [x] **Pinned was said twice**, in the dialog header and in Output. Output only.
- [x] **The hint wrapped at the bottom of Input** and floated with no edge. It is a one-line footer strip.
- [x] **A trigger's Input looked like a dead end.** I first put a Test Step in its empty state, then took it out again: that made three Test Steps on one screen. The empty state explains itself, and the tab row and Output keep theirs.

### Data views

- [x] **Table rows did not line up with their header.** `INDENT[0]` was `ps-0`, which cancelled the cell's `px-2`, so depth 0 text sat 8 px left of "Field". A plain bug of mine, now measured.
- [x] **Table rows were dense and values cut to one line.** Design system `Table` parts, `text-sm`, wrapping up to 3 lines.
- [x] **Data and Table looked the same.** Data has type icons, chips you can drag and indent guides; Table is for scanning.
- [x] **A list of records was unreadable as nested rows.** It shows real columns (`recordTable`), one row per item, scrolling sideways in its own box.
- [x] **Raw was Sora in one colour with `break-all`** cutting words apart, the hardest thing to read in the product. It now looks like a VS Code preview, with Dark+ and Light+ colours, line numbers, bracket pair colours, indent guides, a hanging wrap, a file tab and Copy.
- [x] **Values were raw, not human.** ISO dates and bare numbers go through `humanValue`.
- [x] **Labels read "Url" and "Id".** `humanise` writes URL, ID, API, AI, HTML.
- [x] **The big blue view tabs shouted**, twice per dialog. A quiet switch with a neutral selection replaced them.
- [x] **"Sample" was a floating tag.** It is quiet text in the footer strip.

### Blue and notices

- [x] **Up to four blue things at once**: the tab, Test Step twice, the AI bar. Test Step on the tab row is the one blue button; Output's is secondary.
- [x] **The solid blue AI bar repeated the credit line** already in the form and outweighed it. It is one quiet line.
- [x] **Use Sample Text Instead sat in the settings**, though it is about the output. It moved to Output's empty state.
- [x] **A failure had no details to read.** A collapsible Error Details sits under the Alert.
- [x] **The toast crossed the dialog's edge.** With the wider dialog it sits inside the Output pane (shot 147).

### Found while testing

Canvas:

- [x] **The warning sign sat at the top right and looked stuck on.** It moved to the bottom corner inside the card, as a bare icon. Its tooltip lists what is wrong, and a click lands on the first problem (owner's request, after n8n).
- [x] **Marks had backgrounds.** The issue sign, pin, off and Live In Tests were stickers. All bare icons now (owner's request).
- [x] **A selected step had two borders with a gap**, and the ring crossed the tab. The ring touches the border now, with no gap, and follows only the outer edge of the card and its label together, with no line under the label. The owner tried one border, then a ring on the card alone, and chose this (2026-11-04).
- [x] **Every selected step was orange**, whatever its icon. A selected step's ring takes its icon's colour: orange, violet, blue or green, and a logo's own colour. Hover is the same quiet grey as before (owner's request, 2026-11-04).
- [x] **The ring grew heavy zoomed out.** It was divided by the zoom to stay 3 px on screen, so it dwarfed a small card. It scales with the card now, and only holds at about 1.5 px when zoomed far out (owner's request, 2026-11-04).
- [x] **A waiting step had the same second frame**, a pulsing ring outside the card. Its own border pulses amber now. Found while fixing the line above.
- [x] **Approved and Rejected looked like any other branch.** Their labels are green and red, and the labels keep their background (owner's choice, 2026-11-04).
- [x] **A selected note wore an orange border** on top of its own dashed line. It has none now, and its resize handles are ink (owner's request).
- [x] **The issue sign sat on top of the ports and of the Off mark.** Marks share one row now, so nothing stacks.
- [x] **Port stickers did not join their lines.** They touch the stem now.
- [x] **Tall branch lines kinked.** A line with little room sideways takes clean smooth-step corners (`step-edge.tsx`).
- [x] **The hover toolbar was tiny.** 32 px buttons with 16 px icons, on the card's own scale.
- [x] **Specks when a dock opened.** A wide flow keeps its size when a dock takes room, and only recentres up and down.
- [x] **The flow ran under the tools with Logs open.** Logs open now refits the same way.
- [x] **A template opened at a tiny fit.** My first fix only covered part of it. On a blank canvas the opening fit stayed queued until the new cards were measured, so it landed on top of the readable zoom (44%). `fromTemplate` now waits for the fit's own promise, and every path opens at 80%: blank canvas, and both templates from the list page.
- [x] **Setup's first row stayed closed after a template.** It opens even when the row arrives late.
- [x] **Long names pushed the Setup row's chevron out of the panel.** The row's name truncates now.
- [x] **A dev warning repeated in the console** from reading bounds without the flow's lookup. Bounds come from the flow instance now, which also knows each card's measured size.

Step editor:

- [x] **How Often and Days read as tabs.** They were toggle bars, with the bar's frame around all-blue tiles. They are `ChoiceTiles` now: full-width equal keys, an icon above each frequency, and the seven days sharing the row (owner's request, 2026-11-04).
- [x] **The schedule form's edges were ragged.** A label stacked on a label, short selects stopping at `max-w-56`, and a preview of another width. Every row reaches both edges now, and Time sits level with Time Zone (owner's request).
- [x] **Time was two small selects with a colon.** It is the app's own time picker now, as a design system `TimePicker` that `DateTimePicker` shares its columns with (owner's request).
- [x] **The schedule's read-back was a dashed box with ragged lines.** Dashes say "drop something here", and dates and times did not line up. It is a `SummaryBox` now, a solid inset box with real columns, and the Activate dialog's next runs use it too (owner's request).
- [x] **The field said 9:00 AM and the box under it said 09:00.** Found once the picker was in. The sentence and the next runs follow the viewer's clock now, and so do step cards and the Activate sentence, on the owner's go-ahead.
- [x] **Weekly and Monthly had nearly the same icon** at 20 px. Monthly has its own now. Found on review.
- [x] **The time panel crossed the dialog's bottom edge** by 8 px on a 768 high window. It is 16 px shorter now and stops 2 px inside. Found on review.
- [x] **The clock icon sat 4 px left of the dropdown text above it.** They share one left edge now. Found on review.
- [x] **A test that opened a popover hung forever with no output.** jsdom's selector engine loops on `:modal`, which Floating UI asks as it places a popover. Real browsers are fine. A guard in the design system's test setup answers no.
- [x] **Every toggle bar was its own design**, with its own corners and heights. The calendar's Day, Week, Month is the one bar now, in the design system, on every page (owner's request, 2026-11-04). See Measurements.
- [x] **The Queue page scrolled sideways by 140 px on a phone.** A tab's hidden "37 posts" text escaped the bar's scroller and widened the page. The old tabs were built the same way, so it was probably there before this work. A bar's tiles are positioned now, so the text stays inside. Found on review.
- [x] **A focused field glowed.** It is a plain 2 px blue line now, with no glow and no hard shadow under it while focused. A thinner line was tried and rejected as too thin (owner's request, 2026-11-04).
- [x] **A navigation menu's values were plain text.** Each has a lucide icon beside its name now, as part of the component (owner's request, 2026-11-04). Animated icons went in first and the owner asked for lucide instead.
- [x] **Dropdowns and toggle-style controls had shadows.** They looked annoying beside the fields. Removed in the design system, so the whole app changed (owner's request). See Measurements.
- [x] **No line under the Raw file tab.** The strip has a `border-b-2` now, and the tab no longer overlaps it (owner's request).
- [x] **The source select clipped its text** against the view switch. It truncates properly and keeps its gap.
- [x] **"Image: 5 fields" looked stuck closed** in Input. A group opens and closes with its chevron, and top-level groups start open.
- [x] **Data rows started 32 px right of the heading** when no row needed a chevron. The chevron's column only appears at a level that has one; a child always keeps it, so it never sits left of its parent.
- [x] **Input and Output empty states sat at different heights.** They share one line.
- [x] **Toggles sat on different sides** between Configure and Settings. Label left, switch right, everywhere.
- [x] **The connected step's name cut off with room to spare.** The button takes up to `max-w-64`.
- [x] **Last Test was cut off** in Output's row. It shows in full beside the state.
- [x] **Pin This Result still showed while pinned.** It only shows when the result can be pinned.

Runs and Logs:

- [x] **The run canvas was unreadable and had no hatch.** It opens at a readable size, centred on what matters, on `bg-hatch` like a Versions preview.
- [x] **Polling moved the view.** Only a new graph moves it, so a panned canvas stays put.
- [x] **Two colours meant waiting.** One orange for waiting everywhere.
- [x] **Logs showed six green badges in a column.** Each row shows the duration and the same bare mark as the card, with the words for screen readers.
- [x] **The right side of Runs was blank** with nothing chosen. It says "Choose a run", or "Nothing here yet" with Test Workflow when there are no runs at all.

Elsewhere:

- [x] **A workflow card's menu sat on its first flow row**, over a step. It moved to the name row.
- [x] **A workflow card said both "Succeeded" and "No runs".** The first is its last test, the second its live runs, so it now says "No live runs".
- [x] **Boxed icons added weight** in the run list, Connections and the Activate dialog. Bare icons now.
- [x] **"Fill in this field." repeated** in the Activate dialog. One row per step, "3 things to fix." (`issueRows`).
- [x] **Versions rows sat off the heading's edge.** They share its 16 px.
- [x] **Context menu shortcuts were plain text**, and the palette joined two keys into one cap. One key cap per key in both.
- [x] **The shortcuts sheet's keys and labels had no steady gap.** Its rows sit on one grid.

## Sweep

Each screen was shot, critiqued against the checks above, fixed and shot again, in Classic dark, and at the points listed under Measurements. Classic light and Lilac were checked for the canvas and the step editor (shots 139 to 142).

- [x] List page and template preview
- [x] Canvas: empty, small, big, branches, Paths, notes
- [x] Hover toolbar, selected state, zoom tiers
- [x] Picker and its drill-in
- [x] Setup dock
- [x] Configure and Settings tabs across step types
- [x] Step editor: no data, sample, pinned, success, failed, dry run, trigger
- [x] Logs dock
- [x] Runs list and detail
- [x] Versions preview
- [x] Activate menu and dialogs
- [x] Palette, shortcuts sheet, context menu
- [x] Toasts, in the builder and over the step editor
- [x] Connections dialog

Not done by me: `/dev/components` toast specimens, a real Google Picker in a Sheets step, and Tidy Up on one of the owner's own workflows. Those are for the owner's hand check.

## Measurements

Read from the browser with `getBoundingClientRect`, at 1366 by 768, not judged by eye.

| Check | Expected | Measured |
|---|---|---|
| Three pane header lines share one bottom edge | same y | 130, 130, 130 |
| Table header text and depth 0 cell text share one left edge | same x | 48, 48 |
| Input and Output second rows share one top edge | same y | 146, 146 (both 36 tall) |
| Two-output card: port centres | 40 flow px apart | 40 flow px, 32 on screen at 80% |
| Status marks stay inside the card, in the corner | no overlap, inside | 8 and 6.4 from the edges at 80% (10 and 8 flow px); no overlap on the 8 cards checked, up to 2 marks |
| All five marks at once | fits below the summary | Not seen on one card. By sum: 152 of 320 wide, below the summary line |
| No horizontal page scroll at 1366 | none | scrollWidth 1366 of 1366, canvas and list |
| Nothing cut off by a dialog's edge | none | 0 elements outside, no sideways scroller in the step editor |
| Dropdown and toggle shadows | none | computed `box-shadow: none` on the combobox, tab list, segmented group and switch |
| A template opens at a readable zoom | 80% | 80% on all three paths, steady from the first sample |
| A selected step's ring, in its icon's colour | touches the border; matches the icon | 3 px outline on the card, 3 px clipped shadow on the label. Orange 255,107,53, blue 29,78,216, Slack 0,188,212 |
| Hover is grey, and selecting wins under the pointer | grey, then the colour | 120,120,120 on card and tab; orange once clicked, pointer still on it |
| A failed step | red border; ring grey under the pointer, its colour when selected | border 230,57,70 throughout; ring 120,120,120, then the step's colour (class added by hand, nothing saved) |
| Border and ring do not grow zoomed out | under 2.5 px on screen | border 1.6 and ring 2.4 at 80%; both 1.39 at 46%; ring 1.2 to 1.5 from 37% down to 20%, where the label is hidden |
| Every toggle bar matches the calendar's | frame 40 high, 8 corner, no shadow; chosen 32 high, 4 corner, 2 px border | the same on Calendar, Queue, Analytics, Copilot, Media, Workflows, Appearance, Billing, the step editor and the Data view |
| No page scrolls sideways at 390 wide | 0 | see the phone sweep: 0 on every responsive page |
| A focused field | 2 px blue, no glow, no hard shadow | 2 px 29,78,216, no outline, no hard shadow; invalid 2 px 230,57,70 |
| Schedule rows reach both edges | 0 and 0 | 0 and 0 on every row, on all five choices, 496 wide; five tiles 93 each, seven days 64 each |
| Time's icon and the dropdown text above it | same x | 453, 453 |
| The time picker writes a 24 hour time | 12 AM 00:00, 12 PM 12:00, 7:35 PM 19:35 | 00:00, 12:00, 19:35 |
| Time columns scroll with the wheel inside the dialog | it moves | 193 to 73 |
| The time panel stays inside the dialog | bottom under 752 | 750 |
| Summary box columns | one left edge, one right edge | sentence, label and rows 18 from the left, times 18 from the right, in the form and the Activate dialog |
| Issue sign is readable on screen | clear at 80% | 19.2 px wide |

## Questions for the owner

Anything that would change a flow or an earlier decision goes here rather than being changed quietly. None of these block anything.

Answered by the owner, 2026-11-04:

- **Text boxes and date pickers:** keep their shadow for now. The owner will look at them again.
- **A selected step:** a ring touching its border, in its icon's colour, and grey on hover, around the outer edge of the card and its label. Built, see Canvas above.
- **Branch labels:** keep their background, as labels. Approved and Rejected go green and red. Built, see Canvas above.
- **Field focus:** stays as built. The dark edge goes on focus only, and resting text boxes keep their shadow.
- **A navigation menu's values:** an icon and the name, with plain lucide icons. Built.
- **A saved time:** step cards, the read-only canvas and the Activate sentence follow the viewer's clock, as the form does, so a 12 hour viewer sees 9:00 AM everywhere. The Schedule step's blurb in the picker no longer names a time. Built.
- **The toggle bar:** the owner loves it. Data, Table, Raw stays blue and Copilot's tabs stay 40 px.

Still open:

1. **Channel chips and the template logo stack keep their look**, shadows included. They are not dropdowns or toggles.
2. **Two blue buttons on the canvas in two cases:** Activate with Test Workflow, and Stop with Open Review while running. The rule says one blue per view; they sit far apart and do different jobs.
3. **The canvas does not follow a waiting step off screen** during a test, and a reload loses the bar of a test that is waiting.
4. **The card font is exactly as before**, on the owner's "everything needs to be like what we had before". It is one class to shrink.
5. **The run mark no longer shows the duration on the card.** The tooltip and Logs have it.
6. **True and False stay neutral.** Approved and Rejected are outcomes; a condition being false is not bad news. It is one line each to colour them too.
7. **Close branches are tight.** With labels on both of a review's outputs, the "+" on Rejected sits right by the arrow into the next step in the AI Weekly Post template (shot 156). More room between columns would fix it, but it moves every template.
