# Module 10: Recipes And Brand Kit

> **Sprint 13, Clips AI** | Status: Not started | Size: M (one session)
> **Depends on**: [Module 03](module-03-captions.md), [Module 05](module-05-clip-setup-and-highlights-v2.md)
> **Stories**: CA-6.1, CA-6.2, CA-6.3 (new: Starter Recipes), CA-6.4 (new: Auto-Edit Video)
> **Next**: [Module 11](module-11-montage-and-batch-export.md)

## Goal

After this module a team sets a clip up once and reuses it. A **recipe** saves how a clip is set up (shape, layout, caption style, the cleanup and hook switches, export quality) under a name, for the whole workspace, and can be picked on Clip Setup or applied to an open clip. Five **Starter Recipes** come built in, so a new workspace has something to pick on day one, and **Auto-Edit Video** turns a whole video into one edited clip with a recipe in one press. Five **Starter Recipes** come built in, so a new workspace has something to pick on day one, and **Auto-Edit Video** turns a whole video into one edited clip with a recipe in one press. The **brand kit** that Studio already has gains what video needs: where the logo sits, a default caption style, an intro clip and an outro card.

## Read First

- `CLAUDE.md`, Sprint 12's README, then the README in this folder.
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 2 (the pickers), 8.
- User stories: Journey C; CA-6.x; section 5 (a recipe with a missing part).
- Decisions: D13-17 (starter recipes and Auto-Edit), D13-02 (AI Minutes), D13-16 (ASS and the FFmpeg compiler). Research: [`09-ass-captions-and-edit-cookbook.md`](../research/09-ass-captions-and-edit-cookbook.md) section 8 (a title or card from a `color` source plus ASS, per-segment chains that end in one size, SAR, fps and pixel format).
- Research: [`01-reference-features.md`](../research/01-reference-features.md), OpusClip's recipes and brand kit and what PostGear already has (the `BrandKit` model from Studio).
- Code: `packages/db/prisma/schema.prisma` (`BrandKit`), `apps/api/src/modules/studio/` (brand kit routes and service), `apps/web/src/components/studio/` (the brand kit picker and editor); Module 05's setup schema and form; the engine's edits from Sprint 12 and Modules 03, 04, 08, 09 (each setting below maps to one of them); Sprint 12 Module 15's export qualities; Sprint 12's Edit Whole Video path (a clip over the whole video, `CLIP_MAX_MS` raised to 30 minutes); the render compiler in `packages/video-engine/src/render/`.

## Design

### 1. Recipes In The Engine (`packages/video-engine/src/recipes/`, pure)

- `recipeSchema` (Zod, strict, versioned): every field optional, so a recipe can cover a little or a lot:

```ts
interface RecipeSettings {
  version: 1;
  ratio?: Ratio;
  layout?: { kind: LayoutKind; presetId?: string };          // a built-in layout or a saved ClipLayoutPreset
  follow?: { on: boolean; mode: 'speaker' | 'both' };
  captions?: { on: boolean; styleId: string; position: Point; sizePx: number; maxWords: number };
  silences?: { on: boolean; minMs: number };
  fillers?: { on: boolean };
  bleep?: { on: boolean; mode: 'bleep' | 'mute' };
  hookTitle?: { on: boolean; look: string };
  clipLength?: LengthChoice;
  layoutsAiMayUse?: LayoutKind[];
  exportQuality?: ExportQuality;
}
```

- `recipeFromClip(doc, extras)`: reads a clip's current state into settings (what the user sees is what is saved).
- `applyRecipe(doc, settings, context)`: applies each present field through the existing pure edits, in a fixed order (shape, layout, follow, cleanup, captions, bleep, hook title), and returns the new document plus `needs`: things the caller must fetch first (a transcript for captions or cleanup, faces for follow) and `missing`: parts that no longer exist (a deleted caption style or layout preset), each with what was used instead. It never fails because of a missing part.
- `describeRecipe(settings)`: one plain line for cards ("Vertical, Blurred, Marker captions, silences removed, 1080p").
- `starters.ts`: `STARTER_RECIPES`, five built-in recipes as plain `RecipeSettings` data with stable ids (`starter-clean-up-recording` and so on), each described by `describeRecipe`:

| Starter Recipe | Settings | Needs |
|---|---|---|
| Clean Up Recording | `silences { on, 800 ms }`, `fillers { on }`; no shape, no captions | A transcript |
| Auto-Edit Talking Video | `silences`, `fillers`, `captions { on, clean }`; shape untouched | A transcript |
| Captions Only | `captions { on, bold-pop }`; nothing else touched | A transcript |
| Reframe | `ratio 9:16`, `follow { on, speaker }` | Faces (free) |
| Social Edit | `ratio 9:16`, `follow { on, speaker }`, `captions { on, bold-pop }`, `silences`, `hookTitle { on }` | A transcript and faces |

  A starter recipe is **read-only**: it has no row in the database, cannot be renamed or deleted, and shows a "Built in" badge. **Duplicate** copies it into the workspace as the user's own recipe. A starter whose caption style or layout no longer exists falls back exactly as any recipe does (`missing`). Ids that are not in the table are refused by `recipeSchema` as ids of user recipes.
- Tests: round trip (a clip to a recipe and onto a fresh clip gives the same settings), partial recipes touch only their fields, a missing style falls back to `clean` and is reported, the order is stable; every starter parses, applies to a fresh clip and reads back through `describeRecipe`; Reframe touches nothing but shape and follow.

### 2. Recipes In The API And The UI

- `ClipRecipe` (`prisma-change`). Routes: `GET /clips/recipes` (the five starters first with `builtIn: true`, then the workspace's own), `POST` (`{ name, settings, brandKitId? }`, 50 per workspace), `PATCH /:id` (rename, replace settings; a starter id answers 403), `DELETE /:id` (the same), `POST /clips/recipes/:id/duplicate`; `POST /clips/:clipId/apply-recipe` `{ recipeId }` answers `{ needs, missing }` after checking the recipe belongs to the workspace (the editor applies the settings itself through the engine and autosaves; the route exists so the server can start what `needs` lists and record `recipeId` on the clip).
- The editor's top bar menu: **Save As Recipe** (a small dialog: "Enter your recipe name", and a read-back of what will be saved) and **Apply A Recipe** (a list; applying is one undo step; then any `needs` run with their usual progress, and a toast lists `missing`: "This recipe's caption style was deleted. We used Clean instead.").
- Clip Setup: the **Recipe** picker (Starter Recipes under a "Starter Recipes" group, then "My Recipes") fills the form's controls from the settings; controls the user then changes show a dot; **Save As Recipe** appears under the picker when anything differs. The run stores `recipeId` in its params and makes every clip with the recipe applied.
- `/[orgId]/clips/kit` (reached from a **Recipes And Brand Kit** secondary button in the Clips page's `PageActions`): a framed page with `Tabs`: **Recipes** (a "Starter Recipes" row of five read-only cards with **Duplicate**, then the workspace's cards with the name, `describeRecipe`, who made it, **Rename**, **Delete Recipe** with a red confirm; an `EmptyState` when there are none of the workspace's own) and **Brand Kit** (section 3).

### 2a. Auto-Edit Video (CA-6.4)

One press on a video makes **one clip over the whole video** with a chosen recipe applied (Sprint 12's Edit Whole Video clip, up to 30 minutes), for people who want their recording cleaned, not cut into highlights.

- `POST /clips/videos/:videoId/auto-edit` `{ recipeId, range? }`: the recipe is a starter or the workspace's own (the default is **Auto-Edit Talking Video**). A video up to 30 minutes uses its whole length; a longer one is refused with "Auto-Edit works on up to 30 minutes at a time. Pick the part you want." and the dialog's range handles choose a stretch of at most 30 minutes. The answer is 202 `{ job, clipId, price }` or 200 `{ clipId }` when nothing needs fetching.
- **Steps**, shown in words on the video page: (1) **listen if needed**: when the recipe needs a transcript and the stretch is not covered, Module 02's `ensure` listens and charges AI minutes (`aiMinutesCost('listen', ms)`, key `clips.ai:listen:<jobId>`; a failure reverses it); faces are free; (2) **apply**: the server creates the whole-video clip, the engine's `applyRecipe` runs with the transcript and faces, and the clip is saved with `recipeId` and origin `AUTO_EDIT` (a new `ClipOrigin` value; `prisma-change`); (3) **open in the editor**: the video page shows **Open The Clip**, and the browser opens the editor when the user is still on the page. Everything the recipe did is on the clip as ordinary edits, so it can be undone, trimmed or changed by hand.
- The button: **Auto-Edit Video** in the video page's `PageActions` (and its menu on a video card), opening a small dialog with the recipe picker, `describeRecipe` of the choice, the price ("Auto-Edit Video (12 AI Minutes)", or "No AI minutes needed" when the recipe needs no listening) and the chip "38 of 300 AI minutes left". Too few AI minutes disables the button with the missing number and **See Plans** (the 402 `clips_ai_minutes_used`).
- A video with no speech under a recipe that needs words: the clip is still made, the cleanup and captions parts are skipped, and the note says "We could not hear anyone, so we only applied the shape."
- Tests: the price follows coverage (a covered video costs nothing), a 31 minute video is refused with its sentence, the recipe's `needs` run in order, a failed listen reverses the charge and leaves no clip, the clip opens with the recipe applied in one undo step.

### 3. The Brand Kit For Clips

- `BrandKit` gains four optional fields (`prisma-change`): `clipLogoPosition` (`'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | null`), `clipCaptionStyleId`, `clipIntroAssetId`, `clipOutroAssetId`. Studio's existing brand kit routes accept and return them; Studio's own screens ignore them.
- The **Brand Kit** tab lists the workspace's kits (from Studio). For each: the logo's place for video (a `Segmented` over a small drawing of a tall frame, or Off), the default caption style (`Select`), **Intro** (upload a short video, at most 5 seconds and 50 MB, through Sprint 12's upload path into the library; shown as a small player with Remove), and **Outro** (a choice of a simple card made from the kit's logo and colours with a line of text, "Enter your closing line", or an uploaded video of at most 5 seconds).
- Applying a kit to a clip (`applyBrandKit(doc, kit)` in the engine, one undo step):
  - The logo becomes a sticker item (`art: { source: 'library', assetId }` pointing at a copy of the kit's logo in the clips library, made on first use), `anchor: 'clip'`, for the whole clip, small, at the chosen corner, inside the safe margins.
  - The caption style becomes the captions track's style when the clip has captions.
  - The intro is a first segment from the intro's own video (`sources` gains it), with `role: 'intro'`; the outro a last segment, or for the card a 2 second text-and-logo scene **drawn by the compiler**: a `color=c=<kit colour>:s=<output size>:r=<fps>:d=2` source with the logo overlaid and the closing line written as ASS text by `buildAss` (the same pattern as the montage title card, research 09 section 8), with `anullsrc` for its silent sound. Add `'intro' | 'outro'` to `segments[].role` in the version 2 schema (optional values; no version bump). Captions and bleeps skip intro and outro segments. Because the intro and outro come from other files, `compileFfmpeg` ends every segment chain in the same size, SAR 1, frame rate and pixel format (and audio in 48 kHz stereo) before the `concat`, so a 720p intro in a 1080p clip joins cleanly. Because the intro and outro come from other files, `compileFfmpeg` ends every segment chain in the same size, SAR 1, frame rate and pixel format (and audio in 48 kHz stereo) before the `concat`, so a 720p intro in a 1080p clip joins cleanly.
  - Each part can be switched off per clip in a small **Brand Kit** section at the top of the Layouts tab (kit picker; toggles for Logo, Intro, Outro).
- A recipe may name a brand kit; applying the recipe applies the kit.
- An exported clip with an intro from another video needs that video's sharp file too: the render's prepare step (`buildRenderPlan`'s resolved inputs) already downloads one file per source; make sure library videos are resolved the same way, each as its own input.

### 4. Tests

- Engine: section 1; `applyBrandKit` (each part, each part switched off, captions and bleeps skip the intro and outro, the logo stays inside the margins in every shape).
- API: recipe routes (schema refusal, the limit, tenancy), the brand kit fields through Studio's routes, apply-recipe's `needs` and `missing`.
- Web: Save As Recipe reads back correctly, Apply A Recipe is one undo step and reports missing parts, the setup picker fills and marks changes, the kit page (rename, delete confirm, intro upload limits), the per-clip toggles.
- Compiler, with the real FFmpeg binary: a clip with a logo, an intro and an outro card renders to the plan's exact duration, the card's text appears at its time (a still at `-ss`), and an intro of another size and frame rate joins without a size error.

## Scope

**In**: recipes end to end, the kit page, clip fields on the brand kit, the logo, intro and outro, a kit inside a recipe.
**Out**: sharing recipes between workspaces, a public recipe gallery, animated logo stings made by AI, brand fonts beyond the font set (Module 17).

## Tasks

- [ ] `recipes/`: the schema, `recipeFromClip`, `applyRecipe`, `describeRecipe`, the five starters, with tests.
- [ ] `ClipRecipe` and its routes; `apply-recipe`; the starters in the list and `duplicate`.
- [ ] Auto-Edit Video: the route, the `AUTO_EDIT` origin, the dialog and the video page button, the AI minutes charge and reversal.
- [ ] Save As Recipe and Apply A Recipe in the editor; the setup picker.
- [ ] The kit page with both tabs.
- [ ] Brand kit fields; `applyBrandKit`; intro and outro segments and the outro card in the compiler (`color` source plus ASS text); the per-clip toggles.
- [ ] Compiler checks (single frames with `ffmpeg -ss ... -frames:v 1`); title-case test green.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js recipes render
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips apps/api/src/modules/studio
npx jest --config apps/web/jest.config.js apps/web/src/components/clips
```

## Done When

- A clip's setup saved as a recipe and applied to a fresh clip gives the same shape, layout, captions and switches, in one undo step.
- The five Starter Recipes are listed first, cannot be renamed or deleted, and can be duplicated; each applies to a sample clip as its table row says.
- Auto-Edit Video on a ten minute sample video listens once (priced in AI Minutes), makes one clip over the whole video with the chosen recipe applied, and opens it in the editor; running it again on the same video listens to nothing and charges nothing.
- Another member of the workspace sees and can apply the recipe.
- Picking a recipe on Clip Setup makes every clip of the run come out with it applied.
- A recipe whose caption style was deleted still applies, with a notice naming what was used instead.
- A brand kit adds the logo in its corner, the caption style, the intro and the outro, each switchable per clip, and the export shows them (Preview Export shows them exactly).
- Studio's brand kit screens work exactly as before.

## Hand Check

With the three simulation flags on and the demo admin:

1. Set a clip to Vertical, Blurred, Marker captions, silences removed. Menu, Save As Recipe: "Client A Shorts".
2. Open another clip, Apply A Recipe: it changes in one step; Ctrl+Z undoes it.
3. Clips page, Recipes And Brand Kit: the recipe's card reads its settings back. Rename it.
4. Brand Kit tab: set the logo to the top right, pick a caption style, upload a 3 second intro, write an outro line.
5. In a clip, Layouts, pick the kit: the logo, intro and outro appear. Switch Intro off.
6. Clip Setup: pick the recipe, change one control (a dot appears), run: the clips come out styled.
7. Delete the caption style the recipe uses, apply the recipe again: the notice.
8. Recipes And Brand Kit, Recipes: five Starter Recipes are on top with a Built In badge; try to rename one (not possible); Duplicate one.
9. On a video page press Auto-Edit Video: pick Auto-Edit Talking Video, read the price, run. The steps read "Listening to what is said", "Applying your recipe", then **Open The Clip**: the clip is the whole video, cleaned and captioned. Run it again: no price.

## Handoff

Module 11's Export All uses a recipe's export quality when one is set. Module 15 counts recipe use. Module 17 holds sharing recipes.
