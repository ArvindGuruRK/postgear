---
name: new-page
description: Add or rework a PostGear dashboard page, screen or UI component in apps/web or packages/ui, following the design system and the user's UI rules. Use for "add a page", "new screen", "build the X view", "new component", "redesign Y", "move Z into settings", or any change to how a screen looks or is laid out.
---

# New page or UI component

A recipe for screens in `apps/web` and components in `packages/ui`. Project basics are in the root `CLAUDE.md`; read it first if you have not. Before writing any Next.js code, read `apps/web/AGENTS.md`: this is Next 16 and its APIs differ from training data (docs in `node_modules/next/dist/docs/` at the repo root, because npm hoists `next` there).

## 1. Decide where it goes

- **A workspace page** lives at `apps/web/src/app/(dashboard)/[orgId]/<segment>/page.tsx`. Two layouts above it already gate access: `(dashboard)/layout.tsx` (signed in) and `[orgId]/layout.tsx` (onboarded, member of this org, renders `DashboardShell`). Never re-check auth in the page.
- **A settings section** lives at `[orgId]/settings/<segment>/page.tsx` and is wrapped by `settings/layout.tsx` -> `components/settings/settings-shell.tsx`.
- **A modal over the current page** uses the `@modal` parallel slot in `[orgId]/`. The composer is the only one today: `@modal/(.)composer/page.tsx` intercepts in-app navigation, `[orgId]/composer/page.tsx` handles a hard load, and `@modal/default.tsx` plus `@modal/[...catchAll]/page.tsx` render `null` so the modal closes on any other navigation. Copy that trio if you add another.
- **Pre-auth screens** live in `app/(auth)/`, onboarding in `(dashboard)/onboarding/`.

## 2. The page file (server component)

Keep `page.tsx` thin: fetch the first data on the server, then hand it to one client island in `apps/web/src/components/<area>/`. Good examples: `[orgId]/media/page.tsx` (one fetch) and `[orgId]/queue/page.tsx` (parallel fetches plus search params).

- Read params as promises: `({ params }: PageProps<'/[orgId]/media'>)` then `const { orgId } = await params;`. Layouts use `LayoutProps<...>`.
- Export `metadata: Metadata = { title: '...' }` for the browser tab.
- Server fetches: `const cookie = await getSessionCookieHeader()` (from `@/lib/session`), then `serverApi<T>('/path', { cookie })` (from `@/lib/api`). Forgetting the cookie makes the API see an anonymous caller.
- A failed first load is passed down as `null` (`.catch(() => null)`) so the island can show its own retry state, not thrown into an error page.
- Response types live in `apps/web/src/types/<area>.ts`; add yours there.
- Session data for client code comes from `WorkspaceProvider` (`components/navigation/workspace-provider.tsx`), set up in `[orgId]/layout.tsx`.

## 3. Client components

- Put `'use client'` only on the island that needs state, effects or browser APIs. Keep layouts and pages server components.
- Browser calls use `api<T>('/path', { ... })` from `@/lib/api` (cookies travel with `credentials: 'include'`). Streams (AI, SEO) use `@/lib/sse.ts`. Never call `fetch` to the API directly.
- Put non-trivial display logic in a pure `<area>-view-model.ts` next to the component with a `.test.ts` beside it (see `webhooks/webhooks-view-model.ts`, `seo/seo-view-model.ts`, `settings/team-view-model.ts`). That is where copy, labels and formatting get unit tests.

## 4. Navigation and the top bar

All of it is in `apps/web/src/components/navigation/dashboard-shell.tsx`:

- `RAIL` is the sidebar list (segment, short label, animated icon). Add an entry only if the page deserves a rail slot; Composer and Channels are deliberately not on it.
- `TITLES` maps the URL segment to the top bar's `h1`. **Every new top-level segment needs a `TITLES` entry**, or the bar says "Dashboard".
- `FULL_BLEED` is for pages that size their own blocks to the viewport (only the calendar today). Everything else scrolls as one region.
- The same items become the phone tab bar (`TabBar` in `sidebar.tsx`) below `md`, so a new rail entry shows up there too.
- A new settings section is one line in `SECTIONS` in `settings-shell.tsx`.
- Do not widen the sidebar rail.

## 5. Page layout rules

- **No in-page title.** The top bar names the page and the rail marks it active. No page heading, no tagline, no divider under it, no rule under the top bar. `PageHeader` was deleted on purpose; do not recreate it.
- A page opens with a `PageActions` row from `@postgear/ui` (right-aligned buttons such as "New post"), or nothing when there is nothing to act on. Then the content. Section headings inside the page (`SectionHeader`, card titles) are fine.
- No decorative status pills, no filler copy, no repeated labels.
- Phone first: the shell gives `px-4` on phones and `md:px-3` above. Use mobile-first `sm:`/`md:`/`lg:` for layout; the page must never scroll sideways (tables scroll inside their own `overflow-x-auto`). See section 11 of the rules doc for the inherited max-width variants.

## 6. Styling rules

The rulebook is `docs/design-patterns/design-system-rules.md` (how components consume tokens) and `docs/design-patterns/design-tokens.md` (the token catalog). Read the sections that match what you build. The short version, plus the user's standing rules, is in [ui-rules.md](ui-rules.md). Read it before writing JSX.

## 7. Components: packages/ui or apps/web?

- **`packages/ui/src/components/`**: generic, data-agnostic pieces another screen could reuse (buttons, cards, meters, nav primitives). Export it from `packages/ui/src/index.ts`, and add a specimen to the `/dev/components` playground: pick the matching file in `apps/web/src/app/dev/components/sections/` and use `Section` / `Row` / `Spec` from `../shared`. A new section file also gets imported and rendered in `components-showcase.tsx`.
- **`apps/web/src/components/<area>/`**: anything that knows about PostGear data, the API or a route.
- Before building, check the ~80 existing components in `packages/ui/src/components/` (there is already `PageActions`, `SectionHeader`, `StatCard`, `StateDisplay`, `ViewSwitcher`, `FilterBar`, `DataTable`, `UsageMeter`, `SettingsNav`, and more). Extend one rather than adding a near-duplicate.

## 8. Reference layouts

Layout and flow copy Postiz (calendar, composer, media, AI) and Buffer (home, connect, onboarding); screenshots are in `docs/screenshots/` (see its README). Copy where things sit and how the flow goes, not their faded styling: PostGear's look is neobrutalist. Postiz is AGPL, so never paste its code; rebuild from the screenshot.

## 9. Tests

- Unit: `npm test --workspace=@postgear/web -- <file-name>` for view models; `npm run typecheck --workspace=@postgear/web` and `npm run lint --workspace=@postgear/web` before calling it done. Touched `packages/ui` too? Run the same for `@postgear/ui`.
- E2E (Playwright, `e2e/*.spec.ts`): only for a new page or a real flow change. Follow `e2e/media.spec.ts`: sign in as `demo@postgear.local` / `DemoPassword123!`, go to `/seed-demo-org/<segment>`, find things by role and name, clean up what the test created. Running it needs the API started with `npm run dev:api:e2e`.
- **Small UI tweaks: skip Playwright and screenshots.** The user checks those by hand.

## 10. Finish

End every UI change by telling the user exactly what to check by hand: which page, in light and dark mode, on a phone width, and the specific states (empty, loading, error) you touched.
