/**
 * The `meta` each kind of stored file carries on its `ClipAsset` row, so the
 * web reads the filmstrip and the waveform without guessing. Written by the
 * import and segment jobs; read by the video page and the editor.
 */

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
