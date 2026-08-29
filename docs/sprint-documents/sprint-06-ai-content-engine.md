# Sprint 6 — AI Content Engine & Copilot

> **PRD Coverage**: Section 5.5 (AI-Powered Content Engine).
> **Depends on**: [Sprint 4](sprint-04-post-composer-and-media.md) (composer to inject generated content into).
> **Reference repo**: `D:\rk-personal-projects\postiz-app-main` (study only).

## Sprint Goal

A user can generate a platform-ready post from a topic (with real web research backing it), adjust tone, and use a conversational assistant to iterate — all metered by an AI-credit system.

## Reference Study Guide

> **Framework decision**: PostGear standardizes on **LangGraph** as the orchestration layer for this module (confirmed choice — more robust than a bare LangChain call chain for a multi-step, stateful pipeline like this one). Worth knowing going in: LangGraph isn't a full replacement for LangChain, it's a graph/state-machine layer built *on top of* LangChain's primitives — `@langchain/core` still supplies the model wrapper (`ChatOpenAI`), the DALL-E tool wrapper, and message/tool-call types either way. So "LangGraph instead of LangChain" in practice means: reach for `@langchain/langgraph`'s `StateGraph` to structure the pipeline, and use `@langchain/core`/`@langchain/openai` underneath for the actual model calls — exactly the combination Postiz itself uses (see below), so there's no real tradeoff here, just making the graph-based structure the deliberate default rather than an afterthought.

| Concept | Postiz Reference (study, don't copy) | What to Extract |
|---|---|---|
| Multi-step generation pipeline | `libraries/nestjs-libraries/src/agent/agent.graph.service.ts` (`AgentGraphService`, built on `@langchain/langgraph` `StateGraph`) | The graph chains: topic/category lookup → `find-popular-posts` → `generate-hook` (structured-output) → `generate-content` (uses the hook) → DALL-E image-prompt step. This staged approach (research before writing, hook before body) is the actual differentiator vs. a single prompt-and-done call — reproduce it as a real `StateGraph` pipeline in `packages/ai-engine`, not collapsed into one LLM call. |
| Web-grounded research | Same file — Tavily (`@langchain/tavily` `TavilySearch`) is added as a graph tool only when `TAVILY_API_KEY` is set | Confirms Tavily as the research tool; note the **conditional tool registration** pattern (feature works without the key, just skips grounding) — good defensive default for PostGear too. |
| Static taxonomy inputs | `libraries/nestjs-libraries/src/agent/{agent.categories.ts,agent.topics.ts}` | Reference for how they seed category/topic classification — PostGear can define its own list rather than reusing theirs verbatim. |
| Conversational assistant + memory | `libraries/nestjs-libraries/src/chat/mastra.service.ts` (Mastra agent) + `mastra.store.ts` (persistent thread/message storage) | The idea of persistent conversation memory (so the assistant remembers earlier turns/brand guidance) — decide if PostGear needs this from day one or can start stateless and add memory later. CopilotKit (`@copilotkit/react-core`) is the frontend chat UI library Postiz pairs with this — reasonable choice to adopt directly since it's a UI library, not core logic. |
| Tool-calling surface | `libraries/nestjs-libraries/src/chat/tools/*.ts` (e.g. `generate.image.tool.ts`, `integration.schedule.post.ts`, `integration.list.tool.ts`) | Shows the shape of tools an agent needs to actually *act* (not just chat) — list channels, schedule a post, generate an image. PostGear's copilot should expose an equivalent minimal tool set: list channels, draft a post, generate an image. |
| MCP server (external AI agent access) | `libraries/nestjs-libraries/src/chat/start.mcp.ts`, `oauth-middleware.ts` (RFC 9728 OAuth2 protected resource) | PRD marks this P2 — out of this sprint's scope, noted only so the tool-calling design above doesn't need rework if MCP is added later (the same tool definitions can be exposed both to the in-app copilot and an MCP server). |

## PostGear Implementation Plan

Target locations: `packages/ai-engine/src/{agents,tools,prompts}/`, `apps/api/src/modules/` (new `ai` module, or fold into `posts` — decide based on how tightly it couples to post creation), `apps/web/src/app/(dashboard)/[orgId]/ai-copilot/`.

### Task 1 — Content generation pipeline
- `packages/ai-engine/src/agents/content.agent.ts`: staged pipeline (research → hook → platform-specific copy → optional image prompt) built as a LangGraph `StateGraph`, per the framework decision above.
- `packages/ai-engine/src/tools/tavily-search.tool.ts`: web research, gated behind an env key exactly as Postiz does.
- Tone/style control (Personal vs. Company voice) as a pipeline parameter, per PRD 5.5.

### Task 2 — Image generation
- `packages/ai-engine/src/tools/dalle-image.tool.ts`: DALL-E call, saving output directly into Sprint 4's media library.

### Task 3 — Conversational copilot
- `packages/ai-engine/src/agents/copilot.agent.ts`: chat-based assistant with a small tool set (list channels, draft/generate post content, generate image). Start stateless; add persistent memory only if real usage shows it's needed.
- Frontend: CopilotKit-based chat drawer in `apps/web/src/app/(dashboard)/[orgId]/ai-copilot/`.

### Task 4 — Credit metering
- `Credits`-equivalent tracking tied to `Subscription` tier (schema addition if not already covered in Sprint 1): deduct on each generation/image call, expose a balance meter in the UI.

## Definition of Done
- [ ] Given a topic, the pipeline produces a platform-ready post that visibly reflects web research (not just generic LLM knowledge) when Tavily is configured, and degrades gracefully (skips research) when it isn't.
- [ ] Tone toggle (Personal/Company) measurably changes output style.
- [ ] The copilot chat can answer "what channels do I have connected" using its list-channels tool, proving tool-calling actually works end-to-end.
- [ ] Each generation call deducts from the org's AI credit balance and is blocked once exhausted.

## Risks
- LLM cost/latency: stream responses (SSE) rather than blocking on full completion, and cache Tavily results briefly to avoid duplicate research calls on retries — both patterns Postiz's architecture doc calls out as mitigations worth adopting.
