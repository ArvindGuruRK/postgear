# Design System Rules

Companion to [`design-tokens.md`](design-tokens.md) (the raw token catalog) and [`../sprint-documents/sprint-00-design-system.md`](../sprint-documents/sprint-00-design-system.md) (the sprint that built this). That doc explains *what tokens exist and where they came from*; this one is the enforceable rulebook for *how components consume them*, the thing a future contributor should check before hand-rolling a one-off style. All components in `packages/ui/src/components/` follow these rules; if you're adding a new one and it doesn't fit a rule below, that's a sign to extend this document (and the token system, if needed) rather than improvise per-component.

## 1. Typography hierarchy

**One font family for the whole platform** (single-typeface system, 2026-10-15: **Sora**, replacing the earlier Bangers + Plus Jakarta Sans pair). It is loaded once in `apps/web/src/app/fonts.ts` (a Next.js font definitions file, imported by `layout.tsx` and `global-error.tsx`) and exposed as `--font-brand` → `font-sans`. The hierarchy comes from weight, size and case, not from a second face.

Components never choose a weight or tracking for their chrome; they choose a **role** utility, defined with its tokens in `apps/web/src/app/globals.css` ("Typography"):

- `type-heading`: page/card/dialog/sheet titles, the wordmark, big numbers (stat values, scores, prices, ranks). Heaviest weight, slightly negative tracking, balanced wrapping. Used via `<Heading>` (`typography.tsx`) or directly on custom chrome.
- `type-ui`: things you act on or scan: Button, Tabs, NavigationMenu, Breadcrumb, Accordion trigger, toast action, sidebar nav, names, avatar initials, step markers. Firm weight, **sentence case**.
- `type-label`: small uppercase chrome that names a group: menu group labels, StatCard labels, step labels. Uppercase with positive tracking. Not for the name of a page section (see "Muted text" below: section names are sentence case `type-heading`, 2026-10-22).
- Body text: plain inherited text at `--type-body-weight`: body copy, **every part of a form control (see the form-control rule below)**, and **table/data content, including table column headers** (§15's restrained profile; the role utilities never appear inside a data grid, only on the chrome around it).

**Muted text (2026-10-22).** Secondary text (helper lines, captions, dates, units beside a number, day names, hour labels, descriptions under a title) is `text-ink` plus one of two utilities from `globals.css`, never a hand-picked `opacity-60/70/75/80`:

- `type-muted`: for text with no role of its own (`font-sans text-xs text-ink type-muted`). In light mode it is a stronger tone (88%) at the UI weight, because 70% ink at the body weight read as washed out on the light page; in dark mode it stays at 70% and the body weight, the look the user already liked.
- `muted-tone`: the same tone without the weight, for text that already has a role or a weight (`Text muted`, `CardDescription`, a `type-label`). Every description and helper component in `packages/ui` uses it.

Section headings inside a page are written as typed, in sentence case ("First steps", "Up next"), with `type-heading` (`text-lg` for a section, larger for a card's big number). **Don't put a section's name in capitals**: the uppercase `type-label` eyebrow read as shouting on Home and was retired there. `type-label` stays for menu group labels and small chrome only, not for the name of a page section.

Trialling a different font means swapping the loader in `fonts.ts` and retuning the `--type-*` tokens in `globals.css`, with no component changes. Never write `font-semibold tracking-tight` (or similar) by hand to make something look like a heading; use the role.

`Heading` levels (`level` prop, `as` prop to decouple visual size from semantic tag): `h1` `text-5xl md:text-6xl`, `h2` `text-3xl md:text-4xl` (default), `h3` `text-2xl md:text-3xl`, `h4` `text-lg md:text-xl`. None of these are uppercase: headings read the copy as written.

`Text` sizes: `xs` `sm` `md` (default) `lg`, with `weight` (`normal`/`medium`/`bold`) and `muted` (`muted-tone`, see "Muted text" above) as independent axes. **Default `weight` is `medium`** (added 2026-08-30): plain `font-normal` (400) read as thin next to the system's bold labels/chrome (Badge, table headers, Row-style labels) and thick borders/shadows; `font-medium` (500) is a real weight of the variable brand font, not synthetic. This cascades to every dedicated `*Description`/helper-text component too (`CardDescription`, `AlertDescription`, `DialogDescription`, `AlertDialogDescription`, `SheetDescription`, `FormHelperText`, `FileUpload`'s helper text, `StateDisplay`'s description, `PlanCard`'s description, `NotificationCenter`'s item description, `OnboardingStepper`'s step description, `TimelineDescription`), all bumped to `font-medium` alongside `Text`'s default. Deliberately **not** applied to `TimelineTimestamp`, notification timestamps, or any dense/tabular/interactive-control text (Table/DataTable cells, Select/Combobox/DropdownMenu/ContextMenu item text, Calendar day cells, Tooltip); those stay at `font-normal` per the restrained-density rule in §15; this is a prose-body-copy change, not a system-wide weight bump.

**Form controls use `font-sans` end to end** (product decision, 2026-09-02; this section previously said the opposite and listed Label/FormLabel among the `font-display` roles). A form control is read while typing, so its label, its value, its placeholder, its helper text and its error message are all the body face. `Label`/`FormLabel` is:

```
font-sans text-sm font-bold text-ink
```

Sentence case: **not** `uppercase`, **not** `tracking-wide`, and no `type-*` role. A label names the box you type in and shouldn't compete with it. `font-bold` resolves through the theme's `--font-weight-bold`, a real weight of the variable brand font.

This is the same treatment as the specimen captions in the `/dev/components` playground (`Row` in `shared.tsx`), deliberately identical, so what the playground shows is what a form ships. **Check the playground before styling a form control**; if a new control needs its own label markup instead of rendering `<Label>` (as `FileUpload` does, because its label sits inside a `<button>`), copy these exact classes and say why in a comment.

The boundary: menu group headings (`DropdownMenuLabel`, `SelectLabel`, `CommandMenu` group headings) use `type-label`. They're menu chrome that happens to live near a form control, not labels for one: they name a *group of options*, not an input.

**Rules that keep drifting, watch for all three when adding a component:**
1. "Header/title" roles (Card/Dialog/AlertDialog/Sheet title, Alert title, Dropdown/Select/ContextMenu/Command group label, Timeline/StatCard/notification headings, etc.) must explicitly set their role (`type-heading` or `type-label`); it is never inherited for free, and a few of these (DropdownMenuLabel, SelectLabel) once shipped without one and silently rendered as body text until caught. **Form-control labels are not in this list**; see the form-control rule above.
2. **`Badge` is the one deliberate exception**: `text-xs font-bold uppercase` as plain body text, not a role. This was tried both ways and is the confirmed, intentional choice, not an oversight.
3. Don't stack raw weight/tracking/case utilities on top of a role (`type-heading font-bold`, `type-label tracking-wide`). If a role looks wrong, retune its token in `globals.css` so every instance moves together; if something genuinely needs a different treatment, it is a new role, added there.

**No in-page titles** (product decision, 2026-10-17). A page never repeats its own name: the top bar's `h1` names it, the sidebar (or `SettingsNav` in settings) marks it active, and that is enough. So no page-level title, no tagline under it, and no divider separating it from the content; that pattern read as generated filler. A page opens with a `PageActions` row (right-aligned buttons such as "New post"; omitted when there are none), then its content. The old `PageHeader` component was deleted for this reason; don't re-create it. Section headings *inside* a page (`SectionHeader`, card titles) are fine: they name something the top bar doesn't.

## 2. Spacing scale

No custom spacing tokens: Tailwind's own scale is used directly, kept consistent via the shared axis names in `Stack`/`Grid`/`Spacer`: `none` `xs`(1) `sm`(2) `md`(4, default) `lg`(6) `xl`(8), where the number is Tailwind's spacing step (`gap-4` = 1rem). Don't invent a parallel scale; extend this list in `stack.tsx`/`grid.tsx`/`spacer.tsx` together if a new step is genuinely needed.

## 3. Component heights

| Size | Height | Used by |
|---|---|---|
| `sm` | `h-9` (36px) | Button, Input |
| `md` | `h-11` (44px), default | Button, Input, Select trigger, Combobox/DatePicker triggers |
| `lg` | `h-14` (56px) | Button, Input |

Anything not exposing a `size` prop (Checkbox, Toggle, Radio, Avatar `sm`/`md`/`lg`) has its own fixed dimensions documented in its own file; don't override with arbitrary `h-*` classes at the call site.

## 4. Border thickness

- `border-2` for everything: every control and every surface, large ones included (Card, Panel, Dialog, AlertDialog, Sheet, Popover/HoverCard/NavigationMenu content, Command palette). Changed 2026-10-17: large surfaces used `border-4`, which in light mode, stacked with the shadow, made a card's right and bottom edges read as an 8px black bar. Elevation now comes from the surface shadow (§6), not a thicker border.
- The exceptions are the app frame (sidebar/top bar dividers, `border-r-4`/`border-b-4`), the coloured start edge that marks state on a card or row (`border-s-4`, §16a), and the large Spinner's ring.
- Divider lines (Separator, dropdown/select separators, table row borders) use `border-outline`/`bg-outline` at `h-0.5`/`border-b-2`, not the full border scale.

## 5. Border radius

**Correction (2026-08-30, later same day):** an earlier revision of this document moved the whole system to `rounded-xl`/`rounded-2xl`, citing a "locked" sprint-doc note. That note described a design exploration that was never actually adopted in the shipped component code. The real, in-use scale (confirmed against the last commit and restored here) is the slightly-rounded one below. Don't reintroduce `rounded-xl`/`rounded-2xl` anywhere in `packages/ui`; if a future redesign genuinely wants deeper rounding, that's a new decision to make deliberately in-browser, not to infer from a stale comment.

- `rounded-md`: standard controls and small/medium surfaces: Button, Input, Select, Dropdown/Context/Command menu content, Toast, Textarea, Combobox/MultiSelect trigger, DatePicker/DateRangePicker trigger, Toolbar, FileUpload, Alert, Table's outer wrapper, most small icon buttons (Pagination, notification bell, Calendar nav).
- `rounded-sm`: the smallest ~20px controls: Checkbox, Dialog/Sheet close button.
- `rounded-lg`: large surfaces: Card, Dialog, AlertDialog, Sheet, Popover, HoverCard, NavigationMenu content, Command palette shell.
- `rounded-full`: stickers only: Badge, Avatar, Toggle track *and thumb*, filter chips. Toggle's thumb is the one `rounded-sm`→`rounded-full` deviation from the small-control default: a round thumb inside a pill-shaped track reads as a physical switch; a squared-off thumb didn't. Don't reach for `rounded-full` elsewhere on anything that isn't explicitly a pill/sticker shape.

## 6. Shadow depth

Two families of hard, unblurred shadows, split by **role** (2026-10-17). Both are the same right-and-bottom diagonal in every theme of both schemes (2026-10-18: light mode's bottom-only surfaces were dropped for consistency with dark). Depth comes from three offset tokens per scheme, `--brutal-offset-sm/md/lg` in `colors.css`: light 2 / 3 / 4px, dark 2 / 4 / 6px, and a single 2px for the White and Sky themes.

**Pressable: diagonal `brutal*`.** Things you press: Button, Tabs list, ViewSwitcher, NavigationMenu trigger, the active sidebar/SettingsNav item, filter/channel chips, small icon buttons (Calendar nav arrows, notification bell, theme toggle, workspace switcher), Toast's action button, onboarding choice tiles. Tokens: `shadow-brutalSm`, `shadow-brutalMd` (Button), `shadow-brutalLg`, `shadow-brutalPressed` (0, collapsed). The press that goes with them is in §8.

**Surface: `surface*`.** Everything that holds content or takes input: Card, Panel, PlanCard, Input, Textarea, Select/Combobox/MultiSelect/DatePicker triggers, Checkbox, Radio, Slider thumb, Progress, Accordion, Alert, Toolbar/filter bars, Dropdown/Context/Select/NavigationMenu content, Dialog, AlertDialog, Sheet, Popover, HoverCard, Command palette, Tooltip, Toast, BulkActionBar, the selected Calendar day, and app-level cards (calendar post cards, media tiles, thread parts, draft list items). Tokens: `shadow-surfaceSm` (fields, small surfaces), `shadow-surfaceMd` (cards, menus, toasts), `shadow-surfaceLg` (dialogs, sheets, popovers). Same diagonal and depths as `brutal*`; kept as separate tokens so the two roles can diverge again.

Rule of thumb: if hovering or clicking it should feel like pushing a key, it's `brutal*`; if it's a box that holds something, it's `surface*`.
- Dense data surfaces (Table, DataTable) intentionally have **no** brutal shadow on the table itself (see §11).
- FileUpload intentionally has **no** brutal shadow either: a dashed border alone signals "drop target," and a shadow made it read as a pressable button rather than a passive zone.

**One button component.** `Button2`, a bottom-only "pushable" exploration (`shadow-brutalBtn`, added 2026-08-30), was removed on 2026-10-21 with its two shadow tokens: no product screen ever used it, and it doubled every button change. Every button is `Button`, on the diagonal shadow like every other surface; don't bring back a second button component.

## 7. Color usage

Two token families, never raw hex in a component:

- **Surface tokens**: `bg-primary` (page background only), `bg-secondary` (every elevated surface: Card/Dialog/Input/Popover/etc.), `border-outline` (the one border/shadow color), `text-ink` (the one text/icon color, flips near-black/near-white per theme). A nested interactive element *inside* a `bg-secondary` surface (a search field inside a Combobox popover, the clear button inside BulkActionBar, Dialog's own close button) also fills with `bg-secondary`, not `bg-primary`, distinguished from its container by border + shadow, never by dropping back to the page-background tone. `bg-primary` inside a `bg-secondary` context is always a bug, not a valid "recessed" look.
- **Action tokens**: `actionPrimary`/`actionPrimaryHover` (blue), `actionSecondary` (yellow), `actionDanger` (red), `actionAi` (violet, swapped 2026-08-30 from the original pink `--new-ai-btn`, per direct product decision to give AI-powered surfaces their own identity; the pink hex itself is still defined in `colors.css`, just no longer wired to `actionAi`, see the ADDENDUM there), `actionAccent` (orange), `actionSuccess` (green, added in this pass for Alert/EmptyState/SuccessState/StatusIndicator/StatCard/PlanCard, since Task 1's original palette never named a success color). Text-on-fill is a **fixed pair per variant name**, not derived from the hue: `primary` → `text-onActionPrimary` (white), everything else (`secondary`/`danger`/`ai`/`accent`/`success`) → `text-onActionLight` (black), confirmed by contrast, not eyeballed (see the header comment in `colors.css`; re-verified for the new violet `actionAi`, which still narrowly favors black at ~4.8:1 vs white's ~4.4:1). If you add a new action variant, decide its on-fill pairing the same way before shipping it.
- **Button colours (2026-10-21)**: `Button` has four variants: `primary` (blue fill) for the one main action in an area (a card, a dialog, a `PageActions` row; two blue buttons side by side means one is wrong); `secondary` (`bg-secondary text-ink`, the card surface told apart by border and shadow, like the calendar's Add Channel tile) for everything else, filling with `bg-primary` (the page ground) on hover and press, the same colour the calendar's Today button, week arrows and other chrome controls already hover to, so one hover colour runs through the app (the label stays `text-ink`; the user rejected a custom grey and a pitch-black dark fill, 2026-10-21; the fill animates, see §16). This is the one sanctioned use of `bg-primary` on a hover inside a `bg-secondary` control; `danger` (red fill) for every delete and destructive action, both the button that opens a confirm and the confirm's final "yes" (`AlertDialogAction` defaults to it); the user wants deletes always solid red, never a neutral style with red words (2026-10-21); `highlight` (violet fill), the third button (named 2026-10-21, after the reference's pink sparkle button; it was `ai`): the one standout action that is not the main one, at most one per area. Asking the AI is its first use (Generate, Send, the calendar's AI shortcut), and the sparkle icon on the button is what says "AI", so the colour is free to mean "standout" elsewhere. The same violet marks the present on the calendar: today's date, the line across the current hour and the time written on it. Blue and violet are the app's two accent colours. The yellow `actionSecondary` fill is no longer a button colour: it stays for badges, stickers and status dots.
- **Alert colours (2026-10-22)**: `Alert` is the only way to show a notice, warning or failure, with its own solid fills and never a tint of a colour made up for the page: `info` (the primary button blue) for a notice that asks for a step while nothing is wrong ("Connect a channel"), `warning` (orange) for something that is stopping work, `danger` (red) for a failure, `success` (green), `ai` (violet), and `default` (the card surface). Buttons inside an Alert stay the neutral secondary style.
- **Scrollbars**: any `overflow-y-auto`/`overflow-x-auto` region gets themed via the `tailwind-scrollbar` plugin (already registered in `packages/config/tailwind.css`, previously installed but never actually applied; the unstyled native browser scrollbar it left behind was itself an inconsistency), not left as the browser default. Convention: `scrollbar-thin scrollbar-thumb-outline scrollbar-track-{primary|secondary} scrollbar-thumb-rounded-full scrollbar-track-rounded-full`, where the track color matches whatever surface the scrolling element sits on (`secondary` inside Popover/Dialog/Command/Sidebar-style panels, `primary` when it's sitting directly on the page, e.g. AppShell's `main`, Table's horizontal scroll wrapper). Applied on: AppShell `main`, Sidebar nav, Table (horizontal), and every popover-hosted list (Combobox, MultiSelect, CommandList, NotificationCenter).

## 8. Interaction states

The one interaction recipe, reused verbatim across Button, Input, Select, Checkbox, Radio, Toggle, Tabs, NavigationMenu trigger, Calendar nav, notification bell, etc.:

- **Default**: `shadow-brutal{Sm,Md,Lg}` + `border-2`/`border-4 border-outline`.
- **Hover**: a subtle, non-shadow change: `hover:bg-actionPrimaryHover`, `hover:brightness-95`, or `hover:bg-actionPrimary/10` for chrome that isn't filled by default.
- **Pressed/active**: the signature brutalist push. The control moves down and right into the space its shadow occupied and the shadow collapses to nothing.

**The press, everywhere it applies (2026-10-18)**, after the neobrutalism.dev button: `pressSm` / `pressMd` from `packages/ui/src/lib/press.ts`. On hover *and* while pressed, the control translates by exactly its shadow's depth (`translate-x/y-(--brutal-offset-sm|md)`) and the shadow collapses (`shadow-brutalPressed`), so it reads as pushed flat into the page. The distance is the theme's offset token, never a fixed pixel count, so it lands exactly on the shadow in light, dark, White and Sky alike. Used by Button (`pressMd`), and `pressSm` on Toast's action, the notification bell, the theme toggle, the calendar's channel-card tiles, onboarding choice cards and the avatar picker tiles. Transition `translate`, not `transform`: Tailwind v4's `translate-*` classes set the `translate` property, so a `transform` transition leaves the press snapping. Button's fill change stays on `active:` (`active:bg-actionPrimaryHover`, `active:brightness-*`) as confirmation of the click. Controls not yet on the shared press (Calendar nav arrows, NavigationMenu, media tiles and a few others) keep the older active-only push until they are moved over.
- **Focus**: two treatments. **Fields** (Input, Textarea, Select/Combobox/MultiSelect/DatePicker triggers, the search box inside a picker) use `FIELD_FOCUS` from `packages/ui/src/lib/field.ts`: the border turns `actionPrimary` with a soft `ring-3` glow (`FIELD_FOCUS_ERROR` keeps an invalid field red). A text field matches `:focus-visible` on a plain mouse click, so the outside outline below read as a second red border on every click (changed 2026-10-17). **Everything else** (buttons, tabs, links, day cells) uses the outline ring, keyboard-only: `outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing`. **`outline-solid`, not the bare `outline`** (corrected 2026-10-11): under Tailwind v4, `outline-none` sets `--tw-outline-style: none` and the bare `outline` utility only re-reads that variable, so the ring compiled with a 3px width and the right color and *no style*, invisible on every component since Sprint 0. `outline-solid` sets the style itself. Never `focus:` (mouse clicks shouldn't show it); always `focus-visible:`.
- **Loading**: preserve dimensions, don't reflow. `Spinner` sits in place of an icon/label at the same size; `Skeleton` occupies the same footprint as the content it's replacing (`animate-pulse rounded-md bg-outline/10`, deliberately borderless, since a loading placeholder isn't a bordered surface).

## 9. Disabled states

Two variants depending on element type:

- Buttons/pressable chrome: `disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none`.
- Text inputs/non-button controls: `disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none`.

Both reduce to 50% opacity and drop the shadow (a disabled element shouldn't look "liftable"). Never gray out via a separate disabled color token: opacity does the job and stays theme-correct automatically.

## 10. Error states

- Form fields: `variant="error"` swaps only the border to `border-actionDanger` (Input, Textarea). Don't also change the background or shadow: the border color alone is the signal.
- `FormErrorMessage` (`form-field.tsx`): `role="alert"`, `text-dangerInk`, paired with `FormField` + `FormLabel` + optional `FormHelperText`.
- Status colour as **text** (an error line in a dialog, a failed upload, a negative delta) uses the ink tokens `text-dangerInk`, `text-successInk`, `text-accentInk`, never the fills: `text-actionDanger` and the rest are too light to read on a light theme's page. In dark mode the inks equal the fills. Fills (`bg-action*`, badges, toasts, strips) keep the action tokens with their on-fill text pair (§7).
- Whole-surface error states (a failed data fetch, not a single field) use `ErrorState` (`state-display.tsx`), not a red-bordered card: tone comes from the icon/heading color, not from wrapping the surface in danger-red chrome.

## 11. Responsive behavior

Mobile-first Tailwind defaults (`sm:`/`md:`/`lg:`) are used for layout components (Container, Grid, PageActions, SectionHeader). Separately, the inherited Postiz breakpoints are **desktop-first max-width** custom variants (`@custom-variant` in `packages/config/tailwind.css`); know which family you're in before reaching for one:

| Variant | Query | Direction |
|---|---|---|
| `sm:`/`md:`/`lg:`/`xl:` | Tailwind defaults | min-width (mobile-first) |
| `mobile:` | ≤1025px | max-width |
| `tablet:` | ≤1300px | max-width |
| `iconBreak:` | ≤1560px | max-width |
| `maxMedia:` | ≤1400px | max-width |
| `xs:` | ≤401px | max-width |
| `minCustom:`/`custom:` | ≥800px / ≤800px height | viewport height |

Dense surfaces (Table, DataTable) scroll horizontally inside their own `overflow-x-auto` wrapper rather than shrinking columns; the page itself never scrolls horizontally.

## 12. Dark mode

Not `next-themes`, not Tailwind's `dark:` variant convention (though the variant exists and is available): a hand-rolled `.dark`/`.light` class on `document.body`, set before paint by a no-flash inline script in `layout.tsx` from the `pg_appearance` cookie, and changed by `ThemeToggle` or Settings → Appearance (see §16e for the mode, the light and dark themes and how the choice is stored). Every color token resolves through this class swap automatically; components never write `dark:` utility classes themselves, they just consume `bg-secondary`/`text-ink`/etc. and get the right value for free. `--color-ink` (text/icon) and `--color-outline` (border/shadow) intentionally diverge in dark mode: ink flips to near-white for legibility, outline stays dark so borders don't read as a stark white line against the near-black page (see the header comment above `--color-outline` in `colors.css`). The five comic action-fill colors (`actionPrimary`/`Secondary`/`Danger`/`Ai`/`Accent`/`Success`) are **flat and non-theme-varying**: they don't invert with dark mode, so their paired text-on-fill color can't either.

## 13. Icon sizing & alignment

`lucide-react` exclusively, no custom SVG set. Explicit sizing always: never let an icon inherit ambient font-size:

- `h-3 w-3` / `h-3.5 w-3.5`: inline chips, breadcrumb separators, filter-chip remove buttons.
- `h-4 w-4`: the default for icons next to text (button icons, menu item icons, form icons).
- `h-5 w-5` / `h-8 w-8`: larger standalone icons (StatCard icon, EmptyState/ErrorState/SuccessState icon).

`strokeWidth={2.5}` (most icons-next-to-text) or `{3}` (small indicator icons: checkmarks, chevrons, close buttons), heavier than lucide's default `2`, matching the chunky brutalist line weight. Icons sit in a `flex items-center gap-2` (or `gap-1.5` for tighter chrome) row with their text sibling, never absolutely positioned unless the icon is decorating an input (Search icon in `SearchInput`, Calendar icon in `DatePicker`), in which case it's `absolute left-3 top-1/2 -translate-y-1/2` with the input's `pl-10` making room.

## 14. Form layout

Every part of a form control is `font-sans`; see the form-control typography rule in §1 before styling one.

`FormField` (`flex flex-col gap-2`) wraps `FormLabel` + the control + optional `FormHelperText` **or** `FormErrorMessage` (never both at once: helper text disappears once a field has an error, the error message replaces it). `FormLabel` supports a `required` prop that appends a `text-actionDanger` asterisk rather than an separate "(required)" text. Labels sit above their control, never inline to the left; this is a single-column form system, matching the existing Input/Select/Checkbox call sites.

## 15. Density

Two density profiles, per the sprint doc's "where to apply the full treatment" table:

- **Full comic treatment**: buttons, cards, badges, empty states, onboarding, marketing surfaces. Thick outlines, hard shadows, press interaction, and (where it adds personality, not noise) halftone/speech-bubble accents. The halftone dot texture is `bg-halftone` (`packages/config/tailwind.css`); layer it on top of `bg-primary`/`bg-secondary`, never in place of it. `Panel` (`panel.tsx`) is the comic-frame equivalent of `Card` for this treatment: squarer corners, a heavier `shadow-brutalLg`, and an optional `halftone` prop.
- **Restrained**: dense data surfaces: Table/DataTable, StatCard grids, SEO/analytics screens, the composer's text area. Thick borders and flat color stay; drop the shadow depth (Table has no `shadow-brutal*`), skip halftone/playful copy, keep row height tight (`h-11` header, `p-4` cells) so numbers stay scannable. The loud style belongs on the chrome *around* the data (Toolbar, PageActions, FilterBar), not the data grid itself.

## 16. Motion

Durations/easings actually in use; don't add a new one without a reason:

- `duration-100`: the press interaction (translate + shadow collapse) and the Toggle thumb slide. Fast, because it's simulating a physical button push.
- `duration-200`: chevron rotation (Accordion, NavigationMenu trigger), small state transitions.
- `duration-300 ease-out`: Progress bar fill.
- **GSAP (2026-10-21)**, for motion CSS can't do. Import `gsap` and `useGSAP` from `@postgear/ui` (`lib/gsap.ts` registers plugins once), never from the packages directly. Its one use so far is the **hover fill** on neutral buttons (`useFillHover` in `lib/fill-hover.ts`, classes in `lib/fill-hover-classes.ts`): after gsap.com's buttons, a soft-edged circle (`blur-[0.5rem]`) appears under the pointer and grows to cover the control (0.4s), trails the pointer while it moves (0.4s), and shrinks out through the edge it left by (0.3s), all `power2.out`: gsap.com's own timings, kept as they are (the user tried a slower 0.7s / 0.5s / 0.55s version and preferred gsap.com's). `data-filled` drops only when the circle is gone, so a label never matches the fill under it. Used by Button's `secondary` (`bg-primary`) and the calendar's Add Channel and Manage channels tiles; the filled variants (primary, danger, ai) do not get it. It runs only with a fine pointer and no reduced-motion preference, and marks the control `data-fill-hover` while live; the plain CSS hover is written `not-data-fill-hover:hover:` so touch, reduced motion and links styled with `buttonVariants` still get an instant fill. The label flips on `data-filled`. A new neutral control that should fill: spread `fillHoverNeutral` on it, render a `fillHoverNeutralLayer` span as its first child, and wire both refs from `useFillHover`.
- `animate-fadeIn` (0.2s): overlay/content entrance for Dialog, AlertDialog, Sheet, Popover, HoverCard, Tooltip. The only entrance animation in the system; nothing slides, scales, or bounces in: brutalism reads as *snap into place*, not *ease in*.
- `animate-accordionDown`/`Up`, `animate-collapsibleDown`/`Up`: height-based expand/collapse (0.2s ease-out), added in this pass since Radix Accordion/Collapsible need a real `height` keyframe (not just opacity) to animate smoothly; each references its own primitive's `--radix-*-content-height` custom property, so they can't be merged into one pair.

## 16a. Scheduling surfaces (Sprint 5)

The calendar grid and the queue list are **dense data surfaces** under §15, and
the two pages are the first place several rules meet at once; what was decided:

- **Status is one vocabulary.** `apps/web/src/components/posts/post-status.ts`
  maps the four `State` values plus the worker's publish status onto six tones:
  draft, scheduled, publishing, retrying, published, failed, each with a fixed
  Badge variant: `outline`, `primary`, `accent`, `accent`, `success`, `danger`.
  Every card, row and dialog reads it; no screen invents its own mapping.
- **`Badge` has a `success` variant** (`bg-actionSuccess text-onActionLight`),
  added for "Published". It is the one unambiguously good outcome the scheduler
  reports and has to read as such next to a `danger` badge.
- **State on a card is a colored start edge** (`border-s-4` in the tone's
  action color), not a filled card. A grid of filled cards is noise; an edge
  reads at a glance and keeps the text on `bg-secondary` legible in both themes.
- **The grid has no brutal shadow; its cards have `shadow-brutalSm`.** The chrome
  around it (toolbar, view switcher, range heading in `type-heading`) carries
  the full treatment. Slot cells are `border-2 border-outline`; past slots get
  `bg-halftone`, the texture already in the system, rather than a new gray.
- **Drop target** is `bg-actionPrimary/15` plus a dashed `outline-actionPrimary`:
  the primary action color saying "this is where it goes", not a new color.
- **Drag handle is a separate grip**, not the whole card. The card body is a
  button that opens the post; Space/Enter must open, not start a drag.
- **Per-channel status dots** on stacked avatars (`ChannelStack`) use the tone
  colors above; one post to three channels is one card, and the dots are how a
  partial outcome fits in its corner.

## 16b. AI surfaces (Sprint 6)

The AI studio (`/[orgId]/ai-copilot`) is the first screen where the model's
output sits next to the user's own words, and the one place the comic accents
the Sprint 0 doc reserved for "success moments" get used in product UI; what
was decided:

- **`actionAi` violet marks what the model produced, nothing else.** The
  assistant's hook (`SpeechBubble variant="ai"`), the category `Badge
  variant="ai"`, the AI avatar, the Generate/Send `Button variant="ai"`, the
  active stage on the tracker, and the credits meter (`UsageMeter tone="ai"`):
  each is either model output or the act of asking for it. A violet surface
  that holds something the user typed is a bug.
- **The user's own messages stay `primary`** (`SpeechBubble variant="primary"
  tail="right"`), the same blue as every other thing they do. The assistant's
  conversational replies are `default` with `tail="left"` and a Sparkles
  avatar; violet is for the artefact (the hook, the draft), not the chatter
  around it.
- **Generated post parts are restrained cards** (§15). A thread is numbered
  `Card`s with a per-part character count against the channel limit, in
  `font-sans`, no halftone, no tail: this is the composer's content, and it
  has to be read and edited, not admired. The comic treatment goes on the
  chrome around it (the hook bubble, the badge, the actions).
- **The speech bubble is the sanctioned comic accent, for chat only.**
  `SpeechBubble` exists for message lists; it is not a Card or an Alert
  substitute, and a tail on anything that isn't a turn in a conversation is
  decoration the system doesn't want. Its tail is a rotated bordered square
  so the outline stays continuous; give a tailed bubble `mb-2` (or a list
  `gap-*`) so the tail doesn't sit on the next bubble.
- **`StageTracker`'s status colours are the Sprint 5 tone vocabulary**
  (§16a), not a new set: done is `success`, failed is `danger`, the running
  stage is `ai`, pending is the plain surface, and skipped is that surface
  with a dashed outline at `opacity-60`: "didn't run" is an absence, not an
  outcome. Each `<li>` carries `data-testid="ai-stage"` / `data-stage` /
  `data-status` so tests read the status, not the colour.
- **`TypingIndicator` adds no keyframe.** Three `bg-ink` dots on Tailwind's
  `animate-pulse` with staggered delays, still under `motion-reduce`; the
  system's motion budget (§16) is unchanged.

## 16c. Analytics and score surfaces (Sprint 7)

The Analytics dashboard (`/[orgId]/analytics`) and the SEO analyzer
(`/[orgId]/seo-analyzer`) are the system's first charts and the densest data
surfaces it has; what was decided:

- **Charts are SVG from tokens, not a library.** `TrendChart`, `Sparkline`,
  `BarList`, `ScoreGauge` and `ScoreBar` (`packages/ui`) draw with
  `stroke-action*` / `fill-action*` and `stroke-outline`; no gradient, no
  blur, no eased curve. A line is a 3 px miter-joined stroke; its area is
  the same colour at 15 %; a reading cursor is a bordered square. Axis and
  tooltip text is `font-sans`; only the headline number of a gauge or a
  stat card is `type-heading`. This is §15's restrained profile applied to
  a plot: the chrome around the chart (the card, the range tabs, the
  toolbar) carries the treatment, the plot does not.
- **Score tones are one scale.** `toneForScore()` bands a 0–100 reading as
  `success` (≥ 80), `secondary` (≥ 70), `accent` (≥ 60), `danger`; the
  gauge, the bars and the grade badges all read it, so a 58 is red wherever
  it appears. `Progress` gained a `secondary` tone for the yellow band.
- **Severity reuses the Sprint 5 vocabulary.** Critical is `danger`, warning
  is `accent`, info is `primary`, the same three badges the queue uses for
  failed / retrying / scheduled. Nothing on these screens introduces a
  colour.
- **Violet marks the model's advice only** (§16b). The AI summary of an SEO
  audit sits in a `SpeechBubble variant="ai"` with a `Badge variant="ai"`
  naming the model; rule-based findings, which no model wrote, get a plain
  `Text` and an `outline` badge. The crawl facts, the scores and the checks
  are never violet.
- **Comparisons are an arrow and a word, not a colour wash.** Above / below /
  even against an average is `ArrowUp` success, `ArrowDown` danger, `Minus`
  muted, with the average spelled out ("vs avg 1,204"). A table row is never
  filled by its outcome; a status edge or a badge says it.
- **Every chart is readable without a pointer.** `TrendChart` is a focusable
  figure; arrow keys move the cursor and the tooltip is a `role="status"`
  live region. A `Sparkline` is `aria-hidden` because the numbers sit beside
  it. Tables keep their numbers as text, so nothing is only in a picture.
- **Stand-in data says so.** When metrics come from `ANALYTICS_SIMULATION`
  or authority is estimated, a one-line `Alert`/hint names the flag or the
  missing provider; the screen never looks more real than its data.

## 16d. Settings, billing and notification surfaces (Sprint 8)

The settings section (`/[orgId]/settings/*`) and the bell are the first
screens that show money, secrets and a live feed; what was decided:

- **One settings layout.** `settings/layout.tsx` wraps every section in
  `SettingsNav`; a page is its `PageActions` row (if any), then its content, never its own
  side nav or breadcrumb.
- **Status is the Sprint 5 vocabulary again.** A subscription reads
  `success` (active), `primary` (trialing), `accent` (canceling, past due's
  grace), `danger` (payment failed), `outline` (none); a delivery reads
  `success` / `accent` (pending) / `danger`; an API key `success` (live) /
  `outline` (revoked). Nothing on these screens introduces a colour.
- **A secret is shown once, in a warning `Alert`**, with a read-only `Input`
  and a Copy `Button`, never in a table, a toast, or a tooltip. After the
  dialog closes the secret is gone; the list shows a prefix or nothing. The
  warning tone is for "this will not be shown again", not for danger.
- **Plan cards are `PlanCard`**; the current plan is `highlighted` with a
  `CURRENT` badge and a disabled action (`actionDisabled`). Usage is a
  `UsageMeter` (channels `primary`, AI credits `ai`) with the limit's
  origin as the caption.
- **The bell is `NotificationCenter`**, in the top bar's `notifications`
  slot. Items carry a `type` that picks a lucide icon and a tone
  (`post.published` success, `post.failed` danger, `channel.needs_reconnect`
  accent, `billing.*` ink, `webhook.failed` danger); the unread dot is the
  danger badge; the panel's footer is a text link to the preferences. Content
  is rendered as text: a channel name or a provider error can never become
  markup.
- **Dense lists stay restrained** (§15): the API-key, webhook and delivery
  lists are `Table`s or bordered `li`s with no brutal shadow; the `sr-only`
  header for an actions column sits in a `relative` cell so its absolute
  box cannot widen the page.
- **Pending is a state, not a spinner.** *Activating…* on the billing page
  is a `Badge variant="accent"` with a line of copy, polled for a bounded
  time, then either the new plan or an honest "still waiting" alert.

## 16e. Appearance: mode, light themes and dark themes (2026-10-17, dark themes 2026-10-18)

How the colour scheme is chosen, stored and applied. Tokens and both theme tables are in [`design-tokens.md`](design-tokens.md) §2a.

- **Mode is per user: System (default), Light or Dark.** System follows the device's `prefers-color-scheme` and switches live with it (`AppearanceRuntime` in the root layout listens for the OS change). The top bar's `ThemeToggle` always sets an explicit Light or Dark (the opposite of what is showing), and System is chosen back in Settings → Appearance.
- **One theme per scheme, twelve of each (six free, six premium), Classic the default in both.** Light: six free (`classic`, `cream`, `paper`, `white`, `cool`, `lilac`) and six premium (`mint`, `grape`, `peach`, `sky`, `rose`, `lemon`). Dark: six free (`classic`, `midnight`, `forest`, `plum`, `ocean`, `mocha`) and six premium (`obsidian`, `nebula`, `ember`, `aurora`, `slate`, `orchid`). Classic light is the original light look (cream page, everything else white) and Classic dark the original dark one. The person keeps a light choice and a dark choice at once; the one that shows is the one for the scheme on screen, and switching modes brings the other back. A theme changes only the base (page, frame, cards, fields, ink/outline, shadow weight), never a brand fill, so a component never needs to know which theme is on. Never key component styles off `data-light-theme` or `data-dark-theme`; if a theme needs a different value, it is a token override in that theme's block.
- **Premium is a plan feature, enforced by the API, in both modes.** Unlocked while any workspace the user belongs to is on a paid plan or a live trial. Anyone can *preview* a premium theme on the Appearance page (the body only, nothing saved, shown in the theme's own scheme so a dark theme previews from a light page too); saving one without a plan is a 402 with `code: 'premium_theme_requires_plan'`, which the page answers with an upgrade dialog (Upgrade → billing, Keep current → revert). A premium id stored before a plan lapsed is served as Classic until it is live again.
- **One grid at a time, following the mode** (2026-10-18). Settings > Appearance shows only the themes for the scheme on screen: Light shows the light grid, Dark the dark one, and System whichever the device is using, swapping live when the device changes. A theme can only be seen in its own scheme, so a grid for the other one would let the person pick something with no visible effect. A pick therefore never changes the mode; switching the mode is how the person reaches the other grid. (This replaced an earlier version that showed both grids and switched the mode on a pick from the hidden scheme.)
- **Stored on the account, mirrored in a cookie.** `User.themeMode` / `User.lightTheme` / `User.darkTheme` (`GET`/`PATCH /users/me/appearance`) are the truth, so the choice follows the person across devices. The browser keeps a copy in the `pg_appearance` cookie (`<mode>.<lightId>.<darkId>`, e.g. `system.classic.midnight`, a year, `SameSite=Lax`, readable by script on purpose), which the inline script in `<body>` reads before first paint: no flash, and no `cookies()` in the root layout forcing every route dynamic. The script puts `light`/`dark` on `<body>`, plus `data-light-theme` and `data-dark-theme` for any theme but Classic, both whatever the mode. It still accepts the older two-part `<mode>.<lightId>` cookie (dark Classic, and its `cream` read as Classic, since Cream was the default when that form was written). On the first dashboard load on a new device, `AppearanceSync` (in the `[orgId]` layout) corrects the cookie from the account: the mode at once from the session, the effective themes from `GET /users/me/appearance`. A legacy `localStorage('postgear-theme')` value is honoured only when there is no cookie yet.
- **The settings page follows §1 and §16d.** No in-page title and no actions row (nothing to act on beyond the choices themselves); a Mode card with a segmented control (System / Light / Dark), then a "Light themes" card and a "Dark themes" card, each a grid of pressable preview tiles (`shadow-brutalSm`, selected = `border-actionPrimary` plus a "Current" badge, premium = an outline "Premium" badge with a lock while locked). Each tile's miniature is drawn from the catalog's swatch with inline colours (data from the API, not hard-coded hex), edges in the theme's outline and dots in its ink, so it shows its own theme whatever the page is wearing.

## 16f. Onboarding profile step and avatars (2026-10-17)

- **Every onboarding path ends on step 6, "Profile".** Steps 2–5 carry a quiet "Skip questions" *text* button (underlined `font-sans font-bold`, the focus-ring recipe from §8, never a third filled button competing with Continue); skipping and finishing both land on step 6, and only step 6's "Finish setup" completes onboarding. Step 6 is two columns from `md` (stacked below, with the button last): "What should we call you?" + helper + name `Input` on the left, the `AvatarPicker` on the right. No title above the wizard beyond what the page already had (§1).
- **One avatar component.** Draw a person with `UserAvatar` (`components/profile/user-avatar.tsx`: preset → `/avatars/<id>.svg`, image → its URL, none → initials in `type-ui`) or, where `UserMenu` draws it, pass `avatarSrc(...)` as `avatarUrl`. Never resolve a stored avatar to a URL by hand; `lib/avatars.ts` owns that (unknown preset ids fall back to initials). Plain `<img>`, not `next/image`: storage URLs have no remote pattern and are already 256 px WebP.
- **`AvatarPicker` is reusable as-is** (`components/profile/avatar-picker.tsx`; a profile settings page should drop it in). Preset tiles are a real radio group (visually hidden inputs, the `<label>` is the tile, `shadow-brutalSm` like onboarding's choice tiles (pressable, §6), keyboard focus shown with `has-[:focus-visible]:outline-*`), and the selected tile gets `ring-4 ring-actionPrimary ring-offset-2 ring-offset-primary` plus a check badge. "Upload a photo" is a dashed, shadowless tile (a slot to fill, like `FileUpload`). Picks save immediately; the preview updates optimistically and rolls back with a `FormErrorMessage` on failure.
- **Presets are static files.** 16 DiceBear "Notionists" SVGs (CC0 artwork) in `apps/web/public/avatars/`, generated once by `apps/web/scripts/generate-avatars.mjs` on brand fills and pastel tints; the ids live in three places (generator, `lib/avatars.ts`, the API allowlist); see `public/avatars/README.md`. Never generate or fetch avatars at runtime, and never remove a shipped id.

## 17. Token extension policy

Every rule above resolves to a token, not a literal value. When a genuinely new need comes up (this pass added `--color-brutal-success` for semantic success states, and the four accordion/collapsible keyframes for expand animation), extend `colors.css` + `tailwind.css` following the existing pattern (flat non-theme-varying color in the same block as `brutal-secondary`/`brutal-danger`/`brutal-accent`; a new `@keyframes` + `--animate-*` entry next to the existing ones) and document *why* in a comment, the same way every existing token is documented. Never inline a one-off hex/pixel value inside a component file to route around this.
