/**
 * The `meta` each kind of stored file carries on its `ClipAsset` row, so the
 * web reads the filmstrip and the waveform without guessing. Written by the
 * import and segment jobs; read by the video page and the editor.
 */
import { z } from 'zod';

/** A sheet of small pictures, one every `intervalMs`, laid out in rows. */
export interface FilmstripMeta {
  /** Width and height of one tile, in pixels. */
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  /** One tile every this many milliseconds of the video. */
  intervalMs: number;
  /** Tiles in the whole strip (the last sheet may be part full). */
  count: number;
  /** Sheets, in order; each is its own stored file. */
  sheets: number;
  /** On a FILMSTRIP asset row: which sheet this file is, from 0. Each sheet is its own row. */
  sheet?: number;
}

/** The sound's shape: `perSecond` bytes a second, each 0 to 255. */
export interface WaveformMeta {
  perSecond: number;
  count: number;
}

export interface ProxyMeta {
  height: number;
  width: number;
  fps: number;
}

/** The sharp copy of a clip's range, handles included. Source time. */
export interface SegmentAssetMeta {
  fromMs: number;
  toMs: number;
  height: number;
  fps: number;
}

export interface PosterMeta {
  atMs: number;
  width: number;
  height: number;
}

export interface AnalysisAudioMeta {
  sampleRate: number;
  channels: 1;
}

/**
 * The video's highlight tracks (Module 16): one gzipped signals file per
 * video. The meta names what is inside so a run can tell, without reading
 * the file, whether a track needs measuring again.
 */
export interface SignalsAssetMeta {
  durationMs: number;
  tracks: Array<{ name: string; version: number }>;
}

/** At most about this many filmstrip pictures for any video. */
export const FILMSTRIP_MAX_TILES = 1_200;

const FILMSTRIP_STEPS_MS = [2_000, 5_000, 10_000, 15_000, 20_000, 30_000, 60_000] as const;

/**
 * How often a filmstrip picture is taken: the shortest of 2, 5, 10, 15, 20,
 * 30 or 60 seconds that keeps the video at or under about 1,200 pictures (a
 * 40 minute talk gets one every 2 seconds, a 6 hour stream one every 20).
 */
export function filmstripIntervalMs(durationMs: number): number {
  for (const step of FILMSTRIP_STEPS_MS) {
    if (Math.ceil(durationMs / step) <= FILMSTRIP_MAX_TILES) {
      return step;
    }
  }
  return FILMSTRIP_STEPS_MS[FILMSTRIP_STEPS_MS.length - 1];
}

/** Tiles per sheet: ten across, ten down. */
export const FILMSTRIP_COLUMNS = 10;
export const FILMSTRIP_ROWS = 10;
export const FILMSTRIP_TILE_WIDTH = 160;
export const FILMSTRIP_TILE_HEIGHT = 90;
/** Waveform peaks a second. */
export const WAVEFORM_PER_SECOND = 20;

// --- A workspace's own sticker (Module 12) ------------------------------------

/** The most an uploaded sticker file may weigh, checked on its real bytes. */
export const STICKER_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

/**
 * A STICKER asset's `meta`. The API writes it `checking` with the name the
 * person gave; `clipStickerCheckWorkflow` makes the file a PNG or an APNG
 * (the same `normaliseSticker` the library ingest uses) and writes `ready`
 * with its facts and preview, or `failed` with the reason and no file.
 */
export const stickerAssetMetaSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('checking'), name: z.string().max(120) }),
  z.object({
    status: z.literal('ready'),
    name: z.string().max(120),
    animated: z.boolean(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    /** A moving picture's constant rate and frame count; null for a still one. */
    fps: z.number().int().positive().nullable(),
    frames: z.number().int().positive().nullable(),
    durationMs: z.number().int().positive().nullable(),
    /** The 128 px WebP for the Uploaded tab, in the private space. */
    previewKey: z.string(),
  }),
  z.object({
    status: z.literal('failed'),
    name: z.string().max(120),
    error: z.enum(['sticker_unusable', 'sticker_too_large']),
  }),
]);

export type StickerAssetMeta = z.infer<typeof stickerAssetMetaSchema>;

/** A STICKER asset's meta, or null when it is not one we wrote. */
export function readStickerAssetMeta(meta: unknown): StickerAssetMeta | null {
  const parsed = stickerAssetMetaSchema.safeParse(meta);
  return parsed.success ? parsed.data : null;
}

/** A file name made into a sticker's name: no folder, no extension, plain spaces, at most 60 letters. */
export function stickerNameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const plain = base
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[_\s.-]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .slice(0, 60)
    .trim();
  return plain || 'Sticker';
}

// --- A workspace's own sound (Module 14) --------------------------------------

/** The most an uploaded sound file may weigh, checked on its real bytes. */
export const SOUND_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
/** The longest an uploaded sound may play. */
export const SOUND_UPLOAD_MAX_MS = 10 * 60 * 1000;

/**
 * An AUDIO asset's `meta` for an uploaded sound (`purpose: 'sound'` tells it
 * from a video's analysis audio). The API writes it `checking` with the name
 * the person gave; `clipSoundCheckWorkflow` probes it (sound only, at most 10
 * minutes), makes its peaks, converts it to AAC `.m4a` at 48 kHz and writes
 * `ready` with its facts, or `failed` with the reason and no file.
 */
export const soundAssetMetaSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('checking'),
    purpose: z.literal('sound'),
    name: z.string().max(120),
  }),
  z.object({
    status: z.literal('ready'),
    purpose: z.literal('sound'),
    name: z.string().max(120),
    durationMs: z.number().int().positive(),
    /** 100 values, 0 to 255. */
    peaks: z.array(z.number().int().min(0).max(255)).length(100),
  }),
  z.object({
    status: z.literal('failed'),
    purpose: z.literal('sound'),
    name: z.string().max(120),
    error: z.enum(['sound_unusable', 'sound_too_long']),
  }),
]);

export type SoundAssetMeta = z.infer<typeof soundAssetMetaSchema>;

/** An uploaded sound's meta, or null when it is not one we wrote. */
export function readSoundAssetMeta(meta: unknown): SoundAssetMeta | null {
  const parsed = soundAssetMetaSchema.safeParse(meta);
  return parsed.success ? parsed.data : null;
}

/** A file name made into a sound's name, the same way a sticker's is. */
export function soundNameFromFile(fileName: string): string {
  const name = stickerNameFromFile(fileName);
  return name === 'Sticker' ? 'Sound' : name;
}
