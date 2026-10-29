# Module 05: Workflows List, Templates And The Canvas

> **Sprint 10, Workflow Builder** | Status: Done with gaps (2026-10-29: no component test for the step card yet; see the README progress row and decision log) | Size: XL (may need a second session)
> **Depends on**: [Module 03](module-03-data-model-and-api.md) (API), Modules 01 and 02 (package)
> **Stories**: WF-1.1, WF-1.2, WF-1.3, WF-1.4, WF-2.1, WF-2.2, WF-2.3, WF-2.4, WF-2.5, WF-2.6, WF-2.7
> **Next**: [Module 06](module-06-step-panel-and-data-mapping.md)

## Goal

The first thing the user can touch, and it must already feel like n8n, Make and Zapier wearing PostGear's look:

- **Workflows** in the rail; a list page with the template gallery;
- a builder where steps are added from a searchable picker or a "+" on a port, connected port to port, moved, tidied, copied, undone and autosaved;
- the step panel shell opens on select (its fields come in Module 06).

No runs yet. After this module a user can build the Publishing Report graph by hand and see it saved.

## Read First

1. [`README.md`](README.md) and [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 2 to 4, 9 and 11 to 13 (**the source of truth for look and interaction**).
2. `docs/design-patterns/design-system-rules.md`, `apps/web/AGENTS.md` (Next 16 differs from training data), the `new-page` skill.
3. `apps/web/src/components/navigation/dashboard-shell.tsx` (the `RAIL` array), `packages/ui/src/components/page-actions.tsx`, `sheet.tsx`, `command-menu.tsx`, `data-table.tsx`.
4. The Studio editor as the in-house model for an editor page: `apps/web/src/components/studio/editor-autosave.ts` (debounced save, revision guard, Saved only after the API confirms, Offline, conflict), `editor-state.ts` (undo and redo), `apps/web/src/lib/leave-guard.ts`.
5. React Flow 12 docs (`@xyflow/react`): custom nodes, custom edges, `isValidConnection`, `onConnectEnd`, `screenToFlowPosition`, `useStore` zoom selector, `NodeToolbar`, `MiniMap`. Check the current 12.x on npm.

## Scope

**In**: rail entry, list page, template gallery and create-from-template, builder page and layout, canvas with custom step card and edges, step picker (docked, popover, drop-on-canvas), connect rules, insert on line, multi-select, sticky notes, Tidy Up, copy and paste, context menus, keyboard shortcuts and the shortcuts sheet, command palette, undo and redo, autosave with the revision guard and conflict notice, leave guard, Finish Setup checklist (reads issues from `validateGraph`), small screen drawers, the step panel **shell** (header, tabs, Settings section) with a placeholder body.

**Out**: field rendering, data chips, condition and schedule builders, live issue list UI beyond markers (Module 06); anything that runs (Modules 07 and 08); Activate and Versions (Module 09; show the switch disabled with "Coming in this sprint" only if needed, better hidden).

## Design

### Dependencies to add (apps/web)

- `@xyflow/react` 12.x (MIT).
- `@dagrejs/dagre` for Tidy Up (MIT, small). Do not add elkjs.
- `nanoid` if not already present (step keys, 10 chars).
- No global state library unless needed: keep the graph in one reducer (below). If a store is wanted for cross-component reads, `zustand` is acceptable; record the choice.

### File layout (`apps/web/src/components/workflows/`)

```
list/            workflows-list.tsx, template-gallery.tsx, workflow-row-menu.tsx
builder/         builder-page.tsx (layout), builder-top-bar.tsx, builder-state.ts (+ .test.ts),
                 builder-autosave.ts (+ .test.ts), builder-shortcuts.ts, command-palette.tsx,
                 finish-setup.tsx, shortcuts-sheet.tsx
canvas/          workflow-canvas.tsx, step-card.tsx, step-ports.tsx, step-edge.tsx,
                 sticky-note.tsx, canvas-controls.tsx, tidy-up.ts (+ .test.ts), clipboard.ts (+ .test.ts),
                 context-menu.tsx
picker/          step-picker.tsx (one component, three placements), picker-search.ts (+ .test.ts)
panel/           step-panel.tsx (shell only in this module)
icons.ts         IconKey -> component map (brand logos from components/platforms, lucide for built-ins)
```

Routes: `src/app/(dashboard)/[orgId]/workflows/page.tsx` (list, server component fetching through `serverApi()`), `.../workflows/[automationId]/page.tsx` (builder, client island), `not-found` for another workspace's id.

### Rail

Add `{ segment: 'workflows', label: 'Workflows', icon: <animated icon> }` after Studio in `RAIL` (a workflow or git-branch family icon from `@animateicons/react`; pick one that animates well). Also in the mobile menu. Top bar page name: Workflows.

### List page (blueprint section 9)

- `PageActions`: **Create Workflow** (primary), `SearchInput`, status filter (All, Active, Paused, Draft).
- **Start From A Template** row: cards from `GET /automations/templates` (or the package's template list): app logo stickers, Title Case name, one sentence, "Uses: Sheets, Slack". Click creates the draft (`POST /automations` with `templateId`) and routes to the builder with `?setup=1`.
- Table with the columns in the blueprint; Last Run sticker with words; failure reason in a tooltip. Row menu: Open, Duplicate, Activate or Pause (disabled until Module 09), Delete (solid red, confirm naming the workflow, warning if active).
- Empty state: "No workflows yet. Start from a template or build your own." with the template row above it.
- **Create Workflow** creates "Untitled Workflow" and opens it.

### Builder state (`builder-state.ts`)

One reducer owns the draft graph:

```ts
type BuilderState = { graph: AutomationGraph, selection: { nodes: string[], edges: string[], notes: string[] },
                      history: { past: AutomationGraph[], future: AutomationGraph[] }, revision: number, dirty: boolean }
actions: addNode, insertOnEdge, connect, disconnect, moveNodes (commit on drag end only), updateConfig (coalesced),
         rename, toggleDisabled, deleteSelection, duplicateSelection, paste, tidy, addNote, updateNote, undo, redo, load
```

- React Flow renders **derived** nodes and edges from `graph` (never two sources of truth). Positions during a drag live in React Flow; the reducer gets `moveNodes` on drag stop.
- **Undo and redo**: 100 snapshots; config typing coalesces per field within 1.5 s; moves are one step per drag; Tidy Up is one step. Undo after delete restores the step with its settings and lines (WF-2.6).
- **No stale closures** (TriForms lesson): handlers read the latest state through the reducer or a ref updated in the same tick, never through a `useCallback` with a partial dependency list. Add a test that changes config then triggers an action and asserts it saw the new value.
- Keys: `nanoid(10)` per new step, never reused (paste and duplicate re-key and rewrite tokens through the package helper).

### Autosave (`builder-autosave.ts`, modelled on the Studio editor)

- Debounce 1 s after the last change; `PATCH /automations/:id { graph, name, draftRevision }`.
- Show **Saving**, **Saved** (only after the API confirms), **Offline** (navigator offline or network error, retries with backoff), "Could not save. Retrying."
- A 409 shows the DS `Alert`: "This workflow changed somewhere else." with **Reload** (and Copy My Changes as JSON, so nothing is lost).
- Saves happen even when the graph has issues (a draft may be invalid). Saving never activates.
- Flush before: leaving (leave guard), Test Workflow (Module 08), Activate (Module 09).

### Canvas (`workflow-canvas.tsx`, blueprint section 4)

- `ReactFlow` with `nodeTypes = { step, note }`, `edgeTypes = { flow }`, `snapToGrid [12,12]`, `selectionOnDrag`, `panOnDrag={[1,2]}`, `panOnScroll`, `zoomOnPinch`, `minZoom 0.2`, `maxZoom 1.5`, `fitView` on load, `deleteKeyCode={null}` (deletion goes through the reducer so undo works), `proOptions` per licence (attribution can stay; it is MIT).
- **Step card** exactly as blueprint 4.1: stripe, icon tile, name, summary from the catalog's `summary()`, trigger "When" tab, Off and pin stickers, issue triangle, hover `NodeToolbar` (Test Step disabled until Module 08), zoom-level detail via a `useStore` selector (not a `setInterval`, a TriForms weak spot).
- **Ports**: React Flow `Handle`s with ids equal to `PortId`s; labelled output stickers; the "+" stem on an unconnected output.
- `isValidConnection` calls `canConnect()` from `@postgear/automation`; while connecting, fitting handles get a glow class and others dim (read the in-progress connection from React Flow's store).
- `onConnectEnd` on empty canvas opens the picker at the drop point, then adds and connects.
- **Edges**: custom `flow` edge (bezier, arrow marker, midpoint "+" and delete on hover or select, 24 px invisible hit path). Branch edges carry no label of their own; the port sticker names the branch.
- Loops are refused at connect time with a toast: "Workflows cannot loop back to an earlier step."
- `MiniMap` with family colours, pannable and zoomable. Controls bar as in the blueprint.
- Theme: canvas on `bg-inset` with a dot `Background`; cards on `bg-card`; check light, dark, Lilac.

### Step picker (blueprint 4.4)

- Data from `GET /automations/catalog` (definition plus live state). Search ranking in `picker-search.ts` (exact title, then keywords, then description, then recent), unit tested.
- Three placements: docked left panel (collapsible to an icon strip), popover from "+" or a dropped line ("What happens next?", triggers hidden), and the command palette's Add Step.
- Keyboard driven (arrows, Enter, Right to drill in, Left to go back, Esc).
- Coming Soon items show the reason and cannot be added; Needs Connection items can be added (the panel then asks to connect).
- One trigger only: other triggers greyed with "A workflow can have only one trigger."
- Social Channels: one card per platform from the catalog's `postgear.publish` views, with connected channel avatars; a platform with no connected channel shows "Connect a {platform} channel first." linking to Channels.
- Placement: after the selected step (or the last leaf) at +280 px x, avoiding overlap; then pan so it is visible.

### Housekeeping

- **Sticky notes** (Shift+S): a `note` node type, resizable (`NodeResizer`), five colours as DS tokens, light markdown (bold, italic, links, lists) rendered safely (no raw HTML).
- **Tidy Up** (`tidy-up.ts`): dagre `rankdir LR`, `nodesep 40`, `ranksep 80`; keep the trigger's position as the anchor; order branch children so True sits above False and Paths cases follow their order; notes are not moved. Animated with a 300 ms CSS transform transition, off under reduced motion. Unit test: deterministic positions for the three templates.
- **Copy and paste** (`clipboard.ts`): writes `{ kind: 'postgear.steps', version: 1, nodes, edges }` to the system clipboard as text; paste validates with the package schema, re-keys, rewrites tokens between pasted steps, drops lines to steps not pasted, keeps connection ids only if present in the catalog's connections list, and offsets by 48 px. Never copies pinned data.
- **Context menus** and **keyboard** exactly as blueprint 4.5 and 4.6, implemented once in `builder-shortcuts.ts` with an "is the user typing" guard. Shortcuts sheet on `?`.
- **Command palette** (Ctrl/Cmd+K) on the DS `command-menu`: Add Step (opens the picker list inline), Go To Step (by name), Tidy Up, Add Note, Toggle Steps Panel, Fit To Screen, Show Shortcuts.

### Finish Setup checklist (blueprint 9)

- Shown when `?setup=1` or when the graph came from a template and still has errors.
- Lists `validateGraph` errors grouped per step in human words ("Connect Google Sheets", "Choose a Slack connection"). Clicking an item selects the step and opens the panel (Module 06 focuses the field).
- Ticks off live; when empty: "Ready to test." pointing at Test Workflow; dismissible.

### Step panel shell

Right drawer per blueprint 5.1 with header (icon, name with rename, Expand placeholder, close), the Setup, Configure, Test tabs (bodies say "Coming next" only in this module's build), and the Settings section with **On Error**, **Retries**, **Notes** and **Turn Off** working already (they are graph-level fields from Module 01).

### Small screens

Below `lg`: Steps panel and step panel become `Sheet`s; a dismissible `Alert` "The builder works best on a wider screen."; touch: pinch zoom, drag to pan, long press opens the context menu.

## Tasks

- [x] Add dependencies; `icons.ts` map.
- [x] Rail entry and mobile menu; routes and not-found.
- [x] List page, template gallery, create, duplicate, delete, row menu.
- [x] `builder-state.ts` reducer with undo and redo (+ tests, including the stale-closure test).
- [x] `builder-autosave.ts` (+ tests: debounce, Saved only after 200, 409 conflict, offline retry).
- [x] Canvas: step card, ports, flow edge, connect rules, drop-to-add, insert on line, minimap, controls, zoom detail.
- [x] Step picker in three placements (+ search tests).
- [x] Notes, Tidy Up (+ tests), clipboard (+ tests), context menus, shortcuts, shortcuts sheet, command palette.
- [x] Finish Setup checklist.
- [x] Step panel shell with Settings working.
- [x] Leave guard; small screen drawers.
- [x] Title Case test passes for every new name (`title-case.test.ts`).

## Tests

- Unit: reducer (every action, undo and redo of each, coalescing), autosave, picker search, Tidy Up determinism, clipboard round trip and re-keying.
- Component (React Testing Library): step card renders states and stickers; picker keyboard navigation; Coming Soon not addable.
- Playwright (this is a big UI change): one flow, create from Publishing Report, add a Slack step from a "+", connect, undo a delete, reload and see it saved. Screenshots to `screenshots/` in light, dark and Lilac.

## Done When

- WF-1.1 to WF-1.4 and WF-2.1 to WF-2.7 acceptance criteria all work in the running app.
- `npm run validate` passes for web and the package.
- No console errors or React Flow warnings in the builder.

## Hand Check

1. Rail, Workflows: the list, the template row, the empty state.
2. Choose Publishing Report: the steps open tidy and connected, markers on Sheets and Slack, the Finish Setup list.
3. Add a step with "+", by dragging, by dropping a line on empty canvas, and with N. Try to connect into the trigger and to make a loop.
4. Delete a step, Ctrl+Z, Ctrl+Shift+Z. Copy two steps, open another workflow, paste.
5. Tidy Up, sticky note, Turn Off, F2 rename, Ctrl+K.
6. Reload: everything is saved. Open the same workflow in two tabs, edit both: the conflict notice appears.
7. Light, dark, Lilac, and a phone-width window.

## Handoff

Update [`README.md`](README.md): progress row, the library choices (state, dagre), the clipboard format, and any blueprint deviation in the decision log.
