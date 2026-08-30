# Sprint 0 — Design System Foundation (Neubrutalism + Comic Style)

> **PRD Coverage**: none directly — this is cross-cutting infrastructure every later sprint's UI work depends on, not a feature module of its own.
> **Depends on**: nothing technically (this sprint touches `apps/web` + `packages/ui`; [Sprint 1](sprint-01-foundation-and-data-model.md) touches DB/infra — the two don't block each other). Sequenced first anyway per an explicit product decision (2026-08-29): the design system gets built before any feature screens, so every later sprint consumes finished, reusable components instead of writing one-off styled markup.
> **Reference repo**: `D:\rk-personal-projects\postiz-app-main` — **not applicable here**. Postiz's actual visual design (soft shadows, muted purple, blurred glows — a conventional SaaS look) is close to the opposite of the direction chosen for PostGear. Nothing in this sprint studies Postiz's UI; see "Relationship to the imported tokens" below for what *is* being kept from that import.

## Sprint Goal

Establish a working, documented design system — Neubrutalism with comic-book accents — as reusable components in `packages/ui`, built strictly from design tokens, before any feature sprint writes a single production screen.

## Design Direction: Neubrutalism + Comic-Book Accents

**Core principles:**
- **Hard edges, thick outlines.** Every interactive surface gets a visible border (Tailwind's own `border-2`/`border-4` utilities are sufficient — no custom border-width tokens needed). **Revised 2026-08-30** (post-Task-2 execution, on user feedback comparing against Dribbble references): corners are moderately rounded rather than sharp — `rounded-xl` (12px) on controls (Button, Input, Select, Dropdown-menu, Toast), `rounded-md` (6px) on small ~20px controls (Checkbox, Toggle thumb) so they don't read as near-circular, `rounded-2xl` (16px) on large surfaces (Card, Dialog). This softens the look while keeping the thick border + hard offset shadow language intact — still a single exception for fully-rounded "sticker" shapes on badges/tags/avatars (`rounded-full`), which is unchanged. Original direction was sharp corners (`rounded-none`) by default; superseded by this revision.
- **Flat, saturated color. No gradients, no blur.** This is the biggest departure from what's currently imported — see below.
- **Hard offset shadows that respond to interaction**, not soft ambient ones. A button/card sits above the page with a solid offset shadow (`shadow-brutalMd`, already wired — see "Relationship to the imported tokens"); on press, it translates toward its own shadow and the shadow collapses to nothing (`shadow-brutalPressed`), reading as a physical, tactile push. This is the single most important interaction pattern in the whole system — get it right once on the Button, reuse it everywhere.
- **Bold, chunky typography** for headings/buttons/accents. Keep body/paragraph text in a clean, highly readable face — comic styling belongs in headings and interactive chrome, not in dense paragraph copy or data tables, where it would hurt legibility.
- **Comic accents used deliberately, not everywhere**: halftone-dot textures, speech-bubble shapes (rounded rectangle + a small triangular "tail"), playful micro-copy for empty states and celebrations. These are seasoning, applied to marketing surfaces, onboarding, empty states, and success moments — not sprinkled across every screen.

**Where to apply the full treatment vs. where to restrain it** (the actual craft judgment this sprint needs to encode as a standard, not leave to per-screen improvisation later):

| Surface type | Treatment |
|---|---|
| Buttons, cards, badges, empty states, onboarding, marketing/landing pages | Full comic treatment — thick outlines, hard shadows, press interaction, halftone/speech-bubble accents where they add personality |
| Dense data surfaces: analytics tables, the calendar grid, SEO score breakdowns, the composer's text editing area | Restrained version only — thick borders and flat color stay, but skip halftone textures, tails, and playful copy. Numbers and scannable data need to stay quiet; the loud style goes on the chrome around them, not the data itself |

## Relationship to the Imported Postiz Tokens

[`docs/design-patterns/`](../design-patterns/README.md) already imported Postiz's actual color/shadow system as a starting foundation, on the assumption (recorded in [`rebrand-plan.md`](../design-patterns/rebrand-plan.md)) that PostGear would eventually just swap the accent color values and keep the rest. **That assumption is superseded by this sprint's direction** — brutalism isn't a palette swap, it's a different shadow/color *philosophy* (hard vs. soft, flat vs. blurred). Revisit `rebrand-plan.md` once this sprint's palette is locked; it currently under-scopes the actual rework needed.

What's still worth keeping from that import, unchanged:
- The **light/dark switching mechanism** (`.dark`/`.light` classes toggling CSS custom properties) — pure plumbing, style-agnostic, no reason to rebuild it.
- The **semantic naming convention** (components consume `bg-primary`/`text-forth`-style names, never raw hex) — exactly the discipline this sprint needs too.
- The **platform brand colors** (`bgLinkedin`, `bgYoutube`, etc.) — untouched either way, they represent each target platform's own brand in previews, not PostGear's style.

What's already been added as a starting point for this sprint (done, not just proposed — see `packages/ui/src/styles/colors.css` and `packages/config/tailwind.css`):
- `--color-ink` (theme-aware: near-black in light mode, near-white in dark mode) — the outline/shadow color.
- `--shadow-brutal-sm/md/lg` — hard, unblurred, offset shadows (`2px 2px 0`, `4px 4px 0`, `6px 6px 0`), and `--shadow-brutal-pressed` (collapses to `0 0 0`) for the press interaction.
- Mapped into Tailwind as `shadow-brutalSm`/`shadow-brutalMd`/`shadow-brutalLg`/`shadow-brutalPressed` and `ink` (usable as `border-ink`, `text-ink`, etc.).

**Deliberately not decided yet** — the actual comic accent palette (the bold red/yellow/blue set that replaces Postiz's muted purple `--color-forth`). Don't guess at hex values from a document; prototype first (see Task 1 below).

## Task 1 — Lock the Palette (prototype before committing)

- Pick 2–3 candidate flat, saturated palettes (comic/print-inspired: think bold primary-adjacent red/yellow/blue plus black/white, not pastel or muted tones).
- Prototype each on a real Button component (see Task 2) rather than judging swatches in isolation — a color that looks right in a palette grid often doesn't work at 40px on a chunky bordered button.
- The `design` skill (Claude Design's canvas) is a good fit for this specific step — fast visual iteration on a handful of components before writing production CSS. Optional, but worth considering instead of iterating directly in `apps/web`.
- Once locked, update `packages/ui/src/styles/colors.css`'s `--color-forth`/`--color-seventh`/`--new-btn-primary` (and decide `--new-ai-btn`'s fate — keep a distinct AI-action color or fold it into the new primary) in both `.dark` and `.light` blocks, per the mechanism `rebrand-plan.md` already describes.
- Pick the heading/display typeface here too (bold, condensed, or comic-adjacent — not `Helvetica Neue`, which stays for body text). Add as `--font-display` alongside the existing `--font-sans`.

## Task 2 — Phase A: Primitive Components

Build first — everything else in `packages/ui` depends on these. Each must pass the Definition of Done below before moving to Phase B.

- **Button** (`packages/ui/src/components/button.tsx`, already stubbed) — the reference implementation of the press interaction (`shadow-brutalMd` default → `translate-x-[2px] translate-y-[2px] shadow-brutalPressed` on `:active`). Variants: `primary`, `secondary`, `danger`, `ai` (reuses the distinct AI-action color decided in Task 1). Sizes: `sm`/`md`/`lg`.
- **Badge** (already stubbed) — the "sticker" (`rounded-full`) exception to the sharp-corner rule.
- **Input** (already stubbed) — thick border, flat background, focus state defined once here (see Task 2's accessibility note below) and reused by every form field in every later sprint.
- **Avatar** (already stubbed) — sharp or pill, decide alongside Badge.
- A **Checkbox/Toggle** (not yet stubbed — add it) — needed by Sprint 8's team/RBAC settings and Sprint 6's tone-selector UI.

## Task 3 — Phase B: Compositional Components

- **Card** (not yet stubbed — add it) — the workhorse container. Post cards ([Sprint 4](sprint-04-post-composer-and-media.md)), channel cards ([Sprint 3](sprint-03-social-integrations.md)), SEO score cards ([Sprint 7](sprint-07-analytics-and-seo-engine.md)) all reuse this one component rather than each sprint inventing its own bordered box.
- **Dialog** (already stubbed) — modal chrome, reused for every confirm/edit flow across every sprint.
- **Dropdown-menu**, **Select**, **Toast** (already stubbed) — standard chrome primitives.

## Task 4 — Phase C: App-Shell Chrome

- Navigation/sidebar, top bar, org switcher — built by *composing* Phase A/B components, not by inventing new visual patterns. If a shell component needs something Phase A/B doesn't provide, that's a signal to go back and extend a primitive, not to special-case the shell.

## Definition of Done — Every Component (the enforcement mechanism)

A component isn't done until all of these hold — this is what actually makes "everything reusable and consistent" real, not just a stated goal:

- [ ] Lives in `packages/ui/src/components/`, one file per component, exported from `packages/ui/src/index.ts`.
- [ ] **Built only from tokens** — no hardcoded hex, no magic pixel values in the component's own code. A `variant` prop resolves to token-backed Tailwind classes; nothing is inlined ad hoc per usage site. This is the literal rule that prevents drift — a component that hardcodes a color has already broken the system, regardless of how it looks.
- [ ] Exposes `variant` (and `size`, where relevant) props — no two screens should end up with visually different buttons because someone styled one by hand instead of using a prop.
- [ ] All four interactive states implemented explicitly: default, hover, active/pressed (the comic push), disabled.
- [ ] A single, reused focus-ring treatment — decide it once on the Button/Input in Task 2, don't redecide it per component. (A bright offset outline distinct from the ink border tends to work well against a thick black border — verify in-browser rather than assuming.)
- [ ] Checked in both `.dark` and `.light` — don't assume parity, verify it.
- [ ] Text-on-fill color combinations pass WCAG AA contrast — flat saturated colors can fail this more easily than the muted tones they're replacing; check, don't eyeball.
- [ ] Visible somewhere: add it to a small internal playground route (`apps/web`'s `/dev/components`, excluded from production builds) showing every variant/size/state side by side. Storybook is a reasonable future upgrade once there are enough components to justify the setup cost — not needed to start.

## Sprint 0 Definition of Done

- [ ] Palette locked (Task 1) and applied to `colors.css`.
- [ ] All Phase A primitives (Task 2) built, passing the component DoD, visible in the playground route.
- [ ] All Phase B compositional components (Task 3) built, passing the component DoD.
- [ ] `docs/design-patterns/rebrand-plan.md` updated (or explicitly superseded) to reflect the actual palette decision made here, instead of the earlier "just swap the accent" assumption.
- [ ] At least one full screen (a good candidate: the login/register pages [Sprint 2](sprint-02-auth-and-organizations.md) needs anyway) built entirely from `packages/ui` components, with zero one-off styled markup, as a smoke test that the system actually holds together end to end.

## Open Decisions (deliberately left for execution, not pre-decided here)

- The exact comic color palette (Task 1 — prototype first).
- Whether `--color-ink` stays fixed-tone-per-theme (current placeholder: near-black in light, near-white in dark) or something else entirely.
- The display/heading typeface.
- Whether the AI-action accent (`--new-ai-btn` today) stays visually distinct from the primary action color, or gets folded in.
- Storybook now vs. later (recommendation: later).
