# Sprint 4: Post Composer & Media Library

> **PRD Coverage**: Section 5.3 (Post Creation & Content Management Module).
> **Depends on**: [Sprint 2](sprint-02-auth-and-organizations.md) (org scoping), [Sprint 3](sprint-03-social-integrations.md) (channels to target/preview).
> **Reference repo**: `D:\rk-personal-projects\postiz-app-main` (study only for logic; UI inspiration allowed, see below).

> **UI revamp (2026-10-18)**: the composer and media library are being rebuilt to follow Postiz's UX. Screenshots `10` to `16` in [`../screenshots/`](../screenshots/README.md) are the target; the Postiz source is `apps/frontend/src/components/new-launch/` and `components/media/`. Take the pattern, write the code fresh in PostGear's components (Postiz is AGPL-3.0). This reverses the earlier choice of a dedicated `/composer` route: the composer becomes a modal opened from the calendar, the sidebar and empty calendar slots.
>
> **Built 2026-10-19.** The modal is a Next.js intercepting route: `[orgId]/@modal/(.)composer` catches any in-app navigation to `/[orgId]/composer` and opens the composer over the current page. The composer is never a page of its own: a reload or shared link opens the same modal over the calendar, from the non-intercepting `[orgId]/@modal/composer`, while `[orgId]/composer/page.tsx` only renders the calendar beneath it. Both load through `lib/composer-data.ts` and render `Composer` with `opened="in-app" | "direct"`: in-app, closing goes back in history; direct, it goes to the calendar. `@modal/[...catchAll]` closes the slot on other navigations. An "Enter fullscreen" button beside close (after Buffer, screenshots `17` to `19`) stretches the modal to the window, keeps the editor at a reading width, and is remembered per browser. Saves and deletes fire `postgear:posts-changed` (`lib/post-events.ts`) so the calendar and queue underneath refresh at once. Closing with unsaved writing asks first. Not built yet, because PostGear has no backend for them: tags, repeat, per-provider settings, design media, AI image/video from the toolbar, and "Post now" from the main button.
>
> Target composer layout:
> - **Header**: "Create Post" on the left (or the edit state when editing), close on the right of the preview column.
> - **Left column, editor**: connected-channel avatars across the top as the target picker (selected ones get a ring); a global-edit button and, once channels are picked, one tab per channel for per-channel overrides; the editor itself; a toolbar under it (Insert Media, Design Media, AI Image, AI Video, signature, underline, bold, emoji) with a validity badge and character counter (`292/3000`) on the right; attached media as thumbnails inside the editor; "Add comment / post" for threads; a collapsible per-channel Settings bar for platform-specific options.
> - **Right column, Post Preview**: "Start writing your post for a preview" when empty, a generic card in global edit, the platform-styled card (for example LinkedIn with reactions and Like / Comment / Repost / Send) when a channel tab is focused.
> - **Footer**: Add New Tag and Repeat Post on the left; Delete Post (edit only), the date-time picker, Save as draft and the primary split button on the right. The primary label tells the user what is missing ("Check the circles above") until the post is valid, then reads "Add to Calendar", or "Update" when editing.
> - **Media Library modal**: search by file name with Upload beside it, square thumbnail grid with file names over each tile, expand on hover, delete in the corner, Cancel and "Add selected media" in the footer.
> - **AI modals**: "Generate AI Image" with a prompt box, a row of style chips and one full-width Generate button; "Generate Posts" with a free-text brief, output format and voice selects, an "Add pictures?" checkbox and one Generate button.

## Sprint Goal

A user can write a post once, target multiple connected channels, see a live per-platform preview, attach media (with compression), build a thread/carousel, and save it as a draft.

## Reference Study Guide

| Concept | Postiz Reference (study, don't copy) | What to Extract |
|---|---|---|
| Composer shell & multi-target selection | `apps/frontend/src/components/new-launch/add.edit.modal.tsx`, `editor.tsx`, `picks.socials.component.tsx`, `manage.modal.tsx`; entry point `apps/frontend/src/components/launches/new.post.tsx` | Overall composer UX flow: pick channels first, then one shared editor with per-channel override tabs. Note this is a **modal-based** composer in Postiz: decide if PostGear wants a modal or a dedicated route (`apps/web/.../composer/page.tsx` is already scaffolded as a route, which is a valid alternative design). |
| Per-platform preview cards | `apps/frontend/src/components/new-launch/providers/<platform>/<platform>.provider.tsx` + `.preview.tsx` (one folder per platform), generic wrapper `components/preview/preview.wrapper.tsx`, fallback `components/launches/general.preview.component.tsx` | The pattern of "one small preview component per platform, sharing a generic wrapper for anything without a custom preview": directly reusable pattern for PostGear's `apps/web/src/components/previews/`. |
| Rich text editing | Postiz uses TipTap v3 (`@tiptap/react`, `@tiptap/starter-kit`) inside the composer components above | Confirms TipTap as the right library choice (already implied by `project_structure.md`); study how they scope per-platform character-limit validation against the same editor instance. |
| Media upload & compression | `libraries/nestjs-libraries/src/upload/{local.storage.ts,r2.uploader.ts,upload.factory.ts,upload.interface.ts}` | `upload.factory.ts`'s backend-selection-by-env pattern (local vs. R2) is worth keeping structurally so PostGear can develop against local disk and switch to S3/R2 in production via one env var. Image compression itself uses `sharp`: same library PostGear should use. |
| Design/graphic studio | `apps/frontend/src/components/launches/polonto.tsx` + `polonto/polonto.picture.generation.tsx` (Polotno canvas editor integration) | P1/P2 scope, not in this sprint's DoD, but worth knowing where Postiz wires Polotno in if PostGear adds an in-app graphic editor later. |

## PostGear Implementation Plan

Target locations: `apps/web/src/components/{composer,previews}/`, `apps/web/src/app/(dashboard)/[orgId]/composer/`, `apps/api/src/modules/posts/`, a media module (new; add under `apps/api/src/modules/media/` per `project_structure.md`'s conventions, plus a small uploader service, e.g. `packages/ui` is UI-only so the storage backend logic belongs in `apps/api`).

### Task 1: Editor & multi-targeting
- Integrate TipTap in `apps/web/src/components/composer/editor.tsx`.
- Channel multi-select against Sprint 3's connected channels, with per-channel content override.

### Task 2: Per-platform previews
- `apps/web/src/components/previews/<platform>.preview.tsx` for each MVP platform from Sprint 3, plus a generic fallback: mirroring the pattern studied above but written for PostGear's own post/channel types.

### Task 3: Thread/carousel builder & draft lifecycle
- Reorderable list UI for multi-part posts (Twitter threads, LinkedIn carousels). Per the schema inherited in [Sprint 1](sprint-01-foundation-and-data-model.md), this maps to multiple `Post` rows: a cross-posted batch (same content, several channels) shares a `group` value, and a thread/reply chain links rows via `parentPostId`; there's no separate line-item table to build.
- Draft state machine using the schema's `State` enum (`DRAFT → QUEUE`, matching Postiz's naming: queuing itself is [Sprint 5](sprint-05-scheduling-and-publishing.md)'s job; this sprint only needs the state to exist and be settable).

### Task 4: Media pipeline
- `apps/api/src/modules/media/`: upload endpoint, `sharp`-based compression/resizing, storage-backend selection (local for dev, S3/R2-compatible for prod) via an env-driven factory function.
- `apps/web/.../media/page.tsx`: library grid, search, one-click insert into composer.

## Definition of Done

> **Completion checklist**: [sprint-04-completion-checklist.md](../sprint-completion-checklists/sprint-04-completion-checklist.md), covering what shipped, a test command for every item, and the known gaps.

- [x] A post with text + image can be composed, targeted at 2+ channel types, and each shows an accurate live preview. **Verified across X, LinkedIn and Instagram at once**: each preview renders the exact text that platform receives (Unicode-styled bold, list bullets, expanded links), its media layout, and its thread structure; counters measure each platform's way. Browser test: `composer.spec.ts` › *composes text and an image for three platforms*.
- [x] A thread of 3+ items can be built and reordered, by buttons, by pointer drag and by keyboard drag. Browser test: *builds a three-part thread and reorders it*.
- [x] A draft can be saved and re-opened for editing, by URL after a reload and from the Saved posts list, including a channel's customized version. A save from a stale copy is refused rather than overwriting. Browser tests: *saves a draft…*, *refuses a save made from a stale copy…*.
- [x] An uploaded image is auto-compressed and appears in the media library, reusable across posts. **Verified against a raw file**: a 10.2 MB photo stored as 708 KB at 2048×1536 with its GPS EXIF removed, on local disk and on MinIO through the S3 backend. Browser test: `media.spec.ts` › *compresses an upload, lists it, and reuses it across two posts*.

### Added beyond the original scope

- [x] **Declarative platform rules in `social-core`** (the risk below, retired): every provider declares `ProviderRules`, the API sends them to the composer, and one validator runs in the browser, before queueing, and inside every provider's `checkValidity`.
- [x] **Three Sprint 3 publishing gaps closed**: LinkedIn now actually attaches images (Sprint 3 posted the text and dropped them); Pinterest video and TikTok images, which the providers could not publish, are refused up front instead of failing later.
- [x] **Queue validation**: `DRAFT` accepts unfinished work; `QUEUE` requires a future time, a set-up channel and every platform rule, with every blocker listed per channel.
- [x] **Optimistic concurrency** in a serializable transaction: two saves from the same version produce one success and one 409, never a silent overwrite.
- [x] **Content sniffing and privacy stripping** on upload: type decided by bytes, EXIF/GPS removed server-side, disguised files refused.
- [x] **Delete with consequences stated**: deleting media names how many unpublished posts use it.
- [x] **A third seeded channel (Instagram)**, so the rules that differ most can be seen without connecting anything.

### Deviations from this document, and why

| This doc said | What shipped | Why |
|---|---|---|
| The reference's "image compression itself uses `sharp`" | **Server-side compression, written fresh** | The reference compresses in its frontend and trusts uploads; `sharp` appears only at publish time. A client-side step can be skipped by any other client, and GPS stripping is only a guarantee if it cannot. |
| Rich text via TipTap (storage format unstated; the reference stores HTML) | **TipTap, stored as a JSON document** | The reference renders stored HTML with `dangerouslySetInnerHTML` in every preview. A closed JSON schema has nothing to sanitize, and previews render text as text. |
| "Twitter threads, LinkedIn carousels" both map to multiple `Post` rows | **Threads are row chains; a carousel is several media on one part** | Every provider publishes a carousel or multi-image post as one post; a second row becomes a reply (X) or a comment (LinkedIn, Facebook, Instagram), which is a thread, not a carousel. |
| (unstated) the reference's `group` | **One group id minted per post** | The reference mints a new group inside its per-channel loop, so a cross-posted batch is never actually one group. |
| (unstated) row identity on edit | **Rows matched by position; no client-supplied ids** | The reference upserts by a client-supplied id without an organization filter: a cross-tenant overwrite. Position matching also keeps each channel's root row stable for Sprint 5. |
| Modal or route | **Route** (`/[orgId]/composer`) | A draft gets a URL: reloadable, bookmarkable, and reachable from the media library's "Use in a post". |
| Previews per MVP platform + generic | **Seven previews for eight providers** + generic | LinkedIn profiles and Pages look identical in the feed and share one. |

## Risks
- ~~Character-limit and media-constraint rules differ per platform (Sprint 3's providers should expose `maxLength`/media constraints so this sprint's validation doesn't hardcode platform rules in the UI layer).~~ **Retired**: providers declare `ProviderRules`; `apps/web` contains no platform rule. See the checklist, section 1.
- **Local storage cannot publish media to Instagram, Facebook, Pinterest or TikTok**, which fetch media by URL themselves. Sprint 5 needs a public bucket (`STORAGE_PROVIDER=s3`) or a tunnel to test media publishing end to end; TikTok also needs a verified domain.
- **LinkedIn image upload has only been exercised against mocks.** It is the first thing to test once a LinkedIn developer app exists.
