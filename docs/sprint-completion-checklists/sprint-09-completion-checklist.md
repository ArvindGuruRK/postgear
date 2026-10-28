# Sprint 9: Completion Checklist & Test Guide

Companion to [sprint-09-design-studio.md](../sprint-documents/sprint-09-design-studio.md)
and its user stories, [user-stories-design-studio.md](../new-modules/user-stories-design-studio.md)
(the journeys, the acceptance criteria and the section 6 checklist ticked in §10 below).
Status as of **2026-10-28**. Branch `sprint-9-design-studio`, cut from `ui-revamp` at
`6771817`; committed on its own and pushed on 2026-10-29, with Sprint 9b on top; not
merged.

Sprint 9 started from nothing: no `studio` segment, rail entry or route, no
design package, no models, and no way to draw a slide anywhere in the
monorepo. The sprint document and the stories were written the same morning.
What it could lean on was the media library (upload, the image pipeline and
storage), the composer and its drafts, the SSE transport, and the SEO
engine's URL guard, safe fetch and Playwright browser pool.

The **[Pre-existing]** things worth not re-testing: the session guards, RBAC
and the workspace cookie (Sprint 2), the composer and its draft posts, the
media library and its image pipeline (Sprint 4, revamped 2026-10-23), the SSE
transport (Sprint 6), the SSRF URL guard, safe fetch and the browser pool
(Sprint 7), the platform rules in `social-core/composer`, and the
design-system components.

**13 of the 14 Definition of Done items are met; the 14th (every line of the
stories' section 6 ticked) waits on the two lines only a person can tick: walking
Journeys A to D by hand, and a first-time user exporting a carousel in under ten
minutes.** Every other section 6 line was walked in the running app on 2026-10-27
and 2026-10-28 by three verifiers (start and templates, the editor, the outputs),
and what they found was fixed and walked again (§10).

What has not run for real: Send stops at a real DRAFT post, and everything after it
is **in simulation** (`PUBLISH_SIMULATION=true`): nothing was published to a
platform. Brand extraction read five public test sites (python.org, mozilla.org,
info.cern.ch, httpbin.org, a `.invalid` name), not a customer's site. The
real-Chromium specs pass but are opt-in, and CI runs no e2e, so both run on a
developer's machine only (Known gaps).

---

## Prerequisites

```bash
docker compose up -d          # Postgres, Redis, MinIO, Temporal
npm install                   # adds the packages/design-engine workspace; apps/api gains fflate,
                              # react and react-dom (the exporter renders with react-dom/server)
npx playwright install chromium   # the export renderer (already there if the SEO analyzer runs)
npm run db:generate
npm run db:migrate            # applies 20261027120000_sprint9_design_studio
npm run db:seed               # adds the Lotus Flow Yoga brand kit and two designs to seed-demo-org
```

Then `npm run dev`. **No new environment variables.** Studio uses the existing
`WEB_URL` (share links point there). Two older test switches matter here:

| Variable | Default | Meaning |
|---|---|---|
| `SEO_BROWSER_TESTS` | unset | `true` runs the opt-in real-Chromium specs (Sprint 7's switch): the exporter's sizes and pixels, every template with the real fonts, the pool's renders |
| `SEO_NO_SANDBOX` | unset | Chromium without its sandbox, for containers that cannot run it. Pre-existing, and still missing from `.env.example` |

The migration adds four tables (`BrandKit`, `Design`, `DesignShare`,
`DesignFavourite`) and three enums (`BrandKitSource`, `DesignFormat`,
`DesignStatus`); it is additive and nothing inherited changes
(`SCHEMA_NOTES.md` § Sprint 9 additions). The seed, idempotent with fixed
ids: the kit `seed-brand-kit-lotus` ("Lotus Flow Yoga"), the five-slide
portrait carousel `seed-design-carousel` ("5 Morning Stretches") and the
single landscape post `seed-design-single` ("Saturday Classes Are Back"). Its
documents are checked with the engine's own schema, so a renamed layout stops
the seed loudly. `seed-second-org` gets nothing, which makes it the empty
state.

---

## 1. The design engine: `packages/design-engine`

| # | Item | Status |
|---|---|---|
| 1.1 | The package: browser-safe TypeScript and React (no `node:` imports, no `fs`, `path`, `crypto`, `process` or `Buffer` anywhere in `src/`), one public surface in `src/index.ts`, wired into the root and API `tsconfig` paths and the shared Jest preset. The web editor and the API exporter import the same code | ✅ [New] |
| 1.2 | `types.ts`: the document vocabulary (formats, 10 colour roles, 8 fonts, 16 slot ids, element state, slide, brand, `DESIGN_SCHEMA_VERSION = 1`) and the limits: 20 slides, 8 list items, 600 characters of text, a 3 000-character caption, a 60-character handle, a 120-character brand name | ✅ [New] |
| 1.3 | `schema.ts`: Zod with `.strict()` on every object, `schemaVersion` as the literal 1, per-slot rules (a slot only takes what its layout gives it), offsets clamped rather than refused, and `upgrade()` over an `UPGRADE_STEPS` table that is empty until the first change. `DesignVersionError` says "newer version" or "older format (schema N)" as the case is | ✅ [New] |
| 1.4 | `formats.ts`: Square 1080 x 1080, Portrait 1080 x 1350, Story 1080 x 1920, Landscape 1920 x 1080, each with its hover hint | ✅ [New] |
| 1.5 | `layouts/`: 17 layouts in six files by role (covers, content, lists, quotes, stats, closing), all `version: 1`, all four formats; the registry is keyed `id@version`, so an old document keeps the version it was made with | ✅ [New] |
| 1.6 | `themes/`: 10 themes (light: Ink, Editorial, Slate; dark: Midnight, Ocean, Terminal; colourful: Sunrise, Bold, Blossom, Violet) on the 8 bundled fonts; every pairing a layout draws clears WCAG AA | ✅ [New] |
| 1.7 | `presets.ts`: **47 presets**, built from a table of 14 content shapes paired with themes, so a new preset is one row. Categories: tips 7, educational 6, announcement 4, product 4, quote 4, statistic 4, listicle 3, case study 3, promotion 3, story 3, event 3, hiring 3. Styles: light 16, colourful 18, dark 13. All 47 draw in all four formats. Filter and search helpers live beside them | ✅ [New] |
| 1.8 | `brand.ts`, `color.ts`, `ink.ts`: `applyBrand` maps five brand colours onto the theme's roles and derives every ink from its fill, never below AA (a property test throws arbitrary colours at it); `paletteForSlide` and `slideGround` for role, colour and photo backgrounds; `checkContrast` and the Fix Contrast helpers | ✅ [New] |
| 1.9 | `constraints.ts`: `clampToRegion`, `offsetBounds`, `clampWithReport` (which edge was hit, for the edge highlight), `dragToOffset` | ✅ [New] |
| 1.10 | `fit.ts` and `render/fit-runtime.ts`: `fitText` with an injected measure, shrinking to `MIN_FIT_SCALE` (0.62) and then reporting overflow instead of cutting; the same fitter is serialised into the export page, where it measures with the real fonts and sets `__pgFitDone`, `__pgOverflow` and `__pgFontsMissing` (§1.10) | ✅ [New] |
| 1.11 | `history.ts`: the undo and redo reducer, 80 steps, typing coalesced within 700 ms | ✅ [New] |
| 1.12 | `render/SlideView.tsx` (+ `EditableText.tsx`, `export-html.ts`): one renderer with three modes (edit, preview, export); export mode adds nothing; an unknown layout draws a message, not a crash; `buildExportPage` wraps a slide in a page with a strict CSP | ✅ [New] |
| 1.13 | `document.ts`: `documentFromPreset` (a deep copy, so editing never touches the preset), the blank preset, add, duplicate, remove and move slides (20 at most), `applyTheme`, `applyBrandKit`, `detachBrandKit` (No Brand Kit keeps the name and logo), `updateBrandColors` (DS-2.5), reset slide and reset design | ✅ [New] |
| 1.14 | `issues.ts`: `findDesignIssues` and `issueMessage` ("Slide 3: the headline is too long for its space."), the one wording the editor, the rail and the export dialog share | ✅ [New] |
| 1.15 | `fonts/`: 10 woff2 files of 8 OFL families (Archivo Black, DM Serif Display, Inter, JetBrains Mono, Playfair Display, Poppins, Sora, Space Grotesk), latin subsets, 7.8 to 48 KB each, with `LICENSES.md` (source and copyright per family) and the full SIL OFL 1.1 text in `OFL.txt` | ✅ [New] |

### 1.10: why the fitter runs inside the export page

Text fit depends on the font's real glyph widths. Measuring in Node would need
a second text engine, and its numbers would never quite match Chromium's. So
the editor fits with a canvas measure in the user's browser, and the export
page carries the very same fitter as an inline script that measures with the
inlined fonts in the export browser. The render waits for `__pgFitDone`, then
reads `__pgOverflow`: a slot still too long at the floor size is named in the
export's warnings, never silently cut short.

**How to test:**

```bash
npm test --workspace=@postgear/design-engine     # 13 suites, 383 tests
```

The suite: schema refusals (a property the renderer never reads, a slot the
layout does not have, a 21st slide, an empty document), `upgrade()` on old,
current and future versions, every layout in every format (inside the safe
area, slots inside their regions, no overlaps), AA on every theme pairing,
`applyBrand` against arbitrary colours, clamping from every start, the fitter
stopping at the floor, the fitter serialised and run on its own, history
limits and coalescing, every preset drawn in every format, preset copies
being copies, slide limits, issue wording.

---

## 2. Database: `packages/db`

| # | Item | Status |
|---|---|---|
| 2.1 | `BrandKit`: name, websiteUrl, logoMediaId, colors (JSON), description, `source` (MANUAL or EXTRACTED), createdById; several per workspace; soft delete | ✅ [New] |
| 2.2 | `Design`: title, format, presetId, brandKitId (SET NULL when a kit goes), document (JSON), revision (from 1), status (DRAFT, EXPORTED, SENT), exportedMediaIds, lastExportedRevision, createdById, plus `lastSlideIndex` (where the editor reopens) | ✅ [New] |
| 2.3 | `DesignShare` (P1): designId (Cascade), tokenHash (unique), expiresAt, revokedAt, createdById, plus `lastViewedAt`; no organizationId, updatedAt or deletedAt, on purpose (§2.3) | ✅ [New] |
| 2.4 | `DesignFavourite` (DS-3.4): one row per workspace and preset, unique on the pair | ✅ [New] |
| 2.5 | Migration `20261027120000_sprint9_design_studio`: 3 enums, 4 tables, 6 indexes (2 unique), foreign keys; additive only. Deployed, client generated; `prisma migrate diff` against the local database: "No difference detected." | ✅ [New] |
| 2.6 | `SCHEMA_NOTES.md` § Sprint 9 additions: why the document is one JSON column, why templates are not rows, the revision guard, the hashed share token, `lastSlideIndex`, the share table's shape, `lastViewedAt`'s write rate, the nullable `createdById` | ✅ [New] |
| 2.7 | `src/types.ts` re-exports the four models and three enums | ✅ [New] |
| 2.8 | `seeds/studio.seed.ts`: the kit and two designs above, upserted (a re-seed bumps the revision, so an editor open at the time gets the conflict notice instead of overwriting the seed) | ✅ [New] |

### 2.3: why a share link has no workspace column

A share link means nothing without its design: it is created through the
design, listed through the design, and dies with it (Cascade). Copying the
workspace id onto it would add a second source of truth that could disagree
with the design's. `revokedAt` is the link's whole state, so it needs neither
`updatedAt` nor a soft delete, and the public route refuses a link whose
design is deleted. `lastViewedAt` is written at most once a minute per link,
so a busy link is not a write per view.

```bash
npm test --workspace=@postgear/db     # 2 suites, 36 tests
```

---

## 3. The API: `apps/api/src/modules/studio`

| # | Item | Status |
|---|---|---|
| 3.1 | The module: `@Controller('studio')` with `@Roles(ADMIN, USER)` (a membership is required, content work is open to members), every body and query through `ZodBody` / `ZodQuery` with `.strict()` schemas (`dto/studio.schema.ts`), every sentence in `studio.messages.ts`, registered in `app.module.ts` | ✅ [New] |
| 3.2 | Designs: `GET /studio/designs` (search, format, status, 24 a page), `POST /studio/designs` (`{ presetId, format, brandKitId?, title? }`: the server builds the document from the preset; a document in the body is refused), `GET /studio/designs/:id` (a stored document this version cannot read is a 422, not a 500), `PATCH /studio/designs/:id` (`{ revision, title?, document?, lastSlideIndex? }`; one `updateMany` on id, workspace and revision, so a stale revision is a 409 "This design changed in another tab." and never a silent overwrite), `POST .../duplicate`, `DELETE` (soft) | ✅ [New] |
| 3.3 | Brand kits: `GET`, `POST`, `GET :id`, `PATCH`, `DELETE` (soft; designs that used it are unlinked in the same transaction and keep their colours, their logo and their `updatedAt`: losing the link is not an edit); `POST /studio/brand-kits/logo` (memory upload, 5 MB, PNG, JPEG, WebP or SVG; an SVG with scripts or outside links is refused, a safe one is rasterised; "Logos can be PNG, JPG, SVG or WebP, up to 5 MB.") | ✅ [New] |
| 3.4 | `POST /studio/brand-kits/extract` (§4) | ✅ [New] |
| 3.5 | `POST /studio/designs/:id/export`, `POST .../send`, `GET .../download` (§5) | ✅ [New] |
| 3.6 | Shares: `GET`, `POST /studio/designs/:id/shares`, `DELETE .../shares/:shareId`, and the public `GET /public/design-shares/:token` (§6) | ✅ [New] |
| 3.7 | Favourites, shared by the workspace: `GET` and `POST /studio/favourites`, `DELETE /studio/favourites/:presetId` | ✅ [New] |
| 3.8 | `GET /public/studio-fonts/:file`: the bundled fonts, known file names only, for the editor and the signed-out share page | ✅ [New] |
| 3.9 | Tenancy: every repository query filters on `organizationId` from `@CurrentOrg()`; shares are reached only through their design; media are looked up in the workspace only; a foreign channel or media id is a 400 logged as `studio.foreign_reference` | ✅ [New]; **live probe below** |
| 3.10 | `GET /media/:id/download` (DS-8.3, added at close-out): one image as a file to save, under its library name with the extension of what is stored, `Content-Disposition: attachment`, `no-store`; images only (a video is a 400 with a sentence); another workspace's id is a 404 | ✅ [New] |

**Tenancy, live** (2026-10-27, against the running API, signed in as the demo
user with `seed-second-org` active): GET of a `seed-demo-org` design, a PATCH
with any revision, its shares, its download and the seeded brand kit all
answered **404**; the design list came back `{"designs":[],"total":0}` and the
kit list `{"brandKits":[]}`; switching back to `seed-demo-org`, the same design
answered 200. The same probe for `GET /media/:id/download`: 200 in the
image's own workspace (`image/jpeg`, the stored 15 640 bytes, JPEG magic
bytes, `attachment; filename="AI image a sunrise over a city skyline.jpg"`),
404 from `seed-second-org`, 404 for a missing id, 401 signed out.

**How to test:**

```bash
npm test --workspace=@postgear/api -- studio media attachment     # 15 suites, 386 tests (+2 opt-in browser suites, 7 tests, skipped)
npm test --workspace=@postgear/api                                # 97 suites, 1 331 tests (+ the same 2 skipped)
```

The studio suite: create from a template copying the kit in, a document
refused on create, the 409 on a stale revision, the 422 on an unreadable
document, duplicate and delete, every brand kit route and the kit deletion
that unlinks designs, the logo upload's refusals, extraction (below), export
saving each slide as it goes and naming the slide that failed, the missing
browser, Send re-exporting only when stale and making no draft after a failed
export, the zip, share tokens, expiry, limits and dead links, foreign ids
refused and logged. The media suite adds `read()` on both storage backends,
`readImageBytes` and `download` scoped by workspace, and the image pipeline's
`prefer` and `quality`.

---

## 4. Brand extraction: `brand-extractor.ts`, `brand-kits.service.ts`

| # | Item | Status |
|---|---|---|
| 4.1 | The SEO engine's guard first: `assertSafeUrl` before any fetch, then `fetchUrlSafely` and the new `fetchBinarySafely` (the same `follow()`, so every redirect is checked again) | ✅ [New]; the guard ✅ [Pre-existing: Sprint 7] |
| 4.2 | The home page plus up to two stylesheets (1 MB each) and the web manifest (100 KB); the shared browser pool only for an empty JS shell with at least 4 s left | ✅ [New] |
| 4.3 | Name: `og:site_name`, `application-name`, `apple-mobile-web-app-title`, then the manifest name or the title before its first separator | ✅ [New] |
| 4.4 | Logo candidates (up to 6): header images, an inline header SVG, touch icons and icons, manifest icons, `og:image`, `twitter:image`; each fetched through safe fetch (1 MB), its type sniffed with `media/file-type.ts`, returned as a `data:` preview. Only the one the user picks becomes a Media row, on Save | ✅ [New] |
| 4.5 | Colours (up to 8, each with a suggested role): `theme-color`, brand-named custom properties, button and link colours; ranked by use, near-greys dropped, near-duplicates merged | ✅ [New] |
| 4.6 | Limits: 10 s for the whole extraction; 5 a minute per workspace in Redis (`studio:extract:<orgId>`, a 429 "That is a lot of websites at once. Try again in a minute."); refused addresses count too | ✅ [New] |
| 4.7 | Never saves: the endpoint returns candidates only | ✅ [New] |
| 4.8 | Refusals (the Task 2 specs): `http://localhost/`, `localhost:3000`, `http://169.254.169.254/latest/meta-data/`, `http://10.0.0.8/` and `http://[::1]/` each get a 422 "That address is not public." and a `studio.unsafe_url` log line; a redirect into a private network gets the same answer. Following real redirects is Sprint 7's `safe-fetch.test.ts` | ✅ [New] |
| 4.9 | Failure never blocks: a site that blocks bots, times out, answers 403 or drops the socket is a 422 "We could not read that site. You can enter the brand details yourself."; a site with nothing worth using returns empty lists, not an error | ✅ [New] |

**Extraction, live** (2026-10-27, through the brand kit dialog in the running app):

| Address | Time | What the dialog showed |
|---|---|---|
| `python.org` | 1.0 s | "Found 6 logos and 6 colours on python.org.", the name "Python.org", the first logo chosen; every field editable; the logo uploaded on Save |
| `mozilla.org` | 2.0 s | 6 logos, 8 colours, the name "Mozilla"; leaving without saving left the kit count unchanged |
| `info.cern.ch` | 0.8 s | "We found no logo or colours on info.cern.ch." with the pickers ready |
| `does-not-exist.invalid`, httpbin `/delay/15`, httpbin `/status/403` | 0.25 s, 6.5 s, 1.5 s | "We could not read that site. You can enter the brand details yourself."; the form stays open |
| `http://169.254.169.254/` | | "That address is not public." |
| `localhost:3000`, `http://localhost/`, `http://[::1]/` | | "That address is not public." (2026-10-28, after the fix in Fixed after the app walk: the dialog used to call them malformed); `acme` still says "Enter a website address like https://example.com." without asking the API |
| the 6th read within a minute | | 429 "That is a lot of websites at once. Try again in a minute." |

---

## 5. Export, Send and downloads

| # | Item | Status |
|---|---|---|
| 5.1 | `BrowserPool.render()` in `packages/seo-engine` (the sprint's `renderHtmlToImage()`): an offline context with every request aborted, the exact viewport at device scale 1, an exact clip; a global `BrowserPoolModule` (two pages) that the SEO module now shares, so there is still one Chromium | ✅ [New] |
| 5.2 | `design-exporter.ts`: each slide rendered with `renderToStaticMarkup` in export mode, the theme's fonts and every picture inlined as `data:` URIs, the page loaded into the pool, the fitter awaited, a missing font face failing the slide; one slide at a time, so a 20-slide PNG export never sits in memory whole | ✅ [New] |
| 5.3 | The export page's CSP (`default-src 'none'`; scripts and styles inline only; images and fonts from `data:` only), and the readiness wait asked from outside the page (`waitUntilTrue`, §5.3) | ✅ [New] |
| 5.4 | JPEG by default at quality 92 (what Instagram takes), PNG as a choice; each slide goes through the media pipeline once with `prefer` and `quality`, so it is stored at its exact size (the 2 048 px cap is above every export size) and named `{title} {nn}.{ext}` | ✅ [New] |
| 5.5 | SSE: "Rendering slide N of M" per slide, then the Media ids. A failed slide fails the export with its number and a reason in words ("It took too long to draw.") and keeps the slides already saved | ✅ [New] |
| 5.6 | No Chromium: a 503 "Export is not available right now. Please try again later.", and the API console prints `npx playwright install chromium` once | ✅ [New] |
| 5.7 | Send To Composer: `{ channelIds, caption?, imageFormat? }`; re-exports only when the design changed since its last export, creates a DRAFT post at the next full hour with the images in slide order and the caption (made into the composer's document), marks the design SENT, and ends the stream with a `sent` event carrying the post group the composer opens | ✅ [New] |
| 5.8 | Download All: `GET /studio/designs/:id/download`, a stored (not deflated) zip written as it is read, safe unique names in slide order, `Content-Disposition` exposed through CORS; "Export this design first, then download it." before any export; a half-written zip cuts the connection rather than ending as if whole | ✅ [New] |
| 5.9 | One image: `GET /media/:id/download` (§3.10) and the Media viewer's **Download** (§7) | ✅ [New] |
| 5.10 | An export busy guard per design (a second export of the same design is refused while one runs) | ✅ [New]; in-process only (Known gaps) |
| 5.11 | `export-compliance.spec.ts`: what Export stores for each format (the media pipeline's JPEG at quality 92, at the format's exact size) goes through the composer's own `validatePost` with the real Instagram rules. It is accepted exactly when Preview offers the Instagram frame (a Story is refused for its shape, and Preview does not offer that frame); PNG is refused (`image_type`), which is why JPEG is the default; an 11th image is left to the composer to explain (`too_many_images`) | ✅ [New] |

### 5.3: why readiness is asked from outside the page

The export page forbids `eval` in its CSP, so nothing on it can turn a string
into code. Playwright's `waitForFunction(string)` checks its predicate once
through the DevTools protocol (allowed) and then re-checks it on every
animation frame with `eval` inside the page, which the CSP blocks. A page that
was not ready at the very first look therefore failed with an `EvalError`,
which the exporter could only report as "Slide 1 could not be rendered.
Something went wrong while drawing it.": about one render in a thousand in
the verification runs. `waitUntilTrue` now asks the same question with
`page.evaluate` every 20 ms (the protocol path, which the page's policy does
not govern) and races a deadline, so a page stuck in its own script still
times out. The failure was reproduced in a scratch script under the export
CSP and is pinned by a real-Chromium test that becomes ready only 300 ms late.

**How to test:**

```bash
npm test --workspace=@postgear/seo-engine     # 8 suites, 170 tests (+2 opt-in browser suites, 5 tests, skipped)
# Real Chromium (opt-in): exact sizes and pixels, and every template with the real fonts
SEO_BROWSER_TESTS=true npm test --workspace=@postgear/api -- design-exporter.browser presets.browser
SEO_BROWSER_TESTS=true npm test --workspace=@postgear/seo-engine -- render.browser
```

Expect **7 passed** in the API (2 suites, 106.7 s, run on 2026-10-28):
`design-exporter.browser` (8.1 s) shoots the four formats at their exact
pixel sizes, paints the slide ground into the corners and the logo in its
colour, and reports a headline too long for its space at the smallest size;
`presets.browser` (105.8 s) draws every template in every format it offers
with the real fonts and finds every sample text fitting. Expect **3 passed**
in the SEO engine (3.3 s): the exact size with the page script run and the
network blocked, the page that is ready only 300 ms late under the no-`eval`
policy (§5.3), and the page that never finishes, which gives up without
keeping its slot.

---

## 6. Share links

| # | Item | Status |
|---|---|---|
| 6.1 | A token of 32 random bytes, base64url, stored as its SHA-256; the link (`{WEB_URL}/share/design/<token>`) is returned once, at creation | ✅ [New] |
| 6.2 | Expiry: 7 days by default, 1 to 30, clamped by the service as well as the schema | ✅ [New] |
| 6.3 | Create, list and revoke, through the design; at most 20 working links per design ("Revoke one to make another.") | ✅ [New] |
| 6.4 | The public route: `@Public()`, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer`; a malformed, missing, revoked or expired token, or a deleted design, all give the same 404 "This link is no longer available." | ✅ [New] |
| 6.5 | The shared view: the design's current saved document without its kit id, the workspace name, the pictures, the preview platforms and the expiry; `lastViewedAt` written at most once a minute | ✅ [New] |

---

## 7. The screens: `apps/web`

| # | Item | Status |
|---|---|---|
| 7.1 | Navigation (`dashboard-shell.tsx`): **Studio** in `RAIL` right after Media with the animated palette icon, so the phone tab bar has it too; the top bar says **Design Studio** on every Studio route; the editor fills the height (`bleeds()`: its rail and panel scroll on their own), the landing and the wizard scroll as one | ✅ [New] |
| 7.2 | The landing (`studio/page.tsx`, `studio-landing.tsx`, `design-card.tsx`, `design-dialogs.tsx`): a PageActions row with Create Design; on the first run "No designs yet. Create your first post or carousel from a template." with Create Design and three example templates drawn as small decks; the Brand Kits strip; the Recent Designs panel with search ("Enter your search"), the format filter, the count, cards (thumbnail, title, format badge, a Draft, Exported or Sent badge, slide count, the time since the last change) and a menu (Open, Duplicate, Rename, Delete with a red confirm); 24 a page with paging; "No designs match" with Clear Filters | ✅ [New] |
| 7.3 | Brand kits (`brand-kits-strip.tsx`, `brand-kit-dialog.tsx`, `color-field.tsx`, `logo-field.tsx`, `kit-preview.tsx`): one dialog for a kit typed by hand or read from a website; Extract From Website shows a review step (the name, up to 6 logo candidates, up to 8 colours each with a suggested role) that is edited before Save; picker and hex field stay in sync; the picked logo uploads on Save; a live preview of the kit on a sample slide; Delete in red, with the designs that used the kit keeping their look | ✅ [New] |
| 7.4 | The wizard (`studio/new/page.tsx`, `studio-wizard.tsx`, `wizard-steps.tsx`): Brand (the workspace's kits, New Brand Kit, Skip), Format (four cards drawn at their real shapes, each with its hint), Template (the gallery); the step lives in the URL, so Back and a reload keep it | ✅ [New] |
| 7.5 | The gallery (`template-gallery.tsx`): the 47 presets drawn in the chosen kit's colours and format, filters for category, format, style and favourites, search by name, the "Show original colours" switch (a form label, so sentence case), favourites shared by the workspace ("No favourites yet" while none is starred), Start From Blank, a no-results message with Clear Filters; slides are drawn just before they scroll into view (`scroll-root.ts`, `slide-frame.tsx`) | ✅ [New] |
| 7.6 | The editor (`studio/[designId]/page.tsx`, `studio-editor.tsx`, `editor-top-bar.tsx`, `studio-editor-model.ts`): server-loaded design and kits; a skeleton, then the action row (the title, renamed in place; the save status with an icon per state; Undo, Redo, the Reset menu; Preview, Export, Send To Composer, Share); from 1024 px the rail, canvas and panel side by side, below it the canvas alone with Slides and Edit drawers; Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y, ignored in text fields and dialogs | ✅ [New] |
| 7.7 | The slide rail (`slides-rail.tsx`, `layout-picker-dialog.tsx`): numbered thumbnails with a too-long sticker, Add Slide by layout (stops at 20 and says why), and per slide an Actions menu (Duplicate, Move Up, Move Down, Delete with Undo, the toast's Undo giving focus back to the slide); one tab stop with arrow keys between slides; mouse drag to reorder, with a grip for touch | ✅ [New] |
| 7.8 | The canvas (`editor-canvas.tsx`, the engine's `EditableText`): click to select, type in place with plain-text paste, drag inside the element's region with the region outlined and the edge it hit highlighted, arrow keys nudge, Delete hides an optional element (focus moves on and "Logo hidden. Undo brings it back." is announced), a ring on text that does not fit | ✅ [New] |
| 7.9 | The properties panel (`editor-panel.tsx`, `panel-element.tsx`, `panel-slide.tsx`, `panel-design.tsx`, `panel-ui.tsx`, `editor-panel-model.ts`): **Element** (text and list items with length hints, S, M and L, alignment, colour swatches by role plus a custom hex, the contrast warning with Fix Contrast, image and logo pickers, Hide, Reset Element), **Slide** (layout, background colour or photo, the darkening overlay, Darken Photo), **Design** (theme, brand kit, Update Colours when the kit changed, name and handle). Only what the selected element supports is shown | ✅ [New] |
| 7.10 | Saving (`editor-autosave.ts`, `use-autosave.ts`, `editor-state.ts`): a save 1.5 s after the last change, Saved only once the API answered; Offline with the edits kept and sent on reconnect; a 409 shows "This design changed in another tab." with Reload and Keep This Version; a design deleted elsewhere shows Back To Studio; a 404 straight after a workspace switch in another tab is retried once in the design's own workspace; the leave prompt only while something is unsaved, and never for a design that was deleted; a link, and also the top bar's workspace switch, sign-out, menu items, search results and notifications (`lib/leave-guard.ts`), save first and ask only when that fails; Leave Anyway asks once, even when the router falls back to a full page load; a last keepalive save on leaving (bodies up to 60 000 bytes) | ✅ [New] |
| 7.11 | Preview (`preview-dialog.tsx`, `platform-frame.tsx`, `preview-model.ts`): a tab per platform the format suits (from the API's list), each frame with the workspace's name, a **Preview** badge and engagement icons without numbers; a carousel with arrows (over the slide, or below it at either end of the dots on a phone), dots in the frame's text colour, keys and swipe; the caption, counted per platform, saved with the design | ✅ [New] |
| 7.12 | Export and Send (`export-dialog.tsx`, `send-dialog.tsx`, `export-model.ts`): JPEG (default) or PNG; "Rendering slide 3 of 7" with a progress bar and the thumbnails filling in slide order; the warnings first ("you can still go ahead"); "Saved N images to your media library." with Download All (which keeps focus while it runs) and Open Media; a failure names the slide and how many were saved. Send: the workspace's channels, the caption read-only, then the composer opens on the draft | ✅ [New] |
| 7.13 | Share (`share-dialog.tsx`, `share-model.ts`): how long the link works (7 days by default, up to 30), Create Link (it saves first), the new link shown once under a warning with Copy Link and Open Link, the active links with their expiry and last view, Revoke behind a confirm | ✅ [New] |
| 7.14 | The share page (`app/share/design/[token]/page.tsx`, `not-found.tsx`, `shared-design-view.tsx`): no session read; the design's title, "Shared by {workspace}", the same frames with the Preview badge, the expiry date and "Made with PostGear"; `robots: noindex` in the head and `no-referrer`; a dead link is an HTTP 404 with "This link is no longer available." | ✅ [New] |
| 7.15 | A design that is not there (`[designId]/not-found.tsx`, `design-missing.tsx`): an HTTP 404 inside the workspace's shell, "This design no longer exists. It may have been deleted." and Back To Studio; another workspace's design looks exactly the same | ✅ [New] |
| 7.16 | One image from Media (`media-viewer.tsx`, added at close-out): **Download** under an open image, saved under its library name through `GET /media/:id/download` (§3.10), a spinner while it runs (the button keeps focus and ignores a second press), a toast if it fails; videos have no Download | ✅ [New] |
| 7.17 | Shared pieces: `lib/api.ts` (`keepalive`, `downloadFile` reading the name from `Content-Disposition`), `lib/sse.ts` (passes the API's error `code` on), `lib/leave-guard.ts` (a page with unsaved work holds the top bar's moves), the media picker's images-only mode (`media-picker-dialog.tsx`, `IMAGE_ACCEPT`, `preflightImage`, `useMediaList`'s first type), `studio-fonts.tsx`, `use-studio-data.ts`, `types/studio.ts`; the design system's `Slider` takes `thumbs` (each thumb's accessible name and value text), its `OnboardingStepper` spaces every step evenly, and its toast does not slide under reduced motion | ✅ [New] |

**How to test:**

```bash
npm test --workspace=@postgear/web     # 47 suites, 644 tests
```

The Studio suites are the view models: the landing's labels and paging,
the wizard's URL state, the gallery's filters, the panel's choices
(`editor-panel-model`), the reducer and its undo steps (`editor-state`), the
autosave controller (revision guard, offline, conflict, retry, the keepalive
cap, the workspace-switch retry), the editor's shortcut and leave-guard
decisions, focus return after dialogs, the preview's frames and caption
counts, the export stream's state, share links, the scroll root, and the
playground's overflow store. The web Jest setup cannot render `@postgear/ui`
components (its ESM icon packages), so there are no component render tests:
the screens are covered by §9 and the walk in §10.

---

## 8. The template playground: `/dev/studio`

| # | Item | Status |
|---|---|---|
| 8.1 | Every preset in every format it supports (47 presets, 860 slides) on the real renderer, with search and the format, category and style filters; each preset lists its category, theme, style, formats and id | ✅ [New] |
| 8.2 | The overflow check at the top: each slide reports whether its sample text fits; the status says how many were drawn and whether any overflow, and each overflow has Go To Slide. On the real library: **all 860 slides fit** | ✅ [New] |
| 8.3 | The app's 12 light and 12 dark themes in two selects, applied to the page only; the top bar's theme button there switches this browser only and never saves to an account (`saveThemeToAccount={false}`, also on `/dev/components`) | ✅ [New] |
| 8.4 | `/dev/components` links to it from its rail ("Templates") | ✅ [New] |

```bash
npm test --workspace=@postgear/web -- playground-model
```

---

## 9. End to end: `e2e/studio.spec.ts`

| # | Test | Status |
|---|---|---|
| 9.1 | Creates a carousel from a template through the wizard (Brand, Format, Template), then renames it | ✅ [New] |
| 9.2 | Edits the cover headline on the canvas, waits for Saved, reloads, and finds it kept | ✅ [New] |
| 9.3 | Adds a slide from the layout picker; the keyboard Undo takes it away | ✅ [New] |
| 9.4 | Writes the caption in Preview and finds it saved with the design | ✅ [New] |
| 9.5 | Exports every slide as a JPEG into the media library: one row per slide, 1080 x 1080, named `{title} 01.jpg` onwards, in order; the design becomes Exported | ✅ [New] |
| 9.6 | Sends to the composer with "Acme Studio": a DRAFT post with the media ids in slide order and the caption; the design becomes Sent | ✅ [New]; **in simulation** for anything after the draft (no post is published) |
| 9.7 | Shares a link, opens it signed out (200, `noindex`, five slides), revokes it, and gets the 404 "This link is no longer available." | ✅ [New] |

`afterAll` removes the design, its exported media, the draft and its share
links even after a failure, then asks the API again that none is left. It
signs in once (the normal login throttle allows it).

```bash
# needs docker services, a seeded database, and the API and web app running
npm run test:e2e -- e2e/studio.spec.ts --workers=1
```

Expect **7 passed** (28.5 s on 2026-10-28, after the last code change).

---

## 10. The user stories' checklist, walked in the running app

Three verifiers walked every line of the stories' section 6 in the running app
(web on :3000, API on :3001, the simulation flags on) on 2026-10-27 and
2026-10-28: the start and the templates (V1), the editor (V2), and Preview,
Export, Send and Share (V3). Each worked on its own designs, kits and links, in
White, Lilac and dark Classic at 1440 and 375 px, changing the theme only inside
its own browser context (the account's appearance read the same at the start and
the end). Every row they made was deleted, and the deletion proved through the
API and the database; the seeded designs and the Lotus kit were unchanged. What
they found is fixed (Fixed after the app walk), and a fourth walk (R) checked
each fix in the running app; the one it failed (the X frame on a phone) was fixed
again and passed a probe. Screenshots: `screenshots/30` to `69` (V1), `70` to `93`
(V2), `111` to `143` (V3), `144` to `158` (R), `159` to `161` (the probe).

| Line | Status | Evidence |
|---|---|---|
| DS-1.1 Studio in the rail and mobile menu, correct top bar name | ✅ | After Media on the rail, `aria-current="page"`; in the phone's More sheet; the top bar says "Design Studio" on the landing and all three wizard steps at 1440 and 375, with no heading inside the page (V1) |
| DS-1.2 Empty state with Create Design and example templates | ✅ | In `seed-second-org`: "No designs yet.", its own Create Design, and example decks that open the wizard with their template chosen; nothing written (V1) |
| DS-1.3 Recent designs with status, search, filter, card menu, red confirm delete | ✅ | Draft, Exported and Sent badges (word and colour), newest first; search and the format filter, "No designs match" with Clear Filters; Open, Duplicate, Rename, Delete; the red confirm names the design; gone in 235 ms with a toast, then a 404; a design reopens on its last slide (V1) |
| DS-1.4 Duplicate a design | ✅ | "{title} (Copy)" opens in the editor; the original's revision and `updatedAt` unchanged (V1) |
| DS-2.1 Manual brand kit with synced picker and hex fields | ✅ | `#1A2B3C` typed moves the picker, the picker sets the hex; "zz12" is marked invalid with "Enter a colour like #1A2B3C." and the picker keeps its value; Save 201 (V1) |
| DS-2.2 Website extraction with review screen; private addresses refused; failure never blocks | ✅ | The live table in §4: three real sites reviewed and edited before Save, three failures that leave the form open, the metadata address and the 429; `localhost:3000`, `http://localhost/` and `http://[::1]/` say "That address is not public." since the fix (V1, R) |
| DS-2.3 Several kits per workspace | ✅ | Two kits beside Lotus with name, logo and swatches; Edit and rename; the red delete confirm says what happens to designs and the logo; the editor's Logo panel lists the kit logo first (V1) |
| DS-2.4 Skip brand setup | ✅ | Skip For Now goes to Format; the gallery shows the templates' own colours; the Design tab offers "Apply a brand kit" (V1) |
| DS-2.5 (P1) Kit updates offered to existing designs, never forced | ✅ | "A newer version of this brand kit is available." with Update Colours; leaving it kept the colours and the revision; accepting saved the new colours and the offer went away (V1) |
| DS-3.1 Four formats with real shapes and hover hints | ✅ | Cards at their real ratios (1, 0.8, 0.563, 1.778) in the kit's colours; each hint always shown, not only on hover (a phone has none); Last Used preselected (V1) |
| DS-3.2 40+ presets, filters, search, no-results message, smooth scrolling | ✅ | 47 presets; Quote 4, Dark 13, Colourful 18, Light 16; "night" and "testimonials" found; "No templates match" with Clear Filters back to 47; 47 cards scrolled in 2.4 s with no long task, each drawn 303 to 351 px before it came into view (V1). The playground draws 860 slides on one page (§8) |
| DS-3.3 Thumbnails in the chosen brand, with Show Original Colours | ✅ | 8 of 8 drawn thumbnails in the kit's colours and logo; "Show original colours" gives the templates' own colours and no logo (V1) |
| DS-3.4 (P1) Favourites | ✅ | Two starred (`aria-pressed`), the filter shows exactly those, and the workspace's member saw both (V1); with none starred it says "No favourites yet" (R) |
| DS-3.5 Template creates a copy; Start From Blank | ✅ | A template opens the user's own copy in 1.0 s, the preset and the other designs unchanged; Start From Blank makes "Untitled Design" with one plain slide in the kit's colours (V1) |
| DS-4.1 Edit text on the canvas, plain-text paste | ✅ | A click puts the caret in any text; typing shows on the canvas, the panel and the rail in the same frame; a pasted HTML snippet with bold and a link lands as plain text and saves (V2) |
| DS-4.2 Edit text in the panel, list items, length hints | ✅ | Canvas and panel in sync both ways; "26 of about 64 characters"; one row per list item, Add Item stops at the layout's limit with a tooltip saying why, Remove moves focus on (V2) |
| DS-4.3 Constrained move with area outline and keyboard nudge | ✅ | A drag outlines the area and stops at its edge, which flashes; arrows nudge 1 % of the area, Shift 5 %; Reset Position (V2) |
| DS-4.4 Text fit and too-long warnings, including at export | ✅ | A 366-character headline shrank from 82 to 51 px, then got the dashed ring and the Too Long sticker; the panel, the rail and Export name it, before and after the run (V2, V3) |
| DS-4.5 Colours with contrast warning and Fix Contrast; theme swap | ✅ | Swatches by role plus Custom, the hex in each name; white on white warns, Fix Contrast mends it; a theme swap recolours every slide and keeps a custom background; an unreadable kit text colour is drawn readable (V2) |
| DS-4.6 Logo placement, images, photo backgrounds with overlay | ✅ | Header, Footer, and Centre on the closing slide; with no kit, the panel says how to get a logo; the picker fills the image slot; a photo background starts at 60 % darkening and warns below it, with Darken Photo (V2) |
| DS-4.7 Size steps, alignment, hide and show optional elements | ✅ | S, M and L on the headline (67, 82, 100 px); Left, Centre, Right; Hide, and the Slide tab brings an element back; the required headline cannot be hidden (V2) |
| DS-4.8 Undo, redo, reset slide, reset design | ✅ | The buttons, Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y; 55 steps undone back to the start; a text field keeps its own undo; both resets ask first and Undo restores even the theme (V2) |
| DS-5.1 Add slide by layout, 20-slide limit | ✅ | 17 drawn layouts in 6 groups, the new slide after the current one; at 20, Add Slide and Duplicate stop with "A design can have up to 20 slides." and the counter reads "20 of 20" (V2) |
| DS-5.2 Duplicate, delete with undo, drag and keyboard reorder | ✅ | The copy lands after its original with focus on it; "Slide deleted" with Undo; drag, and Move Up and Move Down in the Actions menu; a one-slide design cannot delete its slide (V2); Undo from the toast by keyboard puts focus on the slide (R) |
| DS-6.1 Autosave with honest status, offline recovery | ✅ | Saving from the first change, the PATCH 1.5 s after the last key, Saved 67 ms after the 200; Offline keeps the text and saves on reconnect; a forced 503 reads "Could not save. Retrying." and saves 2 s later (V2) |
| DS-6.2 Conflict warning, no silent overwrite | ✅ | The second tab gets "This design changed in another tab." with Reload and Keep This Version, the server untouched; Reload takes the other version; Keep This Version saves over it (revision 3 to 4) (V2) |
| DS-6.3 Leave warning only when unsaved | ✅ | Saved: no prompt; unsaved: it saves, then leaves; a save held 15 s: "Leave without saving?" after 10.2 s with Stay focused; one browser prompt on reload only while unsaved (V2). Since the fixes: the top bar's moves save first, a deleted design never asks, Leave Anyway asks once (R) |
| DS-6.4 Rename from the top bar | ✅ | The field opens with the name selected; Enter saves and returns focus, Escape cancels; an empty name keeps the old one, spaces are tidied, 120 characters at most; search finds the new name (V2) |
| DS-7.1 Platform frames, swipeable slides, no engagement numbers, Preview badge | ✅ | Instagram, Facebook, LinkedIn and X for square, portrait and landscape (Story without Instagram); the workspace's name and a Preview badge in every frame, no numbers; arrows, dots, keys and swipes (V3); the dots now pass 3:1 in White, Lilac and dark (R), and on a phone the arrows sit below the slide, X's after one more fix (the probe) |
| DS-7.2 (P1) Caption in preview, carried to the composer | ✅ | "Enter your caption", "68 / 2,200" for Instagram and "68 / 280" for X; kept after a reload; the composer's text equals it exactly (V3) |
| DS-8.1 (P1) Export to Media in order, exact size, JPEG default, per-slide errors | ✅ | JPEG preselected; "Rendering slide 1 of 5" to 5, then "Saved 5 images to your media library." in 2.5 s; 01 to 05.jpg at 1080 x 1350 in the order of `exportedMediaIds`; PNG as a choice; a too-long slide named before and after (V3). A render failure could not be forced in the app; the API specs cover it (§3, §5.5) |
| DS-8.2 (P1) Send To Composer with images in order and caption | ✅ | After a PNG export it exported JPEG again, then opened the composer in 2.3 s on a DRAFT with 01 to 05.jpg in order and the caption, dated the next full hour; the design became Sent; a second Send reused the export (V3). **In simulation** after the draft |
| DS-8.3 (P1) Download per image and Download All | ✅ | Before an export: "Export this design first, then download it."; the zip holds 01 to 05.jpg in order, byte-identical to the stored files; one image from Media under its library name, byte-identical (V3); both buttons keep focus while busy and ignore a second press (R) |
| DS-9.1 (P1) Create, copy, list and revoke share links | ✅ | 7 days by default (1, 3, 7, 14 or 30); Create Link puts focus on Copy Link and the clipboard holds the link; the list shows expiry, creation and views; Revoke (solid red) asks "Revoke this link?"; 31 days straight to the API is a 400 (V3) |
| DS-9.2 (P1) Shared page works signed out, on a phone, not indexed, dead links say so | ✅ | Signed out, at 375 and 1440, light and dark: the title, "Shared by PostGear Demo Org", the frames, swipes, no inputs, no sideways scroll; `noindex` in the page and the API's headers; revoked and made-up tokens 404 with only "This link is no longer available." (V3); an expired link the same (the probe below). It shows the latest saved version (Deviations) |
| Journeys A to D in section 2 walked through by hand, start to finish, without help | ⬜ | A person's walk: What remains 1 |
| A first-time user exports a carousel in under 10 minutes | ⬜ | Needs someone new to Studio: What remains 2. For scale: four clicks and 2.0 s from the landing to the editor, 2.5 s to export five slides (V1, V3) |
| Every edge case in section 5 behaves as written | ✅ | 12 of the 13 walked in the app (V1, V2, V3 and the expired-link probe), and a refused logo now says its sentence once (R); the 13th, the missing export browser, is covered by the API specs (§5.6), since walking it means removing the server's Chromium |
| Every UX principle in section 4 checked on every Studio screen | ✅ | All twelve across the three walks; what failed (canvas focus, the dots' contrast, reduced motion) is fixed and re-checked (R). The composer's copy, reached through Send, is outside Studio: What remains 4 |
| Checked in light, dark and Lilac themes, and at phone width | ✅ | Every screen in White, Lilac and dark Classic at 1440 and 375 (V1 47 to 67, V2 87 to 93, V3 124 to 143); the phone fixes (no sideways scroll, names on two lines, the stepper, the category row, the Lilac drawer) re-checked (R) |
| Every action works by keyboard alone; focus is always visible | ✅ | The wizard, the gallery, card menus, dialogs, the editor (canvas, rail, panel, drawers), Preview, Export, Send and Share by keyboard (V1, V2, V3); the canvas ring, download focus and the toast's Undo re-checked (R). Two small gaps stay: Known gaps 16 and 17 |
| No other workspace's designs, kits or share links are reachable (API specs) | ✅ | §3.9: the specs and the live probe; from `seed-second-org` a demo design is a 404 inside the shell with nothing about it in the page, and the API answers 404 for it, its shares, its export and its download (V3) |
| `npm run validate` passes; e2e spec covers create, edit, export and send | ✅ | 39 of 39 tasks on 2026-10-28 after the last code change; `e2e/studio.spec.ts` 7 passed (§9) |

**The expired link, live** (2026-10-28, a probe script against the running
app): it made its own design and a one-day link (API 200, page 200), moved the
link's `expiresAt` a minute into the past in the database, and asked again: the
API answered 404 with `X-Robots-Tag: noindex, nofollow, noarchive`, and the page
answered 404 with "This link is no longer available." and no trace of the
design's title. It then revoked the link and deleted the design (the database: 0
live designs, 0 working links).

---

## Definition of Done: evidence

| DoD item | Evidence |
|---|---|
| Studio is in the rail, opens the landing page, and Create Design walks Brand, Format, Template into the editor. | §7.1, §7.4; e2e 9.1; walked (§10 DS-1.1, DS-3.5): four clicks and 2.0 s from the landing to the editor, 28 keys by keyboard |
| A design can be created with no website, and with a website whose extracted values are reviewed and edited before saving. | §4 and its live table (python.org and mozilla.org reviewed and edited before Save, nothing saved on leaving); Skip For Now and a kit typed by hand (§10 DS-2.1, DS-2.4) |
| Extraction refuses private, loopback, link-local and metadata addresses, including through a redirect (API specs). | §4.8: the specs refuse `localhost`, `10.0.0.8`, `169.254.169.254`, `[::1]` and a redirect into a private network, each a 422 and a `studio.unsafe_url` line; live, the dialog says "That address is not public." for each (§4) |
| The gallery shows 40 presets, filters by category, format and style, searches by name, and recolours to the chosen brand. | 47 presets (Deviations), §1.7, §7.5; walked (§10 DS-3.2, DS-3.3) |
| Choosing a preset creates a copy; editing it never changes the preset or another design. | `documentFromPreset` copies (§1.13, its spec); walked: the preset and the other designs unchanged (§10 DS-3.5, DS-1.4) |
| Text, logo, image, colours and size steps can be edited; elements cannot leave their region; long text warns instead of being cut. | §1.9, §1.10, §7.8, §7.9; walked (§10 DS-4.1 to DS-4.7). Text still too long at its smallest size is clipped at its region's edge if exported anyway (Deviations) |
| Slides can be added, duplicated, deleted and reordered, up to 20. | §1.13, §7.7; e2e 9.3; walked (§10 DS-5.1, DS-5.2) |
| Undo, redo and reset work; autosave shows Saved only after the API confirms; two tabs cannot silently overwrite each other. | §1.11, §3.2 (the 409), §7.10; e2e 9.2; walked (§10 DS-4.8, DS-6.1, DS-6.2) |
| Preview shows every slide in the chosen format inside an Instagram, Facebook, LinkedIn and X frame, with no engagement counts and a Preview badge. | §7.11; walked (§10 DS-7.1). A Story shows in the three frames that take its shape, not in Instagram's feed frame |
| Export saves one Media row per slide, in order, at the exact export size, and the files pass the composer's Instagram rules. | §5.2 to §5.5; §5.11 (`export-compliance.spec.ts`); the real-Chromium specs (exact sizes and pixels, §5); e2e 9.5; walked (§10 DS-8.1) |
| Send To Composer opens a draft with the images attached in order and the caption carried over. | §5.7; e2e 9.6; walked (§10 DS-8.2). **In simulation** after the draft: nothing was published |
| (P1) A share link shows a read-only preview to someone not signed in, and stops working when revoked or expired. | §6; e2e 9.7; walked (§10 DS-9.2) and the expired-link probe (§10) |
| `npm run validate` passes; an e2e spec covers create, edit, export and send. | `npm run validate`: 39 of 39 tasks (2026-10-28); `e2e/studio.spec.ts` 7 passed (§9) |
| Every line of the user stories' completion checklist (section 6) is ticked. | **Not met.** 41 of the 43 lines are ticked (§10); the other two need a person (What remains 1 and 2) |

---

## Deviations from the sprint document, and why

| The document said | What shipped | Why |
|---|---|---|
| 40 presets on 6 themes (Tasks 1 and 6) | 47 presets on 10 themes | Presets are built from a table of 14 content shapes paired with themes, so each new one is a row; every preset is tested in all four formats, with the real fonts too (§1.7, §5) |
| One file per layout, including a "split-headline" | 17 layouts in six files by role; split-picture and split-panel cover the split role | Layouts of one role share helpers; the registry is still keyed `id@version` (§1.5) |
| `regionOf()` in `constraints.ts` | `findRegion`, `slotPlacement` and `slotFrame` in `layouts/index.ts` | A region belongs to its layout; `constraints.ts` keeps the clamping maths |
| Coordinates as percentages of the canvas | Percentages of the format's content box (the canvas minus its safe area); a nudge is a percentage of its region | One layout reflows across all four formats, and nothing can land in the unsafe margin |
| The document shape in "Technical Design" | Extra fields: `handle`, `caption`, `brand.kitVersion`, nullable brand colours, an element's `color` and `placement`, a slide's `origin` | The caption travels with the design (DS-7.2); `kitVersion` tells when a kit changed (DS-2.5); `origin` lets Reset Slide go back to the template |
| `SlideView` draws region outlines and handles in edit mode | One slide drawing in three modes (edit, preview, export); the editor lays the outlines over it | What you edit is exactly what exports |
| Three tables | Four: `DesignFavourite` added; `Design.lastSlideIndex` and `DesignShare.lastViewedAt` added; no workspace column, `updatedAt` or `deletedAt` on `DesignShare`; `createdById` nullable everywhere | Favourites are shared by the workspace (DS-3.4); the editor reopens on the slide you left; §2.3; removing a member must not take their designs with them |
| Share routes `POST` and `DELETE /studio/designs/:id/shares` | Also `GET .../shares` and revoke by `.../shares/:shareId`; plus `GET /studio/brand-kits/:id`, `POST /studio/brand-kits/logo`, `GET /studio/designs/:id/download`, three favourites routes, the public fonts route, and a status filter on the list | Each one serves a story: the link list (DS-9.1), the logo upload (DS-2.1), Download All (DS-8.3), favourites (DS-3.4), fonts for the signed-out share page |
| Screen 6: "Channels, schedule and platform validation all happen in the composer" | Send asks which channels first (only the workspace's own; one connected channel is chosen for you); schedule and validation stay in the composer | A draft post needs at least one channel, as the AI's own draft door (`draft_post`) does; the composer can change them |
| Send returns the new post | Send takes the channels (at least one), the caption and the image format, and streams progress that ends in `sent` with the post group; the draft is dated the next full hour | A composer draft needs its channels; Send re-exports first when the design changed, which takes a while |
| Extraction reads stylesheets up to 500 KB and logos up to 2 MB | Stylesheets up to 1 MB, logo candidates up to 1 MB; the web manifest and `twitter:image` are read too, with two more name sources; refused addresses count toward the limit | Real stylesheets often pass 500 KB; a 1 MB image is no longer a logo; counting refusals stops probing |
| A new `renderHtmlToImage()` | `BrowserPool.render()` in the SEO engine and one global `BrowserPoolModule` that the SEO module now shares; each slide is shot as PNG and encoded once by the media pipeline | One Chromium for the whole API; one encode keeps the quality (§5.1, §5.4) |
| DS-9.2: the share page "shows the latest exported version" | It shows the latest saved version, and the share dialog says so | Journey B step 6: the manager sees the edited headline before anything is exported or sent |
| (not in the document) | At most 20 working share links per design | A cap on what one design can hand out |
| Journey D: "Nothing is cut off in the export" | Text still too long at its smallest size is clipped at its region's edge if you export anyway | DS-4.4 asks for the ring, the panel message and a warning in Export and Send that names the slide, and all three are built; letting the text spill out would break the layout |
| Fonts (no place given) | `packages/design-engine/fonts/`, latin subsets, with `LICENSES.md` and `OFL.txt` | Binary assets stay outside `src/`; latin covers every template's text (other scripts: Known gaps) |
| Screen 1: search and filters on the landing | Search and the format filter sit at the top of the Recent Designs panel; PageActions holds Create Design only, hidden on the first run where the empty state has its own; the brand kits strip comes first | A filter belongs to the list it filters; one primary action per screen |
| DS-8.3: download per image, from the export | The export dialog's per-slide links open each image full size in a new tab; one image downloads from Media (open it, press Download: §7.16); Download All is the zip | Media is served from another origin, where browsers ignore `<a download>`; one API route now serves any image in the library |
| (not in the document) | A per-element **Reset Style** in the panel: the template's size, alignment, colour, nudge and placement come back, while the words and the picture stay | Resetting the whole element emptied a headline in one click; Reset Slide is the way back to the template's words |
| (house rule: every delete is solid red) | Remove Image, Remove Photo and a list row's Remove are secondary, not red | They only detach content from the slide, and Undo brings it back; red stays for deleting |
| A wide Preview dialog | `max-w-2xl`, frames capped at feed width; a plain frame and one sentence when no platform suits the format | Feeds are narrow, so a wider dialog only added empty space |
| The share page named after the design | The browser tab says "Shared Design"; the design's title is the page heading | Static metadata keeps `noindex` and `no-referrer` in the head without a second fetch |
| Alerts are `role="alert"` (the design system's default) | Studio's warnings and notes are `role="status"`; errors stay `alert` | A warning that appears while you type should not interrupt a screen reader |
| (dependencies) | The lockfile hoisted `react` and `react-dom` from 19.2.8 to 19.3.1 and `scheduler` from 0.27 to 0.28 for the whole monorepo | `apps/api` now depends on React (the exporter uses `react-dom/server`); every suite and the e2e spec pass on it |

## Review findings fixed before closing (2026-10-27)

Four review rounds ran before this checklist: a builder's checker on each
screen, a project-rules review of the editor, a walk of the editor in the
running app, and the close-out verification of the API, engine and data.

| Finding | Fix |
|---|---|
| Export failed about once in a thousand renders with "Slide 1 could not be rendered": Playwright re-checks `waitForFunction` with `eval`, which the export page's CSP forbids | `waitUntilTrue` asks through the DevTools protocol every 20 ms and races a deadline (§5.3); a real-Chromium test that turns ready 300 ms late pins it |
| The real-font fit of every preset and Instagram compliance were one-off probes | Committed: `presets.browser.spec.ts` (all 47 presets in all four formats, bundled fonts, real Chromium: nothing overflows) and `export-compliance.spec.ts` (what Export stores, per format, through the composer's own Instagram validator) |
| No pixel check of an exported slide (the sprint's Risks section asks for one) | The browser spec reads the pixels of an exported slide: the slide ground in its corners and the logo in its colour |
| The new media code (`processImage`'s `prefer` and `quality`, `readImageBytes`, both storages' `read()`) had no tests | Specs added |
| `SCHEMA_NOTES.md` gave no reasons for the share table's shape, the nullable `createdById`, `lastSlideIndex` or `lastViewedAt` | Written (§2.6) |
| No full licence text beside the fonts | `fonts/OFL.txt` |
| The storage interface said only the exporter calls `read()` | It names all three callers |
| `DesignVersionError` said "newer version" for an old document with no upgrade step too | It says which of the two it is |
| A per-image download only opened the image: browsers ignore `<a download>` across origins | `GET /media/:id/download` and the Media viewer's **Download** (§3.10, §7.16) |
| Engine: a slide on the `text` colour role was painted with its adjusted ink (white in Ink, the same as Background) | The ground keeps the role's own colour |
| Engine: No Brand Kit wiped the typed brand name and logo | `detachBrandKit` keeps both |
| Design system: the Slider's thumb had no accessible name | `Slider` takes `thumbs` |
| Panel: Reset Element emptied a headline in one click | Reset Style keeps the words and the picture |
| Panel: "Shorten it or choose a smaller size." even at size S | "Shorten it so every word shows." there |
| Panel: with every kit deleted, No Brand Kit could not be reached; a background on a non-brand role was labelled "Light Text"; the Format section lacked its export size | The kit select stays while the design points at a kit; "Theme Colour"; "1080 x 1350. Instagram and Facebook portrait feed posts." |
| Export and Send: the second click of a double click on Export landed on Cancel and aborted the run | The primary button stays put, disabled, reading "Exporting…" or "Sending…" |
| Export: the per-slide link said "Download" but opened the image; the format tiles lacked the press effect; Send's focus landed on Cancel while channels loaded | "Open X full size, in a new tab"; `pressSm`; the dialog takes focus first |
| Share page: the expiry was always the UTC date, a day late for a reader west of UTC; Try Again dropped focus while it retried; dead links answered HTTP 200 | The reader's own date after hydration (no mismatch); `aria-disabled` with a spinner; a real 404 that still shows only the sentence |
| Share dialog: the load failure said what happened but not what to do; the new link sat in a plain box (design-system rule 16d) | "Your share links could not be loaded. Please try again."; the link sits under a warning Alert labelled "New link" |
| Preview: disabled arrows at 40% opacity | 50%, the design-system rule |
| A save right after the workspace changed in another tab read as "deleted" (R1) | The save points the API back at the design's workspace and is sent once more |
| A save refused with 404 or 401 offered only Try Again (Q2) | Back To Studio for a deleted design, Sign In for an ended session |
| A missing design fell through to the app's global 404 ("Back to sign in") (Q3) | A 404 inside the workspace's shell with Back To Studio (§7.15) |
| Focus fell to the page after deleting or duplicating a slide, hiding an element, deleting a design or a kit, or closing the composer (R3, R4, R8, Q10, Q11) | Focus moves to the active thumbnail, the next element (with "Logo hidden. Undo brings it back."), the neighbouring card's control, or Send To Composer |
| The leave prompt promised the changes were lost although a last save may still land (Q1) | "If you leave now, they may be lost." |
| A keepalive save over the browser's 64 KB cap would be refused outright (Q6) | Keepalive only for bodies up to 60 000 bytes |
| Ctrl+Z did nothing inside the phone drawers (Q7) | It undoes and redoes there too |
| Lazy slides inside a scrolling box drew only once in view (Q4) | The observer watches the box they scroll in |
| The theme button on the /dev pages saved to the signed-in account (Q5) | It switches this browser only there |
| Kit Delete was not red (R2); warnings were read twice or with the wrong role (R5); off-scale values (`rounded-[3px]`, a raw rgba white, `translate-x-[2px]`) (R6); the chosen kit and template were not announced (R7) | `danger`; `role="status"` and one announcement; design tokens; `aria-current` |
| Swatch labels broke inside words; element names read "Brand Name , Lotus Flow Yoga" (Q8, Q9) | Whole words, the tick as a sticker; "Brand Name, Lotus Flow Yoga" |

## Fixed after the app walk (2026-10-28)

What the three verifiers found in the running app (§10), and the close-out
review's last finding. Each fix was walked again in the running app.

| Finding | Fix |
|---|---|
| A workspace switch or sign-out from the top bar while the editor held unsaved changes lost them: the switch (or logout) landed first, so the last save, sent as the editor closed, met another workspace (404) or no session (401) | `lib/leave-guard.ts`: the editor registers a guard, and the avatar menu, search results and notifications ask it first. It saves, or asks "Leave without saving?" when the save fails or has not landed within 10 seconds; Stay keeps everything |
| Canvas elements showed no focus ring by keyboard, and the selected element's halo did not draw: `var(--color-focusRing)` and `var(--color-onActionPrimary)` live only inside Tailwind's `@theme inline`, never in the page | The runtime names, `--color-focus-ring` and `--color-on-action-primary` |
| After a design was deleted in another tab, Back To Studio still asked "Leave without saving?" and closing the tab raised the browser's prompt, for changes that can never be saved | A deleted design counts as nothing left to save |
| Offline, Leave Anyway was followed by the browser's own prompt (the router falls back to a full page load) | Leave Anyway turns that prompt off until the next edit (`letGo`) |
| The phone Edit drawer was near-white in Lilac, unlike the Slides drawer | `bg-chrome` |
| Preview dots failed 3:1: 2.05:1 in White, 2.12:1 in Lilac, 1.02:1 in dark (the outline colour is near-black in dark mode too) | Ink, the frame's text colour, at 60% (85% on hover); the current dot outlined in ink |
| On a phone the Preview arrows covered the slide's edges | Below the slide at either end of the dots, which keep clear of them |
| The re-check found the X frame on a phone still hiding those arrows: X's rounded media box clipped everything inside it, the arrows below the slide too, and its five dots wrapped onto two lines | The rounded box clips the slides only, and below the slide the arrows sit flush with its edges; a probe then passed X in Preview (White, Lilac and dark at 375, dark at 1440) and on the signed-out share page (light and dark at 375): the arrows clickable, five dots on one line |
| Download All and Media's Download dropped keyboard focus while busy (`disabled`) | `aria-disabled`, and a second press is ignored |
| Undo from the "Slide deleted" toast by keyboard left focus on the empty toast list | Focus goes to the slide that came back |
| `localhost:3000` and `[::1]` were called malformed ("Enter a website address like https://example.com."), not "That address is not public.": the web check wanted a dot in the name | The local machine and IPv6 addresses go on to the API, which refuses them; a dotless name stays a typo |
| A refused logo said "Logos can be PNG, JPG, SVG or WebP, up to 5 MB." twice, as the hint and as the error | The error takes the hint's place |
| The landing scrolled sideways at 375 (537 px wide): the swatches' hidden hex text, absolutely placed, escaped the kit strip's own sideways scroll | Each swatch is `relative`. The five role names, cut to "Prim...", "Sec..." at every width, are in each swatch's tooltip and accessible text instead of printed |
| Template names, design titles and kit names were cut to a few letters at 375 | Up to two lines |
| The wizard's step line ran past step 3 and the steps sat unevenly (`last:flex-none` in the design system's `OnboardingStepper`) | Every step equally wide, so each line ends at the next step's centre |
| "All Categories" wrapped inside its select at 375 | The category filter has a row of its own on a phone |
| Deleting a kit stamped "Updated just now" on every design that used it and moved them to the top of Recent Designs (`updateMany` sets `updatedAt`) | The link is cleared in SQL, which leaves `updatedAt` alone |
| The Favourites filter with nothing starred said "No templates match" | "No favourites yet" and "Star a template to keep it here for everyone in this workspace." |
| Reduced motion: the save spinner and four other Studio spinners, the toast's slide-in and the top bar's theme icon still moved | `motion-reduce` on each (the toast and the theme icon app-wide) |
| The image picker's search said "Search by file name" (shared with the composer) | "Enter your search" |

## Known gaps

1. **The real-Chromium specs are opt-in** (`SEO_BROWSER_TESTS=true`, as since
   Sprint 7), and **CI runs no e2e**, so CI never draws a slide or walks the
   Studio. Both pass on a developer's machine (§5, §9). A CI job with Chromium and
   the docker services would close it.
2. **No real platform post.** Send makes a real DRAFT; publishing it is
   `PUBLISH_SIMULATION`, as for every post since Sprint 5.
3. **No spec for `studio.repository.ts` itself.** Tenancy rests on the service
   specs (with fakes) and the live probe in §3.9; a database-backed repository
   spec would pin the `organizationId` filters directly.
4. **The export busy guard is in-process.** Two API instances could export the
   same design at once; a Redis lock would close it before the API runs on more
   than one instance.
5. **Latin font subsets only.** Text in another script (Devanagari, Tamil,
   Arabic, Chinese) is drawn in a fallback font in the editor and the export,
   and fitted with that font's widths.
6. **`SEO_NO_SANDBOX` is missing from `.env.example`** (Sprint 7's switch).
7. **Leave Anyway may still save.** The editor's last save on closing is a
   keepalive request, so changes may land after all; the dialog says they "may be
   lost". A real offline tab close was not reproduced: Playwright's offline mode
   does not cover a request that outlives the page.
8. **The fit model in Jest is approximate.** The engine's specs measure text with
   `approximateMeasure` (a width model); only the opt-in browser spec measures
   with the real fonts.
9. **No component render tests in the web app.** Its Jest setup cannot load the
   design system's ESM icon packages, so screens are covered by §9 and the walks.
10. **A Send that fails after a fresh export** leaves the editor unaware of that
    export until the design is opened again.
11. **The missing-design page's browser tab says "Edit Design".**
12. **The share page's server fetch has no timeout**: if the API hangs, so does
    the page.
13. **In development, a dead share link's sentence arrives through the page's
    script** (the 404's HTML carries it in the React payload); a production build
    was not checked.
14. **Each export adds a new set of Media rows**; earlier sets stay in the library
    until deleted there.
15. **Media's delete dialog counts posts only.** Deleting an image a design uses
    says "No draft or queued post uses this file."; the design then shows "This
    image was deleted. Choose another." and Export warns.
16. **The design system's disabled-control wrapper** (`TooltipHint`, used by Undo
    and Redo and across the app) is a tab stop with no name of its own; text
    fields' focus glow is faint in dark Classic.
17. **The editor takes no focus when it opens.** Opened from the gallery by
    keyboard, the first Tab lands on Slide 1, not Back To Studio.
18. **The Design tab lists a kit's own colours**, while an element drawn in a
    guarded colour shows the readable one (a kit Text of `#F4F4F5` is drawn as
    `#111111` on a light slide).
19. **A 21-slide document sent straight to the API answers "Invalid input"**; the
    editor never sends one.
20. **Top bar titles wrap** (`type-heading`'s `text-wrap: balance` wins over
    `truncate`, app-wide); a long design name reads on two lines.
21. **The app's global not-found page says "Back to sign in"** inside the
    dashboard too (pre-existing; Studio's own missing design has its 404, §7.15).
22. **Long template names still end in an ellipsis at phone width.** Names now
    take two lines, but beside the favourite star the name column is 74 px wide
    at 375, so 16 of the 47 need a third line and are cut (the full name is in the
    tooltip and the button's name). Putting the star elsewhere would free the
    column.

## 11. What remains for you

1. **Walk Journeys A to D by hand** (user stories §2), start to finish, in light,
   dark and Lilac and at phone width: the two section 6 lines only a person can
   tick (DoD item 14). The testing guide's §5k takes you through every screen.
2. **Time a first-time user**: someone who has never seen Studio exports a
   carousel in under ten minutes (principle 1).
3. **Look at the late fixes** (Fixed after the app walk): Preview's dots and, at
   phone width, its arrows (the X tab too, and on a share link); Tab onto a canvas
   element (the ring); the Edit drawer
   in Lilac at phone width; the landing at phone width with three or more kits; the
   wizard's step line; a workspace switch from the avatar menu straight after an
   edit (it saves first).
4. **Decide on the composer's copy**, which the walk passed through on the way
   from Send: "New post", "Add tag" and "Repeat post" (names, so Title Case), the
   placeholder "Write something…" (the "Enter your ..." rule), and Delete Post as
   red text (its code calls that a deliberate quiet action). Several e2e specs
   match those strings, so they were left for you to approve with the specs.
5. **Decide on three colour references outside Studio** that name a variable the
   page never has (the canvas focus ring's bug): the wordmark's drop shadow in
   `brand/brand-mark.tsx` (`--color-onActionLight`), which therefore never draws;
   the emoji picker's colours in `composer/editor-inserts.tsx` and the channel
   stack's hover ring in `posts/channel-stack.tsx` (`--color-actionPrimary`).
   Fixing the first changes the logo you approved, so it waits for you.
6. **Publish a Send draft for real** with `PUBLISH_SIMULATION=false` (Sprint 5's
   switch) to see Instagram take a carousel.
7. **Commit and open the PR** when you are happy: nothing is committed yet.

---

## Files changed in this pass

**Added: the design engine** (`packages/design-engine`)
- `package.json`, `tsconfig.json`, `jest.config.js`
- `src/{index,types,schema,formats,brand,color,ink,constraints,fit,history,presets,document,issues,bindings,media,samples}.ts` (+ 13 specs)
- `src/layouts/{index,shared,covers,content,lists,quotes,stats,closing}.ts`, `src/themes/index.ts`, `src/fonts/index.ts`
- `src/render/{SlideView,EditableText}.tsx`, `src/render/{export-html,fit-runtime}.ts`
- `fonts/`: 10 woff2 files, `LICENSES.md`, `OFL.txt`

**Added: database** (`packages/db/prisma`)
- `migrations/20261027120000_sprint9_design_studio/migration.sql`, `seeds/studio.seed.ts`

**Added: API** (`apps/api/src`)
- `modules/studio/{studio.module,studio.controller,design-shares.controller,studio-fonts.controller,studio.service,brand-kits.service,studio.repository,studio.messages,studio.types,studio.fonts,brand-extractor,brand-logo,design-exporter,design-archive,preview-platforms}.ts`, `modules/studio/dto/studio.schema.ts` (+ 9 specs, and the opt-in `design-exporter.browser` and `presets.browser`)
- `common/browser/browser-pool.module.ts`, `common/attachment.ts` (+ spec)

**Added: web** (`apps/web/src`)
- `app/(dashboard)/[orgId]/studio/{layout,page}.tsx`, `studio/new/page.tsx`, `studio/[designId]/{page,not-found}.tsx`
- `app/share/design/[token]/{page,not-found}.tsx`
- `app/dev/studio/{page,template-playground,preset-section,fit-status,app-theme-selects}.tsx`, `playground-model.ts` (+ test)
- `components/studio/`: the landing (`studio-landing`, `design-card`, `design-dialogs`, `brand-kits-strip`, `brand-kit-dialog`, `color-field`, `logo-field`, `kit-preview`), the wizard (`studio-wizard`, `wizard-steps`, `template-gallery`, `slide-frame`), the editor (`studio-editor`, `editor-top-bar`, `editor-canvas`, `slides-rail`, `layout-picker-dialog`, `editor-panel`, `panel-element`, `panel-slide`, `panel-design`, `panel-ui`, `design-missing`), the outputs (`preview-dialog`, `platform-frame`, `export-dialog`, `send-dialog`, `share-dialog`, `shared-design-view`), and `studio-ui`, `studio-fonts`; the logic in `studio-view-model`, `studio-editor-model`, `editor-state`, `editor-autosave`, `editor-panel-model`, `preview-model`, `export-model`, `share-model`, `scroll-root` (+ 9 tests), `use-autosave`, `use-dialog`, `use-studio-data`
- `lib/leave-guard.ts` (+ test), `lib/api.test.ts`, `types/studio.ts`

**Added: elsewhere**
- `e2e/studio.spec.ts`, `e2e/helpers/studio.ts`
- `packages/seo-engine/src/crawler/{browser.pool,render.browser}.test.ts`

**Modified**
- root: `tsconfig.json` (the design-engine path), `package-lock.json` (the new workspace; React hoisted to 19.3.1)
- `apps/api`: `app.module.ts` (the Studio and browser pool modules), `main.ts` (CORS exposes `Content-Disposition`), `package.json`, `tsconfig.json`, `biome.json` (no React lint domain), `common/logging/security-logger.ts` (three Studio events), `modules/media/*` (`read()` on both storages, `readImageBytes`, the download route, the pipeline's `prefer` and `quality`; specs), `modules/seo/{seo.module,seo.engine.factory}.ts` (the shared pool), `modules/users/avatar.service.spec.ts` (the storage fake's `read`)
- `apps/web`: `next.config.mjs`, `package.json`, `tsconfig.json`; `lib/{api,sse}.ts` (+ test); `components/navigation/{dashboard-shell,app-shell,topbar,sidebar,account-menu,theme-toggle}.tsx` (the rail entry and title, `saveThemeToAccount`, the leave guard, reduced motion); `components/search/global-search.tsx` and `components/notifications/notification-bell.tsx` (the leave guard); `components/media/{media-viewer,media-uploader,media-limits,use-media-list}` (Download, images-only picking); `components/composer/media-picker-dialog.tsx` (the images-only mode, the placeholder); `app/dev/components/components-showcase.tsx` (the Templates link, `saveThemeToAccount={false}`)
- `packages/db`: `schema.prisma`, `SCHEMA_NOTES.md`, `seeds/index.ts`, `src/types.ts`
- `packages/seo-engine`: `crawler/browser.pool.ts` (`render()`), `crawler/safe-fetch.ts` (`fetchBinarySafely`), `index.ts`, `crawler/crawler.test.ts`
- `packages/ui`: `slider.tsx` (`thumbs`), `onboarding-stepper.tsx` (even steps), `toast.tsx` (reduced motion), `button.test.tsx` (waits for the fill under React 19.3)
- `docs`: `local-testing-guide.md` (§5k, the Studio walk), `sprint-documents/README.md`; in the spec files (new in this commit), the sprint document's Definition of Done and the stories' section 6 ticked (the DS-9.2 "latest exported version" criterion points at Deviations)
