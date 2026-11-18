/**
 * What the browser sees of a `ClipVideo` and its files (Sprint 12, Module 04).
 *
 * Never the raw row and never a `ClipAsset` row: a storage key, a bucket
 * name or a tool's text must not reach a page. The view carries the facts,
 * our error sentence (re-derived from the code, whatever the row says), and
 * addresses the API signed. Asset `meta` is re-read field by field with the
 * engine's shapes (`packages/video-engine/src/assets.ts`), so a malformed
 * row reads as "no filmstrip", never as a broken page.
 */
import type { ClipAsset, ClipVideo } from '@postgear/db';
import type {
  ClipError,
  ClipPlatformId,
  FilmstripMeta,
  LinkKind,
  PosterMeta,
  ProxyMeta,
  WaveformMeta,
} from '@postgear/video-engine';
import { z } from 'zod';
import { errorOf } from '../jobs/clip-job-view';

export type ClipVideoPlatform = ClipPlatformId | 'upload';
export type ClipVideoKindName = LinkKind | 'upload';

export interface ClipVideoView {
  id: string;
  platform: ClipVideoPlatform;
  kind: ClipVideoKindName;
  title: string;
  channelName: string | null;
  /** The platform's own page for the video; null for uploads. */
  link: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  status: ClipVideo['status'];
  /** Our sentence when the import failed; never a tool's text. */
  error: ClipError | null;
  /** False once the platform's sharp copy is gone; exports then use the kept copy. */
  hdAvailable: boolean;
  /** A signed address of the poster picture, when there is one. */
  posterUrl: string | null;
  expiresAt: string | null;
  lastUsedAt: string;
  createdAt: string;
}

const PLATFORMS: Record<ClipVideo['platform'], ClipVideoPlatform> = {
  YOUTUBE: 'youtube',
  TWITCH: 'twitch',
  KICK: 'kick',
  UPLOAD: 'upload',
};

const KINDS: Record<ClipVideo['kind'], ClipVideoKindName> = {
  VIDEO: 'video',
  PAST_STREAM: 'past_stream',
  CLIP: 'clip',
  SHORT: 'short',
  UPLOAD: 'upload',
};

/** A video's platform as the browser names it (`youtube`, `twitch`, `kick`, `upload`). */
export function platformOf(platform: ClipVideo['platform']): ClipVideoPlatform {
  return PLATFORMS[platform];
}

/** The enum value for a probed link's platform. */
export const PLATFORM_ENUM: Record<ClipPlatformId, ClipVideo['platform']> = {
  youtube: 'YOUTUBE',
  twitch: 'TWITCH',
  kick: 'KICK',
};

/** The enum value for a probed link's kind. */
export const KIND_ENUM: Record<LinkKind, ClipVideo['kind']> = {
  video: 'VIDEO',
  past_stream: 'PAST_STREAM',
  clip: 'CLIP',
  short: 'SHORT',
};

export function toVideoView(video: ClipVideo, posterUrl: string | null = null): ClipVideoView {
  return {
    id: video.id,
    platform: PLATFORMS[video.platform],
    kind: KINDS[video.kind],
    title: video.title,
    channelName: video.channelName,
    link: video.platform === 'UPLOAD' ? null : safeLink(video.canonicalUrl),
    durationMs: video.durationMs,
    width: video.width,
    height: video.height,
    fps: video.fps,
    hasAudio: video.hasAudio,
    status: video.status,
    error: video.status === 'FAILED' ? errorOf(video.error) : null,
    hdAvailable: video.hdAvailable,
    posterUrl,
    expiresAt: video.expiresAt?.toISOString() ?? null,
    lastUsedAt: video.lastUsedAt.toISOString(),
    createdAt: video.createdAt.toISOString(),
  };
}

/** Only an https platform address is ever shown; anything else reads as none. */
function safeLink(value: string | null): string | null {
  return value?.startsWith('https://') ? value : null;
}

// --- Asset meta, re-read with the engine's shapes ------------------------------

const count = z.number().int().min(0).max(10_000_000);
const size = z.number().int().min(1).max(10_000);

const filmstripMetaSchema = z.object({
  tileWidth: size,
  tileHeight: size,
  columns: size,
  rows: size,
  intervalMs: z.number().int().min(1),
  count,
  sheets: z.number().int().min(1).max(10_000),
});

const waveformMetaSchema = z.object({ perSecond: size, count });
const proxyMetaSchema = z.object({
  width: size,
  height: size,
  fps: z.number().positive().max(240),
});
const posterMetaSchema = z.object({ atMs: count, width: size, height: size });
/** A filmstrip sheet's place in the strip; the first sheet is 0. */
const sheetIndexSchema = z.object({ sheet: z.number().int().min(0) });

export function filmstripMetaOf(raw: unknown): FilmstripMeta | null {
  const parsed = filmstripMetaSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function waveformMetaOf(raw: unknown): WaveformMeta | null {
  const parsed = waveformMetaSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function proxyMetaOf(raw: unknown): ProxyMeta | null {
  const parsed = proxyMetaSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function posterMetaOf(raw: unknown): PosterMeta | null {
  const parsed = posterMetaSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Filmstrip sheets in strip order: by `meta.sheet`, then by when they were stored. */
export function orderedSheets(assets: readonly ClipAsset[]): ClipAsset[] {
  const indexOf = (asset: ClipAsset) => {
    const parsed = sheetIndexSchema.safeParse(asset.meta);
    return parsed.success ? parsed.data.sheet : Number.MAX_SAFE_INTEGER;
  };
  return [...assets]
    .filter((asset) => asset.kind === 'FILMSTRIP')
    .sort(
      (a, b) =>
        indexOf(a) - indexOf(b) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
}

/** The newest asset of a kind, or null. */
export function latestAsset(
  assets: readonly ClipAsset[],
  kind: ClipAsset['kind'],
): ClipAsset | null {
  let best: ClipAsset | null = null;
  for (const asset of assets) {
    if (asset.kind !== kind) continue;
    if (!best || asset.createdAt.getTime() > best.createdAt.getTime()) best = asset;
  }
  return best;
}
