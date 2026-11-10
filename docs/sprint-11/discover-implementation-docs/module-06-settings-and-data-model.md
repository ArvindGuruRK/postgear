# Module 06: Settings And Data Model

> **Sprint 11, Discover** | Status: Not started | Size: M (one session)
> **Depends on**: [Module 03](module-03-discover-page-and-location.md)
> **Stories**: DC-1.6, DC-3.2
> **Next**: [Module 07](module-07-competitors.md)

## Goal

A workspace admin saves a default place, languages, news topics and source switches; members start from it on any device; the settings section exists. The first migration of the sprint.

## Read First

- Sprint doc: Database, API Routes (settings), Screens (Settings Section).
- User stories: DC-1.6, DC-3.2, Journey C; section 5 (member tries to save).
- Code: `packages/db/prisma/schema.prisma` (Organization relations, the Sprint 10 additions as a style guide), `packages/db/prisma/SCHEMA_NOTES.md`, `.claude/skills/prisma-change/SKILL.md`, `apps/api/src/modules/dashboard/` (`PATCH /dashboard/goal`, the one workspace-level setting today), `apps/web/src/components/settings/settings-shell.tsx` (`SECTIONS`), `apps/web/src/app/(dashboard)/[orgId]/settings/notifications/page.tsx` and `components/notifications/notification-preferences.tsx` (the form pattern: optimistic save, toast, danger alert with Try Again), `apps/api/src/common/pipes/zod-validation.pipe.ts`.

## Design

### 1. Schema

Exactly the `DiscoverSettings` model and `DiscoverLocationSource` enum from the sprint doc (no `Competitor` yet; that is Module 07's migration, so each module owns one migration). Back-relations on `Organization` and `User` under a "Sprint 11" comment. Migration `2026MMDDHHMMSS_sprint11_discover_settings`, additive. `SCHEMA_NOTES.md` gains "Sprint 11 additions": what the row holds, why there are no coordinates, why it is 1:1 with the org id as the key, and the note that the old Postiz `Trending` tables stay dropped.

### 2. API

- `settings.service.ts` and `settings.repository.ts` in the discover module.
- `GET /discover/settings` (members): the row or `{ settings: { countryCode: null, ... , languages: [], topics: [], sources: null, locationSource: 'NONE' } }` when none.
- `PATCH /discover/settings` (admins, `@Roles(Role.ADMIN)`): body is any subset of `{ countryCode, regionCode, regionName, city, timeZone, languages, topics, sources, locationSource }` with `.strict()`; `countryCode` must be two upper-case letters or null; `regionCode` must start with the country code; `languages` at most 6 BCP-47 codes; `topics` from the fixed Google News topic list; `sources` an object of known source ids to booleans; `timeZone` validated with the dashboard's `tz` rule. Upsert; sets `updatedById`. Members get 403 with "Only workspace admins can change the workspace place."
- `feed()` honours `sources` switches when the request carries `?useWorkspaceSources=1` (the page sends it): a switched-off group is left out of the fan-out (no upstream call) and listed in `hidden`, not `unavailable`.

### 3. Web

- `use-place.ts`: on mount, with no remembered choice, read `/discover/settings` (fetched by the server page and passed down) and start from the workspace place with `source: 'workspace'`; the chip shows the Workspace badge. A remembered choice still wins on that device.
- Place popover: for admins, **Save For This Workspace** (secondary) and the line "Workspace default: {City}" (or "No workspace default yet."); for members the button is disabled with the tooltip from the stories. Saving sends the current place and languages with `locationSource` = `BROWSER` or `SEARCH` (or `TIMEZONE` for a guess), then toasts "Saved".
- News tab: the **Topic** select (DC-3.2); the workspace's `topics` set the default; the choice is remembered with the place.
- `settings/discover`: a section in `SECTIONS` (animated compass icon) and a page with cards: Workspace Place (the same popover controls inline, plus "Clear"), Languages (ordered chips with up and down, from the place's list plus English), News Topics (checkboxes), Sources (switches: Rising Searches, Wikipedia, Worldwide Social, Videos, Festivals). Optimistic save per card, toast, danger alert with Try Again on failure. Members see the page read-only with a sentence at the top.

## Scope

**In**: the model and migration, the two routes, the switches in the feed, the popover additions, the topic select, the settings section, tests.
**Out**: competitors (07), per-user saved place (P2).

## Tasks

- [ ] Schema, migration, `db:generate`, SCHEMA_NOTES (use `prisma-change`).
- [ ] Repository and service with specs (upsert, member 403, validation refusals, unknown source id refused, feed leaves a switched-off group out without an upstream call).
- [ ] Controller routes; `discover.routes.spec.ts` updated.
- [ ] `use-place` workspace default; popover Save For This Workspace; tests (member disabled, admin saves and the badge appears, remembered choice wins on this device).
- [ ] Topic select on News with tests.
- [ ] Settings section and page with tests (read-only for members).
- [ ] Seed: `seed-demo-org` gets Chennai, `['ta', 'en']`, topics `['BUSINESS']` so the demo starts in the right place; PostGear Second Org gets nothing.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config apps/api/jest.config.js apps/api/src/modules/discover
npx jest --config apps/web/jest.config.js apps/web/src/components/discover apps/web/src/components/settings
```

## Done When

- `PATCH /discover/settings` as admin saves Chennai; as member answers 403 with the sentence.
- A fresh browser (cleared storage) opens Discover on Chennai with the Workspace badge; after Use My Location it switches to the browser's place and the default is unchanged.
- Turning off Worldwide Social in Settings hides that group for every member and no Bluesky or Mastodon fetch happens for that workspace's requests.
- The News topic default follows the saved topics.

## Hand Check

1. As the demo admin: chip popover, Save For This Workspace; Settings, Discover shows Chennai, Tamil then English.
2. As the member: the popover button is disabled with the tooltip; the Settings page is read-only.
3. Clear site data, reload Discover: Chennai with the Workspace badge.
4. Turn Videos off in Settings; the Videos tab says it is turned off for this workspace (an `EmptyState` sentence, not the "not set up" one).

## Handoff

Module 07 adds `Competitor` with its own migration and the competitors routes next to these.
