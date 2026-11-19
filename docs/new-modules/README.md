# New Modules: Design Studio, Workflow Builder, Discover and Clips

Four modules that set PostGear apart from other schedulers:

1. **Design Studio**: branded posts and carousels from templates, with brand colours taken from the user's website or picked by hand, edited inside fixed regions, previewed in a platform frame, and sent to the composer.
2. **Workflow Builder**: n8n-style automations for posting. Triggers (post published, post failed, schedule), AI, logic, PostGear actions, and notifications (Slack, Teams, Sheets, WhatsApp later) connected on a canvas.
3. **Discover** (Sprint 11, built in ten modules; see its completion checklist): what is trending where the audience is (search trends, local news in the local language, festivals, competitors, worldwide social topics), each item one click from an AI draft. Research in [`../sprint-11/`](../sprint-11/README.md).
4. **Clips** (Sprints 12 and 13; Sprint 12 built 2026-11-19 on `sprint-12-clips`, simulation only and not merged; Sprint 13 documents written, not built): paste a YouTube, Twitch or Kick link or upload a video, make clips by hand or with AI, edit them in a full-window video editor, export, and send them to the composer. Sprint 12 is the core ([`../sprint-12/`](../sprint-12/README.md)); Sprint 13 adds captions, AI that understands speech, following the speaker and the Python media service ([`../sprint-13/`](../sprint-13/README.md)), and starts only after Sprint 12 has been tested for real.

## Which file is what

| File | Role |
|---|---|
| [`../sprint-documents/sprint-09-design-studio.md`](../sprint-documents/sprint-09-design-studio.md) | **Build spec** for Design Studio, written against this codebase |
| [`../sprint-documents/sprint-10-workflow-builder.md`](../sprint-documents/sprint-10-workflow-builder.md) | **Build spec** for Workflow Builder, written against this codebase |
| [`../sprint-documents/sprint-11-discover.md`](../sprint-documents/sprint-11-discover.md) | **Build spec** for Discover, written against this codebase |
| [`user-stories-design-studio.md`](user-stories-design-studio.md) | **User stories** for Design Studio: personas, real journeys, acceptance criteria, UX rules, edge cases, completion checklist |
| [`user-stories-workflow-builder.md`](user-stories-workflow-builder.md) | **User stories** for Workflow Builder, same structure |
| [`user-stories-discover.md`](user-stories-discover.md) | **User stories** for Discover, same structure |
| [`../sprint-documents/sprint-12-clips.md`](../sprint-documents/sprint-12-clips.md) | **Build spec** for Clips (the core) |
| [`../sprint-documents/sprint-13-clips-ai.md`](../sprint-documents/sprint-13-clips-ai.md) | **Build spec** for Clips AI (captions, smarter AI, Auto-Reframe, the Python service) |
| [`user-stories-clips.md`](user-stories-clips.md) | **User stories** for Clips (prefix `CL-`), same structure |
| [`user-stories-clips-ai.md`](user-stories-clips-ai.md) | **User stories** for Clips AI (prefix `CA-`), same structure |
| [`CLAUDE_CODE_PROMPTS.md`](CLAUDE_CODE_PROMPTS.md) | One copy-paste prompt per build phase |
| `POSTGEAR_PRODUCT_PRD.md`, `POSTGEAR_USER_STORIES_AND_WALKTHROUGH.md`, `CAROUSEL_STUDIO_REQUIREMENTS.md`, `WORKFLOW_BUILDER_REQUIREMENTS.md`, `IMPLEMENTATION_PROMPT_FOR_CODING_AGENT.md` | First brainstorm drafts, generated outside this codebase. **Not a reference**: do not build from them. Kept only as a record of the original idea. |

## Key decisions in the sprint docs

- Studio templates are **data in code** (layout + theme + sample content), not database rows, so 100+ presets is a content task, and a shared template can never be edited by accident.
- The editor and the export use **one renderer** (`packages/design-engine`), and export screenshots it in the Playwright browser the SEO engine already runs, so what you edit is what you get.
- Website brand extraction **reuses the SEO crawler's SSRF guard**, and always shows a review screen before saving.
- Studio does not schedule: **Send To Composer** creates a draft, and the composer does channels, rules and timing.
- Workflow runs execute on **Temporal**, which gives durable delays and "wait for my review" steps for free.
- Lessons from TriForms' workflow audit are built in: **stable node keys** for data tokens, **immutable versions**, one token resolver shared by browser, API and worker.
- A clip is **one versioned document** drawn by **one composition** in the editor and in the export (Remotion), with video-anchored things in the video's time and overlays in the clip's time, so trims, cuts and speed changes never move anything by accident.
- Clips runs its heavy work on **its own Temporal queues**, keeps imported videos in **private storage**, and every sprint ends with a **real-test plan** that Arvind runs before the next one starts.
- Side effects are **dry in test runs**, `AUTOMATION_SIMULATION` covers every external provider locally, and nothing is shown as connected unless it really is.
