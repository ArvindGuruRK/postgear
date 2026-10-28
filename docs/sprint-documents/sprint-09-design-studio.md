# Sprint 9: Design Studio (Template-Based Posts and Carousels)

> **PRD Coverage**: new module, not in `prd.md` section 5 yet.
> **User stories**: [`../new-modules/user-stories-design-studio.md`](../new-modules/user-stories-design-studio.md) holds the journeys, acceptance criteria, UX rules and the completion checklist. They are part of this sprint's scope, including the few small items they add beyond this document (example templates in the empty state, brand kit update offers, Download All). This document decides *how* to build; the stories decide *what the user experiences*.
> **Depends on**: [Sprint 4](sprint-04-post-composer-and-media.md) (media library, composer drafts), [Sprint 7](sprint-07-analytics-and-seo-engine.md) (the SEO crawler's SSRF guard, safe fetch and Playwright browser pool).
> **Branch**: `sprint-9-design-studio`, cut from `ui-revamp`.
> **Reference**: Postiz ships a design editor built on Polotno (`postiz-app-main/apps/frontend/src/components/launches/polonto.tsx`). Study it only for where the editor opens from and how the result lands in the composer. **Do not adopt Polotno**: it needs a paid commercial licence, it is a free-form Canva clone (the opposite of the constrained template editor below), and its look cannot follow the design system.

## Sprint Goal

A user opens **Studio** from the rail, sets up their brand (from their website or by hand), picks a format and a template, edits text, logo and colours inside fixed regions, previews the result as it would look on a platform, exports the slides as images into the Media library, and sends them to the composer as a draft post. Single posts and multi-slide carousels use the same editor.

**What this is not**: a free-form design tool. Users fill and nudge a template; they do not draw. That constraint is the product: every output stays on-brand and readable, and it keeps the editor small enough to build well.

## Names And Placement

| Thing | Name |
|---|---|
| Rail label (fits the 64px tile) | Studio |
| Top bar page name | Design Studio |
| Route | `/[orgId]/studio`, editor at `/[orgId]/studio/[designId]` |
| Rail position | after Media (Studio makes media, so it sits next to it) |
| Primary action | Create Design |

Rail icon: an animated `@animateicons/react` icon (layout, palette or pen-tool family; pick one that animates well), wired the same way as the other `RAIL` entries in `apps/web/src/components/navigation/dashboard-shell.tsx`.

## User Flow

```
Studio landing ── Create Design ──> 1. Brand ──> 2. Format ──> 3. Template ──> Editor
     │                              (skippable)                                  │
     └── recent designs (open, duplicate, rename, delete)                        │
                                                                                 v
                                        Preview (eye icon) ──> Export ──> Send To Composer
                                                    └──> Share (P1)
```

### Screen 1: Studio Landing

- `PageActions` row: Create Design (primary), search field, format filter.
- **Recent Designs** grid: thumbnail, title, format badge, slide count, updated time, status badge (Draft, Exported, Sent). Card menu: Open, Duplicate, Rename, Delete (solid red, confirm dialog).
- **Brand Kits** strip: the workspace's saved brands with their swatches and logo; Edit and New Brand Kit.
- Empty state (sentence case): "No designs yet. Create your first post or carousel from a template." with Create Design.

### Screen 2: Create Design Wizard

One question per screen, the same rhythm as onboarding (see the onboarding revamp memory). Back and Continue on every step; the wizard state lives in the URL so a refresh does not lose it.

**Step 1, Brand** (skippable):
- Choose an existing brand kit, or New Brand Kit.
- New: Brand Name, Website URL, Logo upload, Colours (primary, secondary, accent, background, text) with a colour picker and a hex field each.
- Extract From Website: fetches the URL server-side, then shows a review screen with every found value editable (name, description, up to 6 logo candidates to pick from, up to 8 colour candidates to assign to roles). Nothing is saved until the user clicks Save Brand Kit.
- Extraction failure never blocks: the error says why in one sentence ("We could not reach that site." / "That address is not public.") and the form stays filled in for manual entry.
- Skip uses the template's own theme colours.

**Step 2, Format**:

| Format | Ratio | Export size | Hover hint |
|---|---|---|---|
| Square | 1:1 | 1080 x 1080 | Instagram, Facebook, LinkedIn and X feed posts |
| Portrait | 4:5 | 1080 x 1350 | Instagram and Facebook portrait feed posts |
| Story | 9:16 | 1080 x 1920 | Stories, Reels and Shorts covers |
| Landscape | 16:9 | 1920 x 1080 | X and LinkedIn link-style images, YouTube thumbnails |

The hint is guidance, not a promise: at Send time the composer's own platform rules (`packages/social-core/src/composer/rules.ts`) are what accept or refuse the media.

**Step 3, Template**: the gallery (below). Choosing a preset creates the design (a copy) and opens the editor. "Start From Blank" uses the plain layout with the brand theme.

### Screen 3: Template Gallery

- Search by name; filter by category, format, and colour style (light, dark, colourful); Favourites.
- Categories: Tips, Educational, Announcement, Product, Quote, Listicle, Statistic, Case Study, Promotion, Story, Event, Hiring.
- Card: rendered thumbnail (the real renderer at small scale, not a stored image, so a new theme never needs new thumbnails), name, category, slide count, formats supported.
- The thumbnails are recoloured with the chosen brand kit live, so the user sees their colours before choosing.

### Screen 4: Editor

```
┌ PageActions: Title (inline rename) | Saved state | Undo Redo | Reset | Preview (eye) | Export | Send ┐
├──────────────┬─────────────────────────────────────────────────────┬────────────────────────────────┤
│ Slides rail  │                   Canvas (active slide)             │ Properties panel               │
│ thumbnails,  │   regions outlined while dragging or on hover       │ selected element: text, size,  │
│ add, dup,    │   click a text to edit in place                     │ alignment, colour role, show/  │
│ delete,      │                                                     │ hide; slide: layout, background│
│ drag reorder │                                                     │ design: theme, brand kit       │
└──────────────┴─────────────────────────────────────────────────────┴────────────────────────────────┘
```

Editable elements (a template decides which of these it has):

| Element | What the user can change |
|---|---|
| Header | logo placement, brand name text |
| Eyebrow | short text |
| Headline | text, size step (S, M, L), alignment |
| Subheadline | text |
| Body | text or a bullet list (add and remove items) |
| Footer | text, handle, CTA |
| Logo | which logo, header, footer or centre slot when the template offers it |
| Image | a picture from the Media library (media picker dialog already exists) |
| Background | theme colour role, brand colour, or a picture with an overlay |

Behaviour:
- **Two ways to edit text**: click into the canvas (contenteditable on the slot) or use the field in the properties panel. Both edit the same state.
- **Constrained movement**: each element belongs to one region (header, body, footer, or the template's own). Dragging is clamped to the region's rectangle; while dragging, the region outline and a small region label show, and the element stops at the edge (with a short edge highlight so it does not feel broken). An element cannot change region.
- **Text fit**: text auto-shrinks down to the slot's minimum size, then the slot shows a warning ring and the panel says "This text is too long for this space." Nothing is cut silently.
- **Contrast guard**: when a colour change puts text under WCAG AA contrast against its background, the panel warns and offers Fix Contrast (switch the text to the theme's light or dark ink).
- **Undo, Redo, Reset**: Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z; Reset restores the current slide to the template (confirm), Reset Design restores everything.
- **Slides**: add (choose a slide layout: cover, content, list, quote, closing CTA), duplicate, delete, drag to reorder (`@dnd-kit/sortable` is already installed). Limit 20 slides.
- **Autosave**: debounced 1.5 s after the last change, with the indicator showing Saving, Saved, Offline or "Could not save. Retrying." Saved appears only after the API confirms. A `revision` number guards against two tabs overwriting each other: on conflict, show "This design changed in another tab." with Reload.
- **Leave guard**: unsaved changes prompt before navigation.
- **Keyboard**: every control reachable; arrow keys nudge the selected element by 1% (Shift for 5%) inside its region; Delete hides the selected optional element.
- Small screens: the slides rail and properties panel become `Sheet` drawers, the canvas stays.

### Screen 5: Preview

Opened with the eye icon (a `MotionIcon`). A dialog or full-screen overlay:
- Platform switch: Instagram, Facebook, LinkedIn, X (the ones that take the chosen format).
- A mock of the platform frame: the workspace avatar and name, the caption field (editable here and carried to Send), the slides as a swipeable carousel with dots, and like, comment and share icons **without counts**.
- A clear "Preview" badge. Nothing may suggest the post is live or has engagement.
- Reuse the composer's `preview-panel.tsx` pieces where they fit rather than building a second set of platform frames.

### Screen 6: Export And Send

- **Export**: renders every slide server-side at the exact export size, in slide order, and saves each as a Media row named `{design title} {nn}.{ext}`. Default format JPEG (quality 92), because the composer's Instagram rule accepts JPEG only; PNG is a choice for other uses. Progress streams per slide ("Rendering slide 3 of 7"). A failed slide fails the export with a reason and keeps the slides already saved.
- **Download**: a zip of the exported images (P1; a per-image download is enough for P0).
- **Send To Composer**: exports if the design changed since the last export, then creates a `DRAFT` post through the posts API with the images attached in order and the caption from Preview, and opens it in the composer (the same door the AI "Open in composer" uses, see `apps/api/src/modules/ai/tools/copilot-tools.ts`). Channels, schedule and platform validation all happen in the composer; Studio does not grow its own scheduler.
- **Share** (P1): see Task 7.

## Technical Design

### New package: `packages/design-engine`

Browser-safe TypeScript and React (no Node built-ins, the same rule as `social-core/composer`), so the web editor and the API exporter render from the **same code**. That is what makes the preview honest: what you edit is what is exported.

```
packages/design-engine/src/
  types.ts            DesignDocument, Slide, ElementState, Layout, Region, Slot, Theme, Format
  schema.ts           Zod schema for DesignDocument (with schemaVersion and upgrade())
  formats.ts          the four formats, sizes, hover hints
  layouts/            one file per layout: regions and slots per format, slide roles
  themes/             colour and font themes
  presets.ts          the gallery: layout + theme + sample content + category + tags
  brand.ts            applyBrand(theme, brandKit): map brand colours onto theme roles,
                      pick readable ink, never produce text below AA contrast
  constraints.ts      clampToRegion(), regionOf(), pure and unit tested
  fit.ts              text fitting (pure measure function injected; canvas in browser,
                      the same metrics at export because export also runs in a browser)
  history.ts          undo/redo reducer
  render/SlideView.tsx  renders one slide at native pixels; mode "edit" adds slot
                      handles and region outlines, mode "export" renders nothing extra
  fonts/              self-hosted OFL font files + LICENSE notes
```

**Templates are data in code, not database rows.** They are versioned with git, reviewed like code, render-tested, and cost nothing to store. A design row stores the preset id it came from plus its own copy of the content; layouts are versioned (`layoutId` + `version`) and old versions stay in code until an `upgrade()` step migrates documents. The database never holds a template, so "never modify the shared template" is true by construction.

**Getting to 100+ templates**: a preset is a layout combined with a theme and sample content. Twelve to fifteen solid layouts times eight to ten themes gives well over 100 distinct presets without hand-drawing 100 designs. Launch with **40 curated presets**; the structure must make the next 60 a content task, not an engineering one.

**Typography inside designs**: CLAUDE.md's "one font, Sora" rule is about the **app's UI**. Designs are user content and need choice, so themes pick from a small curated set of OFL fonts bundled in `fonts/` (for example Sora, Inter, Poppins, Space Grotesk, Archivo Black, DM Serif Display, Playfair Display, JetBrains Mono). The Studio chrome around the canvas still uses the app's role utilities only.

**Coordinates**: regions and slots are stored in percentages of the canvas, per format, so one layout definition serves all four formats and the editor can scale the canvas freely. The renderer converts to pixels for the export size.

### Document shape (the JSON stored on the `Design` row)

```ts
interface DesignDocument {
  schemaVersion: 1;
  format: 'square' | 'portrait' | 'story' | 'landscape';
  presetId: string;
  themeId: string;
  brand: { kitId: string | null; colors: BrandColors; logoMediaId: string | null; name: string | null };
  slides: Array<{
    id: string;                 // stable, client generated
    layoutId: string;           // e.g. "split-headline@1"
    background: { kind: 'role'; role: ColorRole } | { kind: 'color'; hex: string } | { kind: 'media'; mediaId: string; overlay: number };
    elements: Record<SlotId, {
      text?: string;            // plain text; list items separated in `items`
      items?: string[];
      mediaId?: string;
      hidden?: boolean;
      offset?: { x: number; y: number };   // % inside the slot's region, clamped
      size?: 'sm' | 'md' | 'lg';
      align?: 'start' | 'center' | 'end';
      colorRole?: ColorRole;
    }>;
  }>;
}
```

Everything a template does not allow is rejected by the Zod schema on the API (`.strict()`), so the client cannot store arbitrary CSS.

### Database (use the `prisma-change` skill)

| Model | Fields (beyond id, organizationId, timestamps, deletedAt) | Notes |
|---|---|---|
| `BrandKit` | name, websiteUrl?, logoMediaId?, colors Json, description?, source (`MANUAL`, `EXTRACTED`), createdById | Several per workspace: agencies run many brands |
| `Design` | title, format enum, presetId, brandKitId?, document Json, revision Int, status (`DRAFT`, `EXPORTED`, `SENT`), exportedMediaIds String[], lastExportedRevision Int?, createdById | Slides live inside `document`: they are edited and saved as one unit, and a JSON column with a versioned Zod schema avoids hundreds of tiny row writes per autosave |
| `DesignShare` (P1) | designId, tokenHash, expiresAt, revokedAt?, createdById | Token shown once, stored hashed |

Write the reasons into `packages/db/prisma/SCHEMA_NOTES.md`, as every earlier sprint did.

### API module: `apps/api/src/modules/studio` (use the `new-api-module` skill)

| Route | What it does |
|---|---|
| `GET /studio/designs` | list with search, format filter, paging |
| `POST /studio/designs` | create from `{ presetId, format, brandKitId? }`; the server builds the document from the preset |
| `GET /studio/designs/:id` | one design |
| `PATCH /studio/designs/:id` | `{ revision, title?, document? }`; 409 on a stale revision |
| `POST /studio/designs/:id/duplicate`, `DELETE /studio/designs/:id` | soft delete |
| `POST /studio/designs/:id/export` | SSE stream: per-slide progress, then the Media ids |
| `POST /studio/designs/:id/send` | export if stale, create the DRAFT post, return its id for the composer |
| `GET/POST/PATCH/DELETE /studio/brand-kits` | brand kit CRUD |
| `POST /studio/brand-kits/extract` | `{ url }` → candidates only, never saves; throttled per workspace |
| `POST/DELETE /studio/designs/:id/shares`, `GET /public/design-shares/:token` (P1) | share links; the public route is `@Public()` |

Every query scoped by `organizationId` from `@CurrentOrg()`; user-facing strings in `studio.messages.ts`.

### Website brand extraction

Reuse the SEO engine, do not write a second fetcher: `assertSafeUrl` (`packages/seo-engine/src/crawler/url-guard.ts`) and `safe-fetch.ts` already block private addresses, credentials in URLs, odd ports, unsafe redirects and DNS rebinding. On top:
- Fetch the home page only (plus up to two linked stylesheets, each capped at 500 KB). Plain fetch first; the browser pool only if the page is an empty JS shell.
- **Name**: `og:site_name`, then `application-name`, then the `<title>` before its first separator.
- **Logo candidates**: `apple-touch-icon`, `icon` links, `og:image`, `<img>` whose src, alt or class mentions "logo", inline `<svg>` inside the header. Each candidate is downloaded through safe fetch, capped at 2 MB, and its type sniffed with `apps/api/src/modules/media/file-type.ts`. Candidates are returned as previews; only the one the user picks becomes a Media row, on Save.
- **Colours**: `theme-color` meta, CSS custom properties whose names suggest brand (`--primary`, `--brand`, `--accent`...), button and link colours; ranked by frequency, near-greys dropped, near-duplicates merged. Return up to 8 with a suggested role each.
- 10 s total deadline, 5 extractions per minute per workspace.

### Export renderer

Export renders `SlideView` (mode `export`) to static HTML with `react-dom/server`, inlines the fonts and images as data URIs (no network during render), loads it into a page from the SEO engine's Playwright browser pool with `page.setContent`, and screenshots at the exact export size. It runs in the API over SSE, the same way SEO audits already use the pool there. Read `packages/seo-engine/src/crawler/browser.pool.ts` first and expose a small `renderHtmlToImage()` from it (or move the pool somewhere shared) rather than starting a second Chromium.

There is no fallback without a browser: if Playwright's Chromium is missing, export fails with a clear message and the fix (`npx playwright install chromium`) is printed to the API console. Rendering in the browser instead (html-to-image style) was considered and rejected: fonts and sub-pixel layout differ between users' machines, and the output would not be reproducible.

## Task Breakdown

Ordered checklist; each task ends with `verify-change`.

### Task 1: The engine and the first presets (P0)
- `packages/design-engine` as above, wired into tsconfig `paths` and Jest like the other packages.
- 6 layouts (cover headline, split headline, list, quote, statistic, closing CTA) x 6 themes, 4 formats each.
- Unit tests: `clampToRegion`, schema `.strict()` refusals, `applyBrand` contrast guarantees, `upgrade()`.
- A `/dev/studio` playground page rendering every preset in every format (the design-system playground pattern), so the templates can be checked by eye in light and dark app themes, including Lilac.

### Task 2: Data and API (P0)
- Prisma models and migration (run `migrate:deploy` and `db:generate` yourself, per CLAUDE.md).
- `studio` module: designs CRUD with revision checks, brand kits CRUD, extraction endpoint.
- Seed: one brand kit and two designs for `seed-demo-org`.
- Specs: tenancy (another workspace's design is a 404), stale revision is a 409, extraction refuses `http://localhost`, `http://169.254.169.254`, a private IP and a redirect to one.

### Task 3: Landing and wizard (P0)
- Rail entry, landing page, wizard steps 1 to 3, gallery with search and filters and live brand recolouring.
- Use the `new-page` skill: `PageActions` first, no in-page title, Title Case names, "Enter your ..." placeholders, DS `Alert` for errors, `bg-chrome` for big surfaces.

### Task 4: Editor (P0)
- Canvas with region outlines and constrained drag, inline and panel text editing, slides rail with reorder, properties panel, undo/redo/reset, autosave indicator, leave guard, keyboard nudging, drawer layout on small screens.

### Task 5: Preview, export, send (P0 preview, P1 export and send)
- Preview overlay with platform frames and the Preview badge.
- Export over SSE into Media; Send To Composer through the posts API.

### Task 6: Template expansion (P0 to 40, then ongoing)
- Grow to 12+ layouts and 40 curated presets across the categories. Every new preset is covered by a render test (renders in all its formats without overflow on its sample content).

### Task 7: Share links (P1)
- Create Share Link (expiry 7 days by default, up to 30), Copy, Revoke. The share page at `/share/design/[token]` (outside the dashboard layout, `noindex`) shows the slides and the platform preview with the Preview badge, and the workspace name. No sign-in, no comments, no approve buttons: approvals are P2.

## Definition Of Done

- [x] Studio is in the rail, opens the landing page, and Create Design walks Brand, Format, Template into the editor. **Verified live**: four clicks and 2.0 s from the landing to the editor, and e2e 9.1 (checklist §10 DS-1.1, DS-3.5).
- [x] A design can be created with no website, and with a website whose extracted values are reviewed and edited before saving. **Verified live**: python.org and mozilla.org extracted, reviewed and edited before Save, plus Skip For Now and a kit typed by hand (checklist §4, §10 DS-2.1 to DS-2.4).
- [x] Extraction refuses private, loopback, link-local and metadata addresses, including through a redirect (API specs). **Verified**: the Task 2 specs refuse each one, a redirect into a private network included, with a 422 and a `studio.unsafe_url` log line, and the dialog says "That address is not public." live (checklist §4.8).
- [x] The gallery shows 40 presets, filters by category, format and style, searches by name, and recolours to the chosen brand. **Verified live** with 47 presets: every filter, the search, and thumbnails in the chosen kit's colours and logo (checklist §10 DS-3.2, DS-3.3).
- [x] Choosing a preset creates a copy; editing it never changes the preset or another design. **Verified**: `documentFromPreset` deep-copies (its spec), and live the preset and the other designs stayed unchanged (checklist §10 DS-3.5).
- [x] Text, logo, image, colours and size steps can be edited; elements cannot leave their region; long text warns instead of being cut. **Verified live**: every edit, a drag stopped at its area's edge, and a 366-character headline shrank, then warned in the panel, the rail and Export (checklist §10 DS-4.1 to DS-4.7).
- [x] Slides can be added, duplicated, deleted and reordered, up to 20. **Verified live**: 20 of 20 stops Add Slide and Duplicate with the reason; drag, Move Up and Move Down reorder; Delete has Undo (checklist §10 DS-5.1, DS-5.2).
- [x] Undo, redo and reset work; autosave shows Saved only after the API confirms; two tabs cannot silently overwrite each other. **Verified live**: 55 steps undone, Saved only after the 200, and a stale second tab gets the conflict notice with the server untouched (checklist §10 DS-4.8, DS-6.1, DS-6.2).
- [x] Preview shows every slide in the chosen format inside an Instagram, Facebook, LinkedIn and X frame, with no engagement counts and a Preview badge. **Verified live**: the four frames for square, portrait and landscape (a Story in the three that take its shape), a Preview badge in each, no numbers (checklist §10 DS-7.1).
- [x] Export saves one Media row per slide, in order, at the exact export size, and the files pass the composer's Instagram rules. **Verified live and by spec**: 01 to 05.jpg at 1080 x 1350 in slide order, exact sizes and pixels in real Chromium, and `export-compliance.spec.ts` through the composer's Instagram validator (checklist §5, §10 DS-8.1).
- [x] Send To Composer opens a draft with the images attached in order and the caption carried over. **Verified live** up to the DRAFT (the images in order, the caption exact); everything after the draft is **in simulation** (checklist §10 DS-8.2).
- [x] (P1) A share link shows a read-only preview to someone not signed in, and stops working when revoked or expired. **Verified live**: signed out on a phone and a desktop; revoked, made-up and expired tokens answer 404 with "This link is no longer available." (checklist §10 DS-9.2).
- [x] `npm run validate` passes; an e2e spec covers create, edit, export and send. **Verified**: `npm run validate` 39 of 39 tasks and `e2e/studio.spec.ts` 7 passed (create, edit, export, send and share), both on 2026-10-28 after the last code change (checklist §9).
- [ ] Every line of the user stories' completion checklist (section 6) is ticked. **Not yet**: 41 of the 43 lines are ticked; the other two need a person, walking Journeys A to D by hand and a first-time user exporting a carousel in under ten minutes (checklist §10 and What remains).

## Out Of Scope (P2, later sprints)

AI-written slides ("Write my carousel about X" through the content agent and the Workflow Builder's Render Design node), LinkedIn PDF document carousels (needs provider support for documents), animated or video templates, a formal approval flow on shares, premium templates gated by plan (the appearance themes' free and premium split is the model), user-saved custom templates, team template libraries.

## Risks

- **Export fidelity**: the editor and the export must render the same. Mitigated by one renderer package and server-side rendering in a real browser; add a snapshot test that renders a preset and compares its PNG size and a few pixel samples.
- **Font licensing**: bundle OFL fonts only, keep each licence file next to its font.
- **Extraction quality varies a lot by site**: the review screen exists because the output is a suggestion. Never auto-apply.
- **JSON document drift**: the `schemaVersion` + `upgrade()` path must exist from day one, before the first real document is saved.
- **Scope creep toward a Canva clone**: new element kinds or free positioning need a product decision first, not a quick add.
