/**
 * `@postgear/video-engine`: what a clip is, and how it becomes an FFmpeg
 * command.
 *
 * Pure TypeScript: no Node built-ins, no Temporal, no Prisma and no other
 * `@postgear/*` package (a test enforces it), so the browser preview, the
 * API, the worker and workflow code all import the identical rules.
 *
 * - `captions/`: Sprint 13: caption styles, mapping words onto the clip, paging,
 *   the SRT and VTT reader.
 * - `cleanup/`: Sprint 13: cutting a clip by its words, pauses and filler words;
 *   Bleep Bad Words (Module 09).
 * - `highlights/`: Sprint 13: Clip Setup and the transcript moment picker's pure parts.
 * - `document/`: the clip document schema, its upgrade chain and the creator.
 * - `effects/`: the looks and the vignette, as numbers both drawings read; the
 *   hook clip and the hook title (Module 09).
 * - `time/`: the time map between the video's clock and the clip's, the pure
 *   edits (trim, split, remove, speed, duplicate and remove an item) and the
 *   time formatters.
 * - `timeline/`: the timeline's maths: scale and zoom, the ruler, what is
 *   visible, snapping and the drag reducers.
 * - `links/`: what a pasted link is, channel handles, canonical links.
 * - `render/`: `frameState` (the one definition of what is on screen),
 *   `buildRenderPlan`, `compileFfmpeg` and `buildAss`.
 * - `recipes/`: Sprint 13 (Module 10): recipes, the five starters, applying one.
 * - `brand/`: Sprint 13 (Module 10): the brand kit for clips (logo, intro, outro).
 * - `jobs.ts`, `errors.ts`, `quality.ts`, `export.ts`, `pricing.ts`, `assets.ts`, `library.ts`: the
 *   contracts the API, the worker and the web share.
 */

export * from './assets';
export * from './brand';
export * from './canvas';
export * from './captions';
export * from './cleanup';
export * from './document';
export * from './downloads';
export * from './effects';
export * from './errors';
export * from './export';
export * from './highlights';
export {
  clampRect,
  FULL_RECT,
  fitRect,
  MIN_RECT_SIDE,
  type Point,
  type Rect,
  rectAspect,
  rectCentre,
  rectsEqual,
} from './geometry';
export * from './history';
export * from './jobs';
export * from './layout';
export * from './reframe';
export * from './library';
export * from './links';
export * from './pricing';
export * from './quality';
export * from './recipes';
export * from './render';
export * from './signals';
export * from './sources';
export * from './time';
export * from './timeline';
export * from './transcript';
