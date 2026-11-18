/**
 * `@postgear/video-engine`: what a clip is, and how it becomes an FFmpeg
 * command.
 *
 * Pure TypeScript: no Node built-ins, no Temporal, no Prisma and no other
 * `@postgear/*` package (a test enforces it), so the browser preview, the
 * API, the worker and workflow code all import the identical rules.
 *
 * - `document/`: the clip document schema, its upgrade chain and the creator.
 * - `effects/`: the looks and the vignette, as numbers both drawings read.
 * - `time/`: the time map between the video's clock and the clip's, the pure
 *   edits (trim, split, remove, speed, duplicate and remove an item) and the
 *   time formatters.
 * - `timeline/`: the timeline's maths: scale and zoom, the ruler, what is
 *   visible, snapping and the drag reducers.
 * - `links/`: what a pasted link is, channel handles, canonical links.
 * - `render/`: `frameState` (the one definition of what is on screen),
 *   `buildRenderPlan`, `compileFfmpeg` and `buildAss`.
 * - `jobs.ts`, `errors.ts`, `quality.ts`, `export.ts`, `pricing.ts`, `assets.ts`, `library.ts`: the
 *   contracts the API, the worker and the web share.
 */

export * from './assets';
export * from './canvas';
export * from './document';
export * from './effects';
export * from './errors';
export * from './export';
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
export * from './library';
export * from './links';
export * from './pricing';
export * from './quality';
export * from './render';
export * from './signals/types';
export * from './sources';
export * from './time';
export * from './timeline';
export * from './transcript';
