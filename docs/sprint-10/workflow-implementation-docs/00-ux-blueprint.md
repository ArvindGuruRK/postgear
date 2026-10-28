# 00: UX Blueprint, The Workflow Builder Experience

> Reference document, not a build module. Every UI module (05, 06, 08, 09 and the step panels in 10 to 13) follows it.
> Sources: n8n, Make and Zapier as of October 2026 (UX ideas only, never their code), the Sprint 10 doc's "Screens", the user stories' section 4, and PostGear's design system (`docs/design-patterns/design-system-rules.md`).

## 1. Principles

1. **Familiar first.** Anyone who has touched n8n, Make or Zapier should know what to do in five seconds: a trigger on the left, steps flowing right, "+" to add the next one, click a step to set it up, Test to see it work, a switch to turn it on.
2. **Beginner path, power path.** Zapier's linear Setup, Configure, Test tabs are the default path through a step. n8n's side-by-side Input, Settings, Output view is one click away (Expand) for people who want to see the data while they map it.
3. **Alive while it runs.** Like Make, a test run plays on the canvas: steps light up, data travels along the lines, each step gets a result badge. People understand automations by watching them.
4. **Safe by default.** Tests are dry runs. Saving never activates. Turning a workflow on shows, in one sentence, what it will do.
5. **PostGear's look, not theirs.** Borders, hard shadows, stickers, Sora type roles, design tokens. We copy placement and flow from the references, not their faded styling.
6. **Plain words.** "Step", "run", "data", "schedule". Never "node", "execution", "payload", "cron", "JSON" in the UI (the raw view tab is the one exception and says "Raw").

## 2. Screen Map

```
/[orgId]/workflows                       Workflows list, template gallery
/[orgId]/workflows/[id]                  Builder, Editor tab
/[orgId]/workflows/[id]?tab=runs         Builder, Runs tab (run list + canvas replay)
/[orgId]/workflows/[id]?step=<key>       deep link: selects and opens a step
/[orgId]/workflows/[id]?run=<runId>      deep link: opens a run on the canvas
/[orgId]/workflows/connections           Connections (apps linked to this workspace)
```

## 3. The Builder Layout

```
┌ PageActions ──────────────────────────────────────────────────────────────────────────────────────────┐
│ [Name, click to rename] Saved ✓ | [Editor | Runs] | ● Draft / Active v3 / Unpublished Changes |        │
│ [2 Issues ▾] [Test Workflow ▶] [Activate ◯━] [⋯ Versions, Duplicate, Export, Import, Delete]          │
├──────────┬──────────────────────────────────────────────────────────────────────┬─────────────────────┤
│ Steps    │                                                                      │ Step panel          │
│ (picker, │   [⚡ Post Published]──▶[Set Fields]──▶[Sheets]──▶[Slack]              │ (opens on select)   │
│ 280 px,  │                                                                      │ Setup | Configure | │
│ collaps- │                                                     ┌──────────┐     │ Test     [Expand ⤢] │
│ ible)    │                                                     │ minimap  │     │                     │
│          │  [− + Fit ⟲ Undo Redo Tidy Up 🔒]                   └──────────┘     │                     │
├──────────┴──────────────────────────────────────────────────────────────────────┴─────────────────────┤
│ Run bar (only while a test runs or a run is open): ▶ Test run 14:02, 4 of 6 steps, 3.1 s  [Stop] [×]   │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **PageActions row** (no page title; the top bar says Workflows): inline rename, save state ("Saving", "Saved", "Offline", "Could not save. Retrying."), the Editor/Runs segmented switch (n8n's Editor and Executions tabs), the status badge, the issues chip ("No issues found" or "2 Issues" in red; click opens the issues list), **Test Workflow** (primary, Ctrl/Cmd+Enter), the **Activate** switch (admins only; members see it disabled with "Only workspace admins can turn workflows on."), and a menu.
- **Steps panel** on the left: collapsible to a 56 px icon strip. Opens automatically on an empty canvas.
- **Canvas** in the middle on `bg-inset` with a subtle dot grid.
- **Step panel** on the right (400 px, resizable 360 to 560), a drawer that slides in on select and closes on Esc or empty-canvas click.
- **Run bar** at the bottom while a run is live or replayed.
- **Small screens** (below `lg`): Steps and Step panel become `Sheet` drawers; a dismissible `Alert` says "The builder works best on a wider screen." The canvas stays usable (pan, zoom, select, open a step).

## 4. The Canvas

### 4.1 Step card (the node)

PostGear's card language, n8n's compact layout:

```
          ┌──────────────────────────────────────┐
  ⚡ When │▌ ┌────┐  Post Published               │●  out
   tab    │▌ │icon│  Instagram, Facebook          │
          │▌ └────┘  (one-line summary)           │
          └──────────────────────────────────────┘
            ▲ family stripe   ▲ 44 px icon tile      ▲ status corner (run state, issue marker)
```

- Card 240 x 76 px, `border-2`, hard shadow (the DS named shadow), Card-only 12 px corner, `bg-card`.
- **Family stripe** 6 px on the left, colour per category (tokens, not hex): Triggers yellow (primary), PostGear ink, Social the platform colour, AI violet (the existing AI violet), Logic blue, Notify green, Data orange. Check every colour in light, dark and Lilac.
- **Icon tile** 44 px square, `border-2`, the app's brand logo for Slack, Sheets, Teams, Discord and the social platforms (reuse `apps/web/src/components/platforms`), a lucide icon for built-ins.
- **Name** (`type-ui`, one line, ellipsis) and **summary** (`type-label`, muted, one line: "Every Monday at 08:00", "Channel is Instagram", "Dry run in tests").
- **Triggers**: a small "When" sticker tab above the card's top-left with a bolt, and a rounded left edge (n8n's trigger shape). No input port.
- **Turned off**: 50% opacity, the name struck through, an "Off" sticker.
- **Pinned data**: a small pin sticker on the top edge (n8n).
- **Issue marker**: a red corner triangle with a tooltip of the first issue; never colour alone, the triangle has a "!" glyph.
- **Selected**: a 3 px focus ring in the primary colour plus a lifted shadow. No shadow on selected segments elsewhere (existing rule).
- **Hover toolbar** (n8n): floats above the card: Test Step, Turn Off, Duplicate, Delete, and a "..." menu. 150 ms leave grace so it is reachable.
- **Zoom levels**: below 0.6 hide the summary; below 0.4 show only the icon tile and name (driven by the React Flow zoom selector).
- **Merge** and **If / Else** and **Paths** cards are the same card; their output ports carry labels.

### 4.2 Ports and lines

- Input port: a filled circle on the left edge. Output ports on the right edge; labelled outputs (True, False, Approved, Rejected, case names, Otherwise, On Error) show a small label sticker next to the port. On Error is red.
- An output with nothing attached shows a short stem with a **+** button (n8n). Clicking it opens the step picker anchored there; the chosen step is placed to the right and connected.
- Dragging from a port: fitting targets glow (primary ring), others dim to 30% and refuse the drop. Dropping on empty canvas opens the picker at the cursor and connects the new step.
- Lines: bezier, 2 px ink, arrowhead at the target. Hover shows a midpoint **+** (insert a step here, the line splits) and a delete button. Selected lines thicken to 3 px.
- **Filter-on-line badge** (Make): when a Filter step sits alone between two steps, it may be shown collapsed as a funnel badge on the line (P1 polish; the Filter is still a real step in the graph).
- Reduced motion: no line animation, no flow dots.

### 4.3 Empty canvas and first step

- A large dashed **Add A Trigger** tile in the centre: "Choose what starts this workflow." Clicking opens the picker on Triggers only (n8n's "What triggers this workflow?").
- Under it, a strip of three template cards ("Or start from a template") so a blank canvas is never a dead end.

### 4.4 Step picker (n8n node creator, Zapier app picker)

One component, used three ways: the docked Steps panel, the popover from a "+", and the command palette's "Add Step".

- Search at the top (autofocus; ranks exact name, then keywords, then recent). "excel" finds Google Sheets and Excel.
- No search: **Recent** (last 5 used in this workspace), then categories: Triggers, PostGear, Social Channels, AI, Logic, Notify, Data. From a "+" the title reads "What happens next?" and triggers are hidden.
- Category rows drill down (n8n) with a back arrow; keyboard: arrows move, Enter adds, Right opens, Left goes back.
- Each item: icon tile, Title Case name, one-line description, a state sticker: **Ready**, **Needs Connection** (amber), **Coming Soon** (muted, with the reason on hover; not addable). Social Channels list one card per platform with the connected channels' avatars.
- Drag an item onto the canvas, or click to add after the selected step (connected automatically). Adding animates the new card in (scale 0.96 to 1, 200 ms) and nudges the view so it is visible.
- With a trigger already placed, triggers are greyed with "A workflow can have only one trigger."

### 4.5 Canvas controls and housekeeping

- Bottom-left control bar: zoom out, zoom in, Fit To Screen, Undo, Redo, **Tidy Up** (dagre left to right; animated 300 ms; undoable), lock (stops accidental moves).
- Minimap bottom-right, family colours, pannable.
- Snap to a 12 px grid. Multi-select with Shift-click or a drag box; selected steps move, duplicate and delete together.
- **Sticky notes**: Shift+S or the menu; five colours; markdown-light (bold, links, lists); resizable; never validated.
- **Right-click menu** on a step: Open, Test Step, Rename (F2), Turn Off (D), Pin Data (P), Duplicate, Copy, Delete. On the canvas: Add Step, Add Note, Paste, Tidy Up, Select All.
- **Copy and paste** through the system clipboard as JSON (works across workflows and tabs). Pasted steps get new keys; tokens between pasted steps are rewritten; connection ids are kept only if they exist in this workspace.

### 4.6 Keyboard

| Keys | Action |
|---|---|
| N | Open the step picker |
| Shift+S | Add a sticky note |
| Enter | Open the selected step |
| F2 | Rename the selected step |
| D | Turn the selected step off or on |
| P | Pin or unpin its test data |
| Ctrl/Cmd+C, V, D | Copy, paste, duplicate |
| Delete, Backspace | Delete the selection |
| Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z | Undo, redo |
| Ctrl/Cmd+Enter | Test Workflow |
| Ctrl/Cmd+K | Command palette (add step, tidy up, go to step, open run, toggle panels) |
| 1, 0 | Fit to screen, reset zoom |
| Arrow keys | Move selection to the next step along the lines (keyboard path through the graph) |
| Space+drag | Pan |
| ? | Shortcuts sheet |
| Esc | Close the picker or panel, then clear the selection |

Shortcuts never fire while typing in a field or a dialog.

## 5. The Step Panel (Zapier's tabs, n8n's expanded view)

### 5.1 Docked panel

```
┌ [icon] Google Sheets: Append Row   [✎]   [Expand ⤢] [×] ┐
│ Adds a row to a spreadsheet each time this step runs.  │
│ ┌ Setup ✓ ┬ Configure ! ┬ Test ┐                         │
│ │ ...                                                  │ │
│ └──────────────────────────────────────────────────────┘ │
│ ▸ Settings (On Error, retries, notes)                     │
└──────────────────────────────────────────────────────────┘
```

- **Setup**: the account or channel (connection picker with Connect {App} inline), and for social steps the channels. A tick on the tab when complete.
- **Configure**: the fields generated from the step's config schema. A "!" on the tab while a required field is empty.
- **Test**: Test Step, the result (output view), Pin Data, and the dry run notice ("This step does not send anything during tests." plus the "Send for real in tests" switch with a confirm).
- **Settings** (collapsed): On Error (Stop The Workflow, Continue, Use The Error Path), Retries (0 to 5, wait), Notes, Turn Off.
- Tabs never block: users can open Configure before Setup is done; the ticks just guide.
- Panels for triggers say what starts the workflow and show the sample data source ("Sample: your last published post", "Built-in sample").

### 5.2 Expanded view (n8n node detail view)

**Expand** (or double-click a step) opens a near full-screen dialog with three columns:

```
┌ Input ──────────────┬ Settings (the same tabs) ──┬ Output ──────────────┐
│ From: [Post Pub. ▾] │ Message                    │ [Data | Table | Raw] │
│ [Data|Table|Raw]    │ ┌────────────────────────┐ │ ✓ Dry run            │
│ ▾ Post              │ │ New post on [Channel]: │ │ would send:          │
│   Link  https://... │ │ [Post Link]            │ │ "New post on ..."    │
│   Text  "Spring..." │ └────────────────────────┘ │                      │
│   ▸ Channel         │ [Insert Data]              │ [Pin] [Test Step ▶]  │
└─────────────────────┴────────────────────────────┴──────────────────────┘
```

- **Input** shows the data available to this step (upstream only) from the last test run, pinned data, or built-in samples, labelled with its source. Views: **Data** (a tree with labels and sample values, the default), **Table**, **Raw** (formatted JSON, the only place it appears).
- **Drag a field** from Input into any text field to insert a chip there (n8n drag-to-map). Click a field to copy it as a chip.
- **Output** shows this step's last result (or "Test this step to see its result.").
- Prev and next arrows in the header walk to the previous and next step without closing (n8n).

### 5.3 Data chips (Insert Data)

- Text fields that accept data are a single-line or multi-line rich input (Tiptap, already in `apps/web`) where tokens render as **chips**: icon tile of the source step, "Post Published: Post Link". Users never see curly braces.
- **Insert Data** button (and typing `/` or `{` in the field) opens a popover (Zapier): steps grouped and searchable, each field with its sample value, nested fields as a tree, "May be empty" tags on fields from branches that might not run.
- Hover a chip: sample value from the last test, the source step, and a "Format" menu for the fixed filters ("Shorten to 200 characters", "Date as 2026-11-03", "If empty use ...").
- A chip whose source is gone turns red with "This data is no longer available." and the step gets an issue marker.
- Backspace deletes a whole chip. Keydown inside fields never deletes the selected canvas step (stop propagation).

### 5.4 Field types

| Field | Control |
|---|---|
| Short text, long text | data-chip input (one line or growing) |
| Choice | DS `Select` |
| Channels | the shared channel picker (the Queue revamp's component), only connected channels, avatars |
| Connection | connection picker: name, status dot and word, "Connect {App}" or "Ask a workspace admin to connect {app}." |
| Schedule | frequency segmented control, day chips, time picker, time zone combobox, and "Next runs" (three dates) underneath |
| Condition | rule rows: [field chip] [operator select, words fit the type] [value chip input]; All Of / Any Of switch; Add Rule; the sentence preview |
| Key and value list | Set Fields, HTTP headers, Sheets columns: rows with a name and a chip input; secret toggle for headers |
| Number, duration | number input with a unit select (minutes, hours, days) |
| Recipients | email chips, at most 10 |

Every field: label (sentence case), "Enter your ..." placeholder, help text under fields that need it, required asterisk, inline error in the DS style.

## 6. Live Checks And Issues

- Validation runs on the client on every change (debounced 300 ms) with `validateGraph` from `@postgear/automation`.
- Step markers update live. The issues chip in PageActions opens a popover list: each issue with its step icon and one sentence; clicking selects and centres the step, opens the panel on the right tab and focuses the field (`?step=` deep link).
- Errors block Activate; warnings do not (they show in amber).

## 7. Running And Watching (Make's playback, n8n's states)

### 7.1 Step states

| State | Card | Words (always shown, never colour alone) |
|---|---|---|
| Queued | dashed border | Waiting |
| Running | spinning ring around the icon tile, stripe pulses | Running |
| Succeeded | green check sticker, duration ("1.2 s") | Done |
| Dry run | green check plus a "Dry Run" sticker | Dry Run |
| Handled error | amber sticker (On Error was Continue or the error path) | Error Handled |
| Failed | red border, red "!" sticker | Failed |
| Skipped | 40% opacity | Skipped |
| Waiting for review | amber pulse, hand icon | Waiting For Review |
| Retried | small "2 attempts" sticker under the check | Succeeded after 2 attempts |

Never show a handled error as green (an n8n pitfall users complain about).

### 7.2 Playback

- During a run, events stream over SSE (`common/sse.ts`, `lib/sse.ts`). The line feeding a running step animates (dashed flow, 1 s loop); finished lines turn solid with the success colour; lines on the branch not taken go dashed and faint.
- Each finished step gets a **result badge** (Make's bubble) on its top-right corner: a check, a cross or a pause, plus the duration. Clicking it opens the step's input and output for that run.
- The run bar shows progress ("4 of 6 steps, 3.1 s"), Stop, and Close.
- Reduced motion: no flow animation and no pulse; states still change instantly with their words.

### 7.3 Runs tab

- Left: the run list (status sticker with words, Test or Live, the trigger phrase, started, duration, version "v3", credits used). Filters: All, Succeeded, Failed, Waiting, Test. Infinite scroll.
- Right: the canvas, read-only, painted with the selected run (n8n's past execution view), and a step list under it with input and output per step (Data, Table, Raw), errors in one sentence plus **Copy Details**.
- Actions on a run: **Debug In Editor** (copies the run's trigger data into the editor as pinned data and switches to Editor), **Retry From Here** on a failed step (P1, safe steps only), **Cancel** for running or waiting runs, **Approve** and **Reject** for a waiting review.

## 8. Activation, Versions And Safety

- The Activate switch opens a confirm dialog: the plain-words sentence ("When a post is published, this workflow will add a row to Social Report 2026 and send a Slack message."), the AI credit estimate per run when relevant, and, for automatic posting without a review, the extra tick: "I understand posts will go out automatically."
- Active workflows show **Active v3**. Edits after that show **Unpublished Changes** with two actions: **Activate Changes** and **Discard Changes**.
- **Versions** (menu): a drawer listing versions (number, who, when, an optional note typed at activation). Open one to preview it read-only on the canvas; **Restore As Draft** copies it into the draft (Zapier rollback). Never edits a version in place.
- Pausing a schedule says "Missed runs will not be caught up when you turn it back on."

## 9. Workflows List And Templates

- `PageActions`: Create Workflow (primary), search, status filter (All, Active, Paused, Draft).
- **Start From A Template**: a horizontal row of large template cards (sticker-style app logos in a row, Title Case name, one sentence, "Uses: Sheets, Slack"). Choosing one creates a draft and opens it with the **Finish Setup** checklist.
- **Finish Setup** (Zapier and Make template setup): a small floating checklist on the canvas listing what is left ("Connect Google Sheets", "Choose a Slack connection"); each item focuses its step and field; it ticks itself off live and disappears when the list is empty, with a "Ready to test" nudge pointing at Test Workflow.
- Table: Name, Trigger (icon and phrase), Status, Last Run (sticker and time, the failure reason on hover), Runs In 30 Days (a tiny bar list), Updated. Row menu: Open, Duplicate, Activate or Pause, Delete.
- Empty state: "No workflows yet. Start from a template or build your own."

## 10. Connections Page

A Zapier Apps style list: app logo, connection name, status (Connected, Needs Reconnect, Error) as words plus a sticker, last checked, "Used by 3 workflows" (opens the list), actions Check Connection, Rename, Reconnect, Delete. Admin only for changes; members see the list read-only. Secrets show only a masked hint ("hooks.slack.com/...a9F2").

## 11. Motion

- Panels slide 200 ms ease-out; cards scale in on add; Tidy Up animates positions 300 ms; playback lines flow. All motion stops under `prefers-reduced-motion`.
- Clickable icons are animated (`MotionIcon`); state icons (checks, crosses) are lucide.
- Toasts for activate, pause, duplicate and copy; never a toast for autosave (the save state says it).

## 12. Copy Glossary

| Never | Say |
|---|---|
| node | step |
| execution | run |
| payload, JSON, object | data |
| cron, cron expression | schedule |
| webhook URL (to beginners) | link |
| expression, variable, token | data (the button is Insert Data) |
| deploy, publish (a workflow) | activate, turn on |
| error (alone) | what went wrong and what to do: "Google Sheets is disconnected. Reconnect it in Connections." |

## 13. Accessibility

- Every canvas action has a keyboard path (section 4.6); the step picker is fully keyboard driven; focus is always visible.
- States are words plus icons, never colour alone.
- Cards have `aria-label`s ("Slack step, Failed: the link was not accepted").
- A screen-reader friendly **List View** toggle (P1) shows the graph as an ordered list of steps with their branches, editable through the same panel.
- Checked in light, dark and Lilac, and at phone width.
