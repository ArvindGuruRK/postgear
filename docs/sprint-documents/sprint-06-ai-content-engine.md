# Sprint 6: AI Content Engine & Copilot

> **PRD Coverage**: Section 5.5 (AI-Powered Content Engine).
> **Depends on**: [Sprint 4](sprint-04-post-composer-and-media.md) (composer to inject generated content into).
> **Reference repo**: `D:\rk-personal-projects\postiz-app-main` (study only).

## Sprint Goal

A user can generate a platform-ready post from a topic (with real web research backing it), adjust tone, and use a conversational assistant to iterate: all metered by an AI-credit system.

## Reference Study Guide

> **Framework decision**: PostGear standardizes on **LangGraph** as the orchestration layer for this module (confirmed choice; more robust than a bare LangChain call chain for a multi-step, stateful pipeline like this one). Worth knowing going in: LangGraph isn't a full replacement for LangChain; it's a graph/state-machine layer built *on top of* LangChain's primitives, and `@langchain/core` still supplies the model wrapper (`ChatOpenAI`), the DALL-E tool wrapper, and message/tool-call types either way. So "LangGraph instead of LangChain" in practice means: reach for `@langchain/langgraph`'s `StateGraph` to structure the pipeline, and use `@langchain/core`/`@langchain/openai` underneath for the actual model calls; exactly the combination Postiz itself uses (see below), so there's no real tradeoff here, just making the graph-based structure the deliberate default rather than an afterthought.

| Concept | Postiz Reference (study, don't copy) | What to Extract |
|---|---|---|
| Multi-step generation pipeline | `libraries/nestjs-libraries/src/agent/agent.graph.service.ts` (`AgentGraphService`, built on `@langchain/langgraph` `StateGraph`) | The graph chains: topic/category lookup → `find-popular-posts` → `generate-hook` (structured-output) → `generate-content` (uses the hook) → DALL-E image-prompt step. This staged approach (research before writing, hook before body) is the actual differentiator vs. a single prompt-and-done call: reproduce it as a real `StateGraph` pipeline in `packages/ai-engine`, not collapsed into one LLM call. |
| Web-grounded research | Same file: Tavily (`@langchain/tavily` `TavilySearch`) is added as a graph tool only when `TAVILY_API_KEY` is set | Confirms Tavily as the research tool; note the **conditional tool registration** pattern (feature works without the key, just skips grounding): good defensive default for PostGear too. |
| Static taxonomy inputs | `libraries/nestjs-libraries/src/agent/{agent.categories.ts,agent.topics.ts}` | Reference for how they seed category/topic classification: PostGear can define its own list rather than reusing theirs verbatim. |
| Conversational assistant + memory | `libraries/nestjs-libraries/src/chat/mastra.service.ts` (Mastra agent) + `mastra.store.ts` (persistent thread/message storage) | The idea of persistent conversation memory (so the assistant remembers earlier turns/brand guidance): decide if PostGear needs this from day one or can start stateless and add memory later. CopilotKit (`@copilotkit/react-core`) is the frontend chat UI library Postiz pairs with this: reasonable choice to adopt directly since it's a UI library, not core logic. |
| Tool-calling surface | `libraries/nestjs-libraries/src/chat/tools/*.ts` (e.g. `generate.image.tool.ts`, `integration.schedule.post.ts`, `integration.list.tool.ts`) | Shows the shape of tools an agent needs to actually *act* (not just chat): list channels, schedule a post, generate an image. PostGear's copilot should expose an equivalent minimal tool set: list channels, draft a post, generate an image. |
| MCP server (external AI agent access) | `libraries/nestjs-libraries/src/chat/start.mcp.ts`, `oauth-middleware.ts` (RFC 9728 OAuth2 protected resource) | PRD marks this P2: out of this sprint's scope, noted only so the tool-calling design above doesn't need rework if MCP is added later (the same tool definitions can be exposed both to the in-app copilot and an MCP server). |

## PostGear Implementation Plan

Target locations: `packages/ai-engine/src/{agents,tools,prompts}/`, `apps/api/src/modules/` (new `ai` module, or fold into `posts`; decide based on how tightly it couples to post creation), `apps/web/src/app/(dashboard)/[orgId]/ai-copilot/`.

### Task 1: Content generation pipeline
- `packages/ai-engine/src/agents/content.agent.ts`: staged pipeline (research → hook → platform-specific copy → optional image prompt) built as a LangGraph `StateGraph`, per the framework decision above.
- `packages/ai-engine/src/tools/tavily-search.tool.ts`: web research, gated behind an env key exactly as Postiz does.
- Tone/style control (Personal vs. Company voice) as a pipeline parameter, per PRD 5.5.

### Task 2: Image generation
- `packages/ai-engine/src/tools/dalle-image.tool.ts`: DALL-E call, saving output directly into Sprint 4's media library.

### Task 3: Conversational copilot
- `packages/ai-engine/src/agents/copilot.agent.ts`: chat-based assistant with a small tool set (list channels, draft/generate post content, generate image). Start stateless; add persistent memory only if real usage shows it's needed.
- Frontend: CopilotKit-based chat drawer in `apps/web/src/app/(dashboard)/[orgId]/ai-copilot/`.

### Task 4: Credit metering
- `Credits`-equivalent tracking tied to `Subscription` tier (schema addition if not already covered in Sprint 1): deduct on each generation/image call, expose a balance meter in the UI.

## Definition of Done

> **Completion checklist**: [sprint-06-completion-checklist.md](../sprint-completion-checklists/sprint-06-completion-checklist.md), covering what shipped, a test command for every item, the live run, and the known gaps.

- [x] Given a topic, the pipeline produces a platform-ready post that visibly reflects web research (not just generic LLM knowledge) when Tavily is configured, and degrades gracefully (skips research) when it isn't. **Verified** with the simulated research provider (the parts cite the sources; the result lists them) and by the engine's `skips research when no provider is configured` test; the tracker shows the stage as "Skipped" in the UI. Real Tavily has not been called yet: see the checklist's Known gaps.
- [x] Tone toggle (Personal/Company) measurably changes output style. **Verified**: the prompt wording and the output flip between "I, me, my" and "we, us, our, as {workspace}" (`tone changes the prompts and the copy`), live and in the UI's two voice cards.
- [x] The copilot chat can answer "what channels do I have connected" using its list-channels tool, proving tool-calling actually works end-to-end. Browser test: `ai.spec.ts` › *the copilot answers "what channels do I have" through its list-channels tool*.
- [x] Each generation call deducts from the org's AI credit balance and is blocked once exhausted. **Verified live**: 23 → 93 used across the run, then a **402** for a generation the balance could not cover, while a cheaper one still passed. Browser test: `ai.spec.ts` › *generates a short post for LinkedIn, charges credits, and opens it in the composer*.

### Added beyond the original scope

- [x] **Simulation mode** (`AI_SIMULATION=true`): deterministic stand-ins for the model, research and images, so every screen, the credit rules and tool calling run locally with no key; the same philosophy as Sprint 5's `PUBLISH_SIMULATION`.
- [x] **Fault tolerance throughout**: per-call deadlines on a linked `AbortSignal`, retry with backoff only on retryable failures, one structured-output repair, research and image failures non-fatal, credits charged first and refunded on every failure path, a disconnect that aborts the run.
- [x] **Platform-aware length**: the Generate tab passes the strictest selected platform's limit into the pipeline, and an over-limit part never leaves the engine.
- [x] **A real draft from both surfaces**: "Open in composer" and the copilot's `draft_post` tool both create a `DRAFT` through the posts API, so generated content enters the composer by the same door everything else does.
- [x] **Three design-system components** (`SpeechBubble`, `StageTracker`, `TypingIndicator`) and rule §16b on AI surfaces.

### Deviations from this document, and why

| This doc said | What shipped | Why |
|---|---|---|
| CopilotKit chat drawer | A chat built from `@postgear/ui` over SSE | CopilotKit brings its own styles and runtime protocol; the design system and the API's ownership of credits and tools came first. The tool definitions stay reusable for a later MCP surface |
| Mastra agent with memory | A LangGraph agent, stateless; history in the browser tab | This doc's own advice: start stateless |
| (unstated) one image per part, as the reference | One hero image on part 1 | Later parts publish as comments on every platform and cannot carry media; the price stays predictable |
| Schema addition for credits if needed | None: the inherited `Credits` table as an additive ledger | Already covered; refunds as negative rows keep the history |

## Risks
- ~~LLM cost/latency: stream responses (SSE) rather than blocking on full completion, and cache Tavily results briefly to avoid duplicate research calls on retries, both patterns Postiz's architecture doc calls out as mitigations worth adopting.~~ **Retired**: both endpoints stream over SSE with a heartbeat, and Tavily results are cached in Redis for ten minutes keyed on the normalised query.
- **No real provider has been exercised.** The repository's keys are the `.env.example` placeholders, so OpenAI, DALL-E and Tavily have only been run against mocked SDKs. The first generation with a real `OPENAI_API_KEY` is the next verification step (`docs/local-testing-guide.md` §5c).
