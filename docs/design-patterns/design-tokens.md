# Design Tokens Catalog

> **Rewritten 2026-09-02 (Sprint 0 close).** This document used to catalog the token system imported from Postiz (`colors.scss` + `tailwind.config.cjs`, imported 2026-08-29). Most of those tokens were deleted when Sprint 0's Neubrutalism system superseded them — 129 CSS variables became 36, and 154 Tailwind theme entries became 39. Cataloging tokens that no longer exist is worse than not cataloging them, so this is now a catalog of what actually ships. The old inventory is in git history if a value ever needs recovering.
>
> Values live in [`packages/ui/src/styles/colors.css`](../../packages/ui/src/styles/colors.css); the mapping that turns them into utility classes lives in [`packages/config/tailwind.css`](../../packages/config/tailwind.css).

## 1. Theming mechanism

Colors are **not** switched with Tailwind's `dark:` variant (though `@custom-variant dark` is defined, so it's available for one-off cases). Every themed color is a CSS custom property defined twice — once under `.dark`, once under `.light` — and the app toggles which class is active.

Two consequences worth knowing before you touch anything:

- **The class goes on `<body>`, not `<html>`.** `colors.css` nests its blocks as `:root { .dark { … } }`, which compiles to a descendant selector, so the class has to sit on an element *below* `:root`. The no-flash script in `apps/web/src/app/layout.tsx` puts it on `<body>` before paint.
- **Without that class, nothing resolves.** Every variable is scoped inside `.dark`/`.light`, so a tree that bypasses the root layout — `global-error.tsx` is the one that actually does — must apply a theme class itself or every component renders colorless.

The Tailwind mapping uses `@theme inline` deliberately: it references the variables at paint time instead of baking in whichever value was active at build time, which is what lets the class swap work at all.

## 2. Surfaces

| Token | Utility | Role |
|---|---|---|
| `--color-primary` | `bg-primary` | The page ground. Warm paper `#fff8e7` in light, `#121212` in dark. Painted on `<body>` in `globals.css` so every route gets it. |
| `--color-secondary` | `bg-secondary` | The surface that sits on the page — cards, dialogs, inputs. White in light, `#2a2a2a` in dark. |
| `--color-gray` | — | Neutral gray `#8c8c8c`, used directly as `var(--color-gray)` by the hand-rolled scrollbar in `globals.css`. Has no utility class on purpose. |

## 3. Structural tokens (Neubrutalism)

The style needs two things Tailwind's defaults don't provide: an outline color, and hard unblurred offset shadows. Border widths and radii use Tailwind's own scale (`border-2`/`border-4`, `rounded-md`/`xl`/`2xl`/`full`).

| Token | Utility | Role |
|---|---|---|
| `--color-ink` | `text-ink` | Text and icon color. Near-black in light, near-white in dark. |
| `--color-outline` | `border-outline` | Border and shadow color. **Separate from ink on purpose**: it stays dark in dark mode instead of inverting to white, so borders read against the lighter surface rather than turning the UI stark black-and-white. |
| `--shadow-brutal-sm/md/lg` | `shadow-brutalSm/Md/Lg` | The diagonal offset shadow scale: `2px 2px 0`, `4px 4px 0`, `6px 6px 0`. |
| `--shadow-brutal-pressed` | `shadow-brutalPressed` | Collapses to `0 0 0`. Paired with `translate(2px, 2px)` on `:active` — the press interaction that is the system's signature. |
| `--shadow-brutal-md-hover` | `shadow-brutalMdHover` | Button-only hover lift (`5px 5px 0`), paired with a 1px translate so the shadow's far corner stays anchored. |
| `--shadow-brutal-btn`, `--shadow-brutal-btn-hover` | `shadow-brutalBtn`, `shadow-brutalBtnHover` | Button2-only vertical base (`0 4px 0` → `0 6px 0`). See §7. |

## 4. Action palette

Locked 2026-08-30 as Palette A ("Classic Comic Primary"). These fills are **flat across themes** — comic colors don't invert, only ink and backgrounds do — so they're declared outside the `.dark`/`.light` blocks.

| Token | Utility | Value | Pairs with |
|---|---|---|---|
| `--color-forth` | `bg-actionPrimary` | `#1d4ed8` blue | `onActionPrimary` (white) |
| `--color-seventh` | `bg-actionPrimaryHover` | `#3d5fe0` | `onActionPrimary` |
| `--color-brutal-secondary` | `bg-actionSecondary` | `#ffd100` yellow | `onActionLight` (black) |
| `--color-brutal-danger` | `bg-actionDanger` | `#e63946` red | `onActionLight` |
| `--color-brutal-ai` | `bg-actionAi` | `#7657ef` violet | `onActionAi` (white) |
| `--color-brutal-accent` | `bg-actionAccent` | `#ff6b35` orange | `onActionLight` |
| `--color-brutal-success` | `bg-actionSuccess` | `#22c55e` green | `onActionLight` |
| `--color-plate` / `--color-on-plate` | `bg-plate` / `text-onPlate` | near-black + yellow digits | Countdown/scoreboard only; stays dark in both themes |

**Text-on-fill is paired to the variant name, not derived from the hue.** Repointing a variant at a different color means also repointing which `on*` token its text uses. Every pair above is contrast-checked, not eyeballed — the lowest is 4.75:1, comfortably over WCAG AA's 4.5:1.

## 5. Focus ring

| Token | Utility | Value |
|---|---|---|
| `--color-focus-ring` | `outline-focusRing` | `#d6440f` light / `#ff6b35` dark |

Its own token since 2026-09-02, and the one token that is theme-scoped for a purely accessibility reason. The ring previously reused `actionAccent`, which reaches 6.61:1 on the dark page but only **2.68:1** on light mode's warm paper — under WCAG 2.1 SC 1.4.11's 3:1 for focus indicators, on a ring 36 components share. The light value clears 3:1 against all three surfaces the ring touches: the page (4.23:1), white cards (4.47:1), and the ink border it sits 2px outside of (4.42:1).

The treatment itself is decided once and reused verbatim: `focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing`. Radix menu items are the deliberate exception — they use the highlight convention (`focus:bg-actionPrimary`) instead, since a ring on every menu row would be noise. `e2e/auth.spec.ts` asserts the computed ring color so a regression fails a test rather than shipping.

## 6. Platform brand colors

`bgLinkedin`, `bgFacebook`, `bgInstagram`, `bgTiktokItem`, `bgTiktokItemIcon`, `bgYoutube`, `bgCommentFacebook`, `textLinkedin`, `borderLinkedin`, `youtubeButton`, `youtubeBgAction`, `youtubeSvg`.

These represent each target platform's own identity in post previews, not PostGear's style — **never rebrand them**. They have no uses yet and were deliberately kept through the prune: Sprint 3's channel-connection UI is what consumes them.

## 7. Typography

| Token | Utility | Face |
|---|---|---|
| `--font-sans` | `font-sans` | Plus Jakarta Sans — body copy, data, and **every part of a form control**: label, value, placeholder, helper text, error message |
| `--font-display` | `font-display` | Bangers — headings, buttons, tabs, badges, dialog/card/menu chrome |

Both load through `next/font/google` in the root layout, which is what actually defines the custom properties; the theme entries just plug that runtime value into Tailwind.

Comic styling belongs in headings and interactive chrome. Two deliberate exceptions keep the display face out: dense data surfaces (tables, the calendar grid, analytics), and **form controls** — a label sits directly above text the user types, so `Label` is `font-sans text-sm font-bold`, sentence case. See design-system-rules.md §1 and §15.

## 8. Animation

Nine animations remain, each with a matching `@keyframes`: `fadeIn`, `progressStripes`, `digitTick`, `accordionDown`/`Up`, `collapsibleDown`/`Up`, `toastIn`/`Out`. The accordion and collapsible pairs can't share keyframes because each Radix primitive exposes its own content-height property.

## 9. Texture utilities

`bg-stripes` (diagonal barber-pole banding, for progress fills) and `bg-halftone` (dot pattern, for full-comic surfaces like empty states and the 404). Both derive their color from `--color-outline` via `color-mix`, so one utility works on every fill and in both themes, and both **layer on top of** an existing background — apply them alongside `bg-actionPrimary`, not instead of it.

`tailwind-merge` needs a custom `bg-image` class group for these, or it treats them as background-*colors* and silently drops the fill in front of them. That extension lives in `packages/ui/src/lib/utils.ts`, and `e2e/playground.spec.ts` guards it.

## 10. What was removed, and why it matters

The prune deleted the `--color-customN` palette (55 entries), the `--new-*` surface layer (28 tokens), the soft/blurred shadow set, eight unused animations, and seven unused max-width breakpoint variants.

The reason was not bundle size — the whole deletion saved about 1.2 KB gzipped. It was that every one of those names was a **working utility class**. `bg-newBgColor` and `text-customColor7` compiled fine and painted the old muted SaaS palette onto a Neubrutalism screen, failing no build, no typecheck and no lint. With eight feature sprints of UI still to write, the cheapest moment to remove that trap was before the screens existed.
