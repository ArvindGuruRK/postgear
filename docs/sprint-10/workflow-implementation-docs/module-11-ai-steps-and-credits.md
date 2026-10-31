# Module 11: AI Steps And Credits

> **Sprint 10, Workflow Builder** | Status: Done (2026-10-31) | Size: M (one session)
> **Depends on**: [Module 09](module-09-triggers-activation-versions.md), and [Module 10](module-10-postgear-and-social-steps.md) for the internal step gateway and `MediaRef`
> **Stories**: WF-9.1 (P0), WF-9.2 (P1), WF-9.3 (P0), Journey B, Journey D (out of credits)
> **Next**: [Module 12](module-12-notify-steps-and-simulation.md)

## Goal

Workflows can write with PostGear's AI, safely and honestly priced:

- **Generate Text** (P0): a prompt with data chips, a platform, a voice (Personal or Company), web research on or off.
- **Generate Image** (P1): an image saved to Media and passed on as a `MediaRef` that Create Draft accepts.
- **Generate Hashtags** and **Rewrite In Brand Voice** (P1): small prompts on the same model.
- **Generate Video**: visible, honestly **Coming Soon**, never addable.

Credits are charged before the model runs, refunded when the step fails, shown per step and per run, and a run with too few credits stops cleanly with "Not enough AI credits for this step."

## Read First

1. [`README.md`](README.md), [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 5.1 (Test tab), 7.1 (states), 8 (credit estimate in the activation dialog).
2. Sprint doc: Node Catalog AI rows, Risks "Runaway cost". User stories WF-9.1 to WF-9.3 and edge case "Out of AI credits".
3. Code:
   - `apps/api/src/modules/ai/ai.service.ts`: `prepareGenerate()` (~102: `credits.context`, `generateCost`, `credits.charge` **before** the run) and `runGenerate()` (~118: refunds the image share when the image stage fails, refunds the rest on any error).
   - `apps/api/src/modules/ai/credits/credits.service.ts` (`context`, `charge`, `tryCharge` with the P2034 serialization retry, `refund`), `credits.repository.ts` (`chargeOnce` in a serializable transaction, refunds are negative rows), `credits.policy.ts` (`AI_CREDIT_COSTS`: `generate_post` 5, `generate_image` 10; `AI_LEDGER_TYPES`; `generateCost`).
   - `apps/api/src/modules/ai/engine/engine.factory.ts` (simulation, OpenAI and unconfigured modes; research only with `TAVILY_API_KEY`; the Redis research cache) and `image-sink.ts` (`imageSinkFor` saves through `MediaService.saveGenerated`).
   - `packages/ai-engine/src/types.ts`: `GenerateRequest` (`topic`, `tone: 'personal' | 'company'`, `format`, `withImage`, `maxCharacters`, `platforms`, `workspaceName`) and `GenerateResult` (`hook`, `parts`, `sources`, `researched`). There is no research flag on the request: research happens when the pipeline was built with a provider.
   - `packages/ai-engine/src/index.ts` and `prompts/` (tone, content, hook).

## The Decision: Where AI Steps Run

The credits ledger, the engine wiring (keys, simulation, research cache) and the image sink (sharp processing, storage backends, the `Media` row) all live in the API. The worker has none of them.

| Option | What it means | Extra work |
|---|---|---|
| A. Worker runs `ai-engine` itself | Move `chargeOnce`, `refund`, `sumUsed` and the cycle maths into a shared helper (for example `packages/db/src/credits-ledger.ts`) used by both `CreditsService` and the worker; build the engine in the worker from the same env; extract image storage too | Three extractions (ledger, engine config, storage plus image processing); the API's behaviour must stay identical (its specs are the guard) |
| **B. Through the Module 10 gateway (recommended when Module 10 chose the gateway)** | `POST /internal/automation/ai/*` calls a thin `AutomationAiService` that reuses `CreditsService`, the engine factory and `imageSinkFor` unchanged | One controller and service; the gateway's run binding and `AutomationEffect` give retry safety for free |

**Recommend B**, because Module 10 already pays for the gateway and B needs no extraction. If Module 10 recorded option A (no gateway), use A and put the ledger in one shared helper with the API's `CreditsService` delegating to it, so there is still exactly one charging implementation. Either way: **never** a second, hand-written credit check. The session confirms the choice from the decision log before building.

Long calls: the gateway call for Generate Text can take 30 to 90 s. The worker's gateway client uses a 150 s timeout for `/ai/*` routes, and the executor heartbeats every 10 s (Module 07's activity options must allow it: `heartbeatTimeout` 30 s, `startToCloseTimeout` 3 min). If the worker times out while the API finishes, the retry finds the `AutomationEffect` row (`PENDING` answers 409 and retries, `DONE` returns the result), so a retry never charges twice.

## Design

### Credit types and costs

| Step | Ledger type | Cost |
|---|---|---|
| Generate Text | `generate_post` (existing) | 5 (`generateCost(false)`) |
| Generate Text with "Also make an image" | `generate_post` | `generateCost(true)` (15), image share refunded if the image fails, like `runGenerate` |
| Generate Image | `generate_image` (existing) | 10 |
| Generate Hashtags, Rewrite In Brand Voice | `generate_snippet` (**new**) | 2 |

Adding `generate_snippet`: extend `AI_CREDIT_COSTS` and therefore `AI_LEDGER_TYPES` and the refund type in `credits.policy.ts`; check every switch over `AiCreditType` (the copilot tools, the analytics or billing pages that list usage) and the policy specs. The catalog's `credits(config)` (Module 01) mirrors these numbers; add a unit test in the API that compares the catalog's numbers with `AI_CREDIT_COSTS` so they cannot drift.

### Run totals

`AutomationRun.creditsUsed Int @default(0)` (add it with `prisma-change` if Module 03 did not). The gateway returns `creditsCharged` (net of refunds); the executor stores it on the step output's metadata and the activity increments the run total in the same write as the step row. The Runs list and the run detail show "12 credits".

### Generate Text (`ai.generateText`, P0)

Config: `{ prompt: string /* template */, platform: ProviderId | 'generic', voice: 'personal' | 'company', format: 'one_short' | 'one_long' | 'thread_short' | 'thread_long', research: boolean, withImage: boolean }`.

- Gateway `POST /internal/automation/ai/text` builds the pipeline exactly as `AiService.prepareGenerate` does, with research only when `config.research` is on **and** the engine has a provider (in `AI_SIMULATION` the simulated research is used, never Tavily). Add a `research: boolean` option to the engine factory's `createPipeline` rather than a new code path.
- `maxCharacters` comes from the chosen platform's composer rules (the same lookup `resolveTargets` does for channels; reuse it by provider instead of channel ids).
- `workspaceName` from the organization, as today.
- Output: `{ text /* parts joined with blank lines */, parts: string[], hook, category, sources: [{ title, url }], researched, image?: MediaRef }`.

### Generate Image (`ai.generateImage`, P1)

Config: `{ prompt: string /* template, usually a chip from Generate Text */, style?: 'photo' | 'illustration' | 'flat' }`.

- Gateway `POST /internal/automation/ai/image` charges `generate_image`, runs the engine's image generator, saves through `imageSinkFor(media, orgId)` (so it is a normal Media item: listable, deletable, attachable), refunds on failure.
- Output: `{ image: MediaRef, url, alt }`. Create Draft's Media field accepts it directly.

### Generate Hashtags and Rewrite In Brand Voice (P1)

- Two small functions in `packages/ai-engine` (`generateHashtags`, `rewriteInVoice`) with prompts in `prompts/`, sharing the model client and the tone prompt. Unit tested with the simulated model client.
- Hashtags config `{ text, platform, count: 3..15 }`, output `{ hashtags: string[], line /* "#a #b #c" */ }`.
- Rewrite config `{ text, platform, voice }`, output `{ text }`. Both respect the platform's length rule and say so if they had to shorten.

### Generate Video

`status: 'comingSoon'` with "Video generation is coming soon." It stays out of `EXECUTABLE_TYPES`. Nothing else to build (WF-9.3).

### Out of credits

- The gateway uses `tryCharge`. When the cycle cannot afford it, the step fails **permanently** (no retry) with "Not enough AI credits for this step." and the run stops (On Error policies do not apply to credit failures: the error is marked `stopsRun`).
- Module 09's failed-run notification fires; its text for this case adds when credits reset ("Credits reset on 1 December.").

### Step panel

- **Configure**: the prompt as a multi-line chip input, the platform select, the voice segmented control ("Personal" and "Company", the same words as the AI page), the research switch with "Searches the web first. Takes longer.", the image switch (Generate Text only).
- A cost line under the fields: "Uses about 5 AI credits per run. You have 240 left this month." (balance from the existing credits summary endpoint the AI page uses).
- **Test tab**: a plain sentence in an `Alert` (info, not warning): "Testing this step uses real AI credits." plus a secondary button **Use Sample Text Instead**, which pins a realistic sample output (from the definition's `outputShape` samples) so downstream steps can be tested for free. AI steps are `sideEffect: 'internal'`: they run in tests (users need to see real output) and are never dry runs.
- The activation dialog (Module 09) shows "About 15 AI credits each time it runs." from `riskSummary().aiCreditsPerRun`.

### Frequency guard

Module 02 already refuses a Schedule faster than hourly in a graph with an `ai.*` step. Confirm the Schedule panel shows the reason inline when an AI step exists, and that the API refuses activation too (re-validation on the server).

## Scope

**In**: the four AI step executors, gateway AI routes and `AutomationAiService`, `generate_snippet`, two engine helpers, `creditsUsed`, panel cost line, Use Sample Text Instead, out-of-credits stop.

**Out**: video generation, per-plan AI step quotas (Module 15), the Describe Your Workflow AI builder (Module 15).

## Tasks

- [x] Confirm the gateway or shared-ledger decision from the decision log. (Option B, the gateway.)
- [x] `credits.policy.ts`: `generate_snippet`; specs updated; catalog-versus-policy cost test.
- [x] Engine factory: `research` option on `createPipeline`.
- [x] `packages/ai-engine`: `generateHashtags`, `rewriteInVoice`, prompts, tests with the simulated client.
- [x] API: `AutomationAiService` plus gateway routes `/ai/text`, `/ai/image`, `/ai/hashtags`, `/ai/rewrite`, each charge, run, refund-on-failure, effect row.
- [x] `prisma-change`: `AutomationRun.creditsUsed` if missing. (It already existed; no change.)
- [x] Worker: executors with heartbeats and the longer gateway timeout; credit failure marked `stopsRun`.
- [x] Web: Configure fields, cost and balance line, Test tab notice, Use Sample Text Instead. (Run detail shows credits per AI step: the charged number when the step output carries `credits`, else "About N Credits" from the step's estimate.)
- [x] Catalog: the four ready types in `EXECUTABLE_TYPES`; Generate Video stays Coming Soon.

## Tests

- Charge then refund: a model failure leaves the ledger net zero; an image failure with text success refunds only the image share.
- Exhausted credits: the step fails permanently with the exact sentence, the next steps are not run, no On Error branch fires.
- Replay: the gateway call repeated after success returns the stored output and charges once.
- Research flag: off means no research event; on under `AI_SIMULATION` uses simulated research, never Tavily.
- Hashtag and rewrite helpers obey platform length and count bounds.
- The catalog's credit numbers equal `AI_CREDIT_COSTS`.

## Done When

- `npm run validate` passes. AI Weekly Post runs end to end under `AI_SIMULATION=true`: text, image in Media, review, draft with the image attached.
- The run detail shows credits per step and per run.

## Hand Check

With `AI_SIMULATION=true`:

1. Open AI Weekly Post, test it: text and an image appear, the image is in Media, the review waits, Approve creates the draft with the image.
2. Note the credits before and after on the AI page: they dropped by the shown estimate.
3. Use Sample Text Instead on Generate Text, test again: no credits used, downstream steps still run.
4. Set the workspace's credits to nearly zero (seed or SQL through `docker exec postgear_postgres psql ...`), run Run Now: the run stops at Generate Text with "Not enough AI credits for this step." and a notification.
5. Try an hourly-or-faster schedule with an AI step: the panel explains why not.

## Handoff

README: progress row, gateway or shared-ledger choice, `generate_snippet` and its cost, `creditsUsed`, the heartbeat and timeout values, and anything about `AI_LEDGER_TYPES` other pages had to learn.
