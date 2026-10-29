# Sprint 10b: Workflow Builder UI Revamp (Immersive Canvas)

> **Extends**: [Sprint 10: Workflow Builder](sprint-10-workflow-builder.md) and its [UX blueprint](../sprint-10/workflow-implementation-docs/00-ux-blueprint.md). Everything there still holds: the screens, the flows and the behaviour do not change. This sprint changes how the builder looks and feels.
> **Owner's brief (2026-10-29)**: a UI revamp of the Workflow Builder that is visually immersive, absolutely robust, stunning, neat and clean, with the canvas at its heart, fixing the builder's whole UI properly by sticking to the design system.
> **Depends on**: Sprint 10 Modules 05 (canvas), 06 (step panel), 08 (live run view and run history) and 09 (activation and versions), the surfaces this sprint polishes. Best started after Module 14, when the builder is complete and covered by e2e tests, so the revamp is not chasing a moving target.
> **Design rules**: [`design-system-rules.md`](../design-patterns/design-system-rules.md) and [`design-tokens.md`](../design-patterns/design-tokens.md) are binding. Where this document and the rules disagree, the rules win unless the owner signs off an exception (see "Decisions To Confirm").
> **Branch**: `sprint-10b-workflow-ui-revamp`, cut from `sprint-10-workflow-builder` once its last module is committed (to confirm).
> **Status**: planned, not started. A generic sprint: the workstreams below become numbered tasks (or module files, like Sprint 10's) when it starts.

## Progress Log

- **2026-10-29**: this document, from the owner's brief.

## Sprint Goal

When someone opens a workflow, the canvas is the whole experience: calm and tidy at rest, alive while a run plays, and solid under every action (zoom, drag, paste 50 steps, switch theme, resize the window). It reads as PostGear: borders, hard shadows, stickers and the Sora type roles, used with more discipline, not a new style.

The brief's words, made checkable:

| Word | Means | Checked by |
|---|---|---|
| Immersive | The canvas fills the screen and the chrome steps back: panels collapse, a Focus Mode hides the app frame, detail appears as you zoom in, a run plays on the canvas itself | The owner by eye; screenshots at 1440 and 1024 px |
| Robust | Nothing jumps, flickers, overlaps or gets lost: 50 steps pan and zoom smoothly, long names never collide, every theme reads, keyboard and reduced motion work, no action loses work | The fixture graph, the budgets and the stress list (workstream 7) |
| Stunning, neat and clean | One grid, one card anatomy, one panel anatomy, one line style, one sticker size; colour only where it means something; nothing that is filler | The audit (workstream 1) ends with no open deviations |

## Ground Rules

1. **Not a design system restyle.** The palette, the 24 themes, Sora and its roles, border widths, the shadow tokens, corners (`rounded-card` on cards only), the yellow secondary hover and the current dark mode stay as they are. The 2026-10-20 restyles were rejected; this sprint must not drift into one.
2. **Tokens only.** No hex, no bracketed sizes, no hand-written weights or tracking. A genuinely new need (for example a dot-grid colour for the canvas) is added through §17 of the rules, with a comment saying why.
3. **Reuse before building.** `packages/ui` first (Card, Panel, Toolbar, Sheet, Popover, Tabs, Badge, Alert, Tooltip, Command, MotionIcon). A builder piece another screen could use goes into `packages/ui` with a playground entry; canvas-only pieces stay in `apps/web/src/components/workflows/`.
4. **Layout and flow stay n8n, Make and Zapier**, as the UX blueprint sets them. Ideas only, never code (n8n is under the Sustainable Use Licence), and never one screen copied frame for frame.
5. **No filler.** No in-page titles, taglines, decorative dividers, status pills that say nothing, glows or fades as decoration. Spacing separates; borders and hard shadows give depth.
6. **Words**: Title Case names, sentence case sentences, "Enter your ..." placeholders, and the blueprint's glossary (step, run, data, schedule; never node, execution, payload, cron).
7. **Every change is checked** in light, dark and Lilac, at 1440 px and 1024 px, and with reduced motion on.
8. **Behaviour is frozen.** A change that alters what a click does needs the owner's OK and a decision log entry. The Sprint 10 e2e specs keep passing unchanged.

## Workstreams

### 1. Audit (first, before any change)

- Walk every builder surface: Workflows list, template gallery, empty canvas, the canvas with a 6-step and a 50-step graph, the step picker in its three placements, the docked step panel, the Expanded view, Insert Data, the issues popover, Finish Setup, the run bar, the Runs tab, the activation dialog, the versions drawer, the Connections page and the small-screen drawers.
- For each surface, list every deviation from the design system rules and the blueprint (file and line, the rule, the fix), and every robustness bug found (overlap, jump, flicker, clipped text, weak contrast).
- Take "before" screenshots of each surface in light, dark and Lilac at both widths.
- The owner reviews the audit and the decisions below before workstream 2 starts.

### 2. Canvas Foundation

- **Viewport**: the builder fills the area under the top bar with no page scroll; the canvas resizes without jumping when a panel opens or closes.
- **Ground**: one canvas surface with a dot grid that follows the theme (see decisions), and the 12 px snap grid lined up with the dots.
- **Focus Mode**: one toggle (and a shortcut) that collapses the app sidebar and the side panels, so only the canvas, the PageActions row and the controls remain. Remembered per browser.
- **Zoom detail tiers** (blueprint 4.1): full card, then name only, then icon only, at fixed zoom levels, with no layout jump between them.
- **Lines**: one curve style and weight, arrowheads, port labels that never sit under a card, a clean fan-out from Paths, and lines that avoid crossing cards where they can.
- **Interaction marks**: selection, the multi-select box, the drag ghost, drop targets and the "+" stems all drawn with one recipe.
- **Controls and minimap** as design system Toolbar surfaces, placed so they never cover a step at Fit To Screen.

### 3. Canvas Kit (the visual vocabulary)

One component per element, each showing every state side by side in `/dev/components` (Workflows section):

- **Step card**: rest, hover, selected, dragging, multi-selected, turned off, pinned, with an issue, the trigger shape, and every run state from blueprint 7.1 (waiting, running, done, dry run, error handled, failed, skipped, waiting for review, retried).
- **Ports and lines**: port, port label sticker, the "+" stem, line at rest, hovered, selected, running, done and not taken, and the line's midpoint actions.
- **Around the steps**: result badge, sticky note (five colours), hover toolbar, the Add A Trigger tile, the Finish Setup card and the run bar.
- One sticker size and one icon tile size across all of them; family colours from tokens only.

### 4. Chrome Around The Canvas

- **PageActions row**: one height, one gap, a clear order. Test Workflow is the one primary button; Activate is a switch.
- **One panel anatomy** for the Steps panel, the step panel, the Expanded view, the versions drawer and the run list: the same header (icon tile, name, actions), body padding, footer and scroll behaviour.
- **Resizable panels** with a visible, keyboard-reachable handle and remembered widths; collapse to an icon strip.
- **Popovers** (step picker, Insert Data, issues) share their size rules, search field and keyboard behaviour.
- **Small screens**: the blueprint's drawers, with no clipped control at 1024 px.

### 5. Motion And Liveliness

- A short motion spec: what moves, for how long, with which easing, and whether it is CSS or GSAP (imported from `@postgear/ui` only).
- **Run playback** (blueprint 7.2): line flow, step state changes, result badges and run bar progress, readable at a glance and quiet at rest.
- Add, delete, paste and Tidy Up transitions; panels opening and closing.
- Everything stops under `prefers-reduced-motion`, and states still change at once, with their words.

### 6. Theming And Contrast

- Family stripes, stickers, port labels, line colours, the dot grid and the run-state colours, checked in all 24 themes (12 light, 12 dark), with a measured contrast for each pair that carries meaning: 3:1 for shapes, 4.5:1 for text.
- Lilac and the other tinted light themes follow the chosen theme where the rules allow (the "chrome, not secondary" lesson from Home).
- Platform logos stay legible on their tiles in every dark theme.

### 7. Robustness And Performance

- **A fixture graph** of 50 steps, 120 lines and a few notes on a `/dev/workflows` page, with theme and width switches. Every performance and visual check uses it.
- **Budgets**: pan and zoom with no dropped frames on the dev machine, no long task over 50 ms while dragging, a 50-step paste in under a second, and the builder's first paint with no layout shift.
- **Stress list**: very long step names and summaries, 20 Paths cases, deep Insert Data trees, autosave while offline, a 409 save conflict, a deleted connection, a run showing every state at once, a window resize mid-drag, a theme switch mid-run, and zoom at its minimum and maximum.
- **An error boundary** around the canvas that keeps the draft safe and offers Reload.

### 8. Accessibility

- Visible focus on every canvas element; the keyboard paths of blueprint 4.6 keep working; `aria-label`s on cards, lines and badges; states always as words plus icons.
- The blueprint's List View (P1) is a candidate for this sprint (see decisions).

### 9. The Other Builder Screens

The Workflows list, the template gallery, the Connections page and the Runs tab get the same finish (panel anatomy, sticker size, empty states), so going from the list to the canvas feels like one product.

### 10. Write It Down

- A new §16h, "Workflow builder surfaces", in `design-system-rules.md`: the canvas ground, the card anatomy, the line style, the motion spec, and any exception the owner approved.
- New shared components documented in their files and in the playground.
- `00-ux-blueprint.md` updated wherever the revamp refined a rule, with an entry in Sprint 10's decision log.

## Names And Placement

| Thing | Where |
|---|---|
| Canvas kit | `apps/web/src/components/workflows/canvas/` (canvas-only pieces) |
| Shared pieces | `packages/ui/src/components/` (anything another screen could use), each with a playground entry |
| Playground | `/dev/components`, Workflows section: every kit state side by side |
| Benchmark page | `/dev/workflows`: the 50-step fixture graph with theme and width switches |
| Rules | `docs/design-patterns/design-system-rules.md` §16h |
| Screenshots | `screenshots/` (never committed), numbered, named `10b-<nn>-<surface>-<theme>-<width>.png` |

## Task Breakdown

In order. The owner checks each one by eye before the next starts.

1. Audit, "before" screenshots, decisions confirmed with the owner.
2. The fixture graph and the `/dev/workflows` page, so every later change is measured.
3. Canvas kit components and their playground states.
4. Canvas foundation: ground, Focus Mode, zoom tiers, lines, controls.
5. Chrome around the canvas: PageActions, panel anatomy, popovers, small screens.
6. Motion spec and run playback.
7. Theming and contrast pass across all 24 themes.
8. Robustness and performance pass against the budgets and the stress list.
9. Accessibility pass (and List View, if confirmed).
10. The other builder screens.
11. Rules and docs: §16h, blueprint updates, decision log.
12. Visual checks: Playwright screenshots of the fixture graph and the key surfaces in light, dark and Lilac at both widths, and the full Sprint 10 e2e suite, unchanged.
13. Close-out with the `sprint-closeout` skill.

## Definition Of Done

- [ ] Every deviation in the audit is fixed, or signed off by the owner as an exception.
- [ ] Every kit element shows every state in `/dev/components`, and the builder draws only with those components.
- [ ] No hex, bracketed size or hand-written weight in the builder's code, enforced by a test or lint rule, not only by review.
- [ ] The 50-step fixture meets the workstream 7 budgets, measured and written in the close-out.
- [ ] Every item on the stress list passes.
- [ ] Screenshots of each surface in light, dark and Lilac at 1440 and 1024 px, approved by the owner.
- [ ] Reduced motion and the keyboard paths work across the canvas.
- [ ] `title-case.test.ts`, `npm run validate` and the Sprint 10 e2e specs pass unchanged.
- [ ] §16h is written and the blueprint is up to date.

## Decisions To Confirm (with the owner, before task 3)

| Question | Recommended | Why |
|---|---|---|
| Name and branch | Sprint 10b, on its own branch from `sprint-10-workflow-builder` | The 9b pattern; keeps the revamp reviewable apart from the features |
| When it starts | After Sprint 10 Module 14 | Every surface exists and has e2e cover, so nothing is polished twice |
| Canvas ground | The page ground (`bg-primary`) with a themed dot grid, instead of the blueprint's `bg-inset` | In light themes `bg-inset` equals the card colour, so steps would sit on their own white; in dark, the page shade gives cards the most separation. `bg-chrome` is an option too, but the theme-layers rule says to ask first |
| Motion | Allow builder-only motion through GSAP (panel slide, card entrance, Tidy Up, playback), written as an exception in §16h | Rules §16 says nothing slides or scales in, while blueprint §11 asks for slides and scale-ins; one must give way, and only on the canvas |
| Step card depth | Restrained at rest (`shadow-surfaceSm`), lifted when selected or dragged | Fifty full-depth shadows read as noise and cost paint time; the lift still says "selected" |
| Focus Mode | Yes: a toggle that hides the app sidebar and the side panels | The most direct route to "immersive" without a new layout |
| List View (blueprint P1) | In this sprint | It is the accessibility half of a robust canvas |
| References | The owner adds 3 to 5 canvas captures (n8n, Make, Zapier) to `docs/screenshots/`, each with a line on what to take from it | `docs/screenshots/` has no workflow captures yet |

## Out Of Scope

New features or changed behaviour; any change to the palette, themes, font, corners or shadow tokens; the Composer and other modules; editing workflows on a phone beyond the blueprint's small-screen rules; marketing pages.

## Risks

- **Drifting into a restyle.** Every change is checked against Ground Rule 1; when in doubt, ask the owner.
- **A moving target.** Started before Sprint 10 is finished, the revamp would chase the feature modules. Wait for Module 14, or freeze the surfaces it touches.
- **Canvas performance.** Hard shadows, stickers and animated lines on 50 cards cost paint time. Measure on the fixture page first, then style.
- **Theme coverage.** Family and platform colours that work in Classic can fail in Lilac or a dark theme; the contrast pass is not optional.
- **Two animation systems.** React Flow moves steps with transforms; GSAP must not fight it (animate the card's inner elements, never the step wrapper).
- **Parallel sessions.** If it runs beside other work in the same tree, give each session its own files, as Sprint 10's modules do.
