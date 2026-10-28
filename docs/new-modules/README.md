# New Modules: Design Studio and Workflow Builder

Two modules that set PostGear apart from other schedulers:

1. **Design Studio**: branded posts and carousels from templates, with brand colours taken from the user's website or picked by hand, edited inside fixed regions, previewed in a platform frame, and sent to the composer.
2. **Workflow Builder**: n8n-style automations for posting. Triggers (post published, post failed, schedule), AI, logic, PostGear actions, and notifications (Slack, Teams, Sheets, WhatsApp later) connected on a canvas.

## Which file is what

| File | Role |
|---|---|
| [`../sprint-documents/sprint-09-design-studio.md`](../sprint-documents/sprint-09-design-studio.md) | **Build spec** for Design Studio, written against this codebase |
| [`../sprint-documents/sprint-10-workflow-builder.md`](../sprint-documents/sprint-10-workflow-builder.md) | **Build spec** for Workflow Builder, written against this codebase |
| [`user-stories-design-studio.md`](user-stories-design-studio.md) | **User stories** for Design Studio: personas, real journeys, acceptance criteria, UX rules, edge cases, completion checklist |
| [`user-stories-workflow-builder.md`](user-stories-workflow-builder.md) | **User stories** for Workflow Builder, same structure |
| [`CLAUDE_CODE_PROMPTS.md`](CLAUDE_CODE_PROMPTS.md) | One copy-paste prompt per build phase |
| `POSTGEAR_PRODUCT_PRD.md`, `POSTGEAR_USER_STORIES_AND_WALKTHROUGH.md`, `CAROUSEL_STUDIO_REQUIREMENTS.md`, `WORKFLOW_BUILDER_REQUIREMENTS.md`, `IMPLEMENTATION_PROMPT_FOR_CODING_AGENT.md` | First brainstorm drafts, generated outside this codebase. **Not a reference**: do not build from them. Kept only as a record of the original idea. |

## Key decisions in the sprint docs

- Studio templates are **data in code** (layout + theme + sample content), not database rows, so 100+ presets is a content task, and a shared template can never be edited by accident.
- The editor and the export use **one renderer** (`packages/design-engine`), and export screenshots it in the Playwright browser the SEO engine already runs, so what you edit is what you get.
- Website brand extraction **reuses the SEO crawler's SSRF guard**, and always shows a review screen before saving.
- Studio does not schedule: **Send To Composer** creates a draft, and the composer does channels, rules and timing.
- Workflow runs execute on **Temporal**, which gives durable delays and "wait for my review" steps for free.
- Lessons from TriForms' workflow audit are built in: **stable node keys** for data tokens, **immutable versions**, one token resolver shared by browser, API and worker.
- Side effects are **dry in test runs**, `AUTOMATION_SIMULATION` covers every external provider locally, and nothing is shown as connected unless it really is.
