/**
 * The Clips tab (Sprint 12, Module 07 section 4): `GET /clips`.
 *
 * - **Filters**: `status` (a state, or `all`, which leaves hidden clips out),
 *   `source` (where the clip's video came from, repeatable), `videoId`;
 *   24 a page, newest or oldest first.
 * - **Counts** for the filter row follow `source` and `videoId` but not
 *   `status`, so every tab shows what it would hold.
 * - **State** per clip comes from `clip-state.ts`; the list's filter is the
 *   same rules as a query, so a card's badge always matches its tab. The
 *   post groups still waiting are read once per request (two queries) and
 *   every filter, count and badge reuses them.
 * - **Pictures**: the card's poster is the filmstrip tile nearest the clip's
 *   start (no new file), or the video's poster; its hover preview is the
 *   light copy's signed address with the clip's range. Each stored file is
 *   signed at most once per request (`signOnce`), and only the sheets a
 *   poster on this page uses are signed. No storage key is answered.
 * - **Module 17**: `withExport` (the composer's Clips tab: clips with an
 *   exported file, whatever their state) and `q` (words of the name); each
 *   card carries the live posts it went out in (`posts`, for View Post);
 *   `comingUp` answers the Create tab's Coming Up panel with the same cards.
 */
import { Injectable } from '@nestjs/common';
import {
  type ClipAsset,
  ClipAssetKind,
  type ClipPlatform,
  type Prisma,
  prisma,
} from '@postgear/db';
import { ClipPlaybackService } from '../videos/clip-playback.service';
import { type Signer, signOnce } from '../videos/clip-video-media';
import {
  type ClipVideoPlatform,
  filmstripMetaOf,
  latestAsset,
  orderedSheets,
  platformOf,
  posterMetaOf,
} from '../videos/clip-video-view';
import { CLIP_SUMMARY_SELECT } from '../videos/clip-videos.repository';
import { type ClipSummaryView, toClipSummary } from '../videos/clip-videos.service';
import {
  type ClipPublishedPost,
  ClipPostsService,
  type ComingUpChannel,
} from './clip-posts.service';
import { exportProgressOf } from './export-progress';
import {
  type ClipPoster,
  type ClipPreview,
  filmstripPosterBox,
  wholePoster,
} from './clip-card-media';
import { CLIPS_PAGE_SIZE, type ClipSource, type ListClipsQuery } from './clip-item.schema';
import {
  CLIP_STATUS_FILTERS,
  type ClipStatusFilter,
  stateWhere,
  waitingPostGroups,
} from './clip-state';

/** One card of the Clips tab. */
export interface ClipListItem extends ClipSummaryView {
  videoId: string;
  videoTitle: string;
  platform: ClipVideoPlatform;
  /** The filmstrip tile nearest the clip's start, or the video's poster; null when neither exists. */
  poster: ClipPoster | null;
  /** The light copy and the clip's range, for a muted hover preview; null when not playable. */
  preview: ClipPreview | null;
  /** Module 17: the live posts it went out in, newest first (View Post). */
  posts: ClipPublishedPost[];
  /**
   * Module 17: when its exported file was made (the composer's Select A
   * Clip); null with no export, or once that file was deleted from Media.
   */
  exportedAt: string | null;
  /** Module 11: the recipe the clip wears (`document.recipeId`), so Export All can preselect its quality. */
  recipeId: string | null;
}

/** Module 17: one row of the Create tab's Coming Up panel. */
export interface ComingUpItem {
  group: string;
  publishDate: string;
  channels: ComingUpChannel[];
  clip: Pick<ClipListItem, 'id' | 'title' | 'ratio' | 'durationMs' | 'videoId' | 'poster'>;
}

/** `GET /clips/coming-up`: at most five rows, how many there are, and whether any clip is exported. */
export interface ComingUpAnswer {
  items: ComingUpItem[];
  total: number;
  anyExported: boolean;
}

/** How many rows Coming Up shows; the rest are "and N more". */
export const COMING_UP_LIMIT = 5;

export type ClipCounts = Record<ClipStatusFilter, number>;

export interface ClipListPage {
  clips: ClipListItem[];
  counts: ClipCounts;
  page: number;
  pageSize: number;
  /** Clips matching every filter, `status` included. */
  total: number;
}

const SOURCE_ENUM: Record<ClipSource, ClipPlatform> = {
  youtube: 'YOUTUBE',
  twitch: 'TWITCH',
  kick: 'KICK',
  upload: 'UPLOAD',
};

const CARD_ASSET_KINDS = [ClipAssetKind.PROXY, ClipAssetKind.FILMSTRIP, ClipAssetKind.POSTER];

function listSelect(waitingGroups: readonly string[]) {
  return {
    ...CLIP_SUMMARY_SELECT,
    video: { select: { title: true, platform: true, status: true, deletedAt: true } },
    // Any one of its post groups still waiting makes the clip Scheduled.
    posts: {
      where: { postGroup: { in: [...waitingGroups] } },
      select: { id: true },
      take: 1,
    },
  } satisfies Prisma.ClipSelect;
}

type ListRow = Prisma.ClipGetPayload<{ select: ReturnType<typeof listSelect> }>;

/** A ready video's files a card reads, picked once per video. */
interface CardFiles {
  proxy: ClipAsset | null;
  sheets: ClipAsset[];
  poster: ClipAsset | null;
}

@Injectable()
export class ClipsListService {
  constructor(
    private readonly playback: ClipPlaybackService,
    private readonly clipPosts: ClipPostsService,
  ) {}

  async list(orgId: string, query: ListClipsQuery): Promise<ClipListPage> {
    const groups = await waitingPostGroups(orgId);
    const revision = prisma.clip.fields.revision;
    const base: Prisma.ClipWhereInput = {
      organizationId: orgId,
      ...(query.videoId ? { videoId: query.videoId } : {}),
      ...(query.source && query.source.length > 0
        ? { video: { platform: { in: query.source.map((source) => SOURCE_ENUM[source]) } } }
        : {}),
      ...(query.withExport === 'true' ? { exportedMediaId: { not: null } } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };
    const whereFor = (filter: ClipStatusFilter): Prisma.ClipWhereInput => ({
      AND: [base, stateWhere(filter, groups, revision)],
    });
    const direction = query.sort === 'newest' ? 'desc' : 'asc';

    const [rows, countList] = await Promise.all([
      prisma.clip.findMany({
        where: whereFor(query.status),
        orderBy: [{ createdAt: direction }, { id: direction }],
        skip: (query.page - 1) * CLIPS_PAGE_SIZE,
        take: CLIPS_PAGE_SIZE,
        select: listSelect(groups),
      }),
      Promise.all(
        CLIP_STATUS_FILTERS.map((filter) => prisma.clip.count({ where: whereFor(filter) })),
      ),
    ]);
    const counts = Object.fromEntries(
      CLIP_STATUS_FILTERS.map((filter, index) => [filter, countList[index] ?? 0]),
    ) as ClipCounts;

    const clips = await this.cards(orgId, rows);
    return {
      clips,
      counts,
      page: query.page,
      pageSize: CLIPS_PAGE_SIZE,
      total: counts[query.status],
    };
  }

  /**
   * Module 17, Coming Up: the waiting posts in the next 14 days that use a
   * clip, soonest first, at most five, with the total for "and N more".
   */
  async comingUp(orgId: string, now: Date = new Date()): Promise<ComingUpAnswer> {
    const [rows, exported] = await Promise.all([
      this.clipPosts.comingUpRows(orgId, now),
      // The panel is drawn once the workspace has an exported clip, and not before.
      prisma.clip.findFirst({
        where: { organizationId: orgId, exportedMediaId: { not: null }, status: { not: 'HIDDEN' } },
        select: { id: true },
      }),
    ]);
    const anyExported = exported !== null;
    const shown = rows.slice(0, COMING_UP_LIMIT);
    if (shown.length === 0) return { items: [], total: 0, anyExported };
    const groups = await waitingPostGroups(orgId);
    const clipRows = await prisma.clip.findMany({
      where: { organizationId: orgId, id: { in: [...new Set(shown.map((row) => row.clipId))] } },
      select: listSelect(groups),
    });
    const cards = new Map((await this.cards(orgId, clipRows)).map((card) => [card.id, card]));
    const items = shown.flatMap((row): ComingUpItem[] => {
      const card = cards.get(row.clipId);
      if (!card) return [];
      return [
        {
          group: row.group,
          publishDate: row.publishDate.toISOString(),
          channels: row.channels,
          clip: {
            id: card.id,
            title: card.title,
            ratio: card.ratio,
            durationMs: card.durationMs,
            videoId: card.videoId,
            poster: card.poster,
          },
        },
      ];
    });
    return { items, total: rows.length, anyExported };
  }

  private async cards(orgId: string, rows: ListRow[]): Promise<ClipListItem[]> {
    const readyVideos = [
      ...new Set(
        rows
          .filter((row) => row.video.deletedAt === null && row.video.status === 'READY')
          .map((row) => row.videoId),
      ),
    ];
    const assets =
      readyVideos.length > 0
        ? await prisma.clipAsset.findMany({
            where: {
              organizationId: orgId,
              videoId: { in: readyVideos },
              kind: { in: CARD_ASSET_KINDS },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        : [];

    const files = new Map<string, CardFiles>();
    for (const videoId of readyVideos) {
      const own = assets.filter((asset) => asset.videoId === videoId);
      files.set(videoId, {
        proxy: latestAsset(own, 'PROXY'),
        sheets: orderedSheets(own),
        poster: latestAsset(own, 'POSTER'),
      });
    }

    const sign = signOnce((key) => this.playback.address(key));
    const ids = rows.map((row) => row.id);
    const exportedIds = [
      ...new Set(rows.flatMap((row) => (row.exportedMediaId ? [row.exportedMediaId] : []))),
    ];
    const [exporting, published, exportedFiles] = await Promise.all([
      exportProgressOf(orgId, ids),
      this.clipPosts.publishedPostsOf(orgId, ids),
      exportedIds.length > 0
        ? prisma.media.findMany({
            where: { organizationId: orgId, id: { in: exportedIds }, deletedAt: null },
            select: { id: true, createdAt: true },
          })
        : Promise.resolve([] as { id: string; createdAt: Date }[]),
    ]);
    const exportedAt = new Map(
      exportedFiles.map((file) => [file.id, file.createdAt.toISOString()]),
    );
    return Promise.all(
      rows.map(async (row) => {
        const summary = toClipSummary(row, row.posts.length > 0, exporting.get(row.id) ?? null);
        const own = files.get(row.videoId) ?? null;
        const [poster, preview] = own
          ? await Promise.all([
              posterFor(own, summary.range?.fromMs ?? 0, sign),
              previewFor(own, summary.range, sign),
            ])
          : [null, null];
        return {
          ...summary,
          videoId: row.videoId,
          videoTitle: row.video.title,
          platform: platformOf(row.video.platform),
          poster,
          preview,
          posts: published.get(row.id) ?? [],
          recipeId: recipeIdOf(row.document),
          exportedAt: row.exportedMediaId ? (exportedAt.get(row.exportedMediaId) ?? null) : null,
        };
      }),
    );
  }
}

/** The filmstrip tile nearest `atMs`, else the video's poster picture, else null. */
async function posterFor(files: CardFiles, atMs: number, sign: Signer): Promise<ClipPoster | null> {
  const meta = files.sheets[0] ? filmstripMetaOf(files.sheets[0].meta) : null;
  const box = meta ? filmstripPosterBox(meta, atMs) : null;
  const sheet = box ? files.sheets[box.sheet] : undefined;
  if (box && sheet) {
    const address = await sign(sheet.key);
    if (address) {
      const { sheet: _index, ...rest } = box;
      return { url: address.url, ...rest };
    }
  }

  const posterMeta = files.poster ? posterMetaOf(files.poster.meta) : null;
  if (!files.poster || !posterMeta) return null;
  const address = await sign(files.poster.key);
  return address ? wholePoster(address.url, posterMeta) : null;
}

async function previewFor(
  files: CardFiles,
  range: ClipSummaryView['range'],
  sign: Signer,
): Promise<ClipPreview | null> {
  if (!files.proxy || !range) return null;
  const address = await sign(files.proxy.key);
  return address
    ? { url: address.url, fromMs: range.fromMs, toMs: range.toMs, expiresAt: address.expiresAt }
    : null;
}

/** The document's `recipeId` when it is a short id; anything else reads as none. */
function recipeIdOf(document: unknown): string | null {
  if (!document || typeof document !== 'object') return null;
  const value = (document as { recipeId?: unknown }).recipeId;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}
