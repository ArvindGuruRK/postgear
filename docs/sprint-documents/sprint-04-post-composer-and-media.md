# Sprint 4 — Post Composer & Media Library

> **PRD Coverage**: Section 5.3 (Post Creation & Content Management Module).
> **Depends on**: [Sprint 2](sprint-02-auth-and-organizations.md) (org scoping), [Sprint 3](sprint-03-social-integrations.md) (channels to target/preview).
> **Reference repo**: `D:\rk-personal-projects\postiz-app-main` (study only).

## Sprint Goal

A user can write a post once, target multiple connected channels, see a live per-platform preview, attach media (with compression), build a thread/carousel, and save it as a draft.

## Reference Study Guide

| Concept | Postiz Reference (study, don't copy) | What to Extract |
|---|---|---|
| Composer shell & multi-target selection | `apps/frontend/src/components/new-launch/add.edit.modal.tsx`, `editor.tsx`, `picks.socials.component.tsx`, `manage.modal.tsx`; entry point `apps/frontend/src/components/launches/new.post.tsx` | Overall composer UX flow: pick channels first, then one shared editor with per-channel override tabs. Note this is a **modal-based** composer in Postiz — decide if PostGear wants a modal or a dedicated route (`apps/web/.../composer/page.tsx` is already scaffolded as a route, which is a valid alternative design). |
| Per-platform preview cards | `apps/frontend/src/components/new-launch/providers/<platform>/<platform>.provider.tsx` + `.preview.tsx` (one folder per platform), generic wrapper `components/preview/preview.wrapper.tsx`, fallback `components/launches/general.preview.component.tsx` | The pattern of "one small preview component per platform, sharing a generic wrapper for anything without a custom preview" — directly reusable pattern for PostGear's `apps/web/src/components/previews/`. |
| Rich text editing | Postiz uses TipTap v3 (`@tiptap/react`, `@tiptap/starter-kit`) inside the composer components above | Confirms TipTap as the right library choice (already implied by `project_structure.md`); study how they scope per-platform character-limit validation against the same editor instance. |
| Media upload & compression | `libraries/nestjs-libraries/src/upload/{local.storage.ts,r2.uploader.ts,upload.factory.ts,upload.interface.ts}` | `upload.factory.ts`'s backend-selection-by-env pattern (local vs. R2) is worth keeping structurally so PostGear can develop against local disk and switch to S3/R2 in production via one env var. Image compression itself uses `sharp` — same library PostGear should use. |
| Design/graphic studio | `apps/frontend/src/components/launches/polonto.tsx` + `polonto/polonto.picture.generation.tsx` (Polotno canvas editor integration) | P1/P2 scope — not in this sprint's DoD, but worth knowing where Postiz wires Polotno in if PostGear adds an in-app graphic editor later. |

## PostGear Implementation Plan

Target locations: `apps/web/src/components/{composer,previews}/`, `apps/web/src/app/(dashboard)/[orgId]/composer/`, `apps/api/src/modules/posts/`, a media module (new — add under `apps/api/src/modules/media/` per `project_structure.md`'s conventions, plus a small uploader service, e.g. `packages/ui` is UI-only so the storage backend logic belongs in `apps/api`).

### Task 1 — Editor & multi-targeting
- Integrate TipTap in `apps/web/src/components/composer/editor.tsx`.
- Channel multi-select against Sprint 3's connected channels, with per-channel content override.

### Task 2 — Per-platform previews
- `apps/web/src/components/previews/<platform>.preview.tsx` for each MVP platform from Sprint 3, plus a generic fallback — mirroring the pattern studied above but written for PostGear's own post/channel types.

### Task 3 — Thread/carousel builder & draft lifecycle
- Reorderable list UI for multi-part posts (Twitter threads, LinkedIn carousels). Per the schema inherited in [Sprint 1](sprint-01-foundation-and-data-model.md), this maps to multiple `Post` rows: a cross-posted batch (same content, several channels) shares a `group` value, and a thread/reply chain links rows via `parentPostId` — there's no separate line-item table to build.
- Draft state machine using the schema's `State` enum (`DRAFT → QUEUE`, matching Postiz's naming — queuing itself is [Sprint 5](sprint-05-scheduling-and-publishing.md)'s job; this sprint only needs the state to exist and be settable).

### Task 4 — Media pipeline
- `apps/api/src/modules/media/`: upload endpoint, `sharp`-based compression/resizing, storage-backend selection (local for dev, S3/R2-compatible for prod) via an env-driven factory function.
- `apps/web/.../media/page.tsx`: library grid, search, one-click insert into composer.

## Definition of Done
- [ ] A post with text + image can be composed, targeted at 2+ channel types, and each shows an accurate live preview.
- [ ] A thread of 3+ items can be built and reordered.
- [ ] A draft can be saved and re-opened for editing.
- [ ] An uploaded image is auto-compressed and appears in the media library, reusable across posts.

## Risks
- Character-limit and media-constraint rules differ per platform (Sprint 3's providers should expose `maxLength`/media constraints so this sprint's validation doesn't hardcode platform rules in the UI layer).
