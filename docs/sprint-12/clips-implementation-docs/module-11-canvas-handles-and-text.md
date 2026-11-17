# Module 11: Canvas Handles And Text

> **Sprint 12, Clips** | Status: Not started | Size: L (one full session)
> **Depends on**: [Module 09](module-09-timeline.md)
> **Stories**: CL-7.1
> **Next**: [Module 12](module-12-stickers-and-gifs.md) (Stickers And GIFs)

## Goal

After this module things can be placed on the clip. A user adds text, types on the clip, picks a font from the Studio families, sets size, colour, outline or a box, moves, resizes and turns it with handles that snap, and sets when it shows on the timeline. The handle layer and the colour picker built here are what stickers (Module 12) reuse. The export draws the text through one ASS subtitle file burned in by FFmpeg's `ass` filter (libass with HarfBuzz shaping), the same text pipeline Sprint 13 will use for captions; the editor draws the same text with the DOM from the same numbers, and Preview Export shows the exact result.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 8 (Text), 9 (handles), 13, 15 (the new pieces).
- User stories: CL-7.1; Journey A step 8, Journey B step 4.
- Sprint doc: The Clip Document (`tracks`, `TextItem`, `transform`, `anchor`).
- Research: [`09-ffmpeg-render-cookbook.md`](../research/09-ffmpeg-render-cookbook.md), section 6 (text through ASS: everything below marked verified was run on FFmpeg 9.0.2) and section 12 (parity rules); [`05-editor-and-render.md`](../research/05-editor-and-render.md), sections 3 and 6 (what the preview cannot match, the text pipeline); [`02-libraries.md`](../research/02-libraries.md), the `react-moveable` row (stale since 2023, so a spike decides) and the font rows; [`03-open-source-reference-repos.md`](../research/03-open-source-reference-repos.md), the lessons on canvas handles (divide pointer movement by the stage scale, 8 px guides, turning snaps within 5 degrees; every editor read wrote its own handles).
- Code: Module 08's `Stage`, `PreviewEngine` and `useStageScale`; Module 09's rows, `TimelineBar`, the gesture reducers and `TimeField`; Module 05's `render/fonts.ts` (the manifest shape, `checkFonts`), `buildAss` stub and the `clips:fonts:build` stub; `packages/design-engine/src/fonts/index.ts` (`FONTS`, `fontStack`, `faceWeight`, `filesFor`) and `packages/design-engine/fonts/`; `apps/web/src/components/studio/font-select.tsx`, `studio-fonts.tsx`, `color-field.tsx`, `panel-ui.tsx` (`SwatchPicker`, `CustomColorField`, `PercentSlider`).

## Design

### 1. Items In The Engine (pure)

- `document/items.ts`: `TextItem` is `{ id, kind: 'text', start, duration, anchor, transform, text, widthPx, style }` with `style: { fontId, sizePx, weight, color, align: 'left' | 'center' | 'right', letterCase: 'as-typed' | 'upper', backing: { kind: 'none' } | { kind: 'outline', color, widthPx } | { kind: 'box', color, padPx }, shadow: boolean, fadeInMs, fadeOutMs }`. Sizes are in canvas pixels (the document's 1080-wide canvas), so they mean the same at every export quality; `sizePx` is a CSS-style em size, and the compiler converts it (section 3).
- **Outline and box are one choice** (`backing`). An ASS box is the outline drawn as a filled rectangle (`BorderStyle 3`, the box colour is the outline colour, square corners), so one text cannot have both. The panel offers **None**, **Outline** and **Box**. Box corners are square in this sprint (rounded boxes are a Module 21 item). The text has no line-height setting: libass uses the font's own line height.
- `transform` is `{ x, y, scale, rotation, opacity }` with `x` and `y` as the item's centre in 0 to 1 of the canvas, `rotation` in degrees, **clockwise-positive** (as CSS `rotate()` and FFmpeg's `rotate`), and `scale` multiplying `sizePx`, `widthPx` and the backing sizes. `widthPx` is the text box's width on the canvas; the text wraps inside it.
- **No emoji in text.** libass draws colour emoji as plain one-colour outlines (cookbook section 6), so the schema refuses emoji codepoints in `text`. Typing or pasting one removes it and the panel shows "Emoji are stickers. Add one from Elements." Colour emoji are image overlays (Module 12).
- Edits: `addItem(doc, item)` (to the first overlay track with room at that time, else a new overlay track), `updateItem`, `removeItem`, `duplicateItem` (offset a little and placed after the original), `moveItemInTime`, `resizeItemInTime` (the Module 09 reducers call these), `setItemAnchor`.
- `TEXT_STYLES`: three ready styles as data: **Bold Outline** (heavy weight, white with a dark outline of modest width), **On A Box** (dark text on a light box), **Plain** (white with a shadow). They are our own designs; none copies a reference product's caption art.
- `defaultTextItem(doc, atMs)`: centred in the upper third, 3 seconds, `anchor: 'moment'`, style Bold Outline.
- Tests: limits (`MAX_ITEMS`, `TEXT_MAX`), track placement on overlap, the anchor rule through a trim (from Module 01's `replaceItems`), emoji refused.

### 2. Fonts For The Export (the manifest and the TTF twins)

- **libass cannot read WOFF2**: "Error opening memory font" for the Studio files (cookbook section 6). `npm run clips:fonts:build` (stubbed in Module 05, built here) writes a TTF or OTF twin for every Studio font into `CLIPS_FONTS_DIR` (default `.cache/clips-fonts`, ignored by git; Module 20's worker image runs the same step), adds the Noto Sans Tamil and Noto Sans Devanagari files, and writes the **manifest** `packages/video-engine/src/render/fonts.manifest.json` (small, committed, so the web app and the tests need no font files). Each entry: `{ fontId, weight, family, assName, file, bold, unitsPerEm, winAscent, winDescent }`, the last three read from the font file's own tables. The conversion tool and how a variable font (such as the Bodoni Moda file) becomes static weights are settled in a half-day spike at the start of this module (not verified; record the choice in the Decision Log). The twins are format conversions of the fonts the repo already ships, so the licences are the same; check the Reserved Font Name entries against the font licences dialog before committing the manifest.
- **Font size**: ASS `Fontsize` is the line height, not the em size. `fs = cssPx x (winAscent + winDescent) / unitsPerEm`, per font. Arial at `\fs100` gave a 64 px cap height and Segoe UI 53 px; the formula predicted 64.1 and 52.6 (cookbook section 6). The compiler applies it once, in the plan.
- **A missing font falls back silently.** Two checks, both fail the render with `font_missing` and write no file: before rendering, `checkFonts(plan, manifest)` and a look at the folder the job copied into scratch (`fonts/`, only the families the document uses plus the Tamil and Devanagari fonts); after FFmpeg starts, the executor reads the `fontselect:` lines libass logs (the text-bearing render runs at a log level that prints them) and compares each chosen file with the manifest's `file`. A line that names another file means the family fell back.
- **Shaping**: HarfBuzz stays on. Never set `shaping=simple` (it broke the Hindi conjuncts; Tamil `தமிழ்` and Hindi `हिन्दी`, `क्षत्रिय` came out joined with Nirmala UI). The Tamil and Devanagari fonts are the fallback for glyphs the chosen font lacks. A Linux run in the real worker image is Module 20's check (not verified here).

### 3. Text Through ASS (`render/ass.ts`, pure, `buildAss`)

One file per render (`captions.ass`; the name is kept for Sprint 13), burned in by one `ass=captions.ass:fontsdir=fonts` filter placed last in the picture chain, after stickers and looks and before the fade and the mark (Modules 12, 13, 15). The recipe is cookbook section 6; the rules:

- `PlayResX` and `PlayResY` equal the document canvas (1080 wide), `WrapStyle: 0`, `ScaledBorderAndShadow: yes`. Every number in the file is a canvas pixel; a 720p export uses the same file and libass scales it.
- One `Style` per distinct look, one `Dialogue` per item: `{\an5\pos(PX,PY)\org(PX,PY)\frz-ROT\fad(IN,OUT)}text`. Colours are `&HAABBGGRR` (blue, green, red; alpha 00 is opaque). Opacity is `\alpha&H<hex of round((1 - opacity) x 255)>&`. A line break is `\N`; `\`, `{` and `}` in the text are escaped.
- **Rotation**: `\frz` turns counter-clockwise, so the clockwise `rotation` is written `\frz-ROT`. `\org` at the anchor makes a left- or right-aligned text turn about the item's centre (the `\org` use is not verified in the cookbook; a parity case here checks it).
- **The box width is the event's margins.** `MarginL = boxX`, `MarginR = CW - boxX - boxW`, with `boxW = widthPx x scale`, and `\pos` at the anchor inside the box (`\an4`, `\an5` or `\an6` for left, centre or right, all vertically centred). libass wraps inside those margins even with `\pos`, and `WrapStyle: 0` balances the lines (verified: 556 px of text inside a 680 px box). `\q2` would turn wrapping off and is never used.
- **Backing**: Outline is `BorderStyle 1` with the outline colour and width; Box is `BorderStyle 3`, the box colour in `OutlineColour`, and `Outline` is the padding (24 gave a 24 px margin); Shadow is the style's `Shadow`.
- **Time**: absolute start and end are rounded to centiseconds, never durations, so two items never drift apart; the window is the item's output start and end.
- **Cost**: libass draws an image per glyph and layer, so a large outline and shadow is the slowest item in the graph (about 15 s more per 8 s of video for a four-line paragraph with a 6 px outline and shadow, against about zero without). The ready styles use a modest outline. `clips:benchmark` gains a text-heavy clip here, and the number goes in the Progress notes.
- **Tests**: `buildAss` snapshots (escaping, the `fs` conversion, margins from the box, `\frz-ROT`, alpha hex, centisecond rounding, one style per look); `font_missing` on a family the manifest lacks; parity cases (added to `render-parity.test.ts`, skipped without `ffmpeg`): text on a plain colour source, the ink's bounding box against `frameState`'s box within a few pixels, the centre within 3 px, a clockwise rotation moving the right end of a bar down, a Hindi and a Tamil string leaving ink.

### 4. The Preview

`PreviewEngine`'s overlay layer draws a text item as a DOM node from `frameState` (centre, size, rotation, opacity, the item's style), above the picture:

- The same family as the export (the web app has the Studio WOFF2 files; `StudioFonts` registers them and the layer waits for the used families with `document.fonts.load` before it shows or measures anything). The box has the item's width; `line-height` is `(winAscent + winDescent) / unitsPerEm` in em, so lines are spaced as libass spaces them; `dir="auto"`.
- Outline: `-webkit-text-stroke` is centred on the glyph edge and ASS grows outward, so the preview strokes with twice the width and `paint-order: stroke fill`. Box: a background with padding equal to the ASS `Outline`. Shadow: a `text-shadow` with the same offset. Rotation: CSS `rotate()` about the centre.
- The known differences (research 05 section 3): line breaks can fall on a different word because CSS and libass wrap by different rules, outline geometry differs by a pixel or two, and a long text may take another line count. They are why **Preview Export** exists. The text panel does not claim otherwise.
- `textBoxMetrics(style, manifest)` (pure, exported) gives line height from the manifest numbers; the handle box's height is measured from the DOM node, and Sprint 13's caption pager reads the same metrics and the same box-width rule.

### 5. The Handle Layer (`components/clips/editor/transform-layer.tsx`)

Start with a half-day spike recorded in the Decision Log: `react-moveable` (MIT, feature-complete, but with no release since 2023) against our own handles. The default, and what the open-source editors did, is our own: it is a small amount of pointer maths and keeps a stale dependency out. Whichever wins must give exactly this behaviour:

- An overlay sits over the stage, in screen pixels, not inside the picture. For the selected item it draws `TransformBox`: a 2 px primary border, eight square handles, and a round turning handle above. Items are hit-tested from the document's geometry (topmost first), so clicking the clip selects the item under the pointer and clicking empty space clears the selection.
- Move by the body; corner handles scale keeping the shape; side handles change a text's box width (`widthPx`; stickers have corners only); the round handle turns, snapping at 0, 90, 180 and 270 within 5 degrees. Every pointer delta is divided by `useStageScale()`.
- Guides and snapping (within 6 px on screen): the canvas centre lines and edges, and other items' centres and edges. Guide lines show while snapped. **Alt** turns snapping off for the drag.
- Keys on a selected item: arrows nudge by 1 px (Shift: 10 px), Delete removes, Ctrl+D duplicates, Escape clears.
- An item can never be dragged fully off the clip: at least a quarter stays inside.
- Each drag is one undo step (a coalesce key per item and gesture). Only items that are on screen at the playhead's time can be selected on the stage; any item can be selected from its bar.
- `TransformBox` is a design-system piece in `packages/ui`, shown on `/dev/components`.

### 6. Typing On The Clip

Double-click a text (or press Enter on a selected one) to edit in place: a `contentEditable` box positioned and styled like the text itself, sized by the same transform. While typing, editor shortcuts are off (the `shortcutOf` rule already ignores typing); Escape or a click outside ends editing; an empty text is removed. The panel's `Textarea` edits the same value.

### 7. The Text Tab (`components/clips/panels/text-panel.tsx`)

- **Add Text** (primary): adds `defaultTextItem` at the playhead, selects it and starts in-place editing.
- The three ready styles as tiles; clicking one with a text selected restyles it, with none selected adds a text in that style.
- For the selected text, in `PanelSection`s: the words (`Textarea`, "Enter your text"), **Font** (`FontSelect`), **Size** (`Slider`), **Colour**, **Backing** (`Segmented`: **None**, **Outline**, **Box**, with its colour and width or padding), **Shadow** (`Toggle`), alignment and letter case (`Segmented`), **Fade** (`Segmented`: **None**, **Short**, **Long**, for 0, 200 and 500 ms in and out), **Opacity** (`PercentSlider`).
- **When It Shows**: two `TimeField`s ("From", "For"), and a `Segmented`: **On This Moment** or **Whole Clip**. Whole Clip sets `anchor: 'clip'`, start 0 and the clip's full length, and keeps it stretched when the clip's length changes.
- The Overlay row on the timeline now shows text bars (the first words as the label); dragging and resizing use Module 09's reducers.

### 8. The Colour Picker (`packages/ui`, shown on `/dev/components` first)

`ColorPicker`: a `Popover` (no shadow on the trigger, which is a swatch with the hex beside it) holding a grid of theme and recent swatches, a hue strip and a shade square, a hex field, and an opacity slider when `alpha` is allowed. Keyboard: arrows move in the square and strip. It emits on drag with a coalesce-friendly `onChange` and a final `onCommit`. Used here for text; Studio's `ColorField` can move to it later (not in this sprint).

### 9. Tests

- Engine: item edits, limits, track placement, styles, emoji refused.
- Compiler: the `buildAss` and font tests of section 3.
- Web: the handle maths as pure functions (move, scale about the opposite corner, turn with snapping, scale division), snapping guides, key nudges, the quarter-inside rule, one undo step per drag; in-place editing (enter, type, escape, empty removes); the Text panel (each control changes the document; Whole Clip sets the anchor and stretches); `ColorPicker` (hex parsing, keyboard, commit); the preview text node's style from `frameState`.
- A still-frame check: `clips:stills` with a text in each ready style, three fonts and one Tamil line, set beside the editor by eye.

## Scope

**In**: item types and edits, the font manifest and TTF twins, `buildAss` for text, the preview's text layer, the handle layer and `TransformBox`, in-place typing, the Text tab, `ColorPicker`, text bars on the timeline.
**Out**: stickers and GIFs (12), text animation presets, rounded boxes, curved or gradient text, colour emoji in text, captions (Sprint 13), multi-select and alignment tools (Module 21).

## Tasks

- [ ] `document/items.ts`, edits, `TEXT_STYLES`, `defaultTextItem`, emoji refusal, with tests.
- [ ] The font spike and its Decision Log row; `clips:fonts:build` (twins, Tamil and Devanagari, the manifest with `assName`, `bold` and the three metrics); the committed manifest.
- [ ] `render/ass.ts` (`buildAss`), the `fs` conversion, the box margins, `\org` and `\frz-ROT`, `font_missing` (pre-check and the `fontselect:` reading in the executor), the text parity cases, the text-heavy benchmark case.
- [ ] The preview's text layer and `textBoxMetrics`.
- [ ] The handle spike and its Decision Log row; `transform-layer.tsx`, `TransformBox`, hit-testing, snapping, keys.
- [ ] In-place typing.
- [ ] The Text panel with every control and When It Shows.
- [ ] `ColorPicker` with a playground demo.
- [ ] Text bars on the Overlay row.
- [ ] `clips:stills` for text; title-case test green.
- [ ] Playwright once under simulation: add a text, restyle, move, turn, time it, export. Screenshots in `screenshots/`.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js document render
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/editor apps/web/src/components/clips/panels
npx jest --config packages/ui/jest.config.js color-picker transform-box
npx jest --config apps/web/jest.config.js apps/web/src/lib/title-case
npm run clips:fonts:build
npm run clips:stills
```

## Done When

- Add Text puts an editable text on the clip at the playhead; typing shows at once.
- Font, size, colour, backing (outline or box), shadow, alignment, case, fade and opacity all change the text in the editor and in the export.
- The text moves, resizes and turns with handles; it snaps to the centre with a guide; arrows nudge it.
- Its bar on the timeline moves and resizes; Whole Clip stretches it and it stays stretched after a trim.
- A text set On This Moment stays on that moment after the clip is trimmed.
- In Preview Export (or the stills script before Module 15) the text is in the same place, size and font as in the editor at three checked frames, within a few pixels; a long text may break its lines on a different word, and that is the documented difference.
- A Tamil line and a Hindi line come out joined in the export.
- A render with a font the manifest lacks, or one that falls back, fails with `font_missing` and writes no file.
- Emoji cannot be typed into a text; the hint points to Elements.
- The font manifest is committed, `clips:fonts:build` produces a twin for every manifest entry, and no WOFF2 file is ever handed to `ass`.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin, in a Vertical clip:

1. Text, Add Text: type "HE REALLY DID THAT". Pick another font; make it bigger; change the colour with the picker; choose Outline.
2. Drag it to the top: it snaps to the centre line. Turn it a little; turn it back until it snaps straight.
3. On the timeline, drag its bar to start at 2 seconds and last 4. Set Fade to Short.
4. Add a second text, set it to Whole Clip in the On A Box style, put it in a corner. Type a Tamil word into a third text.
5. Try to type an emoji: it is removed and the hint appears.
6. Trim the start of the clip by 3 seconds: the first text is still on its moment, the second still covers the whole clip.
7. Export at 720p and compare with the editor at three moments.

## Handoff

Module 12 adds `StickerItem` drawing and reuses the handle layer, `addItem` and the Overlay row unchanged; its Follow Badge uses `buildAss` for the label. Module 13 uses `TimeField` and the picker's patterns, and its fade goes after the `ass` filter. Module 15 adds the mark after the text. Sprint 13's captions are written into the same ASS file by `buildAss`, use the manifest metrics for their pager, and get their own layer above this one.
