/**
 * Emote Maker (Sprint 13, Module 14): the page's rules and words, pure so
 * they are tested without a browser.
 *
 * - The stretch moves in tenths of a second and never passes 3.0 seconds.
 * - The crop is a square inside the light copy's frame, at least 16 px; under
 *   112 source pixels the page warns that it will look soft.
 * - Remove A Colour keys the preview the way FFmpeg's `colorkey` keys the
 *   files (RGB distance, the same similarity and edge), so what the canvas
 *   shows is what the export makes.
 * - The links: the Creator Tools hub, the Emote Maker (optionally opened on a
 *   clip's video and range), the Schedule Maker.
 */
import {
  EMOTE_MAX_MS,
  EMOTE_MIN_CROP,
  EMOTE_PROFILES,
  EMOTE_SOFT_BELOW,
  EMOTE_STEP_MS,
  EMOTE_UNDER_LIMIT,
  type EmoteCrop,
  type EmoteFile,
  type EmoteFrame,
  type EmotePlatform,
  emoteBytesLabel,
  emoteOverReason,
} from '@postgear/video-engine';

export const SOFT_NOTE = 'This will look soft.';
export const EMOTE_OWN_STREAM_LINE =
  'Use clips of your own stream. Twitch reviews emotes before they go live.';
export const EMOTE_CHECK_RULES_LINE = "Check each site's current rules before you upload.";
export const KEY_EDGE_LINE = 'Edges are rougher in GIF files than in 7TV files.';
export const EMOTE_MAX_LINE = '3.0 seconds at most';
export const NO_SOURCE_LINE = 'Pick a clip or a video to start.';
export const NO_VIDEOS_LINE = 'Bring in a video on Clips first, then make an emote from it.';
export const EXPIRED_LINE = 'These files have expired. Export again to make them.';

/** The three export buttons, in order. */
export const EMOTE_EXPORTS: ReadonlyArray<{ platform: EmotePlatform; label: string }> = [
  { platform: 'twitch', label: 'Export For Twitch' },
  { platform: 'sevenTv', label: 'Export For 7TV' },
  { platform: 'bttv', label: 'Export For BTTV' },
];

/** The preview sizes, largest first (Twitch's three). */
export const PREVIEW_SIZES = [112, 56, 28] as const;

// --- Links --------------------------------------------------------------------------

const org = (orgId: string) => `/${encodeURIComponent(orgId)}/clips`;

export function creatorToolsHref(orgId: string): string {
  return `${org(orgId)}/tools`;
}

export function scheduleMakerHref(orgId: string): string {
  return `${org(orgId)}/tools/schedule`;
}

export interface EmoteStart {
  videoId?: string | null;
  clipId?: string | null;
  fromMs?: number | null;
  toMs?: number | null;
}

/** The Emote Maker, opened on a video (and a clip's range) when given. */
export function emoteHref(orgId: string, start: EmoteStart = {}): string {
  const query = new URLSearchParams();
  if (start.videoId) query.set('video', start.videoId);
  if (start.clipId) query.set('clip', start.clipId);
  if (typeof start.fromMs === 'number') query.set('from', String(Math.round(start.fromMs)));
  if (typeof start.toMs === 'number') query.set('to', String(Math.round(start.toMs)));
  const text = query.toString();
  return `${org(orgId)}/tools/emote${text ? `?${text}` : ''}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function ms(value: string | string[] | undefined): number | null {
  const text = first(value);
  if (!text || !/^\d{1,9}$/.test(text)) return null;
  return Number(text);
}

/** The page's query string, checked: ids must be ids and times whole milliseconds. */
export function parseEmoteQuery(query: Record<string, string | string[] | undefined>): {
  videoId: string | null;
  clipId: string | null;
  fromMs: number | null;
  toMs: number | null;
} {
  const video = first(query.video);
  const clip = first(query.clip);
  return {
    videoId: video && UUID.test(video) ? video : null,
    clipId: clip && UUID.test(clip) ? clip : null,
    fromMs: ms(query.from),
    toMs: ms(query.to),
  };
}

// --- The stretch --------------------------------------------------------------------

export interface Stretch {
  startMs: number;
  lengthMs: number;
}

const snap = (value: number) => Math.round(value / EMOTE_STEP_MS) * EMOTE_STEP_MS;

/** On tenths of a second, 0.1 to 3.0 seconds long, inside the video. */
export function clampStretch(stretch: Stretch, durationMs: number): Stretch {
  const total = Math.max(EMOTE_STEP_MS, Math.floor(durationMs / EMOTE_STEP_MS) * EMOTE_STEP_MS);
  const lengthMs = Math.min(Math.max(EMOTE_STEP_MS, snap(stretch.lengthMs)), EMOTE_MAX_MS, total);
  const startMs = Math.min(Math.max(0, snap(stretch.startMs)), total - lengthMs);
  return { startMs, lengthMs };
}

/** A clip's range as a stretch: its start, at most 3 seconds of it. */
export function stretchFromRange(
  fromMs: number | null,
  toMs: number | null,
  durationMs: number,
): Stretch {
  if (fromMs === null) return clampStretch({ startMs: 0, lengthMs: EMOTE_MAX_MS }, durationMs);
  const startMs = Math.ceil(fromMs / EMOTE_STEP_MS) * EMOTE_STEP_MS;
  const span = toMs !== null && toMs > startMs ? toMs - startMs : EMOTE_MAX_MS;
  const lengthMs = Math.floor(span / EMOTE_STEP_MS) * EMOTE_STEP_MS;
  return clampStretch({ startMs, lengthMs }, durationMs);
}

/** "2.4 s". */
export function secondsLabel(ms: number): string {
  return `${(Math.max(0, ms) / 1_000).toFixed(1)} s`;
}

/** "1:07.4": where the stretch starts. */
export function clockLabel(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths % 10}`;
}

// --- The crop -----------------------------------------------------------------------

/** A centred square of 60 percent of the shorter side. */
export function defaultCrop(frame: EmoteFrame): EmoteCrop {
  const side = Math.min(frame.width, frame.height);
  const size = Math.max(EMOTE_MIN_CROP, Math.round(side * 0.6));
  return {
    x: Math.round((frame.width - size) / 2),
    y: Math.round((frame.height - size) / 2),
    size,
  };
}

/** Whole pixels, square, at least 16 px and inside the frame. */
export function clampCrop(crop: EmoteCrop, frame: EmoteFrame): EmoteCrop {
  const side = Math.min(frame.width, frame.height);
  const size = Math.min(side, Math.max(EMOTE_MIN_CROP, Math.round(crop.size)));
  return {
    x: Math.min(Math.max(0, Math.round(crop.x)), frame.width - size),
    y: Math.min(Math.max(0, Math.round(crop.y)), frame.height - size),
    size,
  };
}

/** Under Twitch's largest size in source pixels the emote is scaled up and looks soft. */
export function isSoft(crop: EmoteCrop): boolean {
  return crop.size < EMOTE_SOFT_BELOW;
}

// --- Remove A Colour ----------------------------------------------------------------

export const DEFAULT_SIMILARITY = 0.3;
/** The edge softness the worker uses (`EMOTE_KEY_BLEND`). */
const KEY_BLEND = 0.08;

export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return null;
  return [
    Number.parseInt(match[1] as string, 16),
    Number.parseInt(match[2] as string, 16),
    Number.parseInt(match[3] as string, 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * The alpha FFmpeg's `colorkey` gives a pixel: its RGB distance from the key,
 * scaled to 0..1, against the similarity, with a soft edge of `blend`.
 */
export function keyAlpha(
  pixel: [number, number, number],
  key: [number, number, number],
  similarity: number,
): number {
  const dr = pixel[0] - key[0];
  const dg = pixel[1] - key[1];
  const db = pixel[2] - key[2];
  const diff = Math.sqrt((dr * dr + dg * dg + db * db) / (255 * 255 * 3));
  const alpha = (diff - similarity) / KEY_BLEND;
  return Math.round(Math.min(1, Math.max(0, alpha)) * 255);
}

/** Keys RGBA pixels in place (the canvas preview). */
export function applyKey(data: Uint8ClampedArray, keyHex: string, similarity: number): void {
  const key = hexToRgb(keyHex);
  if (!key) return;
  for (let at = 0; at < data.length; at += 4) {
    const alpha = keyAlpha(
      [data[at] as number, data[at + 1] as number, data[at + 2] as number],
      key,
      similarity,
    );
    data[at + 3] = Math.min(data[at + 3] as number, alpha);
  }
}

// --- The result ---------------------------------------------------------------------

/** "112 px, 311 KB, under the limit", or the reason it is not. */
export function fileLine(file: EmoteFile, platform: EmotePlatform): string {
  const reason = emoteOverReason({
    bytes: file.bytes,
    maxBytes: file.maxBytes,
    frames: file.frames,
    maxFrames: file.format === 'png' ? 1 : EMOTE_PROFILES[platform].maxFrames,
  });
  const verdict = reason ?? EMOTE_UNDER_LIMIT;
  return `${file.size} px, ${emoteBytesLabel(file.bytes)}, ${verdict.charAt(0).toLowerCase()}${verdict.slice(1)}`;
}

/** "Made at 15 frames a second to fit" when the ladder lowered the largest moving file. */
export function madeAtLine(files: readonly EmoteFile[]): string | null {
  const moving = files.filter((file) => file.format !== 'png' && file.fits);
  const lowered = moving.find((file) => file.rung > 1);
  if (!lowered) return null;
  return `Made at ${lowered.fps} frames a second to fit.`;
}

/** The number of moving and still files kept, for the card's line. */
export function keptLine(files: readonly EmoteFile[]): string {
  const kept = files.filter((file) => file.fits).length;
  return kept === 1 ? '1 file ready.' : `${kept} files ready.`;
}

// --- The source picker --------------------------------------------------------------

/** One choice in Pick A Clip: a clip (its video and range) or a whole video. */
export interface EmoteSourceOption {
  /** `clip:<id>` or `video:<id>`. */
  value: string;
  kind: 'clip' | 'video';
  label: string;
  videoId: string;
  fromMs: number | null;
  toMs: number | null;
}

interface SourceVideo {
  id: string;
  title: string;
  status: string;
}

interface SourceClip {
  id: string;
  title: string;
  videoId: string;
  range: { fromMs: number; toMs: number } | null;
}

/** The workspace's clips (of ready videos) first, then its ready videos. */
export function sourceOptions(
  videos: readonly SourceVideo[],
  clips: readonly SourceClip[],
): EmoteSourceOption[] {
  const ready = new Map(
    videos.filter((video) => video.status === 'READY').map((video) => [video.id, video]),
  );
  const fromClips = clips
    .filter((clip) => ready.has(clip.videoId))
    .map<EmoteSourceOption>((clip) => ({
      value: `clip:${clip.id}`,
      kind: 'clip',
      label: clip.title,
      videoId: clip.videoId,
      fromMs: clip.range?.fromMs ?? null,
      toMs: clip.range?.toMs ?? null,
    }));
  const fromVideos = [...ready.values()].map<EmoteSourceOption>((video) => ({
    value: `video:${video.id}`,
    kind: 'video',
    label: video.title,
    videoId: video.id,
    fromMs: null,
    toMs: null,
  }));
  return [...fromClips, ...fromVideos];
}

/** The choice the page opens on: the asked clip, else the asked video, else none. */
export function initialSource(
  options: readonly EmoteSourceOption[],
  start: {
    videoId: string | null;
    clipId: string | null;
    fromMs: number | null;
    toMs: number | null;
  },
): EmoteSourceOption | null {
  if (start.clipId) {
    const clip = options.find((option) => option.value === `clip:${start.clipId}`);
    if (clip) return clip;
  }
  if (start.videoId) {
    const video = options.find((option) => option.value === `video:${start.videoId}`);
    // A clip's menu sends its range even when the clip is not in the first page of clips.
    if (video) return { ...video, fromMs: start.fromMs, toMs: start.toMs };
  }
  return null;
}

const PAGE_PATH = /^\/([^/]+)\/clips(?:\/video\/([0-9a-f-]{36}))?(?:\/|$)/i;

/**
 * A clip menu's Make An Emote link, from the page it is on: the workspace is
 * the address's first part; the video is the clip's own (a library item) or
 * the video page's. Null off a Clips page, or with no video to name.
 */
export function emoteHrefFromPage(
  pathname: string,
  clip: {
    clipId: string;
    videoId: string | null;
    range: { fromMs: number; toMs: number } | null;
  },
): string | null {
  const match = PAGE_PATH.exec(pathname);
  if (!match?.[1]) return null;
  const videoId = clip.videoId ?? match[2] ?? null;
  if (!videoId) return null;
  return emoteHref(decodeURIComponent(match[1]), {
    videoId,
    clipId: clip.clipId,
    fromMs: clip.range?.fromMs ?? null,
    toMs: clip.range?.toMs ?? null,
  });
}
