# Rebrand Plan — From Postiz's Palette to PostGear's Own

> **Superseded (2026-08-29)** by [`../sprint-documents/sprint-00-design-system.md`](../sprint-documents/sprint-00-design-system.md): PostGear has committed to a Neubrutalism + comic-book visual direction, which is a bigger change than the "swap the accent color, keep the rest" plan this document originally described — Postiz's soft/blurred shadows and muted palette were replaced in philosophy, not just in hue. What's still accurate below: the *mechanism* (values-only change through `colors.css`, because components consume semantic names) and the note that platform brand colors never get touched.
>
> Status: **locked 2026-08-30 (Sprint 0)**. Three candidate palettes were prototyped visually (real Button/Badge/Card, light + dark, two typefaces) via a design canvas; **"Classic Comic Primary" (Palette A, blue-forward)** was selected over a red-forward and a yellow-forward candidate. See [`design-tokens.md`](design-tokens.md) for what every token means and `packages/ui/src/styles/colors.css` for the actual values now in place.

## Why a values-only change is possible

Because every component consumes semantic Tailwind utility names (`bg-primary`, `text-forth`, `bg-btnPrimary`) rather than hardcoded hex values, and those utility names resolve through `packages/config/tailwind.css`'s `@theme inline` block to CSS variables defined once in `packages/ui/src/styles/colors.css` — rebranding is, in principle, a matter of editing values in **one file** (`colors.css`), not hunting through every component. This only holds as long as new PostGear components keep following that discipline (see the ground rule in `README.md`).

## What actually changed

Not everything — most of the token system (backgrounds, borders, table styling, breakpoints, animations) is brand-neutral UI plumbing and stayed exactly as imported. The tokens that carry PostGear's actual brand identity, now locked:

| Token(s) | Value | Role |
|---|---|---|
| `--color-forth`, `--new-btn-primary` | `#2b4fe0` (blue) | Primary action color — buttons, active nav states, links |
| `--color-seventh` | `#4a63e8` (lighter blue) | Primary hover tint |
| `--new-ai-btn` | `#ff2e93` (pink) | AI-feature accent — kept **distinct** from primary (the recommended option): a useful "this is an AI action" signal |
| `--color-brutal-secondary` | `#ffc700` (yellow) | Secondary action color (new token — nothing in the inherited Postiz layer named this role) |
| `--color-brutal-danger` | `#e63946` (red) | Danger action color (new token) |
| `--color-brutal-accent` | `#00c2cb` (cyan) | Occasional accent (badges, focus ring) (new token) |
| `--color-primary` (page bg) | `#fff8e7` light / `#121212` dark | Warm paper light mode, near-black dark mode — replaces Postiz's cool gray |
| `--color-secondary`/`--color-third` (surface bg) | `#ffffff` light / `#1a1a1a` dark | Card/dialog surface — one consistent tone instead of three near-duplicate dark grays |
| `--font-display` (new) | Bangers (via `next/font/google`) | Headings, buttons, comic-accent chrome |
| `fontFamily.sans` | `Helvetica Neue` (unchanged) | Body copy, dense data — deliberately kept plain for legibility |

**Text-on-fill is a fixed pair, not theme-aware**: `--color-on-action-primary` (`#ffffff`) for the primary blue only; `--color-on-action-light` (`#0a0a0a`) for every other fill (secondary, danger, ai, accent). Comic fill colors don't invert between light/dark — only backgrounds and the `--color-ink` border/shadow color do — so the text sitting on a fill can't be aliased to `--color-ink` either; that was confirmed by an actual contrast calculation, not eyeballed (white-on-red and white-on-pink both fail WCAG AA at button text sizes; black text on every non-primary fill clears it comfortably).

Favicon/logo assets (`apps/web/public/{favicon.ico,logo.svg}`) remain out of scope for this document.

**Explicitly not touched**: the platform brand colors (`bgLinkedin`, `bgFacebook`, `bgInstagram`, `bgYoutube`, etc.) — these represent the *target platform's* brand in preview cards, not PostGear's own, and stay accurate to each platform regardless of PostGear's palette.

## What was done

1. Three candidate palettes were prototyped on real Button/Badge/Card components (light + dark, two typeface candidates — Bangers vs. Archivo Black) via a design canvas, rather than guessing hex values from a document.
2. Palette A ("Classic Comic Primary," blue-forward) was picked over a red-forward and a yellow-forward candidate.
3. The change was applied in `packages/ui/src/styles/colors.css` (existing tokens updated in both `.dark`/`.light` blocks, new `--color-brutal-*`/`--color-on-action-*` tokens added for roles nothing in the inherited layer named) and mapped into Tailwind utilities (`actionPrimary`, `actionSecondary`, `actionDanger`, `actionAi`, `actionAccent`, `onActionPrimary`, `onActionLight`, `font-display`) in `packages/config/tailwind.css`.
4. Contrast was verified by calculation (not eyeballed) for every text-on-fill pairing — see the "Text-on-fill" note above.

## Non-goals for now

- Renaming the `customColorN` tokens wholesale (see `design-tokens.md` §4) — that's an incremental cleanup tied to whichever component a given sprint happens to touch, not a rebrand-blocking task.
- Redesigning the token *structure* (introducing a different theming approach, e.g. a full design-tokens-as-JSON pipeline) — out of scope unless a concrete pain point emerges from using this system in practice.
