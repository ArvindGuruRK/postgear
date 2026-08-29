# PostGear — Sprint Documents Index

> **Purpose**: Module-by-module execution plan for building PostGear.
> **Method**: Postiz (`D:\rk-personal-projects\postiz-app-main`) is a **reference implementation only**. Every sprint below names the exact Postiz files that solve a given problem so you can study their approach — data model, control flow, edge cases, library choices. PostGear's own code is then written from scratch inside **our own structure** (`apps/web`, `apps/api`, `apps/worker`, `packages/*`, as defined in [`project_structure.md`](../../project_structure.md)), using our own types, our own Prisma schema, and our own naming.
>
> **Never**: copy a Postiz file/folder into PostGear verbatim, rename a Postiz class and call it done, or vendor a whole library wholesale — for *logic* (controllers, workflows, providers, agents, UI components). There are two deliberate, explicitly-decided exceptions to that rule, not precedents for more:
> 1. **The Prisma schema** — `packages/db/prisma/schema.prisma` is Postiz's real 48-model schema, kept as-is (see [Sprint 1](sprint-01-foundation-and-data-model.md)'s "Decision" note). A battle-tested multi-tenant data model is exactly the kind of asset worth inheriting wholesale under solo-dev time constraints; it gets extended with new models per-module (SEO, AI-specific tables, etc.) rather than replaced.
> 2. **Design tokens / CSS variables** — see [`../design-patterns/`](../design-patterns/README.md). Colors, spacing, and Tailwind theme config aren't business logic; PostGear imports Postiz's actual token system as a starting visual foundation. Note this import is now a smaller piece of the picture than originally planned — [Sprint 0](sprint-00-design-system.md) commits PostGear to a Neubrutalism + comic-book visual direction, which supersedes the original "just reskin the accent color" plan for anything shadow/color-philosophy related, while still keeping the imported light/dark-switching mechanism and naming conventions.
>
> **How these get used**: when you're ready to start a module, point at its sprint doc and ask something like *"do the same thing Postiz did for auth — explore it, then check our structure, then implement."* The sprint doc gives the concrete file map so that exploration is fast and repeatable instead of ad hoc.

## Sprint Sequence

| # | Sprint | PRD Modules Covered | Depends On |
|---|---|---|---|
| 0 | [Design System Foundation (Neubrutalism + Comic Style)](sprint-00-design-system.md) | — (cross-cutting; underlies every UI screen in every module below) | — |
| 1 | [Foundation, Environment & Data Model](sprint-01-foundation-and-data-model.md) | 5.12 Platform & Infra (partial) | — (sequenced after Sprint 0 by product decision, not a technical dependency — Sprint 1 is backend/infra, Sprint 0 is `apps/web`/`packages/ui`) |
| 2 | [Authentication, Organizations & RBAC](sprint-02-auth-and-organizations.md) | 5.1 Auth, 5.11 Org & Team | Sprint 1 |
| 3 | [Social Channel Integrations](sprint-03-social-integrations.md) | 5.2 Social Media Integration | Sprint 1, 2 |
| 4 | [Post Composer & Media Library](sprint-04-post-composer-and-media.md) | 5.3 Post Creation & Content | Sprint 2, 3 |
| 5 | [Scheduling & Auto-Publishing Engine](sprint-05-scheduling-and-publishing.md) | 5.4 Scheduling & Auto-Publishing | Sprint 3, 4 |
| 6 | [AI Content Engine & Copilot](sprint-06-ai-content-engine.md) | 5.5 AI-Powered Content Engine | Sprint 4 |
| 7 | [Analytics & SEO Score Prediction](sprint-07-analytics-and-seo-engine.md) | 5.6 Analytics, 5.7 SEO (net-new) | Sprint 3, 5 |
| 8 | [Billing, Notifications, Public API & Launch](sprint-08-billing-notifications-api-launch.md) | 5.8 Billing, 5.9 Notifications, 5.10 API/Webhooks, 5.12 (remainder) | Sprint 2–7 |

## Cross-Cutting Notes

- **Source of truth for scope**: [`../../prd.md`](../../prd.md) section 5 (Feature Modules) drives what each sprint must deliver. [`../../user_stories.md`](../../user_stories.md) has the acceptance-level detail per feature.
- **Source of truth for our own layout**: [`../../project_structure.md`](../../project_structure.md). If a sprint below needs a folder that doesn't exist yet under `apps/` or `packages/`, create it following that document's conventions rather than mirroring Postiz's `apps/backend` / `libraries/nestjs-libraries` naming.
- **Reference-only repo**: [`../../complete_codebase_and_architecture_analysis.md`](../../complete_codebase_and_architecture_analysis.md) is the high-level map of Postiz; each sprint doc below drills into the specific files relevant to that sprint's module.
- **Design system**: [Sprint 0](sprint-00-design-system.md) is the actual design-direction and component-standards document (Neubrutalism + comic style) — read it before any sprint touching `apps/web` or `packages/ui`. [`../design-patterns/`](../design-patterns/README.md) is the older token-import catalog (colors, Tailwind theme, shadows, animations from Postiz); still useful for what mechanism/naming got kept, but its `rebrand-plan.md` is superseded by Sprint 0's direction.
- **Older 4-sprint plan**: [`../../sprint_plan.md`](../../sprint_plan.md) was written before this deeper codebase analysis and groups work into four 2-week sprints with a Temporal/LangChain green-field design. It's superseded by this 8-sprint, module-by-module breakdown for day-to-day execution — keep it only for the original story-point/timeline estimates.
- **Sizing**: sprints here are sized by module, not by fixed calendar weeks — since you're a solo developer working with Claude Code, treat the "Task Breakdown" in each doc as an ordered checklist rather than a rigid 2-week box.
