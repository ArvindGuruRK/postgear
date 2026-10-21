# Design Tokens Catalog

> **Rewritten 2026-09-02 (Sprint 0 close).** This document used to catalog the token system imported from Postiz (`colors.scss` + `tailwind.config.cjs`, imported 2026-08-29). Most of those tokens were deleted when Sprint 0's Neubrutalism system superseded them: 129 CSS variables became 36, and 154 Tailwind theme entries became 39. Cataloging tokens that no longer exist is worse than not cataloging them, so this is now a catalog of what actually ships. The old inventory is in git history if a value ever needs recovering.
>
> Values live in [`packages/ui/src/styles/colors.css`](../../packages/ui/src/styles/colors.css); the mapping that turns them into utility classes lives in [`packages/config/tailwind.css`](../../packages/config/tailwind.css).

## 1. Theming mechanism

Colors are **not** switched with Tailwind's `dark:` variant (though `@custom-variant dark` is defined, so it's available for one-off cases). Every themed color is a CSS custom property defined twice, once under `.dark` and once under `.light`, and the app toggles which class is active.

Consequences worth knowing before you touch anything:

- **The class goes on `<body>`, not `<html>`.** `colors.css` nests its blocks as `:root { .dark { … } }`, which compiles to a descendant selector, so the class has to sit on an element *below* `:root`. The no-flash script (`NO_FLASH_APPEARANCE_SCRIPT` in `apps/web/src/lib/appearance.ts`, rendered by `layout.tsx` and `global-error.tsx`) puts it on `<body>` before paint, from the `pg_appearance` cookie (see §2a).
- **A theme is an attribute on the same `<body>`, one per scheme.** `data-light-theme="<id>"` selects one of the light themes in §2a and `data-dark-theme="<id>"` one of the dark themes; no attribute is Classic, the base `.light` / `.dark` block. Every light selector requires `.light` and every dark one `.dark`, so each attribute is inert in the other scheme, and both are set whatever the mode.
- **Without that class, nothing resolves.** Every variable is scoped inside `.dark`/`.light`, so a tree that bypasses the root layout (`global-error.tsx` is the one that actually does) must apply a theme class itself or every component renders colorless.

The Tailwind mapping uses `@theme inline` deliberately: it references the variables at paint time instead of baking in whichever value was active at build time, which is what lets the class swap work at all.

## 2. Surfaces

| Token | Utility | Role |
|---|---|---|
| `--color-primary` | `bg-primary` | The page ground. Warm cream `#fff8e7` in Classic light, `#121212` in Classic dark. Painted on `<body>` in `globals.css` so every route gets it. |
| `--color-secondary` | `bg-secondary` | The surface that sits on the page: cards, dialogs, menus. White `#ffffff` in Classic light, `#2a2a2a` in Classic dark. |
| `--color-chrome` | `bg-chrome` | The app frame: sidebar and top bar. White in Classic light, equal to secondary in Classic dark; most other themes tint it (a shade deeper than the page in light, e.g. butter `#ffeec2` in Cream). Added 2026-10-17. |
| `--color-field` | `bg-field` | Form fields: inputs, textareas, select/combobox/date triggers, checkboxes, radios. Pure white in every light theme so typing surfaces stay the clearest thing on screen; equal to secondary in Classic dark, a step lighter than the cards in the other dark themes. Added 2026-10-17. |
| `--color-gray` | (none) | Neutral gray `#8c8c8c`, used directly as `var(--color-gray)` by the hand-rolled scrollbar in `globals.css`. Has no utility class on purpose. |

The values above are the **Classic** themes', the base `.light` and `.dark` blocks. Every other theme in §2a overrides the four surface layers (page, chrome, cards, fields) plus `--color-ink`/`--color-outline` and, for some, the shadow weights. Components never know which theme is active: they consume `bg-primary`/`bg-chrome`/`bg-secondary`/`bg-field` and get the theme's value. That is also why chrome and field are separate tokens from secondary: a theme tints the frame, the cards and the fields independently, and one token could not do all three.

## 2a. Themes

Twenty-four user-selectable themes, twelve per scheme (six free, six premium): the light ones shipped 2026-10-17 (replacing the dev-only "palette trials" and their switcher), the dark ones and Classic light 2026-10-18. The person picks one light and one dark theme in Settings → Appearance; both are stored on their account (`User.lightTheme`, `User.darkTheme`, each defaulting to `classic`) and mirrored into the `pg_appearance` cookie that the no-flash script reads.

### Light themes

| Id | Tier | Page | Chrome (frame) | Cards | Field | Ink / outline | Shadows |
|---|---|---|---|---|---|---|---|
| `classic` (default) | Free | `#fff8e7` | `#ffffff` | `#ffffff` | `#ffffff` | `#0a0a0a` | standard |
| `cream` | Free | `#fff8e7` | `#ffeec2` | `#fffdf7` | `#ffffff` | `#0a0a0a` | standard |
| `paper` | Free | `#f4f3ee` | `#e8e6dd` | `#fbfaf7` | `#ffffff` | `#111111` | standard |
| `white` | Free | `#f5f5f3` | `#ffffff` | `#ffffff` | `#ffffff` | `#0a0a0a` | light: 2px everywhere |
| `cool` | Free | `#eef1f7` | `#dfe6f2` | `#f9fbff` | `#ffffff` | `#0f172a` | standard |
| `lilac` | Free | `#ece9fb` | `#d9d2fb` | `#f8f7ff` | `#ffffff` | `#0a0a0a` / `#000000` | diagonal surfaces |
| `mint` | Premium | `#eaf6ee` | `#cdebd9` | `#f7fdf9` | `#ffffff` | `#052e1a` | standard |
| `grape` | Premium | `#f3eafb` | `#e4cff6` | `#fcf8ff` | `#ffffff` | `#1f0a33` | diagonal surfaces |
| `peach` | Premium | `#fff1e8` | `#ffdcc7` | `#fffaf6` | `#ffffff` | `#2a1206` | standard |
| `sky` | Premium | `#eaf5fd` | `#cfe8fa` | `#f7fcff` | `#ffffff` | `#0b2239` | light: 2px everywhere |
| `rose` | Premium | `#fdedf0` | `#f9d3dc` | `#fff8f9` | `#ffffff` | `#2b0a13` | standard |
| `lemon` | Premium | `#fbf8d6` | `#f3ea9a` | `#fffef2` | `#ffffff` | `#2a2406` | standard |

"Standard" is the base `.light` scale (§3, design-system-rules.md §6). Classic is the original light look; Cream (the butter frame and warm-white cards) was the base from 2026-10-17 until Classic took its place and is now one free option among the rest.

### Dark themes

| Id | Tier | Page | Chrome (frame) | Cards | Field | Ink | Outline |
|---|---|---|---|---|---|---|---|
| `classic` (default) | Free | `#121212` | `#2a2a2a` | `#2a2a2a` | `#2a2a2a` | `#f5f5f5` | `#050505` |
| `midnight` | Free | `#0b1120` | `#131c33` | `#18223c` | `#232e4e` | `#e6ebf7` | `#02050d` |
| `forest` | Free | `#0b1510` | `#12221a` | `#17291f` | `#1e3428` | `#e4f1e8` | `#020805` |
| `plum` | Free | `#140d1c` | `#1f142b` | `#261a33` | `#352641` | `#f0e7f7` | `#07030b` |
| `ocean` | Free | `#071518` | `#0e2226` | `#12292e` | `#183439` | `#e0f2f3` | `#010708` |
| `mocha` | Free | `#16100c` | `#231a14` | `#2a2019` | `#392c23` | `#f5ebe1` | `#070402` |
| `obsidian` | Premium | `#000000` | `#0a0a0a` | `#141414` | `#1c1c1c` | `#f2f2f2` | `#3d3d3d` |
| `nebula` | Premium | `#110c22` | `#1c1538` | `#221a40` | `#2f2656` | `#ece8ff` | `#05030d` |
| `ember` | Premium | `#170b09` | `#261310` | `#2d1814` | `#3e2520` | `#f8e9e4` | `#080302` |
| `aurora` | Premium | `#08171a` | `#1d1638` | `#102629` | `#17343c` | `#e3f4f2` | `#02080a` |
| `slate` | Premium | `#10141a` | `#1a2029` | `#1f2630` | `#28303c` | `#e8edf3` | `#04060a` |
| `orchid` | Premium | `#170a17` | `#291029` | `#311631` | `#432241` | `#fbe8f7` | `#060206` |

Every dark theme keeps the base `.dark` shadow scale (diagonal, §3). The page is the deepest layer and each one above it a step lighter, fields last, so a field stands off its card; the outline is a near-black tint of the hue, except Obsidian's grey `#3d3d3d`, since a near-black edge would vanish on its true-black page. Aurora is the two-hue one: Ocean-like teal surfaces in a violet frame.

Brand fills (§4) never change with the theme, light or dark.

- **Where it lives.** CSS: `.light[data-light-theme='<id>']` and `.dark[data-dark-theme='<id>']` blocks in `colors.css` ("Themes"), each (0,3,0) so it beats the base blocks wherever it sits. Catalog (ids, names, which are premium, each entry's `mode`, and a copy of each block's surface, ink and outline hexes for the settings previews): `apps/api/src/modules/users/appearance.catalog.ts`, two lists (`LIGHT_THEMES`, `DARK_THEMES`) served together by `GET /users/me/appearance`. Ids are unique per mode only (`classic` is in both), so every catalog lookup takes the mode. A unit test (`appearance.catalog.spec.ts`) fails when a CSS block (or, for Classic, the base blocks) and its catalog entry disagree, so add a theme in both places.
- **The cookie.** `pg_appearance=<mode>.<lightId>.<darkId>`, e.g. `system.classic.midnight`. The older two-part `<mode>.<lightId>` is still read, as dark `classic`, with its `cream` read as `classic` (Cream was the default when that form was written; the migration that added the dark themes moved every account still on it to Classic, the same rule).
- **Contrast, by script.** Light, for every theme: ink ≥ 11.6:1 on page, chrome and cards (floor 7:1); blue `#1d4ed8` ≥ 4.6:1 on chrome and ≥ 5.6:1 on the page (floor 4.5:1); outline ≥ 14:1 against a white field (floor 3:1); the focus ring `#d6440f` ≥ 3.1:1 on page and chrome (floor 3:1). Dark, for every theme: ink ≥ 11.1:1 on page, chrome, cards and fields (floor 7:1); the focus ring `#ff6b35` ≥ 5.0:1 on page and chrome (floor 3:1); outline against a field ≥ 1.46:1 in every tinted theme, never below Classic dark's 1.42:1 (where field equals card and the outline alone draws the edge), with each field also a step lighter than its card; the blue fill ≥ 2.1:1 against every chrome (Classic dark's own figure; the tinted themes are 2.4:1 or more), so an active nav item stands off the sidebar, its white label at 6.7:1 on the blue everywhere. Re-check all of these for a new theme before shipping it.
- **Premium.** The six premium themes in each scheme unlock while any workspace the user belongs to is entitled to a paid tier or a live trial (the plan table's `resolveEntitlement`). The server enforces it in both modes; a stored premium id is served back as Classic while the plan has lapsed.

## 3. Structural tokens (Neubrutalism)

The style needs two things Tailwind's defaults don't provide: an outline color, and hard unblurred offset shadows. Border widths and radii use Tailwind's own scale (`border-2`/`border-4`, `rounded-md`/`xl`/`2xl`/`full`).

| Token | Utility | Role |
|---|---|---|
| `--color-ink` | `text-ink` | Text and icon color. Near-black in light, near-white in dark. |
| `--color-outline` | `border-outline` | Border and shadow color. **Separate from ink on purpose**: it stays dark in dark mode instead of inverting to white, so borders read against the lighter surface rather than turning the UI stark black-and-white. |
| `--brutal-offset-sm/md/lg` | `translate-x/y-(--brutal-offset-*)` | The shadow depths per scheme: light 2 / 3 / 4px, dark 2 / 4 / 6px, White and Sky 2px throughout. Every shadow below is built from them. |
| `--shadow-brutal-sm/md/lg` | `shadow-brutalSm/Md/Lg` | The diagonal offset shadow scale, right and bottom, from the offsets above. |
| `--shadow-brutal-pressed` | `shadow-brutalPressed` | Collapses to `0 0 0`. With a translate by the matching offset (`pressSm`/`pressMd` in `packages/ui/src/lib/press.ts`): the press interaction that is the system's signature. |
| (none) | `bg-primary` on hover | The shared hover colour for neutral controls: the calendar's Today button and week arrows, and the secondary Button's GSAP fill (2026-10-21). Button2's `--shadow-brutal-btn` pair was removed with Button2 the same day. |

## 4. Action palette

Locked 2026-08-30 as Palette A ("Classic Comic Primary"). These fills are **flat across themes** (comic colors don't invert, only ink and backgrounds do), so they're declared outside the `.dark`/`.light` blocks.

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

**Text-on-fill is paired to the variant name, not derived from the hue.** Repointing a variant at a different color means also repointing which `on*` token its text uses. Every pair above is contrast-checked, not eyeballed: the lowest is 4.75:1, comfortably over WCAG AA's 4.5:1.

## 5. Focus ring

| Token | Utility | Value |
|---|---|---|
| `--color-focus-ring` | `outline-focusRing` | `#d6440f` light / `#ff6b35` dark |

Its own token since 2026-09-02, and the one token that is theme-scoped for a purely accessibility reason. The ring previously reused `actionAccent`, which reaches 6.61:1 on the dark page but only **2.68:1** on light mode's warm paper, under WCAG 2.1 SC 1.4.11's 3:1 for focus indicators, on a ring 36 components share. The light value clears 3:1 against all three surfaces the ring touches: the page (4.23:1), white cards (4.47:1), and the ink border it sits 2px outside of (4.42:1).

The treatment itself is decided once and reused verbatim: `focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing`. Radix menu items are the deliberate exception: they use the highlight convention (`focus:bg-actionPrimary`) instead, since a ring on every menu row would be noise. `e2e/auth.spec.ts` asserts the computed ring color so a regression fails a test rather than shipping.

## 6. Platform brand colors

`bgLinkedin`, `bgFacebook`, `bgInstagram`, `bgTiktokItem`, `bgTiktokItemIcon`, `bgYoutube`, `bgCommentFacebook`, `textLinkedin`, `borderLinkedin`, `youtubeButton`, `youtubeBgAction`, `youtubeSvg`.

These represent each target platform's own identity in post previews, not PostGear's style, so **never rebrand them**. They have no uses yet and were deliberately kept through the prune: Sprint 3's channel-connection UI is what consumes them.

## 7. Typography

One family for the whole platform (Sora, locked 2026-10-15), loaded once in `apps/web/src/app/fonts.ts` as `--font-brand`. Every token and utility below is defined in `apps/web/src/app/globals.css` ("Typography"); that file and `fonts.ts` are the only places a font, weight or tracking value is chosen.

| Token | Utility | Role |
|---|---|---|
| `--font-sans` (→ `--font-brand`) | `font-sans` | The family itself; inherited everywhere, so rarely written out |
| `--type-heading-weight`, `--type-heading-tracking` | `type-heading` | Page/card/dialog/sheet titles, wordmark, big numbers |
| `--type-ui-weight`, `--type-ui-tracking` | `type-ui` | Buttons, tabs, nav, menu chrome, names, step markers; sentence case |
| `--type-label-weight`, `--type-label-tracking` | `type-label` | Small uppercase eyebrows naming a section or group |
| `--type-body-weight` | (on `body`) | Body copy, data, and **every part of a form control** |

Both load through `next/font/google` in the root layout, which is what actually defines the custom properties; the theme entries just plug that runtime value into Tailwind.

Comic styling belongs in headings and interactive chrome. Two deliberate exceptions keep the display face out: dense data surfaces (tables, the calendar grid, analytics), and **form controls**: a label sits directly above text the user types, so `Label` is `font-sans text-sm font-bold`, sentence case. See design-system-rules.md §1 and §15.

## 8. Animation

Nine animations remain, each with a matching `@keyframes`: `fadeIn`, `progressStripes`, `digitTick`, `accordionDown`/`Up`, `collapsibleDown`/`Up`, `toastIn`/`Out`. The accordion and collapsible pairs can't share keyframes because each Radix primitive exposes its own content-height property.

## 9. Texture utilities

`bg-stripes` (diagonal barber-pole banding, for progress fills) and `bg-halftone` (dot pattern, for full-comic surfaces like empty states and the 404). Both derive their color from `--color-outline` via `color-mix`, so one utility works on every fill and in both themes, and both **layer on top of** an existing background: apply them alongside `bg-actionPrimary`, not instead of it.

`tailwind-merge` needs a custom `bg-image` class group for these, or it treats them as background-*colors* and silently drops the fill in front of them. That extension lives in `packages/ui/src/lib/utils.ts`, and `e2e/playground.spec.ts` guards it.

## 10. What was removed, and why it matters

The prune deleted the `--color-customN` palette (55 entries), the `--new-*` surface layer (28 tokens), the soft/blurred shadow set, eight unused animations, and seven unused max-width breakpoint variants.

The reason was not bundle size: the whole deletion saved about 1.2 KB gzipped. It was that every one of those names was a **working utility class**. `bg-newBgColor` and `text-customColor7` compiled fine and painted the old muted SaaS palette onto a Neubrutalism screen, failing no build, no typecheck and no lint. With eight feature sprints of UI still to write, the cheapest moment to remove that trap was before the screens existed.
