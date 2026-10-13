# Sprint 6 — Completion Checklist & Test Guide

Companion to [sprint-06-ai-content-engine.md](../sprint-documents/sprint-06-ai-content-engine.md).
Status as of **2026-10-14**.

Sprint 6 started from stubs: every file in `packages/ai-engine/src/` was an
empty `export {}` with a TODO, `apps/api` had no `ai` module, the AI Copilot
page was `return null`, and nothing in the schema or the seed had ever written
a `Credits` row.

The **[Pre-existing]** things worth not re-testing: the `Credits` and
`Subscription` models (Sprint 1's inherited schema — no migration was needed),
the media library's image pipeline (Sprint 4), the channels API and provider
rules (Sprints 3–4), the posts API the copilot drafts through (Sprint 4), and
the design-system components.

**All four Definition of Done items are met**, three of them with a browser
test, and the whole thing was exercised live against the API in **simulation
mode**: the model, the web research and the image generator are deterministic
stand-ins (see [§1.4](#14--simulation-why-it-exists)), while the LangGraph
pipeline, the credit ledger, the SSE streams, the tool calls, the media
library and every screen are real. No paid API was called — the repository's
`.env` still holds the `.env.example` placeholder keys, which the API now
recognises and ignores. The OpenAI and Tavily clients are unit-tested against
mocked SDKs and have **not** been run against the real services; that is the
first thing to do once a key exists ([Known gaps](#known-gaps)).

---

## Prerequisites

```bash
docker compose up -d          # Postgres, Redis, MinIO, Temporal
npm install                   # adds @langchain/core, @langchain/langgraph, @langchain/openai, @langchain/tavily, openai
npm run db:generate
npm run db:migrate            # no new migration
npm run db:seed               # now also seeds an AI credit ledger: 23 of 100 used
```

Then `npm run dev` (or the three processes separately). The AI page needs one
line in `.env`:

| Variable | Default | Meaning |
|---|---|---|
| `AI_SIMULATION` | `false` | Replace the model, research and images with stand-ins. Set `true` locally; refused when `NODE_ENV=production` |
| `OPENAI_API_KEY` | unset | Real generations. The `.env.example` placeholder counts as unset (a boot warning says so) |
| `TAVILY_API_KEY` | unset | Web research. Without it the research stage is **skipped**, and the UI says so |
| `AI_MODEL` | `gpt-4.1-mini` | The chat model for every stage and the copilot |
| `AI_IMAGE_MODEL` | `dall-e-3` | The image model |

Mode precedence: `AI_SIMULATION=true` → simulation; else a real key → OpenAI;
else **unconfigured**, where `/ai/status` says so, the page shows how to fix it,
and the generation endpoints answer 503.

The seeded ledger on `seed-demo-org` (re-seeding resets it): two posts (5 each),
one image (10), three copilot messages (1 each) and one image refund (−10) for
a generation whose image failed — 23 used, 77 remaining, resetting on the
subscription's day of the month.

---

## 1. The engine (Task 1, Task 2) — `packages/ai-engine`

| # | Item | Status |
|---|---|---|
| 1.1 | `types.ts` — the contract: requests, events, tools, the `ModelClient` seam, `AiProviderError` with a `kind` and `retryable` | ✅ [New] |
| 1.2 | `agents/content.agent.ts` — a real `@langchain/langgraph` `StateGraph`: `research → classify → hook → content → (image) → END`, `Annotation.Root` state, per-stage events | ✅ [New] |
| 1.3 | Research is **conditional**: no provider → `stage research skipped`; a provider that throws → `failed`, generation continues | ✅ [New] |
| 1.4 | Category from a fixed PostGear taxonomy (`AI_CATEGORIES`, 15 entries) via a `z.enum` structured output | ✅ [New] |
| 1.5 | Hook stage (1–2 sentences, must not copy the brief), then content that opens with the hook; tone and format as prompt parameters | ✅ [New] |
| 1.6 | Length guard: parts are held to `maxCharacters` (the strictest selected platform) — one repair pass, then a sentence-boundary truncation; an over-limit part never leaves the engine | ✅ [New] |
| 1.7 | `tools/tavily-search.tool.ts` — `@langchain/tavily`, normalised sources, `withResearchCache` (sha1 of the normalised query, 10 min, cache errors ignored) | ✅ [New] |
| 1.8 | `tools/dalle-image.tool.ts` — the `openai` SDK, `b64_json`, 1024×1024, 90 s deadline; bytes go to an injected `ImageSink` (the API's media library) | ✅ [New] |
| 1.9 | One hero image, on the first part only — comment parts cannot carry media on any platform | ✅ [New] |
| 1.10 | `model/openai-model-client.ts` — `ChatOpenAI` with `withStructuredOutput` + one repair re-ask, `bindTools` + `stream()` with live text deltas and tool calls aggregated once | ✅ [New] |
| 1.11 | `model/resilience.ts` — `withRetry` (exponential backoff + jitter, only on `rate_limited` / `unavailable` / `timeout`), `withDeadline` (a linked `AbortSignal`, so a timed-out SDK call is really cancelled), `classifyError`, `redactSecrets` | ✅ [New] |
| 1.12 | `model/simulated-model-client.ts` — deterministic, tone-, format- and length-aware stand-in; drives the copilot's tool calls by keywords | ✅ [New] |
| 1.13 | `agents/copilot.agent.ts` — `StateGraph` `agent → tools → agent` loop, six tool rounds then a forced answer, Zod-validated tool input (bad input → `ok:false`, the model retries), tool exceptions never escape the graph | ✅ [New] |
| 1.14 | `prompts/` — tone, classify, hook, content, copilot system prompt, and the labelled-field format the simulation reads back | ✅ [New] |

### 1.2 — why a graph and not one prompt

The sprint document's framework decision was LangGraph, and the reason holds
up in the code: the stages have different failure policies. Research and the
image are optional (a failure is reported and skipped); classify, hook and
content are not (a failure rejects the run). A single prompt could not express
that, and a hand-written chain would have re-invented the graph's conditional
edges. Each node also reports itself as it runs, which is what the stage
tracker on the page is drawn from.

### 1.4 — simulation, why it exists

Nothing about the engine can be exercised locally against real providers: a
fresh clone has no key, and the key in this repository's `.env` is the
documented placeholder. The stand-ins replace **only the provider calls** — a
`ModelClient`, a `ResearchProvider` and an `ImageGenerator` — behind the same
interfaces the OpenAI, Tavily and DALL-E implementations fill. The graph, the
events, the credit ledger, the SSE transport, the tool-calling loop, the media
library write and every screen run for real. The simulated model is
deterministic (seeded from the prompt), writes "I/me/my" in the personal voice
and "we/us/our" plus the workspace name in the company voice, respects the
format's part count and the platform's character ceiling, and the simulated
copilot calls `list_channels` when asked about channels, `generate_post`
when asked to write, `draft_post` when asked to save, and `generate_image` when
asked for a picture — so tool calling is proven end to end without a model.

The env schema refuses `AI_SIMULATION=true` when `NODE_ENV=production`.

**How to test:**

```bash
cd packages/ai-engine && npx jest
```

Expect **128 passed** across 13 suites: the pipeline's stage order and events;
research skipped without a provider and reported-then-continued when it
throws; image failure leaves `image: null`; the tone changes both the prompt
wording and the simulated copy; `maxCharacters` holds for every part of a
thread; abort rejects as `aborted` (mid-run and already-aborted); the copilot
calls `list_channels` and uses its output, retries a badly-shaped tool call,
turns a tool exception into `ok:false`, and stops at `maxToolRounds`; the
retry policy retries a 429 and not a 401; a timeout classifies as `timeout`;
the OpenAI client (SDK mocked) maps 401/429/5xx/abort/content-filter to the
right kinds; the Tavily cache keys and TTL.

---

## 2. The API (Task 3's tools, Task 4) — `apps/api/src/modules/ai`

| # | Item | Status |
|---|---|---|
| 2.1 | `GET /ai/status` — `configured`, `mode`, `model`, `research`, `images` | ✅ [New] |
| 2.2 | `GET /ai/credits` — allowance, used, remaining, `resetsAt`, tier, `low`, the cost table | ✅ [New] |
| 2.3 | `POST /ai/generate` — SSE; resolves the selected channels to their platforms and the strictest `rules.maxLength`; charges first, relays every stage | ✅ [New] |
| 2.4 | `POST /ai/copilot/chat` — SSE; stateless (the client sends the history); tokens, tool calls, tool results, `done` | ✅ [New] |
| 2.5 | `common/sse.ts` — SSE on `@Post()` handlers (Nest's `@Sse()` is GET-only): the headers, a 15 s heartbeat, `request.on('close')` → `AbortSignal` | ✅ [New] |
| 2.6 | Credits: the existing `Credits` table as an **additive ledger** (positive charge rows, negative `refund:*` rows), allowance by `Subscription.subscriptionTier` (STANDARD 100 · PRO 500 · TEAM 2000 · ULTIMATE 10 000 · no subscription 25), cycle anchored on the subscription's day of the month | ✅ [New] |
| 2.7 | Charge = one `Serializable` transaction (sum → compare → insert), retried three times on `P2034`, the pattern `posts.repository.ts` set | ✅ [New] |
| 2.8 | Charged **before** the work; refunded in full when the pipeline fails, the image share when only the image fails, in full on disconnect; a copilot message is refunded if the agent fails before producing anything | ✅ [New] |
| 2.9 | Exhausted → **402** with the reset date in the message; checked **last**, so a refused request (400/422/503) never costs anything | ✅ [New] |
| 2.10 | Copilot tools: `list_channels` (free), `generate_post` (5, +10 with an image), `draft_post` (free — a real `DRAFT` through `PostsService.create`, next full hour, media on part 1), `generate_image` (10 — DALL-E or the stand-in, saved through `MediaService.saveGenerated`) | ✅ [New] |
| 2.11 | `MediaService.saveGenerated` — sniff, `processImage`, store, thumbnail, row with `alt` = the revised prompt; stored objects removed if the row write fails | ✅ [New] |
| 2.12 | `config/env.ts` — the five AI variables; placeholder and blank values read as unset with a one-time boot warning | ✅ [New] |
| 2.13 | Provider error text and keys never reach a response; every user-facing string in `ai.messages.ts` | ✅ [New] |

### 2.8 — charge first, refund on failure

The alternative — charge after success — lets two requests started together
both pass the balance check and overspend, and lets a request that produced an
image and then died leave the image unpaid for. Charging up front inside a
serializable transaction makes the balance a hard limit; refunding as a
negative row keeps every generation, including the failed ones, in the
history a billing question would need.

**How to test — the whole flow against the real stack** (API with
`AI_SIMULATION=true`). Verified on 2026-10-14, in this order:

| Step | Verified result |
|---|---|
| `GET /ai/status` | `{ configured: true, mode: "simulation", research: true, images: true }`; the API log warned that both placeholder keys were ignored |
| `GET /ai/credits` after `db:seed` | `allowance 100, used 23, remaining 77, tier STANDARD, resetsAt` on the subscription's day |
| `POST /ai/generate` — company voice, short thread, with image, for X + LinkedIn | Events in order: `research` (3 sources) → `classify` (Announcement) → `hook` → `content` (5 parts, every one ≤ 280 as X counts) → `image` (a media-library item with a thumbnail) → `done` with `used 38` |
| `POST /ai/copilot/chat` "What channels do I have connected?" | `tool_call list_channels` → `tool_result ok` with the workspace's channels → a reply naming each one → `done` with `used 39` |
| Generate repeatedly with an image at 93 used | **402** "You've used this cycle's AI credits. They refresh on …" — and a 5-credit generation without an image still went through (93 used, `low: true`) |
| Copilot at 7 remaining | Still answers (1 credit) |
| `tone: "loud"` | **400** |
| A channel id from another workspace | **422** "One of the selected channels is not connected to this workspace" |

```bash
cd apps/api && npx jest src/modules/ai src/modules/media src/common
```

Expect **163 passed** across 14 suites: the SSE writer (headers, framing,
heartbeat, close-once, disconnect → abort); the credit policy (costs, every
tier, month-end clamping, reset dates); the credit service (charge, block,
refund rows, `P2034` retry); the request schemas; the engine mode decision
(simulation / openai / unconfigured, placeholder detection); the simulated
image generator; the four tools (charging, out-of-credits as a tool error,
foreign channels refused before any write); the service (503 before charging,
402, refund of the whole charge on failure, of the image share on an image
failure, abort on disconnect) and `saveGenerated`.

---

## 3. The screens (Task 1's tone control, Task 3's chat, Task 4's meter) — `apps/web`

| # | Item | Status |
|---|---|---|
| 3.1 | `/[orgId]/ai-copilot` — one page, two URL-synced modes (`?mode=generate` / `copilot`); both stay mounted so a generation survives a tab switch | ✅ [New] |
| 3.2 | Credits meter (`UsageMeter tone="ai"`) with the reset date and tier, a "Low" badge under 20 %, refreshed from every terminal stream event | ✅ [New] |
| 3.3 | Generate form: topic with a counter, **Voice** as two cards (Personal "I, me" / Company "We — {workspace}"), format `Select` with hints, hero-image `Toggle` with "+10 credits", the existing `ChannelPicker`, "Fits X's 280 characters, as X counts them" | ✅ [New] |
| 3.4 | The Generate button states its cost; disabled with an explanation and the reset date when the balance cannot cover it | ✅ [New] |
| 3.5 | `StageTracker` while running — research / classify / hook / write / image with details ("3 sources found", "Skipped — no image requested"); Stop aborts the stream | ✅ [New] |
| 3.6 | Result: category `Badge variant="ai"`, hook in an AI `SpeechBubble`, numbered part cards with per-part counts measured the platform's way, the hero image with its prompt as caption, "Backed by research" sources or "Written without web research" | ✅ [New] |
| 3.7 | **Open in composer** — a `DRAFT` for the selected channels through `POST /posts` (image attached to part 1), then the composer opens on it; Copy; Regenerate | ✅ [New] |
| 3.8 | Copilot: user bubbles `primary` with a tail, assistant bubbles with a violet Sparkles avatar, streaming text, `TypingIndicator`, tool-activity rows ("Checked your channels", "Drafted a post for Acme Marketing → Open in composer", an image thumbnail), suggestion chips, Enter sends | ✅ [New] |
| 3.9 | Conversation kept in `sessionStorage` per workspace; "Clear conversation"; the API stays stateless (the last 20 messages travel with each request) | ✅ [New] |
| 3.10 | Every state: unconfigured (an `EmptyState` naming the two fixes), no channels, out of credits, streaming, mid-stream error (partial result kept), stopped, done | ✅ [New] |
| 3.11 | `lib/sse.ts` — a POST-capable SSE client over `fetch`: frames split across chunks, comments, CRLF; a non-2xx before the stream throws the API's message | ✅ [New] |
| 3.12 | Composer: a "Generate with AI" link in the page header | ✅ [New] |
| 3.13 | Design system: `SpeechBubble`, `StageTracker`, `TypingIndicator`; `UsageMeter` gains `tone` and `caption`; all in the playground; rule §16b written | ✅ [New] |

### 3.6 — where the comic treatment goes, and where it does not

The copilot is the first conversational surface in the app, and the speech
bubble is the accent the Sprint 0 document sanctioned for exactly this. So the
chat uses it, the hook — the one line the model wrote to be read aloud — sits
in a violet bubble, and everything the model *produced* is marked with
`actionAi`. The generated post parts are the opposite: they are the dense
content a person is about to edit, so they are restrained `Card`s with
character counts, per §15. Rule §16b in `design-system-rules.md` records the
boundary.

**How to test:**

```bash
cd apps/web && npx jest
```

Expect **75 passed**: the SSE parser (chunked frames, comments, trailing
frame), the generate reducer (stage transitions, partial results on error,
abort as "Stopped", pre-stream 402/503 kinds, the strictest limit, the cost),
the chat reducer (streaming text, tool rows by id, `done` without tokens,
hydration gating of persistence, history serialisation), and Sprints 4–5's
suites.

```bash
npm run test:e2e -- e2e/ai.spec.ts     # API running with AI_SIMULATION=true
```

`ai.spec.ts` (2 passed): a short post for LinkedIn runs every stage to done,
the credits meter's `used` grows by at least the post's price, and **Open in
composer** lands on `/composer?group=` with the text in part 1; the copilot
answers "What channels do I have connected?" through a visible `list_channels`
tool row, names Acme Marketing, survives a reload, and Clear empties it.

The rest of the browser suite (`auth`, `onboarding`, `channels`, `composer`,
`media`, `calendar`, `queue`, `playground`) was re-run after the composer and
design-system changes: **44 passed**.

---

## Definition of Done — evidence

| DoD item | Evidence |
|---|---|
| Given a topic, the pipeline produces a platform-ready post that visibly reflects web research when Tavily is configured, and degrades gracefully when it isn't | §2: the live run's parts cite the research sources by title, and the result card lists them under "Backed by research"; the engine's `skips research when no provider is configured` test and the tracker's "Skipped" stage cover the other half. *Visibly reflects* has only been shown with the simulated provider — see Known gaps 1 |
| Tone toggle (Personal/Company) measurably changes output style | §1: `tone changes the prompts and the copy` asserts "first person singular — I, me, my" vs "first person plural — we, us, our" in the prompt and I/we in the output; live, the same topic came back "Quick one from me: …" and "A short note from the PostGear Demo Org team …" |
| The copilot chat can answer "what channels do I have connected" using its list-channels tool | §2 live and `ai.spec.ts`: a `tool_call list_channels` event, its result, and a reply naming every channel |
| Each generation call deducts from the org's AI credit balance and is blocked once exhausted | §2: 23 → 38 → 39 → … → 93 across the live calls, then **402** for a 15-credit generation while a 5-credit one still passed; `credits.service.spec.ts` for the transaction and `ai.service.spec.ts` for the refunds |

---

## Deviations from the sprint document, and why

| The document said | What shipped | Why |
|---|---|---|
| CopilotKit for the chat UI | A chat built from `@postgear/ui` (`SpeechBubble`, `StageTracker`, `TypingIndicator`) over a plain SSE stream | CopilotKit ships its own styled components and expects its own runtime protocol (it would have moved the agent and its tools into a Next route handler, away from the API that owns credits). The sprint's substance — tool calling that provably acts in the workspace — is kept; the design system is kept whole. The tool definitions are plain `CopilotTool` objects, so an MCP surface later (P2) reuses them |
| Mastra agent with memory | A LangGraph agent, stateless; the browser keeps the conversation in `sessionStorage` and sends the last 20 messages | The document itself says "start stateless; add persistent memory only if real usage shows it's needed". One orchestration library in the package rather than two |
| DALL-E "saving output directly into Sprint 4's media library" | Exactly that, through an injected `ImageSink` | The engine never touches storage; the API's sink wraps `MediaService.saveGenerated` so generated images get the same sniff, compression, thumbnail and cleanup as uploads |
| "`Credits`-equivalent tracking … schema addition if not already covered" | The inherited `Credits` table as an additive ledger; no migration | It was covered. A ledger with refunds as negative rows keeps the history a billing dispute needs, and costs nothing to add |
| Image prompts per part (the reference generates one per part) | One hero image on part 1 | Every platform attaches media to the root post; a thread's later parts are comments on X/LinkedIn/Facebook/Instagram and cannot carry it. One image also makes the price predictable ("Generate · 15 credits") |
| Stream responses (SSE) | SSE on `POST` routes with a hand-written writer | Nest's `@Sse()` is GET-only and a generation request has a body. The writer is shared by both endpoints and tested |
| Cache Tavily briefly | `withResearchCache` over Redis, 10 minutes, keyed on the normalised query | As the risk note asked; a retry after a failed hook stage does not pay for the same search twice |

---

## Review findings fixed before closing (2026-10-14)

| Finding | Fix |
|---|---|
| A reload of the copilot tab lost the conversation under React's development StrictMode: the persist effect wrote the still-empty initial state over the session before the restore dispatch had rendered, and the re-run restore then read that empty array | Persistence is gated on a `hydrated` flag that only the `restore` dispatch sets, so the mount commit can never write; covered by `is hydrated only by a restore` and the reload assertion in `ai.spec.ts` |
| A Next dev server left running by an earlier session had lost its stdout and answered every AI page with a 500 (`write EPIPE` in its render workers) | Not a code defect — noted so the symptom is recognisable: restart the web server |

Visual review: both modes in light and dark at 1360 px, and the page at 390 px
(single column, `scrollWidth === clientWidth`, no horizontal scroll), with no
console errors from this sprint. (The composer's `datetime-local` input logs a
pre-existing hydration warning under headless Chromium — Sprint 4, unchanged.)

## Known gaps

1. **No real provider has been called.** `OPENAI_API_KEY` and `TAVILY_API_KEY`
   in this repository's `.env` are the documented placeholders. The OpenAI and
   Tavily clients are tested against mocked SDKs; the first thing to do with a
   real key is a generation with `AI_SIMULATION="false"` and a check that the
   parts cite the sources (`docs/local-testing-guide.md` §5c).
2. **The copilot is stateless.** Memory lives in the browser tab. A persistent
   thread store (the reference's Mastra store) is the next step if usage shows
   people return to conversations.
3. **Copilot-written posts are not platform-aware.** The `generate_post` tool
   runs with no character ceiling; the Generate tab, which knows the selected
   channels, is. The composer's own validation still catches an over-limit
   draft before it can be queued.
4. **P1 items not built**: thread splitting of long content, content
   suggestions for an existing draft, a credit-history dashboard (the meter and
   `GET /ai/credits` are the P0 half), per-part images.
5. **Simulation is fast.** The stand-ins answer in well under a second, so
   Stop and the disconnect refund cannot be watched happening live; both are
   unit-tested (`stops the engine on disconnect, refunds, and reports a quiet
   abort`).
6. **Inherited `Credits.type = "ai_images"` rows are not counted.** The module
   sums only the six types it writes; a later sprint that bills something else
   adds its own types.
7. **Timezone of the cycle boundary is UTC midnight**, as the 402 message
   states a date rather than a time; `User.timezone` is not consulted
   (Sprint 1's open note still stands).
8. **The E2E suite is still not in CI** — unchanged since Sprint 2.

---

## Files changed in this pass

**Added — `packages/ai-engine`** (dependencies: `@langchain/core`, `@langchain/langgraph`, `@langchain/openai`, `@langchain/tavily`, `openai`, `zod`; `@postgear/db` removed)
- `src/types.ts`, `src/index.ts`
- `src/agents/{content.agent,copilot.agent}.ts` (+ tests)
- `src/model/{model-client,openai-model-client,simulated-model-client,resilience}.ts` (+ tests)
- `src/tools/{tavily-search.tool,dalle-image.tool}.ts` (+ tests)
- `src/prompts/{fields,tone,classify,hook,content,copilot}.ts` (+ tests)

**Added — API**
- `src/common/sse.ts` (+ spec)
- `src/modules/ai/{ai.module,ai.controller,ai.service,ai.messages,ai.errors}.ts`, `ai.service.spec.ts`
- `src/modules/ai/dto/ai.schema.ts` (+ spec)
- `src/modules/ai/credits/{credits.policy,credits.repository,credits.service}.ts` (+ specs)
- `src/modules/ai/engine/{engine.types,engine.config,engine.factory,image-sink,simulated-image.generator}.ts` (+ specs)
- `src/modules/ai/tools/copilot-tools.ts` (+ spec)

**Added — web**
- `src/app/(dashboard)/[orgId]/ai-copilot/page.tsx`
- `src/components/ai/{ai-studio,credits-meter,ai-unavailable,generate-panel,generate-form,generate-progress,generate-result,copilot-chat,chat-message,tool-activity}.tsx`, `generate-state.ts`, `chat-state.ts`, `use-credits.ts` (+ tests)
- `src/lib/sse.ts` (+ test), `src/types/ai.ts`
- `src/app/dev/components/sections/ai-section.tsx`

**Added — design system, tests, docs**
- `packages/ui/src/components/{speech-bubble,stage-tracker,typing-indicator}.tsx`
- `e2e/ai.spec.ts`
- this file; `docs/design-patterns/design-system-rules.md` §16b; `docs/local-testing-guide.md` §5c

**Modified**
- `apps/api` — `app.module.ts`, `config/env.ts`, `common/logging/security-logger.ts`, `modules/media/{media.service,media.repository}.ts` (+ spec), `modules/posts/posts.module.ts` (exports `PostsService`)
- `apps/web` — `components/composer/composer.tsx` (the link), `lib/api.ts` (exports the API base URL), the playground's showcase, feedback and SaaS-patterns sections
- `packages/ui` — `usage-meter.tsx`, `index.ts`
- `packages/db/prisma/seeds/index.ts` — the credit ledger
- `.env.example` (AI section rewritten: no placeholders, the new variables), `README.md`, root `package-lock.json`
