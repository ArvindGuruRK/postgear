# Module 03: The Discover Page And The Place Flow

> **Sprint 11, Discover** | Status: Done (2026-11-10, committed and pushed on `sprint-11-discover`, awaiting the hand check) | Size: XL (one session)
> **Depends on**: [Module 02](module-02-api-locality-feed-and-cache.md)
> **Stories**: DC-1.1, 1.2, 1.3, 1.4, 1.5, 1.7, DC-2.1, DC-2.4, DC-3.1
> **Next**: [Module 04](module-04-create-post.md) (Create Post), [Module 05](module-05-more-sources.md), [Module 06](module-06-settings-and-data-model.md)

## Goal

**Demo 1.** A user opens Discover from the rail, sees country-level Trending from their time zone, presses Use My Location (or searches a city), and gets Tamil Nadu trends and Chennai stories in Tamil, with the choice remembered. Cards have Open; Create Post is a disabled placeholder until Module 04.

## Read First

- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 2, 3, 4, 7, 8, 9, 10, and **section 11, the design system map**: which component each piece is, and the open question on Create Post.
- Sprint doc: Screens, Names And Placement.
- User stories: Journeys A and D; DC-1.x, DC-2.1, DC-2.4, DC-3.1; section 5.
- Research: [`03-location-and-language.md`](../research/03-location-and-language.md) section 2 (the browser flow) and section 8 (fonts and direction).
- Code: `apps/web/AGENTS.md` and `apps/web/node_modules/next/dist/docs/` (Next 16 page props, `await searchParams`); `apps/web/src/app/(dashboard)/[orgId]/seo-analyzer/page.tsx` (server page shape); `apps/web/src/components/analytics/analytics-view.tsx` and `analytics-ui.tsx` (`AnalyticsPanel`, `PanelHeader`, skeleton, `useMounted`); `apps/web/src/components/navigation/dashboard-shell.tsx` (`RAIL`, `TITLES`); `apps/web/src/components/home/home-model.ts` (`viewerTimeZone`); `apps/web/src/lib/api.ts`; `apps/web/src/lib/workflows-api.ts` and `apps/web/src/types/workflows.ts` (shapes to copy); `apps/web/src/lib/title-case.test.ts`; `apps/web/src/app/dev/components/`; `.claude/skills/new-page/SKILL.md` and `ui-rules.md`.

## Design

### 1. Navigation

- `RAIL`: add `{ segment: 'discover', label: 'Discover', icon: CompassIcon }` after Workflows (import `compass-icon` from `@animateicons/react/lucide/`). `TITLES.discover = 'Discover'`. Update the comment that lists which items reach the phone tab bar.

### 2. Route And Data

- `apps/web/src/app/(dashboard)/[orgId]/discover/page.tsx`: a server page with typed `PageProps`, `await searchParams` for `tab`; fetches `/discover/status` with `serverApi` (`.catch(() => null)`); renders `<DiscoverView orgId status initialTab />`. The feed is fetched by the island, not the server, because the place lives in the browser.
- `apps/web/src/types/discover.ts`: mirrors `Locality`, `DiscoverItem`, `DiscoverGroup`, `FeedResponse`, `DiscoverStatus`, `LocalityResponse` from Module 02's answers (hand-mirrored, like `types/ai.ts`).
- `apps/web/src/lib/discover-api.ts`: `getStatus`, `localityFromPosition(lat, lng)`, `localityFromTimeZone(tz)`, `searchPlaces(q)`, `getFeed(kind, place, language, topic?)`, each through `api()` and typed; coordinates rounded to two decimals **here**, in one function, with a test.

### 3. Place State (`components/discover/use-place.ts`)

A hook that owns `{ locality, language, source: 'guess' | 'browser' | 'search' | 'worldwide' | 'workspace', status: 'idle' | 'resolving' | 'denied' | 'unavailable' }`:

- On mount: read `localStorage['pg:discover:<orgId>']` (wrapped in try and catch); if absent, call `localityFromTimeZone(viewerTimeZone())` and mark it `guess`.
- `useMyLocation()`: check `navigator.permissions.query({ name: 'geolocation' })` when available; if `denied`, set `denied` without prompting; else `getCurrentPosition` with `{ enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }`, then `localityFromPosition` (rounded), then set `browser`. Errors map to `denied` or `unavailable`.
- `pickPlace(locality)` from search, `pickWorldwide()`, `setLanguage(code)`; every change writes `localStorage` and resets the language to the place's first language on a place change.
- Module 06 adds the workspace default as the starting point.

### 4. The View (`components/discover/discover-view.tsx`)

- `Stack gap="lg"`: `PageActions` (justify-between) with `PlaceChip`, `LanguageChip`, the updated time (`type-muted`, computed from the oldest group shown), a secondary Refresh (`MotionIcon` refresh), the Simulated sticker when `status.simulation`; the attribution line under the chips.
- `Tabs` with the five tabs; Videos, Festivals and Competitors render "Arrives in a later step of this sprint." in an `EmptyState` until their modules land (Title Case tab names, sentence-case message).
- `useFeed(kind, place, language)`: fetches on change with a request-sequence guard (copy `use-analytics.ts`), keeps the last good answer while loading the next, exposes `{ groups, unavailable, loading, error, refresh }`. Refresh refetches; the API's own cache decides whether that is upstream.
- `TrendingTab` and `NewsTab`: map groups to `DiscoverGroup` panels (`AnalyticsPanel` and `PanelHeader` with the sub-line, the stale note appended when `stale`), items to `TrendCard` or `StoryCard` (blueprint section 4) in the card grid. Related headlines link out. Images: `<img loading="lazy" referrerPolicy="no-referrer" onError={hide}>`. Item text gets `dir="auto"`.
- Empty and error states per blueprint section 7; the skeleton (`DiscoverSkeleton`) takes the footprint of one group of four cards and one of five rows, `aria-busy`.
- Create Post on cards: a primary button that is present but disabled with the tooltip "Arrives in the next step of this sprint." (removed in Module 04). Read: hidden until Module 08. Open: a real link styled as a secondary button, external, opens `item.url ?? item.opaqueUrl` in a new tab with `rel="noopener noreferrer"`.

### 5. The Place Chip And Popover (`components/discover/place-chip.tsx`, `place-popover.tsx`)

As drawn in blueprint section 3: `Popover` from the design system (no shadow on the trigger), Use My Location (secondary `Button` with the pin `MotionIcon`), the consent sentence, the search field (`Input`, placeholder "Enter your city", submit on Enter or the Search button only; never a request on keystroke), the results list (keyboard navigable, Enter picks), Worldwide (secondary), the attribution. Denied and unavailable replace the consent sentence with an `Alert variant="warning"` carrying the exact sentences from the stories, and focus the field. The chip text and badges per the blueprint's state table. Admin-only controls arrive in Module 06.

### 6. The Language Chip (`components/discover/language-chip.tsx`)

A `Select` styled as a chip: the place's languages that have a News edition (the API's `locality.newsLanguages`; the full `locality.languages` is kept for the sheet in Module 04), each shown as native name then English name (a small `languageNames.ts` table for the 40 edition languages, plus `Intl.DisplayNames` as the fallback).

### 7. Playground And Tests

- `/dev/components`: a "Discover" section with `TrendCard`, `StoryCard`, `PlaceChip` in its states, and the `DiscoverSkeleton`.
- Web tests (React Testing Library, like `components/workflows`): `use-place` (guess on first mount, localStorage round trip, denied without prompt when the permission is `denied`, rounding), `place-popover` (search only on Enter, denied alert text, results pick), `discover-view` (groups render, stale note, `unavailable` hides a group, empty tab state, Open link target), `discover-api` (rounding).
- `title-case.test.ts` passes with the new names (add exceptions with reasons only if truly needed).

## Scope

**In**: rail entry, the page, types and client, place state and the popover, the language chip, Trending and News tabs with cards, states, playground demos, tests.
**Out**: Create Post (04), Videos, Festivals, Wikipedia and social groups (05), workspace default and settings (06), Competitors (07), Read (08).

## Tasks

- [x] Rail entry and title; the route and server page.
- [x] `types/discover.ts` and `lib/discover-api.ts` with the rounding test.
- [x] `use-place.ts` (guess, remember, browser flow, search, worldwide, language) with tests.
- [x] `PlaceChip`, `PlacePopover`, `LanguageChip`.
- [x] `useFeed`, `DiscoverView`, `DiscoverGroup`, `TrendCard`, `StoryCard`, `DiscoverSkeleton`, states.
- [x] Playground section; title-case test green.
- [x] Playwright once, under `DISCOVER_SIMULATION=true`: grant geolocation (13.08, 80.27), open Discover, Use My Location, see Chennai and Tamil trends and stories; deny and see the alert; search "paris" and pick it; reload and see Paris kept. Screenshots `s11-01` to `s11-06` in `screenshots/` (light, dark, Lilac, phone).
- [x] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config apps/web/jest.config.js apps/web/src/components/discover apps/web/src/lib/discover-api
npx jest --config apps/web/jest.config.js apps/web/src/lib/title-case
```

## Done When

- Discover is in the rail; the top bar says Discover; `/[orgId]/discover` renders with the chips and tabs and no in-page title.
- First visit shows "India, from your time zone" and India-level trending (under simulation, the fixture answers).
- Use My Location in a browser with permission granted shows Chennai and Tamil content; denied shows the sentence and focuses the field; a search on Enter works and nothing is requested while typing.
- A reload keeps the place and language; switching workspaces switches them.
- A resting source shows the stale note or hides the group; an empty tab shows Try Again; the API being down shows the error state.
- Light, dark, Lilac and phone width look right; Tamil headlines render and `dir="auto"` is present.

## Hand Check

With `DISCOVER_SIMULATION=true`, `AI_SIMULATION=true` and the demo admin:

1. Open Discover. Chip says India from your time zone; Trending has cards.
2. Click the chip, Use My Location, allow. Chip says Chennai, Tamil Nadu; language chip says தமிழ் Tamil; cards are Tamil Nadu trends with related headlines; News shows Chennai stories in Tamil.
3. Switch the language chip to English; News reloads in English.
4. Deny location in the browser settings, click Use My Location: the warning sentence shows and the field is focused. Type "paris", press Enter, pick Paris. Reload: Paris is kept.
5. Phone width: tabs scroll, chips collapse, cards stack.

## Handoff

Module 04 replaces the disabled Create Post with the sheet and needs `item.brief`, `locality.languages` (full list) and the language chip's value. Module 05 adds groups and tabs to the same view. Module 06 feeds `use-place` the workspace default.
