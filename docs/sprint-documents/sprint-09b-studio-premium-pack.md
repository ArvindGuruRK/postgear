# Sprint 9b: Studio Premium Pack (CarouselClick Looks, Luxury Set, Fonts)

> **Extends**: [Sprint 9: Design Studio](sprint-09-design-studio.md). Everything there still holds: users fill and nudge a template, they do not draw.
> **Reference**: CarouselClick, the post builder at `D:\rk-personal-projects\marketing-app-internal\marketing-app-internal\post-builder` (read-only). Its templates, art and menus may be ported (the owner confirmed the rights on 2026-10-28). Its client branding may not: no NitiCore, Niti, CloudSync, Modern Lifestyle, Trident or CarouselClick name, logo, copy or sample text may reach anything a user sees. Code comments and docs may name CarouselClick as the source.
> **Feature inventory**: the CarouselClick vs Studio comparison (every menu, label and gap) was produced on 2026-10-28 and is summarised under "What This Batch Takes" below.
> **Branch**: `sprint-9-design-studio`. Sprint 9 has its own commit (`0e7a4d9`) and this batch is one commit on top of it; both were pushed on 2026-10-29.
> **Status**: built and closed out on 2026-10-28, with 9 of 10 Definition Of Done items met (see the [completion checklist](../sprint-completion-checklists/sprint-09b-completion-checklist.md)). Committed and pushed on 2026-10-29; the owner reports it working.

## Progress Log

- **2026-10-28, lead**: engine vocabulary (section 1) and this document.
- **2026-10-28, lead (Task 7, done)**: `src/presets.ts` became `src/presets/` (`build.ts` with `slide`, `PresetShape`, `PresetRow`, `buildPresets`; `classic.ts` with the 47 unchanged and `CLASSIC_SHAPES` exported; empty `signature.ts`, `originals.ts`, `classic-art.ts`, `luxury.ts` for Task 8; `index.ts` with the registry and the facets `presetCollection`, `presetLook` / `LOOK_NONE`, `presetFamily`, `isPresetPremium`, and search over collection, theme and art names). Proven identical: the 47 serialise to the same JSON as before. Tests: `presets/registry.test.ts` (pins the 47 ids, themes and names; facets; the premium rule; Title Case names) and `src/branding.test.ts` (no client name in any preset, theme, layout, font or art, nor in what the art draws). `presets.browser.spec.ts` takes `PRESET_IDS` (exact ids or `prefix*`).
- **2026-10-28, lead (part of Task 9, done)**: migration `20261028120000_sprint9b_brand_kit_fonts_and_cta` (BrandKit `headingFont`, `bodyFont`, `lockLook`, `ctaText`, `ctaUrl`), applied and generated; `SCHEMA_NOTES.md` has a Sprint 9b section.
- **2026-10-28, Wave 1 (Tasks 1, 2, 4, 5 and 6, done and checked by the lead)**: all six Wave 1 agents stalled once on a stream timeout and were resumed.
  - Task 1, fonts: 61 WOFF2 files and 52 licence texts under `packages/design-engine/fonts/`; `FontDef` gains its category and licence, with `FONT_CATEGORIES`, `FONT_CATEGORY_LABELS`, `FONT_LICENCE_LABELS`, `fontLabel` and `fontsInCategory`; the API serves `/public/studio-fonts/*` (200, path traversal refused).
  - Task 2, art: `art/patterns.ts` (the ten patterns, byte-exact, proven by hashes) and `art/originals.ts` (the ten hand-made backgrounds as recolourable generators). Ladder matches CarouselClick's markup exactly; the 0.5% pixel gap (99.491% match) is CarouselClick's own raster softening.
  - Task 4, engine core: schema version 2 (`art`, `fonts`, `DesignBrand.fonts`, `upgrade()` from 1), typography choices, art colours, and `SlideView` drawing the art between the ground and the decor.
  - Task 5, layouts: `layouts/signature.ts`, the six Signature layouts (cover, content, list, stat, quote, closing) with footers and a Link slot on the closing slide.
  - Task 6, themes: `themes/classic.ts`, `signature.ts` (13) and `luxury.ts` (11, premium), with `themeCollection` and the `*_THEME_IDS` lists. Mint, Paper and Sky keep CarouselClick's grounds; their text colours are darkened to pass AA.
  - At the end of Wave 1: engine 23 suites and 724 tests, API studio 305 passed (7 opt-in skipped), web studio 252, every workspace typechecks.
- **2026-10-28, lead (fixes on top of Wave 1)**: the sample text gains a footer line ("Swipe for more") and an address for slots labelled Link ("yourbrand.com"); `updateDesignSchema` upgrades a version 1 document before validating it, so an editor tab opened before the release keeps saving; the studio seed writes version 2 documents (not re-run, so the demo designs stay as the owner left them); the theme lists are exported from the package root.
- **2026-10-28, lead (pixel contrast check, groundwork for Task 13)**: `presets.browser.spec.ts` gains `PRESET_CHECKS=contrast`. It hides the text, photographs what is behind every line (ground, art, decor) and needs 4.5:1 (3:1 for headline, stat, quote and cta) on 95% of those pixels. Its self-test, Ladder under Nightfall on the tips-steps shape, is flagged on every slide (worst 1.39:1), so a pass means something.
- **2026-10-28, Task 3 (done, checked by the lead)**: `art/luxury.ts`, nine premium styles (Gilded Frame, Art Deco, Silk, Spotlight, Marble, Arch, Pinstripe, Lattice, Guilloche). Arch fades to a ghost where it crosses the content box. 94 tests; art and branding suites 148 passed. Contact sheets: screenshots 200 to 209.
- **2026-10-28**: Wave 2 running: Task 8a (Signature templates), 8b (originals and classic art templates), 8c (Luxury templates) and 9 (the API). Each content task must pass the overflow and contrast checks on its own prefix.
- **2026-10-28, 16:10 to 16:20**: every running agent stopped on the account's session limit and was resumed when it reset; nothing was lost.
- **2026-10-28, lead (shared web pieces for Wave 3)**: `premium-lock.tsx` (the refusal code, the lock mark and the lock dialog with See Plans and Cancel), `useStudioAccess` in `use-studio-data.ts`, and `font-select.tsx` (the grouped font picker, each family in its own face). The premium refusal follows the appearance themes: a 402 with `code: 'premium_look_requires_plan'`.
- **2026-10-28, Task 9 (done, checked by the lead)**: `GET /studio/access`; premium refusals (a 402 with `premium_look_requires_plan`) on create from a premium preset and on a save that adds a premium theme or art, with existing looks and duplicates allowed; kit fonts, Lock Brand Look (not enforced by the server: the editor hides the controls), CTA defaults (`applyCtaDefaults` in the engine, applied once at creation) and kit Duplicate ("Name (Copy)"); duplicate with a format ("Title (Story)", a 400 `format_unavailable` when a layout cannot take it); exports at `scale` 1 or 2, a PDF download (one page per slide, a 409 without a current export, a 503 `pdf_failed`), `captions.txt` in the zip; a Designs group in global search; `brandKitName` on design rows. Portrait PDF pages are 2px taller than the slide because Chromium rounds paper sizes; the picture fills the page. API studio and search: 438 passed, 20 opt-in skipped; real Chromium exporter spec 16/16.
- **2026-10-28, Task 8c (done, checked by the lead)**: `presets/luxury.ts`, 42 premium templates in 15 shapes across the 11 luxury themes and 9 luxury art styles (each art on 4 rows, 6 rows without art), Signature and classic shapes, no picture layouts. Overflow and contrast pass in every format (`PRESET_IDS='luxury-*'`, 4 passed). Contrast moved two rows off Art Deco, whose bottom-centre sunburst sits under the classic closing slide's centred handle; Art Deco now goes only on shapes ending on the Signature closing or the closing band. Copy rewritten so no line ends on a single word. Screenshots 280 to 289.
- **2026-10-28, Task 8b (done, checked by the lead)**: `presets/originals.ts`, 16 premium templates on the ten hand-made backgrounds (9 on a home theme, 7 recoloured), and `presets/classic-art.ts`, 12 free classic templates with a pattern. Overflow and contrast pass (`PRESET_IDS='handmade-*,classic-*'`, 4 passed). Found by the contrast check: Ladder is unreadable under its own Nightfall ground (headlines 52 to 89% readable, body as low as 0%), so it ships once, on Mint, in a carousel without eyebrow, footer or link; Drift opens without an eyebrow; six patterns (Aurora, Arcs, Waves, Horizon, Glass, Minimal) fail on every classic theme, mostly under the classic footer, so classic-art uses only Beams, Prism, Planes and Halftone. Left for Task 13: a way for those six patterns and Ladder to sit under text. Screenshots 270 to 275.
- **2026-10-28, Task 11 (done, checked by the lead)**: the gallery gains Collection, Look and Colour filters beside Search, Category, Style and Favourites, 24 a page with the DS pagination (back to page 1 on any change), premium locks with the lock dialog (and on a 402 at create), order: a preselected template, favourites, featured, then Signature, Luxury, Classic; the wizard remembers the last kit per workspace (Last Used); landing cards name the kit; `/dev/studio` pages at 6, 12 or 24 with filters, page and size in the URL. Gallery page change 0.22 to 0.46 s in a dev build. Web studio, playground and title-case suites: 405 passed. Screenshots 320 to 336.
- **2026-10-28, Task 12 (done, checked by the lead)**: canvas zoom (Zoom Out, level, Zoom In, Fit; up to 200%, never below Fit; plain + - 0 keys when not typing); a Changed marker on a selected element that differs from its template; Escape cancels typing (its own undo step, so Undo brings the words back) and Ctrl or Cmd plus Enter commits; the rail reads "1. Cover"; Tint (Dark, Light) and Apply To All Slides on the Slide tab; the brand kit dialog gains Fonts, CTA text and Link, Lock Brand Look and From One Colour (text at least 7:1, secondary and accent at least 4.5:1); kit Duplicate; the export dialog gains Size 1x or 2x, Download PDF and the captions.txt note; a Designs group in the top bar search. Web studio and search: 436 passed; engine render 27 passed. The lead moved the e2e headline step to Ctrl or Cmd plus Enter and wired `onDuplicated` on the landing's kit strip. Screenshots 340 to 359.
- **2026-10-28, Task 10 (done, checked by the lead)**: the Design tab gains theme tiles by collection, Background Art tiles (None, Patterns, Originals, Luxury) drawn in the design's palette, Fonts (Heading and Body, with Font Licences), Custom Colours with a reset, a Format select with the reason a format is unavailable, and Make A Story Version; the Element tab gains Font ("Design Font" first); Lock Brand Look hides custom colours, fonts and the logo's Choose From Media (the lead added the Slide tab's swatch and hex); locked premium tiles open the lock dialog; a refused save holds without retrying, opens the dialog once and saves again after Undo. Studio suites 406 passed. Screenshots 300 to 319.
- **2026-10-28, Task 8a (done, checked by the lead)**: `presets/signature.ts`, 50 free templates from 14 shapes, `signature-<shape>-<theme>`, no theme and pattern pair repeated; each pattern only on the grounds its text reads on (Waves on Mint only, Halftone on Mint and Sky). Overflow and contrast pass (`PRESET_IDS='signature-*'`, 4 passed). Screenshots 260 to 265.
- **2026-10-28, lead (finishing)**: the library is 167 templates (59 classic including 12 with art, 50 Signature, 16 hand-made, 42 Luxury). `FEATURED_PRESET_IDS` shows one of each collection. Mint and Sky `primary` go to 5:1 (#067D46, #2362D6) so an eyebrow reads over a pattern's gradient, and their carousels show their eyebrows again. Display roles (eyebrow, headline, subheadline, quote, attribution, stat label, CTA, footer) are set with `text-wrap: balance`, so no headline ends on a lone word; balancing never adds a line. "Update Colours" became "Update From Kit" (it takes the kit's fonts too) and the kit notice compares fonts. The canvas reads the renderer's own `typingKeyAction`. `presets.test.ts` wants 150. Lint and typecheck pass in all 17 workspaces; the Studio e2e spec passes (7).
- **2026-10-28**: Wave 3 started early, alongside Wave 2, against Task 9's stated contract: Task 10 (Design and Element tabs), 11 (gallery, wizard, landing, `/dev/studio`) and 12 (canvas, rail, Slide tab, typing, brand kits, export, search).
- **2026-10-28, lead (Task 13, review fixes)**: a postgear-reviewer pass over the batch found four things, all fixed with tests.
  1. A save naming a revision other than the stored one skipped the premium check and relied on the write's own conflict answer, so a save sent ahead of the row could land once a second save moved the row to that revision. The check now answers any other revision with the same 409 `design_conflict` (and a missing design with 404) before it compares looks.
  2. A save held for a premium look offered only See Plans, so a plan upgraded in another tab left the editor stuck until the look was taken out. The alert now has Try Again beside See Plans (which opens in a new tab, as the lock dialog does in the editor, so the edits stay), and Try Again asks for the plan again so the tiles unlock too.
  3. Lock Brand Look hid the font pickers but left fonts chosen before the lock on the slides, so the lock note was not true. Applying or updating a locking kit now takes the design's own fonts out (`withKit`, `withKitUpdate`), and a design that still has some is offered Use Kit Fonts under the lock note.
  4. Download PDF had no busy guard, so repeated clicks or a second tab each held a browser page. One print per design runs at a time (409 `pdf_busy`), and none while that design exports (409 `export_busy`).
- **2026-10-28, lead (Task 13, the whole library in real Chromium)**: `SEO_BROWSER_TESTS=true PRESET_AT_ONCE=6`, all 167 templates in every format they offer, 31 minutes. Overflow passed everywhere (12.5 minutes). Contrast passed for 165 templates and failed for two, on the eyebrow line only: Aurora behind the eyebrow on Mint (Spring Menu, worst 4.07:1) and on Sky (Makers Market, worst 3.59:1), the eyebrows the 5:1 primaries had brought back. Those two rows now wear Horizon (Mint) and Prism (Sky), pairs no other row uses, so the ids, names and eyebrows stay; both re-checked in every format, overflow and contrast passed. The live API was also probed on the seeded workspace without a plan (PostGear Second Org): access says locked, Luxury and hand-made templates are refused with the 402, a save that adds a premium theme is refused and writes nothing, and the paid demo workspace stays open.
- **2026-10-28, lead (close-out)**: the locks seen live in the app on PostGear Second Org: 24 of 24 Luxury cards in the gallery, and every Luxury theme, Original and Luxury background in the Design tab, with the dialog opening and nothing written (screenshots 360 to 362). `npm run validate` passed 39 of 39 tasks and the Studio e2e spec 7 of 7. The completion checklist is [sprint-09b-completion-checklist.md](../sprint-completion-checklists/sprint-09b-completion-checklist.md).

## Sprint Goal

The Studio gains the CarouselClick look and a luxury set, and the library passes **150 templates**:

1. **Background art**: CarouselClick's ten generated patterns, ported exactly, and its hand-made backgrounds rebuilt as recolourable generators, plus a luxury art set of PostGear's own. Art is a third ingredient of a design, next to the theme and the layout, and a brand kit recolours it.
2. **Fonts the user chooses**: 52 families (the Logo Lab's Google fonts, a luxury set, and Sprint 9's eight), picked for the whole design (heading and body), for one element, or on a brand kit.
3. **Premium**: the luxury set and the hand-made originals are locked to paid plans, the way premium appearance themes are.
4. **CarouselClick's menus**: the editor and export features it has that fit PostGear's model (listed under "What This Batch Takes").
5. **A paginated `/dev/studio`** so a developer can walk all 150+ templates.

## Decisions Made Without The Owner (to confirm)

The owner could not be asked during the run, so these were decided on the sensible default and can be flipped:

| Question | Decided | Why |
|---|---|---|
| Commit Sprint 9 first? | Not during the run (a commit waits for the owner); its exact state was saved as a git tree object. **Settled 2026-10-29**: the owner asked for the commit, so Sprint 9 is its own commit (`0e7a4d9`) with this batch on top. | Keeps the two reviewable apart. |
| Lock premium templates? | Yes, per **workspace** plan: a paid tier unlocks them, the same `resolveEntitlement` rule premium appearance themes use. A design that already uses a premium look keeps working after a downgrade. | The seeded demo workspace is on Standard (paid), so nothing is locked while testing. |
| Which templates are premium? | The luxury collection, its themes and art, and the hand-made originals. The ten patterns, the signature themes and every classic template stay free. | Free keeps about 90 templates; premium adds about 60. |
| The Logo Lab's personal fonts (Jumping Chick, Winter Half, Blowbrush, Jaiho and the rest)? | Not shipped. They need each author's written permission for web embedding (see the `studio-fonts-licensing` memory). | Shipping them would breach their licences in every customer export. |
| CarouselClick's exact colours? | Kept exactly (they are part of "the exact designs"), with generic theme names. A text colour that fails WCAG AA on its ground is darkened to the nearest passing shade, and the deviation is listed. | Readability on a phone beats a pixel match. |
| Hand-made originals and brand kits? | Recoloured by a brand kit like the patterns (CarouselClick keeps them fixed). On their own ground they draw in their exact original colours. | PostGear's brand kit promise is "one click restyles everything". |

## Names And Placement

| Thing | Name |
|---|---|
| The art dimension, in the Design tab and the gallery filter | Background Art (panel section), Look (gallery filter) |
| No art | None |
| Gallery collections | Classic, Signature, Luxury |
| The font section in the Design tab | Fonts, with Heading and Body pickers |
| One element's font | Font (Element tab), default "Design Font" |
| A brand kit's fonts | Fonts (brand kit dialog), Heading and Body |
| The font licences list | Font Licences (dialog) |
| Premium marker on a locked card | a lock with the tooltip "Premium templates come with a paid plan." |

All copy follows the house rules: names in Title Case, sentences in sentence case, no all-caps, placeholders "Enter your ...", no em dash or middle dot anywhere.

## What This Batch Takes From CarouselClick

**In this batch:**

| CarouselClick | PostGear |
|---|---|
| 10 generated patterns (Aurora, Prism, Beams, Arcs, Planes, Waves, Horizon, Halftone, Glass, Minimal) | Ported byte for byte as art styles |
| 11 hand-made backgrounds | Rebuilt as 10 recolourable generators (Layered Depth Tall and Wide become one style that picks its drawing by the canvas shape), with generic names |
| 10 palettes (Forest, Midnight, Lagoon, Ocean, Violet, Ember, Graphite, Mint, Paper, Sky) and the brand-dark inks | 13 signature themes with new ids (ours already use midnight, ocean and violet) |
| The stacked layout (eyebrow, headline, supporting text, accent rule, footer; two columns when wide) | A Signature layout family on its geometry |
| Brand fonts and project fonts (Heading / Body) | Design fonts, element font, brand kit fonts, 52 families |
| Tone, colour family and style filters in the gallery | Style (exists), Colour, Look and Collection filters, with pagination |
| Format switch and "Make a 9:16 version" | Format select in the Design tab and Make A Story Version |
| Custom colours for one project | Custom Colours in the Design tab (the design's own five colours) |
| Lock brand look | Lock Brand Look on a brand kit |
| Brand CTA text and link | CTA defaults on a brand kit, filled into the closing slide |
| New brand from one colour, copy a brand | From One Colour and Duplicate on brand kits |
| Download: PDF of all slides, captions.txt, high resolution | PDF Download, captions.txt in Download All, a 2x option |
| Zoom out, zoom in, fit | Zoom controls on the canvas |
| "Changed from the template" marker | A Changed marker on overridden elements |
| Escape cancels typing | Escape cancels, Ctrl or Cmd plus Enter commits |
| Slide type names in the rail | "1. Cover" instead of "Slide 1" |
| Image tint: dark or light | Tint: Dark or Light on photo backgrounds |
| One background for all slides | Apply To All Slides |
| Brand name on project cards, last brand remembered | Both |
| Designs in the top bar search | A Designs group in global search |

**Next batch (out of scope here, see the end):** icons, review and approval, AI (slides from content, rewrite and fit copy, captions per platform, brand voice), video MP4 and GIF, the 3:4 and 1.91:1 formats, logo variants per ground, a Comparison layout, Recent Designs on Home, kit template shortlists and allowed formats.

**Never copied:** free resize, weight and layer order (Studio is constrained by design), fake engagement numbers in Preview, any client branding.

## Technical Design

### 1. Engine vocabulary (done, 2026-10-28)

Already written in `packages/design-engine/src/types.ts`, so every task builds against the same names:

- `FontId` lists all 52 families; `FontCategory` (`sans`, `serif`, `display`, `script`, `handwritten`, `comic`, `mono`); `TypeFace` (`heading` or `body`); `DesignFonts` (`{ heading: FontId | null; body: FontId | null }`).
- `TypeStyle.face` records which face a role uses. `themes/scale.ts` now holds `scale()` (moved out of `themes/index.ts`) and fills `face` in.
- `Theme.family` (`ColorFamily`, with `COLOR_FAMILIES` and `COLOR_FAMILY_LABELS`), `Theme.art` (pinned `{ mid, highlight }`), `Theme.premium`.
- `Preset.art`, `Preset.collection` (`PresetCollection`: `classic`, `signature`, `luxury`, with `PRESET_COLLECTIONS` and `COLLECTION_LABELS`), `Preset.premium`.
- `SlideBackground` media gains `tint?: PhotoTint` (`dark` or `light`).
- `ElementState.font`, `DesignBrand.fonts`, `DesignDocument.art`, `DesignDocument.fonts`: optional for now; Task 4 makes them required with schema version 2.
- `src/art/types.ts` (`ArtColors`, `ArtKind`, `ArtStyle` with `home`) and `src/art/index.ts` (`ART_STYLES`, `artById`, `isArtId`, `artColors`, `artSvg` with a small cache, `artDataUri`, `isDarkGround`), with empty `patterns.ts`, `originals.ts` and `luxury.ts` for Tasks 2 and 3 to fill. Exported from `src/index.ts`.

### 2. Fonts (Task 1)

- The files come from the font pack built on 2026-10-28: `C:\Users\ArvindRK\AppData\Local\Temp\claude\d--rk-personal-projects-postgear\320bc912-c126-48c7-b5af-834ac35168d4\scratchpad\fonts-pack\out\` (`fonts/` 54 woff2, `licenses/` 47 texts, `manifest.json` with family, category, licence, reserved names, source, weights, axes, copyright, missing characters). Fonts with a Reserved Font Name are full-glyph WOFF2 made from the upstream TTF (OFL-FAQ 2.2.1); the rest are Google's latin subsets.
- The pack replaces Sprint 9's `sora-var.woff2` and `jetbrains-mono-var.woff2` (Sprint 9 shipped 400 to 800 trims while declaring 100 to 800) and `playfair-display-var.woff2` (a subset of a font with a Reserved Font Name). Inter, Poppins, Space Grotesk, Archivo Black and DM Serif Display stay as they are.
- `FontDef` gains `label`, `category`, `licence` (`OFL-1.1` or `Apache-2.0`), `copyright` (as the file's own name table states it), `reservedNames`, and `designer` where known. `fonts/LICENSES.md` is rewritten from the files (several Sprint 9 copyright lines were wrong), and each family's licence text ships in `fonts/licenses/`.
- Known gap kept: Google's latin subsets have no rupee sign (it is in latin-ext), and Leckerli One and Oleo Script have no ellipsis glyph. Those characters fall back to the system face.
- `apps/web/scripts/generate-brand.mjs` (and wherever the brand page lists it) label Luckiest Guy as OFL; it is Apache 2.0.

### 3. Background art (Tasks 2 and 3)

**The model.** An art style is `draw(colors, width, height) => svg`. `DesignDocument.art` names one (or null). `SlideView` draws it as `<img src={artDataUri(svg)} alt="" style={{ position: absolute, inset: 0, width: 100%, height: 100%, objectFit: cover }}>` **after the ground and before the layout's decor**, on every slide whose background is not a photo. The export page's CSP already allows `img-src data:`.

**The colours** (`artColors` in `src/art/index.ts`): an original's `home` colours while the slide is on its home ground, else the theme's pinned `Theme.art` while the slide is on the theme's own background, else derived (highlight = the slide palette's accent, mid = mix(ground, highlight, 0.35 on a dark ground or 0.45 on a light one), sheen = white on dark, the highlight on light). So a theme shows the exact CarouselClick colours, and a brand kit recolours the art.

**Patterns (Task 2).** `src/art/patterns.ts` is a byte-for-byte port of CarouselClick's `src/features/templates/patterns.ts` (`patternSvg` and its private helpers, including its own `mix` and number rounding). Ids and names: `aurora` Aurora, `prism` Prism, `beams` Beams, `arcs` Arcs, `planes` Planes, `waves` Waves, `horizon` Horizon, `halftone` Halftone, `glass` Glass, `minimal` Minimal. `kind: 'pattern'`, `premium: false`. Proof of exactness: for every pattern, all ten CarouselClick palettes and the four PostGear canvas sizes, our string equals CarouselClick's (run once against the original file, then frozen as hash tests).

**Originals (Task 2).** `src/art/originals.ts` rebuilds `public/themes/*.svg` (11 files, all small Figma exports with no text, logo or picture) as generators. Each literal colour becomes a token: one of the four `ArtColors`, a fixed mix of two of them, or white or black at an opacity. `home` holds the colours that reproduce the file exactly on its home ground. The SVG keeps the file's own viewBox, draws a full background rect in `colors.background` first, and uses `preserveAspectRatio="xMidYMid slice"` with the canvas width and height, which is how CarouselClick shows them (`object-fit: cover` over the background colour). Layered Depth Tall and Wide become one style, `layered-depth`, that uses the tall drawing when the canvas is taller than wide. Names are generic (for example "Facets" for the rhombus field); no file name or label from CarouselClick survives. `kind: 'original'`, `premium: true`. Home grounds: `#05011A` (the three numbered backgrounds, Layered Depth, Signal Beam, Stepped Bars), `#025226` (the two lifestyle backgrounds), `#162D2F` (the first teal one), `#EBFFF6` (the mint one).
**Proof of fidelity**: each generator on its home colours, rendered in Chromium at 1080 x 1350 next to the original file drawn the CarouselClick way, differs by at most 4 in any channel on at least 99.5% of pixels.

**Luxury art (Task 3).** `src/art/luxury.ts`, `kind: 'luxury'`, `premium: true`, drawn from the four colours only, at least eight styles: Gilded Frame (a thin double inset border with small corner ornaments), Art Deco (a fan of fine rays and concentric arcs rising from one edge), Silk (broad soft satin bands across a diagonal), Spotlight (a soft glow from above with a gentle vignette), Marble (a few fine soft veins), Arch (a tall arch outline with a faint glow inside), Pinstripe (very fine vertical lines and two thin rules), Lattice (a fine diamond lattice that fades toward the centre). Restraint is the brief: luxury reads as space, fine lines and low contrast behind the text, never busy.

### 4. Typography choices (Task 4)

- Resolution, in `src/typography.ts`: an element's own `font`, else the design's `fonts[face]`, else the brand kit's `brand.fonts[face]`, else the theme's. Weight, size, line height and tracking stay the theme's; `resolveWeight` snaps the weight to what the chosen family has.
- `documentFonts(document)`: every family a design uses (each role through the resolution above, plus every element font). The API's exporter inlines exactly these (it inlines the theme's today: `design-exporter.ts` calls `inlineFonts(fontsOf(themeById(...)))`).
- The editor and share page already declare every face (`studio-fonts.tsx`), and a browser only downloads a face when text uses it.

### 5. Document schema version 2 (Task 4)

- `DESIGN_SCHEMA_VERSION = 2`. `upgrade()` step 1 adds `art: null`, `fonts: null` and `brand.fonts: null`. The four new fields become required in the types.
- Validation: `art` is a known art id or null; font ids are `FONT_IDS`; `ElementState.font` only on text and list slots; `tint` is `dark` or `light`.
- New pure operations in `document.ts`: `setArt`, `setDocumentFonts`, `setElementFont` (or through `updateElement`), `setFormat` (re-clamps every nudge to the new format's regions; refuses a format a slide's layout does not take), `applyPhotoToAllSlides`. `documentFromPreset` copies `preset.art`; `resetDocument` restores the theme and the art and clears the design's font choice; `resetElement` clears an element font; applying a kit copies its fonts into `brand.fonts`, detaching clears them.
- **Light tint**: `photoGround(overlay, tint)`; a light-tinted photo takes dark inks that clear AA at `SAFE_PHOTO_OVERLAY` whatever the photo.
- Every fixture in `apps/api`, `apps/web` and `e2e` that builds a version 1 document by hand is updated.

### 6. Themes (Task 6)

Split into `themes/classic.ts` (Sprint 9's ten, unchanged), `themes/signature.ts`, `themes/luxury.ts`; `themes/index.ts` keeps the registry and helpers.

**Signature themes (13, free).** One per CarouselClick palette, with new ids and generic names: `forest` (Forest), CarouselClick's Midnight as `nocturne`, `lagoon`, CarouselClick's Ocean as `deep-sea`, CarouselClick's Violet as `amethyst`, `ember`, `graphite`, `mint`, `paper`, `sky`; plus three for the hand-made originals: the brand-dark inks (accent `#B8FF35`, text `#FAFFE9`, body `#E7F8EC`, mid `#0B6B35`, highlight `#B8FF35`) on `#05011A`, on `#025226` and on `#162D2F`. Mapping from a CarouselClick palette:

| PostGear role | From CarouselClick |
|---|---|
| `background` | background (exact) |
| `text` | text (headline) |
| `textMuted` | body (supporting text) |
| `primary` | accent (eyebrow, footer, accent rule) |
| `accent` | highlight |
| `secondary` | mid |
| `surface`, `onPrimary`, `onAccent`, `onSurface` | derived to clear AA |
| `Theme.art` | `{ mid, highlight }` exact |

Type: Manrope for both faces with CarouselClick's hierarchy from `src/features/editor/layout.ts` (headline 92px max at weight 820, eyebrow 30px at 800, supporting 44px at 720 with line height 1.2, footer 56px at 820, letter spacing 0). Sizes are a percentage of the short edge (92px is 8.5).

**Luxury themes (at least 10, premium).** PostGear's own: deep grounds with metallic accents and ivory grounds with deep inks (noir and gold, ivory and gold, emerald and champagne, bordeaux and rose gold, champagne, sapphire and silver, marble, onyx and blush, obsidian, pearl), set in the luxury families (Cormorant Garamond, Bodoni Moda, Cinzel, Italiana, Marcellus, Fraunces, Instrument Serif, Playfair Display) with a clean body face. Each pins `Theme.art` so the luxury art sits in its exact metallic tones.

Every theme clears `themes.test.ts` (WCAG AA for every pairing it promises), and a signature theme's `primary` must also clear AA on its `background`, because the Signature layouts set the eyebrow and footer in it.

### 7. Signature layouts (Task 5)

`layouts/signature.ts`, registered in `LAYOUTS`, all four formats, version 1:

| Id | Role | Slots |
|---|---|---|
| `signature-cover` | cover | logo, eyebrow, headline, subheadline, footer |
| `signature-content` | content | logo, eyebrow, headline, body, footer |
| `signature-list` | list | logo, headline, list (numbered), footer |
| `signature-stat` | statistic | logo, eyebrow, stat, statLabel, footer |
| `signature-quote` | quote | logo, quote, attribution, footer |
| `signature-closing` | closing | logo, headline, body, cta, footer |

Geometry from CarouselClick's `src/features/editor/layout.ts`: four stacked regions (header, title, body, footer) in square, portrait and story, two columns in landscape, converted from fractions of the slide to percentages of PostGear's content box and clamped to it. The accent rule (a pill at the top-left of the footer region) is a `rule` decor in `primary`. Logo spots header, centre and footer as CarouselClick places them (the footer text narrows so the footer logo never overlaps it). Colour roles: eyebrow, footer and cta `primary`; headline, stat and quote `text`; the rest `textMuted`. `layouts.test.ts` rules hold (slots inside regions, no overlaps, decor blocks cover regions completely or not at all).

### 8. Presets and collections (Tasks 7 and 8)

- `presets.ts` becomes `presets/`: `index.ts` (registry, lookups, filters), `classic.ts` (the 14 Sprint 9 shapes and 47 pairs, unchanged), `signature.ts`, `luxury.ts`, and shape files as needed. **No existing preset id changes or disappears** (Reset looks presets up by id); a test pins the 47.
- New helpers: `presetCollection`, `presetLook` (the art id or `none`), `presetFamily` (the theme's), `isPresetPremium` (the preset, its theme or its art), and `matchesPresetQuery` matching art and collection names too.
- New presets, all generic content in the house style (real sentences, never "Lorem ipsum", no client names; the brand name, handle and slide numbers stay bindings):
  - **Signature, patterns** (about 45, free): the ten patterns across the thirteen signature themes, each on its own content shape (CarouselClick's flows: cover, problem, insight, framework, checklist, statistic, quote, closing) across varied topics (marketing, finance, wellness, food, travel, real estate, education, software, retail, fitness, events, hiring, sustainability, coaching).
  - **Signature, originals** (about 15, premium): each hand-made original on its home theme at least once.
  - **Luxury** (about 40, premium): the luxury art and themes, with luxury-fit topics (a collection launch, a property listing, a menu, a jewellery drop, a spa ritual, a private event, a membership, a portfolio, a lookbook, a wedding, a vintage, an atelier).
  - **Classic with art** (about 10, free): Sprint 9 shapes in classic themes with a pattern.
- Total at least 150. Every preset fits every format without overflow (`presets.browser.spec.ts`) and passes the pixel contrast check (below).

### 9. Premium (Task 9 API, Tasks 10 and 11 web)

- Rule: `premiumUnlocked(org)` = the workspace's subscription is entitled to a paid tier (`resolveEntitlement(...).tier !== 'FREE'` from `billing/plans.ts`), the same rule as `hasPremiumThemes` but per workspace.
- API: `GET /studio/access` (or a field on an existing Studio response) tells the web app `{ premium: boolean }`. Creating a design from a premium preset in a locked workspace is refused the way a premium appearance theme is: a 402 with `code: 'premium_look_requires_plan'` and the message "Premium templates come with a paid plan." from `studio.messages.ts`, so the web app can open the lock dialog instead of an error. Saving a design whose theme or art **changes to** a premium one in a locked workspace is refused the same way; a design that already had it saves normally, and duplicating one is allowed.
- Web: in a locked workspace a premium card, theme tile or art tile shows a lock; choosing it opens a short dialog ("Premium templates come with a paid plan.") with See Plans (to the billing settings) and Cancel. Unlocked workspaces show no premium badge (no filler pills).

### 10. Brand kits (Task 9, one migration)

`BrandKit` gains `headingFont String?`, `bodyFont String?`, `lockLook Boolean @default(false)`, `ctaText String?`, `ctaUrl String?` (additive; use the `prisma-change` skill). DTOs and selects follow. A locked kit's designs hide Custom colour swatches, Custom Colours, the logo's Choose From Media and the font pickers while that kit is applied. Applying or updating a locking kit also takes out the fonts the design chose for itself, and a design that still has some (chosen before its kit was locked) is offered Use Kit Fonts. The lock is the editor's: the API does not refuse a save on a locked kit. CTA defaults fill the `cta` slot of a new design's closing slide (and a footer link slot where a layout has one) on create.

### 11. Exports (Task 9 API, Task 12 web)

- **PDF**: `GET /studio/designs/:id/download?format=pdf` builds one PDF page per exported slide image at the slide's own size, with Playwright's `page.pdf` in the existing browser pool (no new dependency). It needs a current export, exactly as Download All does. One print of a design runs at a time (a 409 `pdf_busy` for a second), and none while that design is being exported (a 409 `export_busy`).
- **captions.txt** in the Download All zip when the caption is not empty.
- **2x**: the export request takes `scale: 1 | 2` (2 renders at `deviceScaleFactor` 2). Media size limits must allow it.

### 12. Editor additions (Tasks 10 and 12)

Design tab: Fonts (Heading, Body, with Font Licences), Background Art (tiles drawn in the design's palette, plus None), Theme tiles grouped by collection, Custom Colours, Format (select) and Make A Story Version. Element tab: Font. Slide tab: Tint (Dark, Light) and Apply To All Slides. Canvas: Zoom Out, Zoom In, Fit; the Changed marker. Typing: Escape cancels. Rail: "1. Cover". Brand kit dialog: Fonts, Lock Brand Look, CTA defaults, From One Colour; kit cards: Duplicate. Wizard: remembers the last kit. Landing cards: the kit's name.

### 13. Gallery and playground (Task 11)

- Gallery (wizard step 3): Search, Category, Style, Look, Colour, Collection; the DS `Pagination` (24 a page, back to page 1 when a filter changes); premium locks.
- `/dev/studio`: the same filters plus pagination (page size 6, 12 or 24, kept in the URL as `?page=`), so a developer can walk every preset in every format.

### 14. Pixel contrast check (Task 13)

`presets.browser.spec.ts` gains a pass that renders each preset slide with its text made transparent, samples the ground under every text slot, and requires the slot's ink to clear 4.5:1 against at least 95% of the sampled pixels (3:1 for headline, stat, quote and cta, which are large).

**As built**: the art was not toned down. Each template pairs its art only with the grounds and shapes its text reads on, and the check proves every pairing that ships: Waves only on Mint, Halftone on Mint and Sky, Art Deco only on shapes that end on the Signature closing or the closing band, Ladder once (on Mint, without eyebrow, footer or link), and six patterns (Aurora, Arcs, Waves, Horizon, Glass, Minimal) never on a classic shape. A veil or mask that would let any art sit under any text was left for a later batch, so a combination a person makes in the editor (any art on any theme) is not checked. Mint and Sky's `primary` went to 5:1 so an eyebrow keeps 4.5:1 over a pattern's gradient.

## Task Breakdown

Each task owns the files listed; another task's files are read-only to it. Agents run in parallel in waves.

**Wave 1**
1. **Fonts library**: `packages/design-engine/fonts/**`, `src/fonts/**`, the Luckiest Guy label fix. Tests: every `FontId` has a def; every face file exists; declared weights match the files; every face loads in Chromium.
2. **CarouselClick art port**: `src/art/patterns.ts`, `src/art/originals.ts`, their tests, the fidelity proof.
3. **Luxury art**: `src/art/luxury.ts` and its tests.
4. **Engine core**: `schema.ts`, `document.ts`, `typography.ts` (new), `brand.ts`, `ink.ts`, `render/SlideView.tsx`, `types.ts` (making the new fields required), the exporter's font line in `apps/api/src/modules/studio/design-exporter.ts`, version 1 fixtures across the repo, and their tests.
5. **Signature layouts**: `src/layouts/signature.ts`, its registration in `layouts/index.ts`, `layouts.test.ts` additions.
6. **Themes**: `src/themes/**` except `scale.ts`, `themes.test.ts` additions.

**Wave 2**
7. **Presets restructure**: `presets.ts` into `presets/`, the facet helpers, the browser spec's preset filter (`PRESET_IDS`).
8. **Template content**: three parallel agents (signature patterns; signature originals and classic with art; luxury), each in its own `presets/*.ts` files.
9. **API**: the BrandKit migration and service, premium access and enforcement, PDF, captions.txt and 2x, duplicate with a format, the format column following the document, designs in global search, the kit name on design list rows.

**Wave 3**
10. **Design and Element tabs**: fonts, art, themes, custom colours, format, premium locks in the panel.
11. **Gallery, wizard, landing and playground**: filters, pagination, premium locks, last kit, kit names on cards.
12. **Editor extras, brand kits, export, search**: zoom, Changed marker, Escape, rail names, tint and Apply To All Slides, the kit dialog and Duplicate, PDF, captions.txt and 2x, the Designs search group.

**Wave 4**
13. **Verification**: `npm run validate`, the opt-in browser specs (overflow and pixel contrast for every preset and format), the e2e Studio spec, a postgear-reviewer pass, a visual walk with screenshots in light and dark and at phone width, then fixes.

## Definition Of Done

- [x] 150 or more presets; the 47 Sprint 9 ids unchanged. **Verified**: 167 presets, and `registry.test.ts` pins the 47 ids, themes and names, which serialise to the same JSON as before.
- [ ] The ten patterns match CarouselClick byte for byte; the originals match their files within the stated pixel tolerance. **Partly met, left for the owner**: the patterns match byte for byte and nine originals score 99.97% or more, but Ladder scores 99.52% and 99.49% against the 99.5% bar; it matches the markup of its own file pixel for pixel, and the gap is the `<img>` resampling in CarouselClick.
- [x] No client name, logo or sample copy anywhere a user can see (a test scans every preset, theme, art name and label for the banned words). **Verified**: `branding.test.ts`.
- [x] 52 fonts load in the editor and in exports; licences and authors are listed in Font Licences and `fonts/LICENSES.md`. **Verified**: `fonts.test.ts` reads every file, a real-Chromium check resolved 82 of 82 weights, and Font Licences lists every family.
- [x] A user can set the heading and body fonts of a design, the font of one element, and a brand kit's fonts; exports use them. **Verified**: the precedence in `typography.test.ts`, and the exporter inlines the faces the design draws with.
- [x] Premium looks are locked for a free workspace in the gallery, the Design tab and the API, and open for a paid one. **Verified live** on 2026-10-28: the API probe on both seeded workspaces, and the gallery and Design tab locks on PostGear Second Org.
- [x] Every preset passes overflow and pixel contrast in every format. **Verified** in real Chromium: overflow 167 of 167, and contrast 165 in the full run plus the two re-paired templates re-checked.
- [x] The CarouselClick features in "What This Batch Takes" work as described. **Verified**: §3 and §4 of the checklist, screenshots 300 to 359.
- [x] `/dev/studio` paginates and filters. **Verified**: §5 of the checklist.
- [x] `npm run validate` passes; the Studio e2e spec passes. **Verified**: validate 39 of 39 tasks and the Studio e2e spec 7 of 7 on 2026-10-28.

## Out Of Scope (next batch)

Icons (a slot kind and a bundled Lucide subset); review and approval (frozen snapshot, decisions, statuses, banner and history); AI (slides from content, rewrite and fit copy, captions per platform, brand voice from a website) under `AI_SIMULATION`; video MP4 and GIF with motion presets; the Portrait 3:4 and Link 1.91:1 formats (a `DesignFormat` enum migration and composer rules); logo variants per ground; a Comparison layout; Recent Designs on Home; per-kit template shortlists and allowed formats; latin-ext font files for the rupee sign.

## Risks

- **Many agents, one package.** File ownership above is strict, and every agent ignores failures in files it does not own while others are mid-edit.
- **Art behind text.** CarouselClick never measured contrast against its art; the pixel check will find spots, and the fix is in the art, not the theme. (Outcome: the fix was in the pairings, see section 14.)
- **Font metrics.** A different font in a theme's sizes can overflow; the fitter shrinks to 62% and then shows Too Long, as today.
- **Thumbnail cost.** Blurred SVG art in a hundred thumbnails; `artSvg` caches strings and the gallery paginates. Measure on the gallery before calling it done.
