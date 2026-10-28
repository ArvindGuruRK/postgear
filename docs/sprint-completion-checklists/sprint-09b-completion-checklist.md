# Sprint 9b: Completion Checklist & Test Guide

Companion to [sprint-09b-studio-premium-pack.md](../sprint-documents/sprint-09b-studio-premium-pack.md),
which extends [Sprint 9](../sprint-documents/sprint-09-design-studio.md) and its
[checklist](sprint-09-completion-checklist.md).
Status as of **2026-10-28**. Branch `sprint-9-design-studio`, one commit on top of the
Sprint 9 commit (`0e7a4d9`); both committed and pushed on 2026-10-29, not merged.

Sprint 9b started from Sprint 9's Studio as the owner tested it that morning: 47
templates in one `presets.ts`, 10 themes, 17 layouts and eight fonts (Sora and
JetBrains Mono shipped as 400 to 800 trims while the code declared 100 to 800, and
Playfair Display as a subset of a font whose name is reserved). There was no
background art, no premium tier, no font choice anywhere, document schema version 1,
brand kits holding only colours, a logo and a name, and exports at 1x with Download
All as a zip. The looks come from CarouselClick (read-only, at
`D:\rk-personal-projects\marketing-app-internal\marketing-app-internal\post-builder`);
the owner confirmed the rights on 2026-10-28, and none of its client branding ships.

The **[Pre-existing]** things worth not re-testing: Sprint 9's Studio (the editor,
autosave and conflicts, undo, export over SSE, Send To Composer, share links, brand
extraction, favourites), billing entitlements and `resolveEntitlement` (Sprint 8), the
media library and image pipeline (Sprint 4, revamped 2026-10-23), the Playwright
browser pool (Sprint 7), the top bar search (2026-10-21), and the design-system
components (`Pagination`, `Dialog`, `Select`, `TooltipHint`).

**9 of the 10 Definition of Done items are met; the tenth (the hand-made originals
within the pixel tolerance) is met for nine of the ten backgrounds, and Ladder misses
the 99.5% bar by 0.01 points at one size** while matching its file's own drawing pixel
for pixel (§1.2). Every template passes overflow and pixel contrast in every format in
real Chromium (§6).

What has not run for real: no paid plan was bought; premium follows the seeded
subscriptions (the demo workspace is on Standard, PostGear Second Org has none), and
the locks were checked against both on the running API. Nothing made here was
published to a platform (`PUBLISH_SIMULATION=true`). The contrast check proves the
167 shipped templates, not the art and theme combinations a person can make in the
editor (Known gaps). The fonts' Chromium proof and the originals' pixel proof were
one-off runs, frozen as tests that read the files and hash the drawings.

---

## Prerequisites

```powershell
docker compose up -d
npm install                 # no new dependencies in this batch
npm run db:generate
npm run db:migrate          # adds 20261028120000_sprint9b_brand_kit_fonts_and_cta
npm run db:seed             # optional: the studio seed now writes version 2 documents
npx playwright install chromium   # once, for export, PDF and the opt-in browser specs
```

No new `.env` variable. The opt-in browser spec takes four test-only switches:

| Variable | Default | Meaning |
|---|---|---|
| `SEO_BROWSER_TESTS` | unset | `true` runs the real-Chromium specs (Sprint 7's switch) |
| `PRESET_IDS` | every template | Exact ids or prefixes ending in `*`, comma separated |
| `PRESET_CHECKS` | `overflow,contrast` | Either check alone, or both |
| `PRESET_AT_ONCE` | `2` | Pages drawn at once; **`6`** on an otherwise idle machine |

After pulling, hard-refresh the Studio once (Ctrl+Shift+R): three font files changed
but kept their names, and the API lets a browser keep them for a week.

---

## 1. The design engine: `packages/design-engine`

| # | Item | Status |
|---|---|---|
| 1.1 | **Fonts** (`fonts/`, `src/fonts/index.ts`): 52 families in seven categories (sans, serif, display, script, handwritten, comic, mono), 61 WOFF2 files, each family's licence text in `fonts/licenses/` (52), `LICENSES.md` rewritten from the files and `OFL.txt` corrected. `FontDef` gains `label`, `category`, `licence` (`OFL-1.1` or `Apache-2.0`), `copyright` (the file's own name table), `reservedNames` and `designer`; `FONT_CATEGORIES`, `FONT_CATEGORY_LABELS`, `FONT_LICENCE_LABELS`, `fontLabel`, `fontsInCategory`. Sprint 9's two trims and the Playfair subset are replaced. Only Google families with web rights ship; the Logo Lab's personal fonts do not | ✅ [New] |
| 1.2 | **Background art** (`src/art/`): 29 styles. `patterns.ts`, CarouselClick's ten patterns ported byte for byte (hash tests over its ten palettes and four canvas sizes); `originals.ts`, its eleven hand-made backgrounds as ten recolourable generators (Layered Depth Tall and Wide are one style) with generic names; `luxury.ts`, nine premium styles of PostGear's own (Gilded Frame, Art Deco, Silk, Spotlight, Marble, Arch, Pinstripe, Lattice, Guilloche). `artColors` gives an original its exact home colours on its home ground, a theme's pinned colours on the theme's ground, and derived colours under a brand kit; `artDataUri` caches | ✅ [New]; Ladder **99.49%** at 1920 x 1080 (§1.10) |
| 1.3 | **Themes** (`src/themes/`): `classic.ts` (Sprint 9's 10), `signature.ts` (13, CarouselClick's grounds; a text colour that failed AA is darkened, and Mint and Sky's primary goes to 5:1, see §1.11), `luxury.ts` (11, premium); `themeCollection`, `CLASSIC_THEME_IDS`, `SIGNATURE_THEME_IDS`, `LUXURY_THEME_IDS`, and `Theme.art`, the colours a theme pins for the art | ✅ [New] |
| 1.4 | **Signature layouts** (`src/layouts/signature.ts`): cover, content, list, stat, quote and closing on CarouselClick's stacked geometry, with footers and a Link slot on the closing slide; 23 layouts in all | ✅ [New] |
| 1.5 | **Templates** (`src/presets/`): `presets.ts` became a folder (`build.ts`, `classic.ts`, `classic-art.ts`, `signature.ts`, `originals.ts`, `luxury.ts`, `index.ts`). **167**: Classic 59 (the 47 unchanged and 12 with a pattern), Signature 50 (free) and 16 on the hand-made backgrounds (premium), Luxury 42 (premium). 109 free, 58 premium, 114 with art. Facets `presetCollection`, `presetLook` / `LOOK_NONE`, `presetFamily`, `isPresetPremium`; search over collection, theme and art names; `FEATURED_PRESET_IDS`, one per collection | ✅ [New] |
| 1.6 | **Schema version 2** (`schema.ts`, `document.ts`): `art`, `fonts` and `brand.fonts`; `upgrade()` from version 1; `setArt`, `setDocumentFonts`, `setElementFont`, `applyCtaDefaults`, `applyPhotoToAllSlides`, `setFormat` | ✅ [New] |
| 1.7 | **Typography** (`typography.ts`): a role's face is the element's own font, then the design's, then the brand kit's, then the theme's; `documentFonts` lists every family a design draws with, which is exactly what the exporter inlines | ✅ [New] |
| 1.8 | **Rendering** (`render/SlideView.tsx`): ground, then the art as an `<img>`, then the decor, then the text; display roles (eyebrow, headline, subheadline, quote, attribution, stat label, CTA, footer) set with `text-wrap: balance` (§1.12). `EditableText`'s `typingKeyAction` (Escape cancels, Ctrl or Cmd plus Enter keeps) is exported, and the canvas asks it | ✅ [New] |
| 1.9 | **No client branding** (`src/branding.test.ts`): no NitiCore, Niti, CloudSync, Modern Lifestyle, Trident or CarouselClick in any preset, theme, layout, font or art, nor in what the art draws | ✅ [New] |

### 1.10: why Ladder misses the fidelity bar by 0.01 points

The DoD asks each hand-made original, drawn on its home colours, to stay within 4 per
channel of CarouselClick's file on 99.5% of its pixels. Nine score 99.97% or more at
both sizes. Ladder scores 99.52% at 1080 x 1350 and 99.49% at 1920 x 1080, every miss
on a bar edge. CarouselClick shows these files through an `<img>`, which Chrome draws
from a resampled raster, so hard edges come out a little soft. The file's own markup
sliced into the canvas scores the same 99.49%, and Ladder matches that markup pixel
for pixel: the gap is in how the reference is drawn, not in the port. Moving the bar
is the owner's call, so the item stays unticked.

### 1.11: why Mint and Sky's primary is 5:1, not 4.5:1

The eyebrow is drawn in the theme's primary, and over a pattern's gradient the ground
behind it lightens and darkens. At exactly 4.5:1 on the flat ground, the eyebrow fell
under AA on part of its line, so the first Signature run hid the eyebrows on Mint and
Sky. At 5:1 (`#067D46`, `#2362D6`) the eyebrows show and pass, except over Aurora
(§6).

### 1.12: why `balance`, and not `pretty`

`text-wrap: balance` evens the lines of a short block, so no headline ends on a lone
word, and it never adds a line, so it cannot cause an overflow the fitter did not
measure. `pretty` would be gentler on body text, but Firefox does not support it, so
the editor in Firefox and the export in Chromium would break lines differently.

```powershell
npm test --workspace=@postgear/design-engine
```

Expect **744 passed** (the whole engine, in `npm run validate` on 2026-10-28): the 47 Sprint 9 ids, themes and names pinned (`presets/registry.test.ts`), the facets and the premium rule, every font file's weights and names read from the file (`fonts.test.ts`), the patterns' hashes, the originals' proven drawings, the luxury art, the themes' AA pairs, schema version 2 and its upgrade, and the branding scan.

## 2. Database: `packages/db`

| # | Item | Status |
|---|---|---|
| 2.1 | Migration `20261028120000_sprint9b_brand_kit_fonts_and_cta`: `BrandKit.headingFont`, `bodyFont` (text, nullable), `lockLook` (boolean, default false), `ctaText`, `ctaUrl` (text, nullable). Additive; applied and generated | ✅ [New] |
| 2.2 | `prisma/SCHEMA_NOTES.md` has a Sprint 9b section | ✅ [New] |
| 2.3 | `seeds/studio.seed.ts` writes version 2 documents; **not re-run**, so the demo designs stay as the owner left them (they upgrade on read) | ✅ [New] |

## 3. The API: `apps/api/src/modules/studio`

| # | Item | Status |
|---|---|---|
| 3.1 | `GET /studio/access` answers `{ premium }`: the workspace's plan is entitled to a paid tier (`resolveEntitlement(...).tier !== 'FREE'`; a trial or a past-due plan counts as paid) | ✅ [New]; **live-probed** |
| 3.2 | **Premium refusals** (`studio.premium.ts`): a 402 with `code: 'premium_look_requires_plan'` and "Premium templates come with a paid plan." on creating from a premium template, and on a save whose theme or art changes to a premium one. A design that already had its look keeps saving after a downgrade, and duplicating one is allowed. A save naming any revision but the stored one is answered 409 `design_conflict` before the comparison (§3.9) | ✅ [New]; **live-probed** |
| 3.3 | **Brand kits** (`brand-kits.service.ts`): `headingFont`, `bodyFont`, `lockLook`, `ctaText` (60 characters), `ctaUrl` (60, no spaces). `POST /studio/brand-kits/:id/duplicate` makes "Name (Copy)". A new design made with a kit gets its CTA text and link in the closing slide once, at creation (`applyCtaDefaults`) | ✅ [New] |
| 3.4 | **Duplicate with a format**: `POST /studio/designs/:id/duplicate` takes `{ format }` ("Title (Story)"), a 400 `format_unavailable` when a layout cannot take it; the format column follows the document | ✅ [New] |
| 3.5 | **2x export**: the export request takes `scale: 1 \| 2` (`deviceScaleFactor` 2); the media pipeline's `GENERATED_MAX_EDGE` is 4096, so a 2x story (2160 x 3840) fits | ✅ [New] |
| 3.6 | **Downloads**: `GET /studio/designs/:id/download?format=zip\|pdf`. The zip gains `captions.txt` when the caption is not empty. The PDF (`design-pdf.ts`) is one page per exported slide at the slide's own size, printed in the browser pool. A 409 `download_nothing` without an export, a 409 `download_missing` when a slide left the library, a 503 `export_unavailable` without a browser, a 503 `pdf_failed`; one print of a design at a time (409 `pdf_busy`) and none while it exports (409 `export_busy`) | ✅ [New]; portrait pages **2px taller** (Known gaps) |
| 3.7 | **Search**: a Designs group in the top bar's `GET /search` (four at most), showing the first exported slide while it exists | ✅ [New] |
| 3.8 | `brandKitName` on design rows, for the landing cards | ✅ [New] |

### 3.9: why the premium check reads only premium saves, and refuses other revisions

Autosave sends the whole document every few seconds, so the check must cost nothing
for an ordinary save: only a document that holds a premium look pays for the read of
the stored one. That read is only meaningful if it is the very design the save
replaces, and the write is conditional on the same revision. So a save naming any
other revision is refused with the write's own 409. Waved through (as it was before
the review), a save sent one revision ahead of the row could land once a second save
moved the row to that revision, and store a premium look nobody checked.

**Live probe, 2026-10-28** (the running API, `scratchpad/premium-probe.py`): signed in
as the demo user and switched to **PostGear Second Org** (no subscription).
`GET /studio/access` gave `{ premium: false }`; creating from
`luxury-collection-launch-gilded-noir` and from `handmade-app-launch-cascade` were both
402 `premium_look_requires_plan`; a free Signature design was created (201); a save
that changed its theme to Gilded Noir was 402 and the stored theme stayed Forest at
revision 1; the same save sent one revision ahead was 409 `design_conflict`; an
ordinary save was 200; the probe design was deleted. Back on the demo workspace,
access gave `{ premium: true }`.

```powershell
npm test --workspace=@postgear/api
```

Expect **1411 passed, 20 skipped** (the opt-in browser specs) for the whole API, in
`npm run validate` on 2026-10-28. The studio and search specs cover the premium rule (both
refusals, a downgraded design that keeps its look, duplicates, the stale and the
ahead-of-the-row saves, a deleted design), kit fonts, lock and CTA, both duplicates,
2x, the zip with `captions.txt`, the PDF and its busy guards, and the Designs search.

## 4. The screens: `apps/web/src/components/studio`

| # | Item | Status |
|---|---|---|
| 4.1 | **Premium locks** (`premium-lock.tsx`, `useStudioAccess`): a locked card or tile keeps showing, with a lock, ", locked" in its name and the hint "Premium templates come with a paid plan."; choosing it opens **Premium Templates** with **See Plans** and **Cancel**. A 402 from the API opens the same dialog. A workspace with a paid plan shows no badge at all | ✅ [New]; **seen live** on PostGear Second Org (2026-10-28): 24 of 24 Luxury cards in the gallery, and 11 of 11 Luxury themes, 10 of 10 Originals and 9 of 9 Luxury backgrounds in the Design tab, locked, with the free ones open. Choosing one opened the dialog (See Plans in a new tab in the editor) and wrote nothing (screenshots 360 to 362) |
| 4.2 | **Gallery** (`template-gallery.tsx`, `template-filters.tsx`, `studio-pagination.tsx`): Search, Category, Collection, Style, Look (None, then the art by group), Colour (11 families) and Favourites; 24 a page with the DS `Pagination`, back to page 1 on any change; a template picked before the wizard first, then favourites, then featured, then Signature, Luxury and Classic. Starring a card never moves it until the filters change | ✅ [New] |
| 4.3 | **Wizard and landing**: the last kit used is remembered per workspace (`postgear.studio.lastKit.<orgId>`, badge **Last Used**); design cards name their kit; the landing's featured tiles lock by the same rule; **Duplicate** on a kit card | ✅ [New] |
| 4.4 | **Design tab** (`panel-design.tsx`, `theme-tiles.tsx`, `art-tiles.tsx`, `font-select.tsx`, `font-licences-dialog.tsx`): Theme tiles by collection, Background Art tiles drawn in the design's palette, Fonts (Heading and Body, "Theme Font" or "Brand Kit Font" first, each family in its own face) with **Font Licences**, Custom Colours with **Use Kit Colours** or **Use Theme Colours**, Format with the reason a format is unavailable, and **Make A Story Version**. **Update From Kit** (formerly Update Colours) takes the kit's fonts too, and the kit notice compares fonts | ✅ [New] |
| 4.5 | **Lock Brand Look** (`BrandLookLock` in `panel-ui.tsx`): hides custom colours, the font pickers, the custom swatch and hex (Element and Slide tabs) and the logo's Choose From Media, with one sentence instead. Applying or updating a locking kit takes the design's own fonts out (`withKit`, `withKitUpdate`), and a design that still has some offers **Use Kit Fonts** | ✅ [New] |
| 4.6 | **Element tab**: **Font**, "Design Font" first | ✅ [New] |
| 4.7 | **Slide tab** (`slide-panel-model.ts`): a photo's **Tint** (Dark lays black under light text, Light white under dark text) and **Apply To All Slides**; both undo | ✅ [New] |
| 4.8 | **Canvas** (`canvas-model.ts`, `rail-model.ts`): Zoom Out, the level, Zoom In and Fit, up to 200% and never below Fit, also +, - and 0 while not typing; a **Changed** marker on an element that differs from its template; Escape cancels typing (its own undo step) and Ctrl or Cmd plus Enter keeps it; the rail reads "1. Cover" | ✅ [New] |
| 4.9 | **Brand kit dialog**: Fonts, CTA text and Link, Lock Brand Look, and **From One Colour** (`kit-palette-model.ts`: text at least 7:1, secondary and accent at least 4.5:1) | ✅ [New] |
| 4.10 | **Export dialog**: Size 1x or 2x, **Download PDF**, and a note that Download All includes `captions.txt` | ✅ [New] |
| 4.11 | **Search** (`search/design-results.ts`, `global-search.tsx`): a **Designs** group in the top bar's palette | ✅ [New] |
| 4.12 | **A save refused for a premium look** (`editor-autosave.ts`, `studio-editor.tsx`): held, never retried on its own; the dialog opens once and premium looks lock; the alert offers **See Plans** (a new tab, so the edits stay) and **Try Again**, which asks for the plan again; Undo or a free look saves on its own | ✅ [New] |

Walked by the task agents with screenshots in `screenshots/`: 300 to 319 (Design and
Element tabs, the premium refusal with routed responses, the lock), 320 to 336
(gallery, landing, Last Used, `/dev/studio`), 340 to 359 (kits, zoom, tint, export,
search), in light, Lilac and dark, desktop and phone. The two review-fix controls
(Try Again beside See Plans, Use Kit Fonts) are not in a screenshot. The close-out
check of the locks on PostGear Second Org, a free workspace, is 360 to 362 (dark, desktop).

```powershell
npm test --workspace=@postgear/web
```

Expect **798 passed** for the whole web app (`npm run validate`, 2026-10-28), including
the studio models (gallery and filters, premium, panels, autosave and its premium hold,
canvas, rail, slide panel, kit palette and extras, export), the Designs search results,
the playground model and `title-case.test.ts`.

## 5. The template playground: `/dev/studio`

| # | Item | Status |
|---|---|---|
| 5.1 | Pages of 6, 12 (default) or 24 with the gallery's filters; the filters, page and size live in the URL and survive a reload; changing the size keeps the first template in view (`playground-model.ts`, screenshots 334 to 336) | ✅ [New] |

## 6. Every template in real Chromium: `presets.browser.spec.ts`

| # | Item | Status |
|---|---|---|
| 6.1 | **Overflow**: every slide of every template in every format it offers, drawn the way Export draws it, with the fitter asked which slots it could not fit | ✅ [New] |
| 6.2 | **Pixel contrast**: the text hidden, the slide photographed, and every text slot must clear 4.5:1 (3:1 for headline, stat, quote and CTA) on 95% of the pixels behind its lines. Its self-test (Ladder under Nightfall) must be flagged, so a pass means something | ✅ [New] |

**The run of 2026-10-28** (`SEO_BROWSER_TESTS=true PRESET_AT_ONCE=6`, all 167, 31
minutes): overflow passed everywhere (748 s); contrast passed for 165 templates and
failed for two, on the eyebrow only: Aurora behind the eyebrow on Mint
(`signature-spring-menu-mint`, worst 4.07:1) and on Sky
(`signature-makers-market-sky`, worst 3.59:1). Those two rows now wear Horizon and
Prism (pairs no other row uses; ids, names and eyebrows unchanged), and
`PRESET_IDS='signature-spring-menu-mint,signature-makers-market-sky'` passed both
checks (4 passed, 34 s). The Signature contact sheets (260 to 265) predate that swap.

The real-Chromium exporter spec (`design-exporter.browser.spec.ts`, including 2x and
the PDF) passed 16 of 16 when Task 9 finished.

## 7. End to end: `e2e/studio.spec.ts`

The Sprint 9 spec (create, edit, preview, export, Download All, send, share and
revoke), with the headline step now ending its typing with Ctrl or Cmd plus Enter,
since Escape cancels. Run on 2026-10-28: **7 passed** (26.3 s).

---

## Definition of Done: evidence

| DoD item | Evidence |
|---|---|
| 150 or more presets; the 47 Sprint 9 ids unchanged | 167 (§1.5); `presets.test.ts` wants 150; `registry.test.ts` pins the 47 ids, themes and names, and they serialise to the same JSON as before the split |
| The ten patterns match CarouselClick byte for byte; the originals match their files within the stated pixel tolerance | **Partly.** The patterns: byte for byte, hash-tested over ten palettes and four sizes. The originals: nine at 99.97% or more; Ladder 99.52% and 99.49% against the 99.5% bar, matching its file's own markup pixel for pixel (§1.10) |
| No client name, logo or sample copy anywhere a user can see | `branding.test.ts` (§1.9) |
| 52 fonts load in the editor and in exports; licences and authors are listed in Font Licences and `fonts/LICENSES.md` | `fonts.test.ts` reads every file's weights and names; Task 1's Chromium proof on the real `buildExportPage` and `buildFontStylesheet`: 82 of 82 weight checks resolved to the right face and drew unlike the fallback (screenshot 170); Font Licences lists every family with its licence and copyright line |
| A user can set the heading and body fonts of a design, the font of one element, and a brand kit's fonts; exports use them | §4.4, §4.6, §4.9; the precedence in `typography.test.ts`; the exporter inlines `documentFonts(document)`, the faces the design actually draws with |
| Premium looks are locked for a free workspace in the gallery, the Design tab and the API, and open for a paid one | API: the live probe of §3.9 on both seeded workspaces. Web: `premium-model`, view model and autosave tests; the editor's refusal and locked tiles with routed responses (317, 318). Live on PostGear Second Org (2026-10-28): every Luxury card in the gallery and every Luxury theme, Original and Luxury background in the Design tab locked, choosing one opened the dialog, and the stored design was unchanged (§4.1, screenshots 360 to 362) |
| Every preset passes overflow and pixel contrast in every format | §6: 167 of 167 for overflow; 165 in the full run and the two re-paired ones re-checked for contrast |
| The CarouselClick features in "What This Batch Takes" work as described | §4.2 to §4.11, §3.3 to §3.7, with screenshots 300 to 359 |
| `/dev/studio` paginates and filters | §5 |
| `npm run validate` passes; the Studio e2e spec passes | `npm run validate`: 39 of 39 tasks on 2026-10-28 (design-engine 744 tests, API 1411 passed and 20 skipped, web 798); `e2e/studio.spec.ts`: 7 passed the same day (§7) |

---

## Deviations from the sprint document, and why

| The document said | What shipped | Why |
|---|---|---|
| Free keeps about 90 templates; premium adds about 60 | 109 free, 58 premium | Signature reached 50 free templates on its own |
| Art that fails behind text is toned down where it sits (section 14) | Each template wears its art only where its text reads, and the check proves every shipped pairing; Ladder ships once (on Mint), and six patterns never sit on a classic shape | A veil or mask strong enough for any art under any text would also flatten the looks the owner asked for exactly; left for a later batch |
| A text colour that fails AA is darkened to the nearest passing shade | Mint and Sky's primary goes to 5:1 | 4.5:1 on the flat ground left eyebrows under AA over a pattern's gradient (§1.11) |
| Fonts with a Reserved Font Name ship as full-glyph files | DM Serif Display stays a Google subset | Its reserved name is "Source" (from Source Serif), which its own name does not use, so the subset is lawful |
| Update Colours (Sprint 9, DS-2.5) | Renamed **Update From Kit** | It takes the kit's fonts too since this batch |
| Not in the document | Display roles use `text-wrap: balance` | No headline ends on a lone word, and it never adds a line (§1.12) |
| Not in the document | Lock Brand Look also takes the design's own fonts out | Otherwise its note ("locks this design's colours, fonts and logo") was not true (review finding 3) |
| Not in the document | `FEATURED_PRESET_IDS` shows one template of each collection | The first screen should show the range |

## Review findings fixed before closing (2026-10-28)

A postgear-reviewer pass over the whole batch found four things.

| Finding | Fix |
|---|---|
| A save naming a revision other than the stored one skipped the premium check, so a save sent ahead of the row could land once a second save moved the row there | Any other revision is a 409 `design_conflict` (a missing design a 404) before the comparison; three specs (§3.9) |
| A save held for a premium look offered only See Plans, so an upgrade in another tab left the editor stuck | Try Again beside See Plans; it resends the save and asks for the plan again, so the tiles unlock; See Plans opens a new tab in the editor (alert and dialog); an autosave spec |
| Lock Brand Look hid the font pickers but left fonts chosen before the lock on the slides | `withKit` and `withKitUpdate` take the design's own fonts out under a locking kit; **Use Kit Fonts** for a design that still has some; three specs |
| Download PDF had no busy guard | One print of a design at a time (409 `pdf_busy`), none while it exports (409 `export_busy`); three specs |

## Known gaps

1. **Art and theme combinations made in the editor are not checked.** The contrast
   check proves the 167 shipped templates. A person can still put Ladder or Aurora
   under any theme's text. A veil or mask behind text, or a warning in the Design tab,
   would close it.
2. **Lock Brand Look is the editor's, not the API's.** The API saves a custom colour
   or font on a locked kit's design if a request sends one.
3. **Ladder's fidelity** is 0.01 points under the bar at 1920 x 1080 (§1.10); the
   owner decides whether the bar or the reference rendering is the measure.
4. **Portrait PDF pages are 2px taller than the slide**: Chromium rounds paper sizes;
   the picture fills the page.
5. **Preview's platform list stays stale after a format change** until a reload: the
   platforms come from the server with the design.
6. **The Design tab opens in 190 to 370 ms** in a dev build (Slide 40 to 110,
   Element 75 to 120). The engine work is negligible; it is about 400 DOM nodes. Not
   profiled or optimised.
7. **The busy guards are per API process.** Export and PDF refuse a second run in the
   same process; a second API instance would not see the first's run (as Sprint 9's
   export).
8. **The Logo Lab's personal fonts** (Jumping Chick, Winter Half, Blowbrush, Jaiho and
   the rest) are not shipped: they need their authors' written permission for web
   embedding. Italiana lacks the euro sign, and no family has the rupee sign (latin-ext
   files are a later batch).
9. **The browser checks are opt-in and not in CI.** The whole library takes about half
   an hour; run it after changing a template, a theme, art or a layout.
10. **No real payment.** Premium follows the seeded subscriptions; no plan was bought
    through Stripe for this batch.

## 8. What remains for you

1. **Walk it by hand** (testing guide §5l), in light, Lilac and dark, and at phone
   width: the gallery's filters and pages, the Design tab (themes, art, fonts, custom
   colours, format, Make A Story Version), the Element font, Tint and Apply To All
   Slides, zoom and Escape, a brand kit with fonts, CTA, Lock Brand Look and From One
   Colour, Duplicate, export at 2x, Download PDF, and the Designs search group.
2. **See the locks** on **PostGear Second Org** (no plan): Luxury and hand-made cards
   and the luxury tiles show a lock and open Premium Templates.
3. **Hard-refresh once** (Ctrl+Shift+R) so the new Sora, JetBrains Mono and Playfair
   Display files load.
4. **Confirm or flip** the "Decisions Made Without The Owner" table in the sprint
   document, and decide on Ladder's fidelity bar (§1.10).
5. **For the Logo Lab fonts**, ask their authors for written web-embedding permission
   first (the `studio-fonts-licensing` notes list who to ask).
6. **Merge when ready**: both commits are pushed on `sprint-9-design-studio` (Sprint 9 is `0e7a4d9`); open a pull request when you want them merged.

---

## Files changed in this pass

Compared with the Sprint 9 commit: 160 files added (51 font files, 52 licence
texts, 57 source and doc files), 103 changed, 1 removed
(`packages/design-engine/src/presets.ts`, now the `presets/` folder). The screenshots
stay local in `screenshots/`, as with every earlier batch.

**Added: engine** (`packages/design-engine`)
- `fonts/` 51 WOFF2 files and `fonts/licenses/` (52 texts)
- `src/art/{index,types,patterns,originals,luxury}.ts` (+ `art`, `patterns`, `originals`, `luxury` tests)
- `src/themes/{classic,signature,luxury,scale}.ts`, `src/layouts/signature.ts`
- `src/presets/{index,build,classic,classic-art,signature,originals,luxury}.ts` (+ `registry.test.ts`)
- `src/typography.ts` (+ test), `src/fonts/fonts.test.ts`, `src/branding.test.ts`, `src/samples.test.ts`, `src/render/{SlideView,EditableText}.test.tsx`

**Added: API and database**
- `apps/api/src/modules/studio/{studio.premium,design-pdf}.ts` (+ `design-pdf.spec.ts`)
- `packages/db/prisma/migrations/20261028120000_sprint9b_brand_kit_fonts_and_cta/`

**Added: web** (`apps/web/src/components`)
- `studio/{premium-lock,font-select,font-licences-dialog,theme-tiles,art-tiles,template-filters,studio-pagination,kit-from-color}.tsx`
- `studio/{premium-model,canvas-model,rail-model,slide-panel-model,kit-palette-model,kit-extras-model}.ts` (+ tests)
- `search/design-results.ts` (+ test)

**Added: docs**
- `docs/sprint-documents/sprint-09b-studio-premium-pack.md`, this checklist

**Modified**
- `packages/design-engine`: `schema`, `document`, `types`, `brand`, `ink`, `issues`, `samples`, `index`, `fonts/index`, `layouts/index`, `themes/index`, `render/{SlideView,EditableText}` and their tests; `fonts/{LICENSES.md,OFL.txt}` and the replaced `sora-var`, `jetbrains-mono-var`, `playfair-display-var`
- `apps/api`: the studio service, controller, repository, schema, types, messages and module; `brand-kits.service`, `design-archive`, `design-exporter` and their specs; `presets.browser.spec.ts` (contrast, `PRESET_IDS`, `PRESET_CHECKS`, `PRESET_AT_ONCE`); the search module and service (Designs); the media `image-processor` and `media.service` (2x)
- `apps/web`: the studio editor, autosave, panels, canvas, rail, landing, wizard, gallery, export dialog, brand kit dialog and view models; the three studio pages; `/dev/studio`; `global-search.tsx`; `types/{studio,search}.ts`; `scripts/generate-brand.mjs` and `brand/brand-paths.ts` (Luckiest Guy's licence label)
- `packages/seo-engine`: the browser pool (`collect` before the screenshot, PDF printing)
- `packages/db`: `schema.prisma`, `SCHEMA_NOTES.md`, `seeds/studio.seed.ts`
- `e2e/studio.spec.ts` (Ctrl or Cmd plus Enter); `docs/local-testing-guide.md` (§0, §5l, §9)
