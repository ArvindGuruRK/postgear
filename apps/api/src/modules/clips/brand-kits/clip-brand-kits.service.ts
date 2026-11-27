/**
 * The brand kit for clips (Sprint 13, Module 10): Studio's kits, with what
 * video needs on top.
 *
 * A kit is Studio's `BrandKit` row (live, of this workspace); Clips adds six
 * columns and never touches Studio's own. Three doors:
 *
 * - **List** (`GET /clips/brand-kits`): every live kit with its Studio logo's
 *   address, its colours and its clip fields; the intro and outro videos
 *   with their signed light copy and poster for the kit page's small player.
 * - **Update** (`PATCH /clips/brand-kits/:id`): the clip fields only, checked
 *   by `checkClipBrandFields` (the same rules Studio's update uses).
 * - **Use** (`POST /clips/brand-kits/:id/use`): the kit in the engine's
 *   shape (`ClipBrandKit`) for `applyBrandKit`. On first use the Studio logo
 *   is copied into the clips space as one of the workspace's own stickers
 *   (`clipLogoAssetId`), so a clip points at it like any own sticker; later
 *   uses reuse it, and a copy that is gone (deleted, swept) is made again.
 *   Studio clears the id when the kit's logo changes. The intro and outro
 *   are given only while their video is still READY and short enough; the
 *   card when there is no outro video and the kit has a closing line.
 *
 * Logs carry ids and counts only.
 */
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { BrandKit, ClipAsset, ClipVideo, Prisma } from '@postgear/db';
import {
  type BrandColors,
  brandColorsSchema,
  brandFromTheme,
  DEFAULT_THEME_ID,
  themeById,
} from '@postgear/design-engine';
import { clipKeys, type PrivateStorage } from '@postgear/storage';
import {
  BRAND_VIDEO_MAX_MS,
  type BrandOutro,
  type BrandVideo,
  type ClipBrandKit,
  LOGO_POSITIONS,
  type LogoPosition,
  readStickerAssetMeta,
  type StickerAssetMeta,
  stickerNameFromFile,
} from '@postgear/video-engine';
import { MediaService } from '../../media/media.service';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { ClipErrorException } from '../clip-error.exception';
import { isBrandKitId } from '../clips.ids';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipPlaybackService } from '../videos/clip-playback.service';
import { latestAsset } from '../videos/clip-video-view';
import { checkClipBrandFields } from './clip-brand-fields';
import type { ClipBrandKitPatch } from './clip-brand-kits.schema';
import { ClipBrandKitsRepository } from './clip-brand-kits.repository';
import { logoSticker } from './clip-brand-logo';

export interface BrandVideoView {
  videoId: string;
  title: string;
  durationMs: number;
  url: string | null;
  posterUrl: string | null;
}

export interface ClipBrandKitView {
  id: string;
  name: string;
  logoUrl: string | null;
  colors: BrandColors;
  clipLogoPosition: LogoPosition | null;
  clipCaptionStyleId: string | null;
  intro: BrandVideoView | null;
  outro: { kind: 'video'; video: BrandVideoView } | { kind: 'card'; text: string } | null;
}

@Injectable()
export class ClipBrandKitsService {
  private readonly logger = new Logger(ClipBrandKitsService.name);

  constructor(
    private readonly repository: ClipBrandKitsRepository,
    private readonly media: MediaService,
    private readonly playback: ClipPlaybackService,
    private readonly limits: ClipLimitsGuard,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
  ) {}

  /** `GET /clips/brand-kits`. */
  async list(orgId: string): Promise<{ brandKits: ClipBrandKitView[] }> {
    const rows = await this.repository.list(orgId);
    return { brandKits: await this.views(orgId, rows) };
  }

  /** `PATCH /clips/brand-kits/:id`: `{ brandKit }`; 404 `brand_kit_not_found`; the field refusals. */
  async update(
    orgId: string,
    id: string,
    patch: ClipBrandKitPatch,
  ): Promise<{ brandKit: ClipBrandKitView }> {
    if (!(await this.findLive(orgId, id))) throw kitNotFound();
    const data = await checkClipBrandFields(orgId, patch);
    const saved = await this.repository.update(orgId, id, data);
    if (!saved) throw kitNotFound();
    const [view] = await this.views(orgId, [saved]);
    if (!view) throw kitNotFound();
    return { brandKit: view };
  }

  /** A live kit of the workspace, or null (another workspace's, a deleted one, a word). */
  findLive(orgId: string, id: string): Promise<BrandKit | null> {
    return isBrandKitId(id) ? this.repository.find(orgId, id) : Promise.resolve(null);
  }

  /** `POST /clips/brand-kits/:id/use`: the kit in the engine's shape; 404 `brand_kit_not_found`. */
  async use(orgId: string, id: string): Promise<ClipBrandKit> {
    const kit = await this.findLive(orgId, id);
    if (!kit) throw kitNotFound();
    return this.engineKit(orgId, kit);
  }

  /** The engine's shape of a live kit row: see the file comment. */
  async engineKit(orgId: string, kit: BrandKit): Promise<ClipBrandKit> {
    const colors = readColors(kit);
    const [logo, videos] = await Promise.all([
      this.logoCopy(orgId, kit),
      this.repository.videos(
        orgId,
        [kit.clipIntroVideoId, kit.clipOutroVideoId].filter((v): v is string => v !== null),
      ),
    ]);
    const byId = new Map(videos.map((video) => [video.id, video]));
    const intro = kit.clipIntroVideoId ? brandVideoOf(byId.get(kit.clipIntroVideoId)) : null;
    const outroVideo = kit.clipOutroVideoId ? brandVideoOf(byId.get(kit.clipOutroVideoId)) : null;
    let outro: BrandOutro | null = null;
    if (outroVideo) outro = { kind: 'video', video: outroVideo };
    else if (kit.clipOutroText)
      outro = { kind: 'card', text: kit.clipOutroText, ...cardColours(colors) };
    return {
      id: kit.id,
      name: kit.name,
      logo,
      logoPosition: logoPositionOf(kit.clipLogoPosition),
      captionStyleId: kit.clipCaptionStyleId,
      intro,
      outro,
    };
  }

  /**
   * The kit's logo as the workspace's own sticker: the recorded copy when it
   * is still there and ready, else a new copy of the Studio logo (null when
   * the kit has none, or it is gone from the library or unreadable).
   */
  private async logoCopy(orgId: string, kit: BrandKit): Promise<ClipBrandKit['logo']> {
    if (kit.clipLogoAssetId) {
      const kept = await this.readyLogo(orgId, kit.clipLogoAssetId);
      if (kept) return kept;
    }
    if (!kit.logoMediaId) return null;
    const file = await this.media.readImageBytes(orgId, kit.logoMediaId);
    if (!file) return null;

    let sticker: Awaited<ReturnType<typeof logoSticker>>;
    try {
      sticker = await logoSticker(file.bytes);
    } catch {
      this.logger.warn(
        JSON.stringify({ event: 'clips.brand_kit.logo_unreadable', orgId, kitId: kit.id }),
      );
      return null;
    }
    await this.limits.assertStorage(orgId, sticker.png.length + sticker.preview.length);

    const key = clipKeys.libraryUpload(orgId, 'png');
    const previewKey = clipKeys.libraryUpload(orgId, 'webp');
    await this.storage.put(key, sticker.png, 'image/png');
    await this.storage.put(previewKey, sticker.preview, 'image/webp');
    const meta: StickerAssetMeta = {
      status: 'ready',
      name: stickerNameFromFile(`${kit.name} Logo`),
      animated: false,
      width: sticker.width,
      height: sticker.height,
      fps: null,
      frames: null,
      durationMs: null,
      previewKey,
    };
    let asset: ClipAsset;
    try {
      asset = await this.repository.createSticker(orgId, {
        key,
        bytes: sticker.png.length,
        meta: meta as Prisma.InputJsonValue,
      });
    } catch (error) {
      await this.dropFiles(key, previewKey);
      throw error;
    }

    const kept = await this.repository.setLogoAsset(orgId, kit.id, kit.clipLogoAssetId, asset.id);
    if (!kept) {
      // Another first use won: its copy stands, this one goes.
      await this.repository.removeSticker(orgId, asset.id);
      await this.dropFiles(key, previewKey);
      const winner = await this.repository.find(orgId, kit.id);
      const theirs = winner?.clipLogoAssetId
        ? await this.readyLogo(orgId, winner.clipLogoAssetId)
        : null;
      return theirs;
    }
    this.logger.log(
      JSON.stringify({
        event: 'clips.brand_kit.logo_copied',
        orgId,
        kitId: kit.id,
        assetId: asset.id,
      }),
    );
    return { assetId: asset.id, width: sticker.width, height: sticker.height };
  }

  private async readyLogo(orgId: string, assetId: string): Promise<ClipBrandKit['logo']> {
    const row = await this.repository.sticker(orgId, assetId);
    const meta = row ? readStickerAssetMeta(row.meta) : null;
    return row && meta?.status === 'ready'
      ? { assetId: row.id, width: meta.width, height: meta.height }
      : null;
  }

  private async dropFiles(...keys: string[]): Promise<void> {
    for (const key of keys) await this.storage.delete(key).catch(() => undefined);
  }

  /** The kit page's views, with every logo, light copy and poster signed in one pass. */
  private async views(orgId: string, rows: readonly BrandKit[]): Promise<ClipBrandKitView[]> {
    if (rows.length === 0) return [];
    const logoIds = rows.flatMap((row) => (row.logoMediaId ? [row.logoMediaId] : []));
    const videoIds = rows.flatMap((row) =>
      [row.clipIntroVideoId, row.clipOutroVideoId].filter((v): v is string => v !== null),
    );
    const [logos, videos, files] = await Promise.all([
      logoIds.length > 0 ? this.media.findViews(orgId, logoIds) : Promise.resolve(new Map()),
      this.repository.videos(orgId, videoIds),
      this.repository.videoFiles(orgId, videoIds),
    ]);
    const videoViews = new Map<string, BrandVideoView>();
    for (const video of videos) {
      if (video.durationMs === null) continue;
      const own = files.filter((file) => file.videoId === video.id);
      const proxy = video.status === 'READY' ? latestAsset(own, 'PROXY') : undefined;
      const poster = latestAsset(own, 'POSTER');
      const [url, posterUrl] = await Promise.all([
        proxy ? this.playback.address(proxy.key) : Promise.resolve(null),
        poster ? this.playback.address(poster.key) : Promise.resolve(null),
      ]);
      videoViews.set(video.id, {
        videoId: video.id,
        title: video.title,
        durationMs: video.durationMs,
        url: url?.url ?? null,
        posterUrl: posterUrl?.url ?? null,
      });
    }
    return rows.map((row) => {
      const logo = row.logoMediaId ? logos.get(row.logoMediaId) : undefined;
      const outroVideo = row.clipOutroVideoId ? videoViews.get(row.clipOutroVideoId) : undefined;
      return {
        id: row.id,
        name: row.name,
        logoUrl: logo?.type === 'image' ? logo.url : null,
        colors: readColors(row),
        clipLogoPosition: logoPositionOf(row.clipLogoPosition),
        clipCaptionStyleId: row.clipCaptionStyleId,
        intro: (row.clipIntroVideoId ? videoViews.get(row.clipIntroVideoId) : undefined) ?? null,
        outro: outroVideo
          ? { kind: 'video' as const, video: outroVideo }
          : row.clipOutroText
            ? { kind: 'card' as const, text: row.clipOutroText }
            : null,
      };
    });
  }
}

/** A stored corner that reads, or null (no logo on clips). */
function logoPositionOf(value: string | null): LogoPosition | null {
  return value !== null && (LOGO_POSITIONS as readonly string[]).includes(value)
    ? (value as LogoPosition)
    : null;
}

/** An intro or outro video while it can still play as one: READY, sized, short enough. */
function brandVideoOf(video: ClipVideo | undefined): BrandVideo | null {
  if (video?.status !== 'READY' || video.durationMs === null) return null;
  if (video.durationMs > BRAND_VIDEO_MAX_MS || !video.width || !video.height) return null;
  return {
    videoId: video.id,
    durationMs: video.durationMs,
    width: video.width,
    height: video.height,
  };
}

/** A kit's colours as stored, or the default theme's when a row was changed by hand. */
function readColors(row: BrandKit): BrandColors {
  const parsed = brandColorsSchema.safeParse(row.colors);
  return parsed.success ? parsed.data : brandFromTheme(themeById(DEFAULT_THEME_ID));
}

/**
 * The outro card's colours: the kit's primary colour behind, and of its text
 * and background colours whichever reads better on it in front.
 */
export function cardColours(colors: BrandColors): { background: string; colour: string } {
  const background = colors.primary;
  const onText = contrast(background, colors.text);
  const onBackground = contrast(background, colors.background);
  return { background, colour: onText >= onBackground ? colors.text : colors.background };
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (offset: number) => {
    const c = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

export function kitNotFound(): ClipErrorException {
  return new ClipErrorException(HttpStatus.NOT_FOUND, 'brand_kit_not_found');
}
