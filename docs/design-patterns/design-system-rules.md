# Design System Rules

Companion to [`design-tokens.md`](design-tokens.md) (the raw token catalog) and [`../sprint-documents/sprint-00-design-system.md`](../sprint-documents/sprint-00-design-system.md) (the sprint that built this). That doc explains *what tokens exist and where they came from*; this one is the enforceable rulebook for *how components consume them* — the thing a future contributor should check before hand-rolling a one-off style. All components in `packages/ui/src/components/` follow these rules; if you're adding a new one and it doesn't fit a rule below, that's a sign to extend this document (and the token system, if needed) rather than improvise per-component.

## 1. Typography hierarchy

Two font families, both loaded via `next/font/google` in `apps/web/src/app/layout.tsx` and exposed as `font-sans` / `font-display`:

- `font-display` (Bangers) — headings, buttons, dialog/card/menu chrome, anything meant to feel bold/comic. Used via `<Heading>`/`<Text>` (`typography.tsx`) or directly on custom chrome.
- `font-sans` (Plus Jakarta Sans) — body copy, **every part of a form control (see the form-control rule below)**, and **table/data content — including table column headers**. Dense data surfaces (Table, DataTable) are a deliberate exception to the "chrome uses font-display" rule below: the comic display font never appears inside a data grid, only on the chrome around it (Toolbar, PageHeader), per the sprint doc's "restrained treatment" rule for dense surfaces (§15).

`Heading` levels (`level` prop, `as` prop to decouple visual size from semantic tag): `h1` `text-5xl md:text-6xl`, `h2` `text-3xl md:text-4xl` (default), `h3` `text-2xl md:text-3xl`, `h4` `text-lg md:text-xl`. None of these are uppercase by default — compare to Label, which *is* uppercase; headings read the copy as written, chrome shouts.

`Text` sizes: `xs` `sm` `md` (default) `lg`, with `weight` (`normal`/`medium`/`bold`) and `muted` (opacity-70) as independent axes. **Default `weight` is `medium`** (added 2026-08-30) — plain `font-normal` (400) read as thin next to the system's bold labels/chrome (Badge, table headers, Row-style labels) and thick borders/shadows; `font-medium` (500) is a real weight of the loaded Plus Jakarta Sans variable font, not synthetic. This cascades to every dedicated `*Description`/helper-text component too (`CardDescription`, `AlertDescription`, `DialogDescription`, `AlertDialogDescription`, `SheetDescription`, `FormHelperText`, `FileUpload`'s helper text, `StateDisplay`'s description, `PlanCard`'s description, `NotificationCenter`'s item description, `OnboardingStepper`'s step description, `TimelineDescription`) — all bumped to `font-medium` alongside `Text`'s default. Deliberately **not** applied to `TimelineTimestamp`, notification timestamps, or any dense/tabular/interactive-control text (Table/DataTable cells, Select/Combobox/DropdownMenu/ContextMenu item text, Calendar day cells, Tooltip) — those stay at `font-normal` per the restrained-density rule in §15; this is a prose-body-copy change, not a system-wide weight bump.

**Form controls use `font-sans` end to end** (product decision, 2026-09-02 — this section previously said the opposite and listed Label/FormLabel among the `font-display` roles). A form control is read while typing, so its label, its value, its placeholder, its helper text and its error message are all the body face. `Label`/`FormLabel` is:

```
font-sans text-sm font-bold text-ink
```

Sentence case — **not** `uppercase`, **not** `tracking-wide`. Shouting is for chrome you *act on* (Button, Tabs, Badge, NavigationMenu); a label names the box you type in and shouldn't compete with it. `font-bold` (700) is a real weight of the Plus Jakarta Sans variable font and carries the presence Bangers' single heavy weight used to.

This is the same treatment as the specimen captions in the `/dev/components` playground (`Row` in `shared.tsx`) — deliberately identical, so what the playground shows is what a form ships. **Check the playground before styling a form control**; if a new control needs its own label markup instead of rendering `<Label>` (as `FileUpload` does, because its label sits inside a `<button>`), copy these exact classes and say why in a comment.

The boundary: menu group headings (`DropdownMenuLabel`, `SelectLabel`, `CommandMenu` group headings) stay `font-display`. They're menu chrome that happens to live near a form control, not labels for one — they name a *group of options*, not an input.

**Rules that keep drifting, watch for all three when adding a component:**
1. "Header/title" roles (Card/Dialog/AlertDialog/Sheet title, Alert title, Dropdown/Select/ContextMenu/Command group label, Timeline/StatCard/notification headings, etc.) must explicitly set `font-display` — it is never inherited for free, and a few of these (DropdownMenuLabel, SelectLabel) shipped without it and silently rendered in `font-sans` until caught. **Form-control labels are not in this list** — see the form-control rule above.
2. **`Badge` is the one deliberate exception**: `text-xs font-bold uppercase` in `font-sans`, not `font-display` — this was tried both ways and `font-sans` is the confirmed, intentional choice, not an oversight. Don't "fix" it to `font-display` again.
3. Never combine `font-display` with `font-bold`. Bangers loads a single weight; asking the browser for a heavier one triggers synthetic/faux-bold, which can render distinctly enough from the rest of the system's `font-display` text that it reads as a *different typeface* at a glance, not just a different weight (this is what was actually wrong with `Label` at one point, not a missing font-family). `font-sans` elements (Badge, Table headers) don't have this problem — Plus Jakarta Sans ships real weights, so `font-bold` there is safe and expected.

## 2. Spacing scale

No custom spacing tokens — Tailwind's own scale is used directly, kept consistent via the shared axis names in `Stack`/`Grid`/`Spacer`: `none` `xs`(1) `sm`(2) `md`(4, default) `lg`(6) `xl`(8), where the number is Tailwind's spacing step (`gap-4` = 1rem). Don't invent a parallel scale — extend this list in `stack.tsx`/`grid.tsx`/`spacer.tsx` together if a new step is genuinely needed.

## 3. Component heights

| Size | Height | Used by |
|---|---|---|
| `sm` | `h-9` (36px) | Button, Input |
| `md` | `h-11` (44px) — default | Button, Input, Select trigger, Combobox/DatePicker triggers |
| `lg` | `h-14` (56px) | Button, Input |

Anything not exposing a `size` prop (Checkbox, Toggle, Radio, Avatar `sm`/`md`/`lg`) has its own fixed dimensions documented in its own file — don't override with arbitrary `h-*` classes at the call site.

## 4. Border thickness

- `border-2` — every standard control and small surface (Button, Input, Select, Dropdown/Context menu content, Toast, Textarea, Combobox, Tabs list, Accordion item, List, Table outer wrapper, Checkbox, Radio, Toggle thumb).
- `border-4` — large surfaces only (Card, Dialog, AlertDialog, Sheet, Popover/HoverCard/NavigationMenu content). These are the "this is a distinct elevated layer above the page" components.
- Divider lines (Separator, dropdown/select separators, table row borders) use `border-outline`/`bg-outline` at `h-0.5`/`border-b-2`, not the full border scale.

## 5. Border radius

**Correction (2026-08-30, later same day):** an earlier revision of this document moved the whole system to `rounded-xl`/`rounded-2xl`, citing a "locked" sprint-doc note. That note described a design exploration that was never actually adopted in the shipped component code — the real, in-use scale (confirmed against the last commit and restored here) is the slightly-rounded one below. Don't reintroduce `rounded-xl`/`rounded-2xl` anywhere in `packages/ui`; if a future redesign genuinely wants deeper rounding, that's a new decision to make deliberately in-browser, not to infer from a stale comment.

- `rounded-md` — standard controls and small/medium surfaces: Button, Input, Select, Dropdown/Context/Command menu content, Toast, Textarea, Combobox/MultiSelect trigger, DatePicker/DateRangePicker trigger, Toolbar, FileUpload, Alert, Table's outer wrapper, most small icon buttons (Pagination, notification bell, Calendar nav).
- `rounded-sm` — the smallest ~20px controls: Checkbox, Dialog/Sheet close button.
- `rounded-lg` — large surfaces: Card, Dialog, AlertDialog, Sheet, Popover, HoverCard, NavigationMenu content, Command palette shell.
- `rounded-full` — stickers only: Badge, Avatar, Toggle track *and thumb*, filter chips. Toggle's thumb is the one `rounded-sm`→`rounded-full` deviation from the small-control default — a round thumb inside a pill-shaped track reads as a physical switch; a squared-off thumb didn't. Don't reach for `rounded-full` elsewhere on anything that isn't explicitly a pill/sticker shape.

## 6. Brutal shadow depth

Five tokens, all hard/unblurred offset shadows: `shadow-brutalSm` (2px), `shadow-brutalMd` (4px, most common default), `shadow-brutalMdHover` (5px, Button's hover-only lift — deliberately a 1px nudge, not a dramatic jump — see §8), `shadow-brutalLg` (6px, large surfaces), `shadow-brutalPressed` (0, the collapsed state — see §8).

- `Sm` — Input, Textarea, Select trigger, Checkbox, Radio, Calendar nav buttons, Toolbar, small triggers (Combobox/DatePicker/UserMenu/NotificationCenter).
- `Md` — Button (default), Card, Toast, Dropdown/Context/Select content, Tabs list, Accordion item.
- `Lg` — Dialog, AlertDialog, Sheet, Popover, HoverCard, NavigationMenu content, BulkActionBar, highlighted PlanCard.
- Dense data surfaces (Table, DataTable) intentionally have **no** brutal shadow on the table itself — see §11.
- FileUpload intentionally has **no** brutal shadow either — a dashed border alone signals "drop target," and a shadow made it read as a pressable button rather than a passive zone.

**`Button2` (`button2.tsx`) is a separate, parallel exploration, not a Button variant or replacement** (added 2026-08-30, per a comic component-sheet reference): it uses `shadow-brutalBtn` (`0 4px 0`, bottom-only) and `shadow-brutalBtnHover` (`0 6px 0`) instead of the diagonal `shadow-brutalMd` family. It exists side-by-side with Button in the showcase for comparison. Don't wire Button2 into product screens or delete Button in its favor without an explicit decision to adopt it — **note that decision has since been partially made**: Button itself gained its own diagonal hover-lift (`shadow-brutalMd` → `shadow-brutalMdHover`, see §8), borrowing Button2's "lift on hover" feel without adopting Button2's bottom-only shadow shape or replacing Button outright.

## 7. Color usage

Two token families, never raw hex in a component:

- **Surface tokens**: `bg-primary` (page background only), `bg-secondary` (every elevated surface — Card/Dialog/Input/Popover/etc.), `border-outline` (the one border/shadow color), `text-ink` (the one text/icon color, flips near-black/near-white per theme). A nested interactive element *inside* a `bg-secondary` surface (a search field inside a Combobox popover, the clear button inside BulkActionBar, Dialog's own close button) also fills with `bg-secondary`, not `bg-primary` — distinguished from its container by border + shadow, never by dropping back to the page-background tone. `bg-primary` inside a `bg-secondary` context is always a bug, not a valid "recessed" look.
- **Action tokens**: `actionPrimary`/`actionPrimaryHover` (blue), `actionSecondary` (yellow), `actionDanger` (red), `actionAi` (violet — swapped 2026-08-30 from the original pink `--new-ai-btn`, per direct product decision to give AI-powered surfaces their own identity; the pink hex itself is still defined in `colors.css`, just no longer wired to `actionAi`, see the ADDENDUM there), `actionAccent` (orange), `actionSuccess` (green — added in this pass for Alert/EmptyState/SuccessState/StatusIndicator/StatCard/PlanCard, since Task 1's original palette never named a success color). Text-on-fill is a **fixed pair per variant name**, not derived from the hue: `primary` → `text-onActionPrimary` (white), everything else (`secondary`/`danger`/`ai`/`accent`/`success`) → `text-onActionLight` (black) — confirmed by contrast, not eyeballed (see the header comment in `colors.css`; re-verified for the new violet `actionAi`, which still narrowly favors black at ~4.8:1 vs white's ~4.4:1). If you add a new action variant, decide its on-fill pairing the same way before shipping it.
- **Scrollbars**: any `overflow-y-auto`/`overflow-x-auto` region gets themed via the `tailwind-scrollbar` plugin (already registered in `packages/config/tailwind.css`, previously installed but never actually applied — the unstyled native browser scrollbar it left behind was itself an inconsistency), not left as the browser default. Convention: `scrollbar-thin scrollbar-thumb-outline scrollbar-track-{primary|secondary} scrollbar-thumb-rounded-full scrollbar-track-rounded-full`, where the track color matches whatever surface the scrolling element sits on (`secondary` inside Popover/Dialog/Command/Sidebar-style panels, `primary` when it's sitting directly on the page — e.g. AppShell's `main`, Table's horizontal scroll wrapper). Applied on: AppShell `main`, Sidebar nav, Table (horizontal), and every popover-hosted list (Combobox, MultiSelect, CommandList, NotificationCenter).

## 8. Interaction states

The one interaction recipe, reused verbatim across Button, Input, Select, Checkbox, Radio, Toggle, Tabs, NavigationMenu trigger, Calendar nav, notification bell, etc.:

- **Default** — `shadow-brutal{Sm,Md,Lg}` + `border-2`/`border-4 border-outline`.
- **Hover** — a subtle, non-shadow change: `hover:bg-actionPrimaryHover`, `hover:brightness-95`, or `hover:bg-actionPrimary/10` for chrome that isn't filled by default.
- **Pressed/active** — the signature brutalist push: `active:translate-x-[2px] active:translate-y-[2px] active:shadow-brutalPressed` (half that offset, `[1px]`, on `Sm`-shadow small controls like Calendar nav buttons). The shadow collapses to nothing as the element visually moves into the space it occupied.

**`Button` is an exception to both the Hover and Pressed/active rules above** (added 2026-08-30, direct product feedback: "a slight upliftment" on hover — but explicitly *no color change* on hover, referencing the Sentry-style pushable-button feel already prototyped on Button2; a first pass at a 2px lift + hover color change together was rolled back same day as "too high" and confusing two signals into one state):
  - **Hover** — shadow/transform only, no fill change: `hover:-translate-x-px hover:-translate-y-px hover:shadow-brutalMdHover` grows the diagonal shadow from 4px to 5px on each axis while nudging the button 1px up-left, so the shadow's far corner stays anchored at the same page position and the button visibly, barely rises off it. Deliberately tiny — just enough to read as "this is liftable," not a dramatic float. `Button` does **not** get a `hover:bg-*`/`hover:brightness-*` change; that would double up with the lift as two separate "something changed" signals.
  - **Pressed/active** — carries the fill-color change *instead* (`active:bg-actionPrimaryHover`, `active:brightness-95`, `active:brightness-90`), stacked on top of the standard press translate/shadow-collapse above. The color change now reads as confirmation of the click itself, not a pre-emptive hover cue.
  - This is scoped to `Button`/`Button2` only; nothing else in the "reused verbatim" list above (Input, Select, Checkbox, etc.) touches its shadow on hover, and their hover color change stays on `hover:`, not `active:`.

**`Button2`'s interaction** (see §6): same hover-is-shadow-only / color-moves-to-active fix as `Button` above (also 2026-08-30 — the pink hover flash was still showing on Button2 after the first Button-only pass). Since its shadow is bottom-only, `hover` grows the offset (`shadow-brutalBtn` → `shadow-brutalBtnHover`) plus `-translate-y-0.5`, with no `hover:bg-*`/`hover:brightness-*`. `active` carries the fill-color change (`active:bg-actionPrimaryHover`, `active:brightness-95`, `active:brightness-90`) and moves the full offset (`translate-y-1`, not half) since there's no horizontal component to split, collapsing to `shadow-brutalPressed` same as everywhere else. This exact recipe (bottom-only shadow, vertical-only lift) is scoped to `Button2` only.
- **Focus** — one focus-ring treatment, identical everywhere: `outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent`. Never `focus:` (mouse clicks shouldn't show it) — always `focus-visible:`.
- **Loading** — preserve dimensions, don't reflow. `Spinner` sits in place of an icon/label at the same size; `Skeleton` occupies the same footprint as the content it's replacing (`animate-pulse rounded-md bg-outline/10`, deliberately borderless — a loading placeholder isn't a bordered surface).

## 9. Disabled states

Two variants depending on element type:

- Buttons/pressable chrome: `disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none`.
- Text inputs/non-button controls: `disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none`.

Both reduce to 50% opacity and drop the shadow (a disabled element shouldn't look "liftable"). Never gray out via a separate disabled color token — opacity does the job and stays theme-correct automatically.

## 10. Error states

- Form fields: `variant="error"` swaps only the border to `border-actionDanger` (Input, Textarea) — don't also change the background or shadow, the border color alone is the signal.
- `FormErrorMessage` (`form-field.tsx`): `role="alert"`, `text-actionDanger`, paired with `FormField` + `FormLabel` + optional `FormHelperText`.
- Whole-surface error states (a failed data fetch, not a single field) use `ErrorState` (`state-display.tsx`), not a red-bordered card — tone comes from the icon/heading color, not from wrapping the surface in danger-red chrome.

## 11. Responsive behavior

Mobile-first Tailwind defaults (`sm:`/`md:`/`lg:`) are used for layout components (Container, Grid, PageHeader, SectionHeader). Separately, the inherited Postiz breakpoints are **desktop-first max-width** custom variants (`@custom-variant` in `packages/config/tailwind.css`) — know which family you're in before reaching for one:

| Variant | Query | Direction |
|---|---|---|
| `sm:`/`md:`/`lg:`/`xl:` | Tailwind defaults | min-width (mobile-first) |
| `mobile:` | ≤1025px | max-width |
| `tablet:` | ≤1300px | max-width |
| `iconBreak:` | ≤1560px | max-width |
| `maxMedia:` | ≤1400px | max-width |
| `xs:` | ≤401px | max-width |
| `minCustom:`/`custom:` | ≥800px / ≤800px height | viewport height |

Dense surfaces (Table, DataTable) scroll horizontally inside their own `overflow-x-auto` wrapper rather than shrinking columns — the page itself never scrolls horizontally.

## 12. Dark mode

Not `next-themes`, not Tailwind's `dark:` variant convention (though the variant exists and is available) — a hand-rolled `.dark`/`.light` class on `document.body`, toggled by `ThemeToggle` and persisted to `localStorage('postgear-theme')`, read by a no-flash inline script in `layout.tsx` before paint. Every color token resolves through this class swap automatically; components never write `dark:` utility classes themselves, they just consume `bg-secondary`/`text-ink`/etc. and get the right value for free. `--color-ink` (text/icon) and `--color-outline` (border/shadow) intentionally diverge in dark mode — ink flips to near-white for legibility, outline stays dark so borders don't read as a stark white line against the near-black page (see the header comment above `--color-outline` in `colors.css`). The five comic action-fill colors (`actionPrimary`/`Secondary`/`Danger`/`Ai`/`Accent`/`Success`) are **flat and non-theme-varying** — they don't invert with dark mode, so their paired text-on-fill color can't either.

## 13. Icon sizing & alignment

`lucide-react` exclusively, no custom SVG set. Explicit sizing always — never let an icon inherit ambient font-size:

- `h-3 w-3` / `h-3.5 w-3.5` — inline chips, breadcrumb separators, filter-chip remove buttons.
- `h-4 w-4` — the default for icons next to text (button icons, menu item icons, form icons).
- `h-5 w-5` / `h-8 w-8` — larger standalone icons (StatCard icon, EmptyState/ErrorState/SuccessState icon).

`strokeWidth={2.5}` (most icons-next-to-text) or `{3}` (small indicator icons — checkmarks, chevrons, close buttons) — heavier than lucide's default `2`, matching the chunky brutalist line weight. Icons sit in a `flex items-center gap-2` (or `gap-1.5` for tighter chrome) row with their text sibling — never absolutely positioned unless the icon is decorating an input (Search icon in `SearchInput`, Calendar icon in `DatePicker`), in which case it's `absolute left-3 top-1/2 -translate-y-1/2` with the input's `pl-10` making room.

## 14. Form layout

Every part of a form control is `font-sans` — see the form-control typography rule in §1 before styling one.

`FormField` (`flex flex-col gap-2`) wraps `FormLabel` + the control + optional `FormHelperText` **or** `FormErrorMessage` (never both at once — helper text disappears once a field has an error, the error message replaces it). `FormLabel` supports a `required` prop that appends a `text-actionDanger` asterisk rather than an separate "(required)" text. Labels sit above their control, never inline to the left — this is a single-column form system, matching the existing Input/Select/Checkbox call sites.

## 15. Density

Two density profiles, per the sprint doc's "where to apply the full treatment" table:

- **Full comic treatment** — buttons, cards, badges, empty states, onboarding, marketing surfaces. Thick outlines, hard shadows, press interaction, and (where it adds personality, not noise) halftone/speech-bubble accents. The halftone dot texture is `bg-halftone` (`packages/config/tailwind.css`) — layer it on top of `bg-primary`/`bg-secondary`, never in place of it. `Panel` (`panel.tsx`) is the comic-frame equivalent of `Card` for this treatment: squarer corners, a heavier `shadow-brutalLg`, and an optional `halftone` prop.
- **Restrained** — dense data surfaces: Table/DataTable, StatCard grids, SEO/analytics screens, the composer's text area. Thick borders and flat color stay; drop the shadow depth (Table has no `shadow-brutal*`), skip halftone/playful copy, keep row height tight (`h-11` header, `p-4` cells) so numbers stay scannable. The loud style belongs on the chrome *around* the data (Toolbar, PageHeader, FilterBar), not the data grid itself.

## 16. Motion

Durations/easings actually in use — don't add a new one without a reason:

- `duration-100` — the press interaction (translate + shadow collapse) and the Toggle thumb slide. Fast, because it's simulating a physical button push.
- `duration-200` — chevron rotation (Accordion, NavigationMenu trigger), small state transitions.
- `duration-300 ease-out` — Progress bar fill.
- `animate-fadeIn` (0.2s) — overlay/content entrance for Dialog, AlertDialog, Sheet, Popover, HoverCard, Tooltip. The only entrance animation in the system; nothing slides, scales, or bounces in — brutalism reads as *snap into place*, not *ease in*.
- `animate-accordionDown`/`Up`, `animate-collapsibleDown`/`Up` — height-based expand/collapse (0.2s ease-out), added in this pass since Radix Accordion/Collapsible need a real `height` keyframe (not just opacity) to animate smoothly; each references its own primitive's `--radix-*-content-height` custom property, so they can't be merged into one pair.

## 17. Token extension policy

Every rule above resolves to a token, not a literal value. When a genuinely new need comes up (this pass added `--color-brutal-success` for semantic success states, and the four accordion/collapsible keyframes for expand animation) — extend `colors.css` + `tailwind.css` following the existing pattern (flat non-theme-varying color in the same block as `brutal-secondary`/`brutal-danger`/`brutal-accent`; a new `@keyframes` + `--animate-*` entry next to the existing ones) and document *why* in a comment, the same way every existing token is documented. Never inline a one-off hex/pixel value inside a component file to route around this.
