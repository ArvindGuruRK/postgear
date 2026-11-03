# Workflow Builder Polish (2026-11-03)

A critique of the workflow canvas and its neighbours against the rest of PostGear, the ideas that came out of it, and what was changed. Companion to section 16h of [`design-system-rules.md`](design-system-rules.md).

The goal: minimal, calm, luxury feeling, intuitive at a glance. Fewer effects, more consistency. Everything stays on the existing tokens.

## What the screenshots showed (flaws)

| # | Flaw | Why it hurts |
|---|------|--------------|
| 1 | The trigger card had a 24px left corner and a 12px right corner (`rounded-l-3xl rounded-r-card`). | Two corner languages on one card. Every other node and every other card in the app is 12px. |
| 2 | The yellow "When" tab floated above the card with a gap, a lightning icon inside, and a border that did not meet the card's. | It looked stuck on, not part of the card. Yellow also means "secondary hover fill" in this system, so it read as a button. |
| 3 | Cards were 264 by 96 and the text was small (16px name, 12px summary). | Cramped. Long names truncated early, and the canvas felt busy at normal zoom. |
| 4 | Cards rested on a hard shadow, and lifted to a bigger one when selected. | On a dotted canvas the shadow adds weight and noise. The owner asked for none. |
| 5 | Port dots were static 12px circles. | No hint that they can be grabbed. No feedback on hover. TriForms-style grow-on-hover was wanted. |
| 6 | A step added from Rejected landed on the same row as Approved's step, or was pushed down only after an overlap. | Branches were not tied to their port. The line from Rejected could cross Approved's. |
| 7 | The step picker highlighted rows in solid yellow. | The Workflows sidebar (the template list) highlights rows with the dark page shade. Two different hover languages inside one module. Yellow here also read like a warning. |
| 8 | Table rows hovered with a faint blue wash (`actionPrimary/5`). | A third hover language. In dark mode the blue wash is barely visible, and it is not what the rest of the app does. |
| 9 | A step warning used the yellow fill. | The Alert rules say a warning is orange. Yellow stays for stickers and the secondary hover fill. |
| 10 | The Data view's small copy buttons hovered to yellow. | Same as 7. |

## Ideas

1. **One card.** Every step is the same size and the same 12px corner, trigger included. The only difference for a trigger is its tab and the missing input port.
2. **The tab grows out of the card.** Black, as wide as its word, left-aligned, overlapping the card's top border by its own 2px so the two read as one shape. No icon.
3. **No shadow on cards.** Selection is the focus ring outline, which already exists and is clearer than a bigger shadow.
4. **Ports that answer the pointer.** The dot grows to about 1.75 times its size around its own centre, takes the ink colour and gets a soft ring. An invisible 8px halo makes it easy to hit without flicker. It is centred on the card's edge, never offset.
5. **Branches know their port.** A step with several outputs fans its next steps out in port order around its own row: Approved on top, Rejected below. Same for True and False, Paths cases and On Error.
6. **One hover.** A row you hover in a list or table turns the dark page shade (`bg-primary`), with no coloured bar. Yellow is for the secondary Button fill only.
7. **Warnings are orange**, as everywhere else.

## What changed

- `builder/graph-ops.ts`: `CARD_WIDTH` 320, `CARD_HEIGHT` 120. `STEP_GAP_X` is the card plus 160 (480, on the 12px grid), `STEP_GAP_Y` is the card plus Tidy Up's 72px row gap (192). `placeAfter` takes the source port and fans branches around the source row.
- `builder/builder-state.ts`: `addStep` passes the port to `placeAfter`.
- `canvas/tidy-up.ts`: rank gap 160, so Tidy Up and a new step agree on the gap.
- `canvas/flow-model.ts`: a card with many outputs grows 40px per output (was 32).
- `canvas/step-card.tsx`: one 12px corner, no shadow, 56px icon tile and a 40px glyph, 18px name and 14px summary, black "When" tab without an icon, 14px port dots with hover, orange warning sticker.
- `canvas/workflow-canvas.css`: port hover (`scale`, ring, invisible halo), reduced motion respected.
- `picker/step-picker.tsx`, `panel/data-view.tsx`: hover is the dark page shade.
- `packages/ui/src/components/table.tsx`: row hover is the dark page shade.
- `design-system-rules.md` 16h: shadow, tab, size and hover rules updated.

## Left alone on purpose (flagged, not fixed)

- The blue marker on the Workflows sidebar's template rows. It was asked to be left out of the picker, and it is not in the picker. The owner can say if it should go from the sidebar too.
- Menus (`DropdownMenu`, `Select`, `Combobox`) still highlight in the primary blue. That is a global design-system decision, wider than this module.
- Dropping a line that crosses several cards still uses the bezier curve. A smoother elbow path is a bigger change than a polish pass.

## How to check it by hand

1. Open a workflow with a Manual Review. Add a step from Approved, then one from Rejected: Approved's goes up, Rejected's goes down.
2. Hover a port dot: it grows, turns ink and stays centred on the edge.
3. Look at the trigger: one corner size, a black "When" tab sitting on the top edge, no icon.
4. Hover rows in the picker, a table and the Data view: all go to the dark shade.
5. Check Lilac (light) as well as Classic dark.

## Later the same day (what the first pass got wrong, and what replaced it)

- **Toolbar.** The first fix put it in React Flow's `NodeToolbar`, which draws in screen pixels. A fixed size towered over small nodes, a scale tied to the zoom never stayed in proportion, and its tooltips did not scale at all. It is now a child of the card (as in TriForms), so it scales with the canvas and is half the card's width at every zoom. See section 16h of the design rules.
- **White flash on refresh.** The canvas wrapper carries a `light` class on the server, which re-declared every token inside it. The canvas is hidden until the real scheme is known (`use-body-appearance.ts`).
- **Zoomed out.** Selection and hover rings are divided by the zoom (`zoom-var.tsx`) so they stay 3px and 2px on screen. A card's tab shows from 60% zoom up.
- **Tidy Up** only arranges; it no longer changes the zoom (Fit To Screen does that). An empty branch holds its row so Approved stays above Rejected.
- **Sizes.** Cards 320 by 120, ports 16px, stickers 12px, arrowhead 16px (20px on hover), lines 2.5px (3.5px on hover), default note 360 by 180. The minimap shows from the first step.
- **Known, not mine.** `e2e/workflows.spec.ts` fails on its first test on the original code too: the step panel opens as a modal sheet at that width and hides the Finish Setup region from the role query.
