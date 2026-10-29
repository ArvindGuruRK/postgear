# Module 06: Step Panel, Data Mapping And Live Checks

> **Sprint 10, Workflow Builder** | Status: Done with gaps | Size: XL (may need a second session)
> **Depends on**: [Module 04](module-04-connections.md) (ConnectionPicker), [Module 05](module-05-list-templates-and-canvas.md) (canvas, panel shell)
> **Stories**: WF-2.2 (state badges), WF-3.1, WF-3.2, WF-3.3, WF-4.1 (in-panel connect), WF-5.1, WF-7.3 (schedule panel), WF-7.4 (manual inputs)
> **Next**: [Module 07](module-07-run-engine.md) (can run in parallel), then [Module 08](module-08-test-runs-history-and-review.md)

## Goal

Every step can be set up without typing a single curly brace:

- the step panel's **Setup** and **Configure** tabs are generated from each step's config schema, with purpose-built controls (channels, connections, schedule, conditions, key-value lists);
- text fields take **data chips** through Insert Data, `/`, or drag from the Input pane, showing sample values;
- the **Expanded** view puts Input, Settings and Output side by side (n8n);
- **pinned test data** can be set per step;
- problems show live: markers on steps, the issues chip, and a click that lands on the exact field.

## Read First

1. [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 5, 6 and 12 (**the source of truth**).
2. Module 02's tokens, conditions, schedules and `availableData` (this module is their UI).
3. `packages/ui/src/components/form-field.tsx`, `select.tsx`, `combobox.tsx`, `multi-select.tsx`, `date-time-picker.tsx`, `popover.tsx`, `tabs.tsx`, `dialog.tsx`, `toggle.tsx`.
4. Tiptap 3 in `apps/web` (already a dependency): find where the composer uses it (`grep -r "@tiptap/react" apps/web/src`) and reuse its setup conventions. Read Tiptap's Mention and custom inline node docs.
5. `apps/web/src/components/composer/channel-picker.tsx` (shared channel picker) and Module 04's `ConnectionPicker`.

## Scope

**In**: field registry and schema-driven form, every field control in the blueprint's 5.4 table, the data chip editor, the Insert Data popover, Format menu for filters, the Expanded view with Input and Output panes (Input fed from pinned data, the last test run when Module 08 lands, or built-in samples), pinned data editing, panels for every **P0** step and every trigger, the issues popover and focus-the-field behaviour, live client validation, Manual trigger input fields editor, Schedule panel with next runs and the AI hourly rule message.

**Out**: Test Step and the Output pane's live result (Module 08 wires them; build the slots now), P1 step panels that need their module's backend (each of Modules 10 to 13 adds its own panel using this module's kit; the field registry must make that a small job).

## Design

### Field kit (`apps/web/src/components/workflows/fields/`)

```
field-registry.ts     maps a field "kind" to a component
schema-form.tsx       renders a step's form from its definition
chip-input.tsx        Tiptap-based data chip editor (single line and multi line)
insert-data.tsx       the popover (also used by drag targets)
format-menu.tsx       the fixed filters in plain words
condition-builder.tsx
schedule-builder.tsx
key-value-list.tsx    Set Fields, headers, column mapping
recipients-input.tsx
duration-input.tsx
connection-field.tsx  wraps Module 04's ConnectionPicker
channels-field.tsx    wraps the shared channel picker
manual-inputs-editor.tsx
```

**How fields are described**: Zod schemas alone cannot carry UI hints, so each `NodeDefinition` in `packages/automation` gains an optional `form: FormSpec` (add it in this module, it is pure data):

```ts
FormSpec = { tabs: { setup: FieldSpec[], configure: FieldSpec[] } }
FieldSpec = { path: string, kind: 'text' | 'longText' | 'select' | 'channels' | 'connection' | 'schedule'
              | 'condition' | 'keyValue' | 'recipients' | 'duration' | 'number' | 'toggle' | 'manualInputs',
              label: string, help?: string, placeholder?: string, required?: boolean,
              acceptsData?: boolean, options?: { value, label }[], showIf?: { path, equals } }
```

`schema-form.tsx` renders `FieldSpec`s, writes through the builder reducer's `updateConfig` (coalesced for undo), and shows Zod errors for that path inline. A test asserts every ready definition's `form` paths exist in its `configSchema`.

### Data chips (`chip-input.tsx`)

- Tiptap editor with a custom inline atom node `dataChip { raw, path, filters }` and plain text. Single-line mode blocks Enter; multi-line mode allows it.
- **Load**: `parseTemplate(value)` (Module 02) to segments, segments to Tiptap content. **Save**: Tiptap content to segments to `serializeSegments`. Round trip must be exact (unit test with the Module 02 tricky strings).
- Chip look: small icon tile of the source step, "Post Published: Post Link", `type-label`; a red variant with "This data is no longer available." when `validateGraph` reports a token issue for this field.
- Hover card: sample value (last test, pinned, or built-in sample, labelled with the source), the source step, and **Format** (the filter menu in words: "Shorten to 200 characters", "Uppercase", "Date as 2026-11-03", "If empty use ...", "Join a list with commas").
- Typing `/` or `{` opens Insert Data at the caret. Backspace removes a whole chip. Keydown never bubbles to the canvas (so Delete does not delete the step).
- Accessibility: chips are announced as "data: Post Published, Post Link".

### Insert Data popover (`insert-data.tsx`, Zapier style)

- Groups from `availableData(graph, nodeKey, ctx)`: trigger first, then upstream steps in run order, then Run and Workspace.
- Search across labels and sample values. Each row: label, type icon, sample value (truncated). Nested fields expand as a tree (3 levels).
- "May be empty" tag and greyed rows for turned-off steps, as Module 02 marks them.
- If nothing is upstream: "Connect this step after another step to use its data."

### Expanded view (blueprint 5.2)

- Opens from Expand, double-click on a step, or Enter. A near full-screen `Dialog` with three resizable columns: **Input**, **Settings** (the same tabs), **Output**.
- **Input pane**: a source dropdown ("From: Post Published", "From: Set Fields", ...); views **Data** (tree with labels and values), **Table** (one row per field path), **Raw** (formatted JSON, read only); a source label ("Pinned", "Last test 14:02", "Sample").
- **Drag to map**: rows in the Input pane are draggable; dropping on a chip input inserts a chip at the drop caret; clicking a row inserts at the last caret.
- **Output pane**: this step's last test output, or "Test this step to see its result." (Module 08 fills it). **Pin** button here and in the Test tab.
- Header arrows step to the previous and next step in run order.

### Pinned data

- Stored per step on the `Automation` row via Module 03's pinned data endpoints, never in the graph.
- Pin from a test result (Module 08), or **Edit Pinned Data** in the Raw view (a JSON editor validated against the step's output shape; invalid JSON shows the line).
- A pinned step shows the pin sticker; pinned data feeds Input panes and Test Step; **live runs ignore it** (enforced in the worker, Module 07). Unpin is one click.

### Panels for the P0 steps and triggers

Write the `FormSpec` and any custom bits for:

| Step | Setup tab | Configure tab |
|---|---|---|
| Post Published | (none) | Channels (optional, "Any channel" when empty), Tags (optional) |
| Post Failed | (none) | Channels, Reasons (multi-select in plain words from `PublishFailureReason`) |
| Schedule | (none) | Schedule builder: frequency, days, time, time zone, "Next runs" list, the AI hourly rule message when relevant |
| Manual | (none) | Input fields editor (up to 5: label, type, required) |
| If / Else | (none) | Condition builder |
| Paths | (none) | Ordered cases, each a name plus a condition builder; reorder by drag; the Otherwise path is fixed last |
| Filter | (none) | Condition builder, with "Only continue if ..." wording |
| Delay | (none) | "Wait for" duration or "Wait until" a date and time (chip input allowed for the time) |
| Manual Review | (none) | What to show the reviewer (chip inputs: text, image), instructions, who is notified (everyone in the workspace for now), expiry (fixed 7 days, shown) |
| Set Fields | (none) | Key-value list (name plus chip input, with a type select) |
| In-App Notification | (none) | Title (chip input), Message (multi-line chip input), optional link |
| Slack (P0, panel only; sending lands in Module 12) | Connection | Message (multi-line chip input) |
| Generate Text (P0, panel only; running lands in Module 11) | (none) | Prompt, Platform, Voice (Personal or Company), Web Research toggle, and "Uses about {n} AI credits per run" |
| Create Draft (P0, panel only; running lands in Module 10) | Channels | Text, Media (chip input that accepts image data or a pick from Media) |

Trigger panels show their sample source line ("Sample: your last published post" or "Built-in sample").

### Condition builder

Rule rows: field (a chip input limited to one chip, or Insert Data), operator (a `Select` whose options depend on the field's type, from Module 02's table, in words), value (chip input; hidden for "is empty"), Match Case toggle for text. **All Of** / **Any Of** segmented switch. Add Rule, remove rule. Under the rules, the sentence from `describeCondition` ("Continue only if Channel is Instagram"). Paths reuse it per case.

### Schedule builder

Segmented control: Every Hour (with "every N hours"), Every Day, Every Weekday, Every Week (day chips), Every Month (day of month select including "Last day"). Time picker (24 h, respecting the user's locale display), time zone combobox (IANA list, search, default from the browser). Under it: "Next runs" with three dates from `nextRuns()` formatted in the chosen zone. Never the word "cron".

### Live checks and the issues list

- `useValidation(graph, ctx)`: runs `validateGraph` debounced 300 ms in the browser; `ctx` from the catalog response (connections, channels). Memoised per graph revision.
- Step markers (Module 05's triangle) now show the first issue's message. Tabs show a "!" when their fields have errors.
- Issues chip in PageActions: "No issues found" or "{n} Issues" (red) plus warnings count in amber. Popover list: step icon, step name, the message. Click: select the step, centre it (`fitView` on that node with padding), open the panel on the tab that holds `field`, scroll to and focus that field. Same behaviour for `?step=<key>&field=<path>` deep links and the Finish Setup list.

### Connections inside the panel (WF-4.1)

The Setup tab's connection field uses Module 04's `ConnectionPicker`: existing connections with status words; **Connect {App}** for admins (webhook paste dialog or the OAuth start that returns to `?step=<key>`); "Ask a workspace admin to connect {app}." for members. When a connection is created, the field selects it and the marker clears.

## Tasks

- [x] `FormSpec` on `NodeDefinition` in `packages/automation` (+ the paths-exist test).
- [x] Field registry and `schema-form.tsx`.
- [x] `chip-input.tsx` with round-trip tests, hover card and Format menu.
- [x] `insert-data.tsx`.
- [x] Condition builder, schedule builder, key-value list, recipients, duration, manual inputs editor, channels and connection fields.
- [x] Panels for every row of the P0 table above.
- [x] Expanded view with Input and Output panes and drag to map.
- [x] Pinned data: sticker, edit in Raw, unpin, wired to the API.
- [x] Live validation hook, tab "!" markers, issues popover, focus-the-field, deep links, Finish Setup focus.
- [x] Placeholders "Enter your ..."; labels sentence case; names Title Case.

## Tests

- Unit: chip round trip (30 strings), `schema-form` writes the right paths, condition builder operator lists per type, schedule builder output equals the package config, focus-the-field resolves every issue code to a tab.
- Component: Insert Data lists upstream only; a deleted source turns a chip red; Backspace in a chip input does not delete the canvas step.
- Playwright (big flow): open Publishing Report, connect Slack through the panel (webhook paste), insert Post Link into the Slack message through Insert Data and by dragging from the Input pane, see the issue count reach "No issues found". Screenshots in light, dark, Lilac.

## Done When

- WF-3.1, WF-3.2, WF-3.3, WF-5.1 work in the running app; WF-7.3 and WF-7.4 panels work (firing comes in Module 09).
- No raw `{{` is visible anywhere in normal views (only in Raw).
- `npm run validate` passes.

## Hand Check

1. Open AI Weekly Post: set the schedule to Monday 08:00, change the time zone, read the next three runs.
2. In Slack's message, type `/`, insert Post Link, change its Format to "Shorten to 50 characters", hover it to see the sample.
3. Delete Set Fields: the chips that used it turn red, the issues chip counts them; click an issue and land on the field.
4. Build an If / Else with two rules and Any Of; read the sentence.
5. Expand a step, drag a field from Input into a field. Pin data on a step and unpin it.
6. As a member (`member@postgear.local`): Connect {App} reads "Ask a workspace admin to connect {app}."

## Handoff

Update [`README.md`](README.md): progress row, the `FormSpec` shape (later modules add panels with it), and any field kind added.
