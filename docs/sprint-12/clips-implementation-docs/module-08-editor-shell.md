# Module 08: Editor Shell

> **Sprint 12, Clips** | Status: Not started | Size: L (one full session)
> **Depends on**: [Module 05](module-05-thin-slice-render.md), [Module 07](module-07-manual-clipping-and-clips-library.md)
> **Stories**: CL-5.1, CL-5.2, CL-5.4
> **Next**: [Module 09](module-09-timeline.md) (Timeline)

## Goal

After this module a clip opens in a full-window editor with its own top bar, the tab rail, an empty panel for each tab, the clip playing in the middle with transport controls, and a read-only timeline dock. The picture is drawn by a new browser `PreviewEngine` that plays the light copy segment by segment and draws the layout from `frameState`, the same function the export compiler is tested against. The document is held in one store with undo and redo, saved by itself with the revision lock, protected by a leave guard, and the first open asks Vertical, Horizontal or Square. Editing tools arrive in the modules after.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 1, 6, 10 (the shape dialog), 11, 13, 15.
- User stories: CL-5.1, CL-5.2, CL-5.4; Journey D (two people, offline).
- Sprint doc: The Clip Document; API Routes (`GET` and `PATCH /clips/:clipId`).
- Research: [`05-editor-and-render.md`](../research/05-editor-and-render.md), section 2 (the preview: what the browser gives, `PreviewEngine`, segment hand-over, the clock), section 3 (what the preview cannot match) and section 10 (the two time bases); [`09-ffmpeg-render-cookbook.md`](../research/09-ffmpeg-render-cookbook.md), section 12 (`frameState` and the parity rules); [`03-open-source-reference-repos.md`](../research/03-open-source-reference-repos.md), the lessons on playhead sync (an external store read with `useSyncExternalStore`, seeking and dragging flags) and undo (one snapshot per finished gesture, selection outside history).
- Code: `apps/web/src/components/navigation/dashboard-shell.tsx` (`immersion()`); `apps/web/src/components/studio/studio-editor.tsx`, `editor-top-bar.tsx`, `editor-state.ts` (`ApplyChange`, the coalesce key), `editor-autosave.ts`, `use-autosave.ts`, `studio-editor-model.ts`; `apps/web/src/lib/leave-guard.ts`; `packages/design-engine/src/history.ts`; `apps/web/src/components/workflows/builder/tool-rail.tsx` (the `Tool` button), `apps/web/src/components/workflows/panel/resize-handle.tsx`, `shortcuts-sheet.tsx`; `apps/web/src/components/studio/panel-ui.tsx`; Module 05's `frameState` and `/dev/clips`; `docs/design-patterns/design-system-rules.md` section 16h.

## Design

### 1. The Full-Window Route

- `immersion()` in `DashboardShell`: add `clips/edit/<id>` as `'fixed'`. Today the function only allows one level under the segment, so extend the rule for this one path and keep Studio's and Workflows' behaviour exactly; cover it with the function's tests.
- `/[orgId]/clips/edit/[clipId]/page.tsx`: the server loads `GET /clips/:clipId` (`notFound()` on 404) and renders `<ClipEditor>` inside `ClipsDesktopOnly`. Studio's `layout.tsx` trick is reused: a `clips/edit/layout.tsx` renders `<StudioFonts />` once so the 52 families are registered for text (Module 11).
- Add Clips to `design-system-rules.md` section 16h as the third desktop-only, full-window module, and to the "desktop only" bullet in `CLAUDE.md`.

### 2. The Store (`components/clips/editor/editor-state.ts`)

Copied in shape from Studio's reducer, not shared with it:

- State: `{ doc, history, selection, tab, revision, saveState }`. Everything in the document goes through `apply(change: (doc) => doc, options?: { coalesceKey?, select? })`; a change that returns an invalid document (the engine's schema) is dropped and logged, never saved.
- History: move `history.ts` to a place both editors can import, or copy it into `video-engine` (say which in the Decision Log). `HISTORY_LIMIT = 80`; drags and sliders coalesce by key into one step; selection and the open tab are not in history.
- Selection: `{ kind: 'segment' | 'item' | 'zoom' | 'area', id } | null`. One thing at a time in Sprint 12.
- Derived values through selectors: `outputDuration(doc)`, the selected thing, and `frameState(doc, outputMs)` for the picture.

### 3. The Preview Engine (`packages/video-preview`, web only)

A new package, replacing the old composition package. It exports one class, `PreviewEngine`, and a React hook. It has no knowledge of FFmpeg, and the web app imports it as source like the other workspace packages (add it to `transpilePackages`). Research 05 section 2 is the design; this is the build list.

- **One clock.** The playhead is output time. While playing, the clock comes from the front `<video>` through `requestVideoFrameCallback`: the engine maps `metadata.mediaTime` (the proxy's source time) back to output time through the time map. A small external store holds it. If `requestVideoFrameCallback` is missing (Firefox before 132), the engine falls back to `requestAnimationFrame` plus `currentTime`, coarser but correct.
- **Two `<video>` elements, one signed address.** While segment *n* plays on the front element, the back element seeks to segment *n+1*'s start and waits for `seeked`. At the join (output time reached, from the frame callback) the elements swap, the new front starts at its `playbackRate`, and the old one pauses. Segments that are contiguous in the source (a split with nothing removed) are not swapped: the same element keeps playing. If the next segment is not ready at the join the engine holds the last frame and reports `buffering` instead of drifting.
- **Speed.** `playbackRate` is the segment's speed, `preservesPitch` stays `true`. Browsers may mute sound outside 0.25 to 4 (Gecko does); the export does not. This is a listed preview difference (research 05 section 3).
- **Drawing the picture from `frameState`.** The stage asks `frameState(doc, outputMs)` for each area's frame and crop and draws them: each area is a `<canvas>` sized to its frame, filled with `drawImage(video, crop...)` from the front `<video>` in the frame callback and again on `seeked`, so one decode serves up to four areas and the crop is exact at source resolution. Zoom is one CSS `transform: scale()` about a `transform-origin` at the focus point on a wrapper around all areas, and looks are one CSS `filter` on the same wrapper (Module 13 fills both in). The default is the canvas path; a half-day spike at the start of this module confirms its cost on a 720p proxy with four areas, and if it drops frames the fallback is one `<video>` pair per area. Record the result in the Decision Log. Only the Fullscreen layout is drawn in this module; the engine's code path is the general one so Module 10 adds presets as data.
- **Overlay layers.** An empty `OverlayLayer` and an `AudioLayer` slot exist and are driven by the same `frameState`, so Modules 11, 12 and 14 only fill them: text and stickers as DOM or canvas above the picture, sounds through Web Audio (`AudioBufferSourceNode.start(when)` with `GainNode` ramps, re-started on every seek and hand-over to cancel drift between the `<video>` clock and the audio clock).
- **Scrubbing mode.** While something is dragged on the timeline the engine is in `scrubbing`: seeks are throttled to one per animation frame, the sound is muted, and the canvas redraws on `seeked`.
- **Remote video needs CORS and Range.** The proxy comes from the private bucket through a signed URL. The bucket's CORS rule for the web origin is Module 02's (`GET` and `HEAD`, `Range` allowed). The URL must outlive the session or be refreshed by swapping `src` at a segment boundary. A `blob:` URL has no Range support, so an uploaded file is proxied before it is opened.
- **Browsers.** Chrome, Edge and Firefox are the target (decision D12-12); Safari is best effort and untested.
- The engine is tested with fake `<video>` elements (jsdom has no media): events, hand-over order, the clock mapping, the buffering report, the scrubbing throttle. Its drawing is checked by hand and by Playwright.

### 4. Playback (`components/clips/editor/playback.ts`)

- `PlaybackStore` wraps the engine: it listens to the engine's `play`, `pause`, `seeked` and clock events and exposes `useCurrentMs()` and `usePlaying()` through `useSyncExternalStore`, plus `play`, `pause`, `toggle`, `seekMs(ms)`, `stepFrames(n)`. Components that only need the time (the playhead, the time text) read it here and do not re-render the editor.
- When the document's length shrinks below the playhead, the playhead moves to the new end.
- Transport bar under the stage: back one frame, play or pause, forward one frame (ghost buttons with tooltips and shortcuts), the time with tenths ("0:12.4 / 0:42.0").

### 5. The Frame (`components/clips/editor/clip-editor.tsx`)

Per blueprint section 6:

- `EditorTopBar`: the back button (to the video page, at the clip's place: `/clips/video/<videoId>?clip=<clipId>`), the name as a rename-in-place field, the `SaveIndicator`, Undo and Redo with `Kbd` hints, the shortcuts button (opens the sheet, filled in Module 09), and **Export** (primary), which selects the Export tab.
- `TabRail`: six `Tool`-style ghost buttons (animated icon over label): **Layouts**, **Elements**, **Text**, **Effects**, **Audio**, **Export**. The open one is `aria-pressed`.
- `EditorPanel` (`w-80`, `bg-chrome`): each tab renders a placeholder `EmptyState` ("Arrives in a later step of this sprint.") except Export, which shows the Module 05 export button for now. **Back** and **Next** at the foot walk the tabs.
- `Stage`: the preview engine's picture scaled to fit, centred, with a thin border; a `ResizeObserver` keeps the scale; the scale is exposed (`useStageScale()`) because Module 11's handles must divide pointer movement by it.
- `TimelineDock`: `ResizeHandle` on the top edge (height kept in `localStorage`), then a read-only view built from Module 07's pieces: the ruler, one Video row with a bar per segment (filmstrip inside), the playhead following playback, click and drag on the ruler to seek, the zoom buttons. No editing yet.
- When the sharp video is still coming (`sharp: 'fetching'`) nothing blocks: the editor works on the proxy. When it is `gone`, an `Alert variant="warning"` under the top bar says "The sharp video is no longer online. This clip will export at 720p from the copy we kept."

### 6. Saving

- `ClipAutosave`: the same class shape as Studio's `Autosave`: 1.5 seconds after the last change, `PATCH /clips/:clipId` with `revision` and the whole document; states `pending`, `saving`, `saved`, `retrying`, `offline`, `conflict`, `failed`; back-off retries; a `keepalive` save on `pagehide` when the document fits, and a `beforeunload` prompt otherwise.
- Conflict (409 `clip_changed_elsewhere`): saving stops, and an `Alert variant="warning"` says "Someone else changed this clip. Reload to see their version." with **Reload**. Nothing is overwritten.
- The leave guard: `registerLeaveGuard` and the capturing click handler from Studio, so the back button and links ask before leaving with unsaved changes.
- Undo and Redo: Ctrl+Z and Ctrl+Shift+Z (and Ctrl+Y) through a `shortcutOf`-style function that ignores keys while typing and inside dialogs.

### 7. The Shape Dialog

On the first open of a clip (`document.canvas` still at its created default and no edit yet; keep a flag in the document's `meta`, added to the schema as an optional strict object), a `Dialog` without the corner close asks "What Do You Want To Make?" with `ChoiceTiles`: **Vertical**, **Horizontal** and **Square**, each with a small drawing and its line, and **Continue**. Choosing sets `canvas` from `CANVASES` and re-fits the Fullscreen layout (`fitRect`). This is one undo step. The shape can be changed later in Layouts (Module 10), where 4:5 joins the list.

### 8. Tests

- `immersion()`: the new path, and Studio and Workflows unchanged.
- The reducer: apply, invalid change dropped, coalescing, undo and redo, selection not in history.
- `PreviewEngine` with fake video elements, and `PlaybackStore` on top of it: events update the stores, the hand-over swaps the elements in order, scrubbing throttles, the clamp when the length shrinks, the `requestVideoFrameCallback` fallback.
- `ClipAutosave`: debounce, retry, offline, conflict stops saving.
- The shape dialog: each choice sets the canvas and is one undo step.
- The frame: tabs switch, Back and Next walk, Export selects its tab, the conflict and gone alerts render.

## Scope

**In**: the full-window route, the store with history, `packages/video-preview` with `PreviewEngine`, playback sync, the frame with the top bar, rail, panel, stage, transport and a read-only dock, autosave with the lock, the leave guard, undo and redo keys, the shape dialog.
**Out**: timeline editing and the shortcuts sheet's content (09), every panel's tools (10 to 14), export options (15).

## Tasks

- [ ] `immersion()` for `clips/edit/<id>`; the route and its fonts layout; the rules docs updated.
- [ ] The reducer, history, selection, selectors.
- [ ] `packages/video-preview`: scaffold, `PreviewEngine` (clock, hand-over, speed, area canvases from `frameState`, scrubbing mode, empty overlay and audio slots), the canvas spike and its Decision Log row.
- [ ] `PlaybackStore` and the transport bar.
- [ ] `ClipEditor`: top bar, tab rail, panel with placeholders, stage with its scale, the read-only dock with `ResizeHandle`.
- [ ] `ClipAutosave`, the conflict and gone alerts, the leave guard, undo and redo keys.
- [ ] The shape dialog and the optional `meta` in the schema.
- [ ] `/dev/clips` switched to `PreviewEngine` as a check.
- [ ] Title-case test green.
- [ ] Playwright once under simulation: open a clip, pick Vertical, rename it, undo, reload and see it kept. Screenshots in `screenshots/` (light, dark, Lilac, 1366 and 1920).
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/editor apps/web/src/components/navigation
npx jest --config packages/video-preview/jest.config.js
npx jest --config packages/video-engine/jest.config.js
npx jest --config apps/web/jest.config.js apps/web/src/lib/title-case
```

## Done When

- Edit on a clip opens the whole window with no rail and no top bar; the back button returns to the video page.
- The first open asks for the shape; the choice shows at once and can be undone.
- The clip plays; the time text and the playhead follow without the rest of the editor re-rendering (check with the React profiler once).
- A clip of two parts with a gap in the source plays through the join without a frozen frame longer than a moment, and the time text stays in step with the picture.
- A rename is saved within about two seconds and survives a reload; going offline shows "Offline, will retry" and saves when back.
- Two tabs on the same clip: the second to save gets the conflict alert and does not overwrite.
- Leaving with an unsaved change asks first.
- Studio and Workflows still go full window exactly as before.
- No file in `apps/web` or any package imports a browser-based render library; the only video code is `packages/video-preview`.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin:

1. Clips tab, Edit on a draft. The dialog asks; pick Vertical. The clip is tall.
2. Play, pause, step a frame each way. The time and the playhead agree.
3. Rename the clip in the top bar: "Saving", then "Saved". Reload: the name is kept.
4. Ctrl+Z brings the old name back; Ctrl+Shift+Z redoes it.
5. Open the same clip in a second tab, rename it there, then rename it in the first: the first shows the conflict alert.
6. Switch the network off in the browser tools and rename: "Offline, will retry"; switch it on: "Saved".
7. Drag the dock's top edge: it resizes and remembers the height.
8. Open a Studio design and a workflow: both still take the whole window.

## Handoff

Module 09 turns the dock into an editing timeline using `apply`, `selection` and `PlaybackStore`. Module 10 adds layout presets that `frameState` and the engine already draw. Modules 11, 12 and 14 fill the overlay and audio slots; Module 13 fills the zoom wrapper and the look filter. Module 11 needs `useStageScale()`. Module 15 replaces the Export tab's body and plays Preview Export files in a dialog.
