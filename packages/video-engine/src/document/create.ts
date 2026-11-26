/**
 * Making a new clip document from a marked range of a video.
 *
 * Every clip starts the same way, whoever makes it (Create Clip on the video
 * page, Edit Whole Video, Find Clips): one video, one part at normal speed,
 * the Fullscreen layout with its crop centred, no texts, stickers or sounds,
 * no look and no fades. The editor changes it from there.
 */
import { CANVASES, type CanvasFps, type Ratio, ratioAspect } from '../canvas';
import { FULL_RECT, fitRect } from '../geometry';
import { CLIP_MAX_MS, CLIP_MIN_MS } from './limits';
import { type ClipDocument, CURRENT_SCHEMA_VERSION, clipDocumentSchema } from './schema';
import { ClipDocumentError, describeIssues } from './upgrade';

/** Imported videos are 16:9 unless the caller knows better. */
export const DEFAULT_SOURCE_ASPECT = 16 / 9;

/** The canvas colour behind areas that do not cover it. */
export const DEFAULT_BACKGROUND = '#000000';

/** Refused before a document is made: the range is not a clip we allow. */
export class ClipRangeError extends Error {
  readonly code = 'clip_range_invalid' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ClipRangeError';
  }
}

export interface CreateClipDocumentInput {
  /** The `ClipVideo` id (a UUID). */
  videoId: string;
  /** Start of the range, in the video's own time (ms). */
  fromMs: number;
  /** End of the range, in the video's own time (ms, exclusive). */
  toMs: number;
  ratio: Ratio;
  fps?: CanvasFps;
  /** The video's real width over height; 16:9 when not known. */
  sourceAspect?: number;
}

const ID_PREFIX = /^[A-Za-z0-9]{1,16}$/;
let fallbackCounter = 0;

/**
 * The two Web Crypto calls this file uses, typed here so the package builds
 * without the DOM library (the worker and media-tools compile with ES2022 only).
 */
interface RandomSource {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

function randomHex(length: number): string {
  const cryptoApi = (globalThis as { crypto?: RandomSource }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    let hex = '';
    while (hex.length < length) {
      // Drop the version and variant nibbles (places 12 and 16): they are fixed, not random.
      const uuid = cryptoApi.randomUUID().replace(/-/g, '');
      hex += uuid.slice(0, 12) + uuid.slice(13, 16) + uuid.slice(17);
    }
    return hex.slice(0, length);
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    // Pages served over plain http have getRandomValues but not randomUUID.
    const bytes = cryptoApi.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
    return Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, length);
  }
  // No crypto at all (an old test runner): unique within the process, which
  // is all an id inside one document needs.
  fallbackCounter = (fallbackCounter + 1) % 0x10000;
  const parts = [
    Date.now().toString(16),
    fallbackCounter.toString(16).padStart(4, '0'),
    Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0'),
  ];
  return parts.join('').slice(-length).padStart(length, '0');
}

/**
 * A new id for a part, an area, an item or a track: `seg_3f9a0c1b2d4e5f60`.
 * 64 random bits, so ids made in two browser tabs never collide. The prefix
 * is letters and digits only; the result always passes the schema's id rule.
 */
export function newId(prefix?: string): string {
  if (prefix !== undefined && !ID_PREFIX.test(prefix)) {
    throw new RangeError('An id prefix is 1 to 16 letters or digits.');
  }
  const hex = randomHex(16);
  return prefix ? `${prefix}_${hex}` : hex;
}

function wholeMs(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new ClipRangeError(`${name} is not a time.`);
  }
  const ms = Math.round(value);
  if (ms < 0) {
    throw new ClipRangeError(`${name} is before the start of the video.`);
  }
  return ms;
}

/**
 * A new clip over `[fromMs, toMs)` of one video, ready to save.
 *
 * Throws `ClipRangeError` (`clip_range_invalid`) when the range is not 3
 * seconds to 30 minutes long; whether it is inside the video is the API's
 * check, because only the API knows the video's length. Times are rounded to
 * whole milliseconds once, here.
 */
export function createClipDocument(input: CreateClipDocumentInput): ClipDocument {
  const fromMs = wholeMs(input.fromMs, 'The start');
  const toMs = wholeMs(input.toMs, 'The end');
  const length = toMs - fromMs;
  if (length < CLIP_MIN_MS || length > CLIP_MAX_MS) {
    throw new ClipRangeError(
      `A clip must last from ${CLIP_MIN_MS / 1000} seconds to ${CLIP_MAX_MS / 60_000} minutes.`,
    );
  }

  const canvas = CANVASES[input.ratio];
  const sourceAspect =
    input.sourceAspect !== undefined &&
    input.sourceAspect > 0 &&
    Number.isFinite(input.sourceAspect)
      ? input.sourceAspect
      : DEFAULT_SOURCE_ASPECT;
  const sourceId = newId('src');

  const doc: ClipDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: {
      ratio: input.ratio,
      width: canvas.width,
      height: canvas.height,
      fps: input.fps ?? 30,
      background: DEFAULT_BACKGROUND,
    },
    sources: [{ id: sourceId, videoId: input.videoId }],
    segments: [
      {
        id: newId('seg'),
        source: sourceId,
        sourceIn: fromMs,
        sourceOut: toMs,
        speed: 1,
        volume: 1,
      },
    ],
    layout: {
      kind: 'fullscreen',
      areas: [
        {
          id: newId('area'),
          name: 'Video',
          frame: { ...FULL_RECT },
          // One keyframe at the video's start holds for the whole video, so a
          // trim outward past `fromMs` keeps the same framing.
          crop: [{ at: 0, rect: fitRect(ratioAspect(input.ratio), FULL_RECT, sourceAspect) }],
          fit: 'cover',
        },
      ],
    },
    zooms: [],
    // Strength 1 so picking a look shows it fully; `none` draws nothing whatever the strength.
    looks: { colour: 'none', strength: 1, vignette: 0 },
    fades: { inMs: 0, outMs: 0 },
    tracks: [],
    bleeps: [],
  };

  // The video id and anything else the caller gave are checked by the same
  // schema every save goes through, so a document made here is always valid.
  const result = clipDocumentSchema.safeParse(doc);
  if (!result.success) {
    throw new ClipDocumentError('invalid', describeIssues(result.error));
  }
  return result.data;
}
