# PostGear — Design Patterns & Tokens Index

> **Decision (2026-08-29)**: PostGear imports Postiz's actual design-token system (colors, Tailwind theme extensions, shadows, animations, breakpoints) as its starting visual foundation, rather than inventing a new one from scratch. This is a deliberate exception to the "reference, don't copy" rule that governs application *logic* in [`../sprint-documents/`](../sprint-documents/README.md) — visual tokens aren't business logic, and reusing a shipped, cross-browser-tested token set is a legitimate time-saver for a solo developer. The colors get reskinned to PostGear's own brand later; the token *structure* (variable names, the light/dark switching mechanism, the Tailwind utility mapping) stays.

## What's in this folder

| Document | Purpose |
|---|---|
| [`design-tokens.md`](design-tokens.md) | Full catalog of every token group that was imported: what it is, where it lives in the repo now, where it came from in Postiz, and what it's for. |
| [`rebrand-plan.md`](rebrand-plan.md) | How and when to actually change these tokens to PostGear's own brand colors, without a big-bang rewrite that breaks every component that consumes them. |

## Where the tokens actually live now

PostGear's apps install `tailwindcss@^4.0.0`, which moved theme configuration from a JS file into CSS (`@theme`, `@custom-variant`, `@plugin`). Everything below is already written in native v4 syntax — not the v3 `module.exports` style Postiz's own source uses.

| File | Contents | Status |
|---|---|---|
| `packages/ui/src/styles/colors.css` | Raw CSS custom properties — the actual color values, in `.dark`/`.light` variants | ✅ Copied in, valid CSS, importable as-is |
| `packages/config/tailwind.css` | Native v4 `@theme inline` block mapping semantic utility names (`bg-primary`, `text-forth`, `shadow-menu`, `animate-fadeIn`, etc.) to the CSS variables above, plus `@keyframes`, `@custom-variant` (dark mode, `child`/`child-hover`, the custom max-width breakpoints), and `@plugin` directives | ✅ Written in v4 syntax |
| `packages/config/tailwind.config.js` | The old v3 `theme.extend` object | ⚠️ Deprecated stub — content moved to `tailwind.css` above, kept only as a placeholder |
| `apps/web/src/app/globals.css` | `@import "tailwindcss"` + imports `colors.css` and `tailwind.css` | ✅ Wired |
| `apps/web/postcss.config.js` | `@tailwindcss/postcss` plugin registration (v4's replacement for the old `tailwindcss` + `autoprefixer` PostCSS setup) | ✅ Created |

**Remaining before this actually renders** (tracked in [Sprint 1](../sprint-documents/sprint-01-foundation-and-data-model.md)): `npm install` needs to actually run so `@tailwindcss/postcss`, `tailwind-scrollbar`, and `tailwindcss-rtl` (added to `apps/web/package.json`'s devDependencies) are present in `node_modules` — that hasn't been run yet as part of this documentation pass. And something in the app shell needs to apply a `dark` or `light` class to a root element, since the color variables in `colors.css` only resolve once one of those is present (see `design-tokens.md` §1).

## Ground rule for using these tokens in new components

Write components against the **semantic names** (`bg-primary`, `text-textColor`, `shadow-menu`, `bg-bgLinkedin`), never against raw hex values or the underlying `--color-*` variable names directly. That's what makes the eventual reskin (see `rebrand-plan.md`) a values-only change instead of a find-and-replace across every component.
