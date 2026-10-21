# PostGear UI rules (checklist)

The short form of `docs/design-patterns/design-system-rules.md` plus the user's standing decisions. When this file and the rules doc disagree, the newer user decision here wins; say so if you notice it.

## Look

- Neobrutalist: 2px `border-outline` borders, hard unblurred diagonal shadows, chunky icons, stickers. Not the faded flat look of the reference apps.
- Shadows by role (rules doc section 6): things you press use `shadow-brutalSm/Md/Lg`; boxes that hold content or take input use `shadow-surfaceSm/Md/Lg`. Tables and file drop zones get none.
- **No shadow on a selected segment** (the active option inside a segmented control or tab strip). The container may have one; the chosen segment does not.
- Never inline a hex or pixel value. New needs extend `packages/ui/src/styles/colors.css` and `packages/config/tailwind.css` (rules doc section 17).

## Colour and themes

- Surfaces: `bg-primary` is the page ground only, `bg-secondary` is every card, field, menu and dialog, `border-outline` is the one border and shadow colour, `text-ink` is the one text and icon colour. `bg-primary` inside a `bg-secondary` surface is a bug.
- Buttons (2026-10-21): `primary` (blue) for the one main action per area, `secondary` (neutral card surface) for everything else, `danger` (solid red) for every delete, including the button that opens the confirm, `ai` (violet) for asking the AI, at most one per area. No yellow buttons. Rules doc section 7.
- Fills: `actionPrimary` (blue), `actionSecondary` (yellow), `actionDanger`, `actionAi` (violet), `actionAccent` (orange), `actionSuccess`. Text on a fill is `text-onActionPrimary` for primary, `text-onActionLight` for the rest.
- There are 12 light and 12 dark themes (`design-tokens.md` section 2a). A theme only changes base tokens, so a page built from tokens works in all 24 for free. Never write `dark:` classes and never style off `data-light-theme` / `data-dark-theme`. If something looks wrong in one theme, fix the token in that theme's block.
- Check new work in at least Classic light and Classic dark.

## Type

- One font, Sora, loaded in `apps/web/src/app/fonts.ts`. Hierarchy comes from role utilities defined in `apps/web/src/app/globals.css`:
  - `type-heading`: card, dialog and sheet titles, big numbers. Or the `<Heading>` component.
  - `type-ui`: things you act on or scan (buttons, tabs, nav, names). Sentence case.
  - `type-label`: small uppercase chrome (menu group labels). **Not** for a page section's name.
  - Body text, form controls and table content: plain text, or `<Text>` (default weight medium).
- Section names inside a page: sentence case, as typed ("First steps"), `type-heading text-lg`. Never all caps (2026-10-22).
- Muted text is `text-ink type-muted` (no role) or `text-ink muted-tone` (already has a role or weight). Never a raw `opacity-60/70/75/80` on text. Rules doc section 1.
- Never hand-write weight or tracking (`font-semibold tracking-tight`) to fake a role, and never stack them on a role. Retune the `--type-*` token instead.
- Form labels: `font-sans text-sm font-bold text-ink`, sentence case, no role (rules doc section 1).

## Icons

- **Clickable icons are animated**: `MotionIcon` from `@postgear/ui` wrapping an icon imported from its own file, for example `import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon'` then `<MotionIcon icon={Trash2Icon} className="h-4 w-4" />`. Import per-icon subpaths, never the barrel. See `components/ai/copilot-chat.tsx`.
- Decorative icons, state ticks and preview bars stay plain `lucide-react`.
- Size explicitly (`h-4 w-4` next to text), `strokeWidth={2.5}` (3 for small indicators). Rules doc section 13.

## Copy

- Input placeholders read "Enter your ..." ("Enter your email"), never sample values like "Acme Media" or "you@company.com".
- Never write an em dash or a middle dot anywhere (a project hook blocks both). Separate with a comma, parentheses or plain words: "Generate (5 credits)", "Published 2h ago to 3 channels".
- Sentence case for buttons and labels. Short, plain words.

## Do not

- Repeat the page title, add a tagline, add a divider, or add a rule under the top bar.
- Add decorative status pills or badges that say nothing new.
- Widen the sidebar rail.
- Paste Postiz code (AGPL). Rebuild layouts from `docs/screenshots/`.
- Run Playwright or take screenshots for a small tweak. Tell the user what to check instead.
