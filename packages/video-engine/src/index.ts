/**
 * `@postgear/video-engine`: what a clip is, and how it becomes an FFmpeg
 * command.
 *
 * Pure TypeScript: no Node built-ins, no Temporal, no Prisma and no other
 * `@postgear/*` package (a test enforces it), so the browser preview, the
 * API, the worker and workflow code all import the identical rules.
 *
 * - `document/`: the clip document schema, its upgrade chain and the creator.
 * - `time/`: the time map between the video's clock and the clip's, the pure
 *   edits (trim, split, remove, speed) and the time formatters.
 * - `links/`: what a pasted link is, channel handles, canonical links.
 * - `render/`: `frameState` (the one definition of what is on screen),
 *   `buildRenderPlan`, `compileFfmpeg` and `buildAss`.
 * - `jobs.ts`, `errors.ts`, `quality.ts`, `pricing.ts`, `assets.ts`: the
 *   contracts the API, the worker and the web share.
 */

export * from './assets';
export * from './canvas';
export * from './document';
export * from './errors';
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
export * from './jobs';
export * from './links';
export * from './pricing';
export * from './quality';
export * from './render';
export * from './signals/types';
export * from './sources';
export * from './time';
export * from './transcript';
