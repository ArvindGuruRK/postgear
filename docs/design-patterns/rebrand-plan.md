# Rebrand Plan — From Postiz's Palette to PostGear's Own

> **Superseded (2026-08-29)** by [`../sprint-documents/sprint-00-design-system.md`](../sprint-documents/sprint-00-design-system.md): PostGear has committed to a Neubrutalism + comic-book visual direction, which is a bigger change than the "swap the accent color, keep the rest" plan this document originally described — Postiz's soft/blurred shadows and muted palette are being replaced in philosophy, not just in hue. What's still accurate below: the *mechanism* (values-only change through `colors.css`, because components consume semantic names) and the note that platform brand colors never get touched. Treat the specific color guidance below as superseded until Sprint 0's actual palette (its Task 1) is locked.
>
> Status: **not started, deliberately deferred**. This document exists so that when you're ready to decide PostGear's actual brand colors, the mechanical part (how to apply them without breaking components) is already figured out. See [`design-tokens.md`](design-tokens.md) for what every token means.

## Why a values-only change is possible

Because every component consumes semantic Tailwind utility names (`bg-primary`, `text-forth`, `bg-btnPrimary`) rather than hardcoded hex values, and those utility names resolve through `packages/config/tailwind.css`'s `@theme inline` block to CSS variables defined once in `packages/ui/src/styles/colors.css` — rebranding is, in principle, a matter of editing values in **one file** (`colors.css`), not hunting through every component. This only holds as long as new PostGear components keep following that discipline (see the ground rule in `README.md`).

## What actually needs to change

Not everything — most of the token system (backgrounds, borders, table styling, shadows, breakpoints, animations) is brand-neutral UI plumbing and can stay exactly as imported. The tokens that actually carry Postiz's brand identity and are worth deliberately deciding on:

| Token(s) | Current value | Role |
|---|---|---|
| `--color-forth`, `--color-seventh` | `#612ad5`, `#7236f1` (purple) | Primary brand accent — buttons, active states, links |
| `--new-btn-primary` | `#612bd3` (same purple family) | Primary button background — should move in lockstep with the accent above |
| `--new-ai-btn` | `#d82d7e` (pink) | AI-feature accent — decide whether PostGear wants a distinct "this is AI" color (recommended — it's a useful UX signal) or to fold it into the primary accent |
| `fontFamily.sans` | `Helvetica Neue` | Typeface — not a considered brand choice on Postiz's part, worth deciding fresh rather than inheriting by default |
| Favicon/logo assets (`apps/web/public/{favicon.ico,logo.svg}`) | placeholder stubs already in the repo | Out of scope for this document, but part of the same overall rebrand effort |

**Explicitly not touched by a rebrand pass**: the platform brand colors (`bgLinkedin`, `bgFacebook`, `bgInstagram`, `bgYoutube`, etc.) — these represent the *target platform's* brand in preview cards, not PostGear's own, and should stay accurate to each platform regardless of PostGear's palette.

## Recommended sequencing

1. **Don't do this now.** Finish Sprint 1's remaining tooling step first (`npm install` so `@tailwindcss/postcss` and the two Tailwind plugins are actually present, per `README.md`) so the imported tokens are actually rendering — you need to *see* the current purple-and-pink scheme working end-to-end before judging what to change it to.
2. **Pick PostGear's brand accent(s) deliberately** — this is a product/brand decision, not an engineering one. Come back to this document when that decision is made.
3. **Apply the change in `packages/ui/src/styles/colors.css` only** — update `--color-forth`, `--color-seventh`, `--new-btn-primary`, and (if decided) `--new-ai-btn`, in both the `.dark` and `.light` blocks. Do not touch `packages/config/tailwind.css` for a pure color change — the utility-name-to-variable mapping doesn't need to change, only the variable values.
4. **Sweep for hardcoded exceptions**: grep the (future) `apps/web/src` for raw hex codes or Tailwind's default color classes (`purple-600`, `bg-[#612ad5]`, etc.) that might have been written directly instead of through the token system — these would silently not update. This matters most for anything ported while studying Postiz's UI components per the sprint documents; carry over the *pattern*, not a pasted color value.
5. **Re-verify contrast/accessibility** on both light and dark variants after the swap — Postiz's current values were presumably contrast-checked for their own palette; a new accent color needs the same check (WCAG AA minimum for text-on-background pairs).

## Non-goals for now

- Renaming the `customColorN` tokens wholesale (see `design-tokens.md` §4) — that's an incremental cleanup tied to whichever component a given sprint happens to touch, not a rebrand-blocking task.
- Redesigning the token *structure* (introducing a different theming approach, e.g. a full design-tokens-as-JSON pipeline) — out of scope unless a concrete pain point emerges from using this system in practice.
