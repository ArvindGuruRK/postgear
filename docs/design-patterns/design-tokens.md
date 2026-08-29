# Design Tokens Catalog

> Source: `postiz-app-main/apps/frontend/src/app/colors.scss` + `postiz-app-main/apps/frontend/tailwind.config.cjs`, imported into `packages/ui/src/styles/colors.css` on 2026-08-29 and ported to native Tailwind v4 syntax in `packages/config/tailwind.css`. See [`README.md`](README.md) for status.

## 1. Theming mechanism

Colors are **not** switched via Tailwind's usual `dark:` utility-variant convention (though `darkMode: 'class'` is set, so that mechanism is technically also available). Instead, every color is a CSS custom property defined twice — once under a `.dark` selector, once under `.light` — and the app toggles which class is active on a root element. Components then reference the semantic Tailwind color name (e.g. `bg-primary`), which resolves to `var(--color-primary)`, which resolves differently depending on which of `.dark`/`.light` is currently applied.

**Implication for PostGear**: whatever renders the app shell needs to apply either `dark` or `light` as a class on an ancestor element (Postiz does this at the root layout level) — without it, none of these variables resolve to anything and everything falls back to unstyled/transparent.

## 2. The `new-*` layer — surface & interaction tokens

This is the newer, actively-maintained layer of the token system (the `--new-` prefix suggests it superseded an older layer at some point in Postiz's history). Covers page chrome and interactive surfaces:

| Token | Purpose |
|---|---|
| `--new-back-drop` | Modal/dialog backdrop overlay color |
| `--new-bgColor` / `--new-bgColorInner` | Page background / nested panel background |
| `--new-border`, `--new-sep`, `--new-bgLineColor`, `--new-blockSeparator` | Border and divider line colors (several shades for different contexts) |
| `--new-settings` | Settings-panel-specific background |
| `--new-textItemFocused` / `--new-textItemBlur` | Text color for focused vs. unfocused list items |
| `--new-boxFocused` / `--new-box-hover` | Interactive box state backgrounds |
| `--new-btn-simple` / `--new-btn-text` / `--new-btn-primary` | Default button background/text, primary (accent) button background |
| `--new-ai-btn` | AI-feature-specific button accent (currently a pink, `#d82d7e`) — distinct from the general primary accent, used to visually flag "this is an AI action" |
| `--new-table-border` / `--new-table-header` / `--new-table-text` / `--new-table-text-focused` | Data-table styling |
| `--new-small-strips` / `--new-big-strips` / `--new-col-color` | Layout striping/column background accents (likely calendar or list-row striping) |
| `--new-menu-dots` / `--new-menu-hover` | Overflow-menu ("⋮") icon and hover states |
| `--menu-shadow` | Drop shadow for popover/dropdown menus (a multi-layer shadow in light mode, a single shadow in dark mode) |
| `--popup-color` | Popover background tint |
| `--border-preview` / `--preview-box-shadow` | Framing for the per-platform post preview cards |

## 3. The `color-*` semantic layer

An older/parallel naming layer, still actively used:

| Token | Purpose |
|---|---|
| `--color-primary` / `--color-secondary` / `--color-third` | Page-level background layers (primary = outermost, third = nested-most) |
| `--color-text` | Primary text color |
| `--color-forth` / `--color-seventh` | Brand accent purple (`#612ad5` / `#7236f1`) — this is the closest thing to a single "brand color" in the system; **this is the primary target for PostGear's rebrand** (see `rebrand-plan.md`) |
| `--color-fifth` / `--color-sixth` | Aliased directly to `--new-bgLineColor` / `--new-table-header` — i.e. these two names are synonyms for tokens in the `new-*` layer, not independent values |
| `--color-gray` | Neutral gray text/icon color |
| `--color-input` / `--color-input-text` / `--color-table-border` | Form input styling |
| `--color-modalCustom` | Modal-specific override background |

## 4. `--color-customN` (1–55) — numbered palette

A large flat palette of 55 named-by-number colors. These are **not documented upstream** either — they accumulated over time as one-off colors got pulled into variables. Treat this list as an inherited flat palette, not a designed system; the meaning of any given `customColorN` should be confirmed by grepping its usage in a component before reusing it in new PostGear code, rather than assumed from the table below.

A few are recognizable by convention (safe to treat as likely-correct without a grep, everything else genuinely needs verification):

| Token | Value | Likely meaning (by hex convention) |
|---|---|---|
| `--color-custom22` | `#b91c1c` | Danger/error red (matches Tailwind's default `red-800`) |
| `--color-custom42` | `#32d583` | Success green |
| `--color-custom19` | `#f97066` | Warning/error accent (lighter red-orange) |
| `--color-custom26` | `#1d9bf0` | X/Twitter brand blue — likely used specifically in the X preview/provider component |
| `--color-custom24` | `#eaff00` | High-visibility highlight (lime/yellow) |
| `--color-custom51` | `#4f46e5` | Secondary indigo accent |

**Recommendation**: don't build new PostGear features against `customColorN` names going forward. When a sprint touches a component that currently uses one, take the opportunity to give it a real semantic name (`danger`, `success`, `brandX`, etc.) in `packages/config/tailwind.css`'s `@theme inline` block instead of propagating the numbered name further — an incremental cleanup, not a blocking rewrite.

## 5. Platform brand colors

Per-platform background/border/text colors used specifically in the post-preview components (see Sprint 4 in the sprint documents):

`bgLinkedin`/`borderLinkedin`/`textLinkedin`, `bgFacebook`/`bgCommentFacebook`, `bgInstagram`, `bgTiktokItem`/`bgTiktokItemIcon`, `bgYoutube`/`youtubeButton`/`youtubeBgAction`/`youtubeSvg`. These intentionally do **not** get reskinned — they represent the actual platform's brand color for visual authenticity in previews (e.g. YouTube's preview should look like YouTube regardless of PostGear's own brand color).

## 6. Typography

- `fontFamily.sans: ['Helvetica Neue']` — the only font-family override; falls back to the browser/OS default sans stack otherwise. PostGear should decide deliberately whether to keep this or pick its own typeface as part of the rebrand (see `rebrand-plan.md`) — it wasn't a considered brand choice on Postiz's part to preserve, just their pragmatic default.

## 7. Shadows & effects

- `boxShadow.menu` → `var(--menu-shadow)`, `boxShadow.previewShadow` → `var(--preview-box-shadow)` (theme-aware, defined in section 2 above).
- `boxShadow.yellow` / `yellowToast` / `greenToast` — fixed (non-theme-varying) glow shadows, used for toast notifications.
- `dropShadow.glow` — a 3-layer yellow glow filter (not obviously used elsewhere in the audited files — verify before reusing).

## 8. Animation & keyframes

Named animations: `fade`, `normalFadeIn`, `fadeIn`, `normalFadeOut`, `overflow`/`overflowReverse` (a hidden→visible overflow toggle, likely for expandable panels), `fadeDown`/`normalFadeDown`, `newMessages` (a background-color flash-then-fade, likely for "new item arrived" list highlighting), `marqueeUp`/`marqueeDown` (continuous scroll, likely for a logo/testimonial strip).

## 9. Breakpoints (`screens`)

Unusual compared to Tailwind's own convention: Tailwind's default breakpoints are **min-width** (mobile-first). Postiz's custom screens (`mobile`, `tablet`, `iconBreak`, `maxMedia`, `custom`) are **max-width** raw media queries instead — i.e. they behave like a desktop-first override system layered on top of Tailwind's mobile-first defaults. `minCustom` is the one exception (`min-height`). Know this before writing responsive classes: `mobile:` here means "at or below 1025px," not "at or above" like Tailwind's own `sm:`/`md:`/`lg:`.

## 10. Plugins

- `tailwind-scrollbar` — themeable scrollbar styling utilities.
- `tailwindcss-rtl` — right-to-left layout utilities (relevant if/when PostGear adds RTL-language i18n support; PRD marks i18n as P2).
- A small inline plugin adding two custom variants: `child` (`& > *`) and `child-hover` (`& > *:hover`) — lets you style direct children conditionally without extra wrapper classes.

Both `tailwind-scrollbar` and `tailwindcss-rtl` have been added to `apps/web/package.json`'s devDependencies, but `npm install` hasn't been run yet as part of this documentation pass — required before `packages/config/tailwind.css`'s `@plugin` directives will actually resolve.
