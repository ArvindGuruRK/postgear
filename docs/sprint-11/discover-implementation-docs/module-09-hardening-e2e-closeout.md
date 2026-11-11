# Module 09: Hardening, E2E And Sprint Close-Out

> **Sprint 11, Discover** | Status: Done with gaps (the full `validate` has timing failures in older tests; see the checklist) | Size: M (one session)
> **Depends on**: Modules 01 to 08
> **Stories**: the section 6 checklist of the user stories
> **Next**: [Module 10](module-10-p2-backlog.md) (parked)

## Goal

Prove the module is safe, honest and complete: a security sweep, every edge case from the stories' section 5 covered by a test, an e2e spec under simulation, performance and accessibility checks, the local testing guide section, and the completion checklist.

## Read First

- User stories: sections 5 and 6 in full.
- Sprint doc: Definition Of Done.
- Research: [`04-legal-limits-and-risks.md`](../research/04-legal-limits-and-risks.md) in full.
- Code: `e2e/seo.spec.ts`, `e2e/ai.spec.ts`, `e2e/helpers/`; `apps/api/src/modules/automations/automations.security.spec.ts` and `automations.routes.spec.ts` (the sweep shape); `docs/sprint-completion-checklists/sprint-10-completion-checklist.md`; `docs/local-testing-guide.md` section 5n; `.claude/skills/sprint-closeout/SKILL.md`.

## Design

### 1. Security Sweep

- `discover.security.spec.ts`: every route answers 401 without a session, members and admins per the table, foreign ids 404; no answer ever contains coordinates, a raw feed body, a page body beyond the reader's own answer, or the YouTube key; private addresses refused on competitors, feed discovery, the reader and resolve-link without any fetch; `WEBHOOK_ALLOW_PRIVATE_URLS=true` changes nothing in Discover.
- A test that greps the engine and the discover module for direct `fetch(` calls outside the one adapter.
- A log sweep: run the hand checks with the log at info and grep for coordinates and query text; none may appear.

### 2. Edge Cases

One test per row of the stories' section 5, placed where the behaviour lives (engine, API or web), listed in the completion checklist with the file and test name.

### 3. E2E

`e2e/discover.spec.ts` under `DISCOVER_SIMULATION=true` and `AI_SIMULATION=true` with `dev:api:e2e`: open Discover, time zone guess, grant geolocation (13.08, 80.27) and Use My Location, see Chennai and Tamil content, switch language, Create Post and Open In Composer, Festivals and Plan A Post, add and remove a competitor, Read a story, deny location and search Paris, reload. Eight to ten tests, each independent.

### 4. Performance

- Feed answer from cache under 50 ms server time; a cold Trending answer under 3 s with the fixture fetch (log the numbers).
- `composeFeed` and `buildBrief` for 100 items under 20 ms.
- The page renders 40 cards without layout shift (images have aspect boxes).

### 5. Accessibility And Look

- Keyboard: tabs, chips, popover, cards, sheets; Escape order.
- Screen reader names: "Discover tabs", group headings, "Create Post for {title}".
- `prefers-reduced-motion` honoured.
- Light, dark, Lilac, phone width; Tamil, Arabic and Japanese sample items (add three fixture items in those scripts) with `dir="auto"`.
- Screenshots `s11-20` onward in `screenshots/`.

### 6. Docs

- `docs/local-testing-guide.md`: section 5o "Discover (Sprint 11)" in the 5n pattern (set up once, what you can test, simulation, the real-feed step with the user's OK, automated checks), plus the section 0 table rows and the section 9 troubleshooting rows (geolocation needs HTTPS or localhost, Nominatim 429, YouTube key).
- `docs/sprint-completion-checklists/sprint-11-completion-checklist.md` through the `sprint-closeout` skill: prerequisites, the area sections, DoD evidence, stories section 6, deviations, known gaps, what remains.
- `.env.example` reviewed for every Discover flag.
- `docs/sprint-documents/README.md` row and `docs/new-modules/README.md` rows already exist from the planning; confirm they read true.

## Scope

**In**: the sweep, edge-case tests, e2e, performance numbers, accessibility, screenshots, the guide section, the checklist.
**Out**: new features; anything in Module 10.

## Tasks

- [x] `discover.security.spec.ts` and the no-direct-fetch test.
- [x] Edge-case tests for every section 5 row; list them. (Checklist section 5. One row is short: no country and region picker with the place finder off.)
- [x] `e2e/discover.spec.ts`; run it; fix what it finds. (10 of 10, three runs; it found the stale workspace place.)
- [x] Performance numbers logged in the Progress notes. (Not measured: layout shift over 40 cards.)
- [x] Accessibility pass and the script samples; screenshots. (`s11-50` to `s11-59`; the keyboard walk and Escape order are unit tested, not walked by hand.)
- [x] Local testing guide 5o, section 0 and section 9 rows.
- [x] Completion checklist with the `sprint-closeout` skill.
- [ ] `npm run validate` green across the repo. (Not green: lint, typecheck and every Discover test pass; 4 tests in `media/image-processor.spec` and `media/media.service.spec` time out, Sprint 9 code. Reported, not fixed.)
- [x] Update the Progress table and the Decision Log; suggest the final commit message.

## Tests

```powershell
npm run validate
npm run dev:api:e2e    # in its own terminal
npm run test:e2e -- e2e/discover.spec.ts
```

Expect `validate` green and the e2e spec passing with every test independent.

## Done When

- Every Definition Of Done line in the sprint doc has evidence in the checklist, marked Verified, In simulation, Partly or Not met honestly.
- Every section 6 story is ticked or listed under Known gaps with the reason.
- No paid call exists anywhere in the sprint's code (grep for the adapters: none).

## Hand Check

Journeys A to D from the user stories, by hand, on the seeded demo workspace under simulation. Then, with Arvind's OK, one real session with `DISCOVER_SIMULATION=false` for Chennai: Trending, News and Festivals from the live feeds, Use My Location through Nominatim once, and back to simulation.

## Handoff

The sprint is closed. Module 10 lists what was left on purpose; nothing in it starts without Arvind's word.
