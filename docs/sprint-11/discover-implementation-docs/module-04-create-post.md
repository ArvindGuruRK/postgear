# Module 04: Create Post

> **Sprint 11, Discover** | Status: Not started | Size: M (one session)
> **Depends on**: [Module 03](module-03-discover-page-and-location.md)
> **Stories**: DC-4.1, 4.2, 4.3, 4.4, 4.5
> **Next**: [Module 05](module-05-more-sources.md), [Module 08](module-08-website-reader.md)

## Goal

**Demo 2.** Create Post on any card opens a sheet, the AI drafts in the chosen language for the chosen channels through the existing generate pipeline, credits are charged honestly, and Open In Composer lands the draft in the composer. No new AI endpoint; one new field.

## Read First

- [`00-ux-blueprint.md`](00-ux-blueprint.md) section 5, and section 11 (the design system map, "Sheets").
- Sprint doc: AI Changes, Screens (Create Post Sheet).
- User stories: DC-4.x, Journey A steps 5 and 6, section 5 (credits rows).
- Code: `apps/api/src/modules/ai/dto/ai.schema.ts` (`generateSchema`, `cleanText`), `apps/api/src/modules/ai/ai.service.ts` (`prepareGenerate`, charge and refund), `apps/api/src/modules/ai/engine/engine.factory.ts` (`createPipeline` options, `withResearchCache`), `packages/ai-engine/src/types.ts` (`GenerateRequest`, `ResearchProvider`, `ResearchSource`), `packages/ai-engine/src/prompts/content.ts` and `hook.ts` (`field`, `block`), `packages/ai-engine/src/agents/content.agent.ts` (the research stage), `packages/ai-engine/src/model/simulated-model-client.ts` (`simulateStructured`), `apps/web/src/components/ai/generate-state.ts`, `generate-panel.tsx`, `generate-progress.tsx`, `generate-result.tsx` (`openInComposer`), `use-credits.ts`, `credits-meter.tsx`, `ai-unavailable.tsx`, `apps/web/src/lib/sse.ts`, `apps/web/src/lib/composer-data.ts` (`at`).

## Design

### 1. AI Stack Changes

- `generateSchema`: add `language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).max(16).optional()`, `sources: z.array(z.object({ title, url, snippet })).max(6).optional()`, `publishAt: z.string().datetime().optional()` (echoed back in the `done` event so the web can hand it to the composer; the API does not schedule anything). Keep `.strict()`.
- `GenerateRequest.language?: string` in `packages/ai-engine/src/types.ts` and the web mirror in `types/ai.ts`.
- `buildContentPrompt` and `buildHookPrompt`: when `language` is set, add `field('Language', 'Write in <name>. Keep brand names, product names and hashtags as they are. Do not translate the brand voice notes.')`, with the language name from a small table (`ta` Tamil, `hi` Hindi, `fr` French, ...; fall back to the code).
- `simulateStructured` needs no new branch (unknown fields are ignored), but the simulated content client should echo "(written in <language>)" into the first part when the field is present, so the hand check can see it. Add that in the simulated client where it builds the content answer.
- `createPipeline(context, { research, researchProvider? })`: when `researchProvider` is given it replaces the Tavily or simulated provider for that run. `AiService.prepareGenerate` builds a provider from `dto.sources` when present: `search()` returns those sources unchanged (`name: 'discover-headlines'`). So "Backed By Research" shows the item's related headlines, `researched` is true, and no Tavily call happens. When `sources` is absent, behaviour is unchanged.
- Credits: `generate_post` as before, including the refund on failure. No change in `credits.policy.ts`.

### 2. The Sheet (`components/discover/create-post-sheet.tsx`)

- Opened with `{ item, locality, language }` from any card's Create Post (or Plan A Post in Module 05).
- Form: the brief preview (`bg-inset`, 5 lines with Show More), **Language** (`Select` over `locality.languages` plus `en`, default the language chip's value), **Channels** (reuse the AI page's channel picker, loaded from `/channels` the way `ai-copilot/page.tsx` does; when the view does not have channels yet, fetch them once on first open), **Tone** and **Format** (`ChoiceTiles`, defaults Personal and One Short), **Image** switch (adds 10 credits; off by default), the credits meter (`use-credits.ts`), **Draft With AI** (`Button variant="highlight"`).
- Submit: `streamEvents('/ai/generate', { topic: item.brief, tone, format, withImage, channelIds, language, sources: item.related?.slice(0, 6).map(...), publishAt })` through `generate-state.ts`'s reducer (reuse, do not fork). Progress and result views are the existing components; `GenerateResult` gains an optional `publishAt` prop used by `openInComposer` for the draft's `publishDate` (default stays the next full hour).
- Out of credits: the existing `AiUnavailable` or out-of-credits alert; Draft With AI disabled.
- Close without opening the composer: nothing persists (the draft is only created by Open In Composer, as today).
- The card's overflow menu gets **Draft In Copilot** (`/${orgId}/ai-copilot?topic=<brief>`), DC-4.5.

### 3. Briefs

`item.brief` already comes from the API (Module 01's `buildBrief`). For the sheet, the preview shows it verbatim. Competitor briefs (Module 07) and reader briefs (Module 08) use the same field.

## Scope

**In**: the three schema fields, the prompt field, the research seam, the simulated echo, the sheet, `publishAt` in `GenerateResult`, Draft In Copilot, tests.
**Out**: any new endpoint; the reader (08); festival rows (05, which only call this sheet with `publishAt`).

## Tasks

- [ ] `generateSchema` and `GenerateRequest` changes with spec updates (`ai.schema.spec`, `ai.service.spec`: `language` passes through; `sources` becomes the research result; absent fields change nothing).
- [ ] Prompt field and language-name table in `ai-engine`, with prompt tests.
- [ ] Simulated client echo.
- [ ] `createPipeline` `researchProvider` option and the `AiService` wiring, with a spec that proves Tavily is not called when `sources` is present.
- [ ] `CreatePostSheet` and wiring on `TrendCard` and `StoryCard`; `GenerateResult.publishAt`.
- [ ] Draft In Copilot menu item.
- [ ] Web tests: the sheet submits the right body (brief as topic, language, sources, channels), disabled when out of credits, Open In Composer navigates with `group`, `publishAt` reaches the draft's `publishDate`.
- [ ] Playwright once under both simulations: Create Post from a Chennai trend in Tamil for one channel, see "(written in ta)" in the result, Open In Composer, see the draft in the composer. Screenshots `s11-07` to `s11-09`.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config apps/api/jest.config.js apps/api/src/modules/ai
npx jest --config packages/ai-engine/jest.config.js
npx jest --config apps/web/jest.config.js apps/web/src/components/discover apps/web/src/components/ai
```

## Done When

- `POST /ai/generate` accepts `language`, `sources` and `publishAt`; refuses unknown fields; charges 5 and refunds on failure as before.
- The sheet drafts from a trend in Tamil with Backed By Research listing the related headlines, and Open In Composer opens the composer with the draft and the picked channels.
- Out of credits disables Draft With AI with the reset date shown.
- Draft In Copilot prefills the AI page's topic.

## Hand Check

With `DISCOVER_SIMULATION=true`, `AI_SIMULATION=true`:

1. Discover, Chennai, Trending, Create Post on the first card. The sheet shows the brief, Tamil selected, your channels.
2. Draft With AI. Progress runs; the result's first part contains "(written in ta)"; Backed By Research lists the related headlines.
3. Open In Composer: the composer opens with the text and the channel; the credits meter on the AI page shows 5 fewer.
4. Use a workspace with 0 credits (set the ledger with a seed or a quick SQL insert): the sheet says the reset date and the button is disabled.

## Handoff

Module 05's Plan A Post opens this sheet with `publishAt` set to the festival date. Module 08's Create Post From This opens it with the reader excerpt as the brief.
