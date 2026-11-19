/**
 * Whether a video fits a platform (Sprint 12, Clips, Module 17).
 *
 * `videoFit` reads a provider's declared video rules (`MediaRules`: the
 * count, `maxVideoBytes`, and the length, shape and width fields) against
 * what is known about one video, and answers the first rule it breaks with
 * the limit it hit, so each caller writes its own sentence from one answer:
 * the Send To Composer dialog greys a channel with it, the API refuses a
 * send with it, and `validate.ts` turns it into the composer's issue.
 *
 * A fact that is unknown (null) is never held against the video: old media
 * without facts behaves as it always did. Pure and browser-safe.
 */
import type { ProviderRules, VideoShape } from './rules';

/** What is known about one video; null when unknown. */
export interface VideoFacts {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
}

/** The rules `videoFit` can say a video breaks, in the order they are checked. */
export const VIDEO_FIT_REASONS = [
  'no_video',
  'too_long',
  'too_short',
  'wrong_shape',
  'too_big',
  'too_wide',
] as const;
export type VideoFitReason = (typeof VIDEO_FIT_REASONS)[number];

export type VideoFit =
  | { ok: true }
  | {
      ok: false;
      reason: VideoFitReason;
      /** The limit hit: milliseconds, bytes or pixels; null for `no_video` and `wrong_shape`. */
      limit: number | null;
      /** For `wrong_shape`: the shapes the platform takes. */
      shapes?: readonly VideoShape[];
    };

/** Width over height for each shape. */
const SHAPE_RATIOS: Record<VideoShape, number> = {
  '9:16': 9 / 16,
  '4:5': 4 / 5,
  '1:1': 1,
  '16:9': 16 / 9,
};

/** How far a video's width over height may be from a shape's and still be that shape. */
const SHAPE_TOLERANCE = 0.03;

/** The shape a video's size is, or null when it is none of the four. */
export function videoShapeOf(width: number, height: number): VideoShape | null {
  if (!(width > 0) || !(height > 0)) return null;
  const ratio = width / height;
  for (const [shape, target] of Object.entries(SHAPE_RATIOS) as [VideoShape, number][]) {
    if (Math.abs(ratio - target) / target <= SHAPE_TOLERANCE) return shape;
  }
  return null;
}

const known = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** The first rule the video breaks on this platform, or `{ ok: true }`. */
export function videoFit(rules: Pick<ProviderRules, 'media'>, facts: VideoFacts): VideoFit {
  const media = rules.media;
  if (media.maxVideos === 0) return { ok: false, reason: 'no_video', limit: null };

  if (known(facts.durationMs)) {
    if (media.videoMaxMs !== undefined && facts.durationMs > media.videoMaxMs) {
      return { ok: false, reason: 'too_long', limit: media.videoMaxMs };
    }
    if (media.videoMinMs !== undefined && facts.durationMs < media.videoMinMs) {
      return { ok: false, reason: 'too_short', limit: media.videoMinMs };
    }
  }

  const shapes = media.videoRatios;
  if (shapes && shapes !== 'any' && known(facts.width) && known(facts.height)) {
    const shape = videoShapeOf(facts.width, facts.height);
    if (shape === null || !shapes.includes(shape)) {
      return { ok: false, reason: 'wrong_shape', limit: null, shapes };
    }
  }

  if (
    known(facts.bytes) &&
    media.maxVideoBytes !== undefined &&
    facts.bytes > media.maxVideoBytes
  ) {
    return { ok: false, reason: 'too_big', limit: media.maxVideoBytes };
  }

  if (
    known(facts.width) &&
    media.videoMaxWidth !== undefined &&
    facts.width > media.videoMaxWidth
  ) {
    return { ok: false, reason: 'too_wide', limit: media.videoMaxWidth };
  }

  return { ok: true };
}

/** "42 s", "2 min", "2 min 10 s": a video's own length. */
export function formatVideoLength(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** "90 seconds", "3 minutes", "1 minute": a platform's limit. */
export function formatLengthLimit(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds <= 90 || seconds % 60 !== 0) {
    return seconds === 1 ? '1 second' : `${seconds} seconds`;
  }
  const minutes = seconds / 60;
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** Binary megabytes as platforms mean them, whole when they are: "300 MB", "340.2 MB". */
function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1024 && Number.isInteger(megabytes / 1024)) return `${megabytes / 1024} GB`;
  const rounded = Math.round(megabytes * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} MB`;
}

/** "a vertical or square video" from the shapes a platform takes. */
function shapeWords(shapes: readonly VideoShape[]): string {
  const words: string[] = [];
  if (shapes.includes('9:16') || shapes.includes('4:5')) words.push('vertical');
  if (shapes.includes('1:1')) words.push('square');
  if (shapes.includes('16:9')) words.push('wide');
  if (words.length === 0) return 'a video of another shape';
  return `a ${words.join(' or ')} video`;
}

/**
 * The sentence for a video that does not fit, naming the platform:
 * "This clip is 2 min 10 s. Facebook takes up to 90 seconds."
 * `noun` is "clip" in Clips and "video" in the composer.
 */
export function videoFitSentence(
  fit: Exclude<VideoFit, { ok: true }>,
  platform: string,
  facts: VideoFacts,
  noun: 'clip' | 'video' = 'clip',
): string {
  switch (fit.reason) {
    case 'no_video':
      return `${platform} does not take video here.`;
    case 'too_long':
      return known(facts.durationMs) && fit.limit !== null
        ? `This ${noun} is ${formatVideoLength(facts.durationMs)}. ${platform} takes up to ${formatLengthLimit(fit.limit)}.`
        : `This ${noun} is longer than ${platform} allows.`;
    case 'too_short':
      return `This ${noun} is shorter than ${platform} allows.`;
    case 'wrong_shape':
      return `${platform} needs ${shapeWords(fit.shapes ?? [])}.`;
    case 'too_big':
      return known(facts.bytes) && fit.limit !== null
        ? `This file is ${formatMegabytes(facts.bytes)}. ${platform} takes up to ${formatMegabytes(fit.limit)}.`
        : `This file is bigger than ${platform} allows.`;
    case 'too_wide':
      return known(facts.width) && fit.limit !== null
        ? `This ${noun} is ${facts.width} pixels wide. ${platform} takes up to ${fit.limit}.`
        : `This ${noun} is wider than ${platform} allows.`;
  }
}
