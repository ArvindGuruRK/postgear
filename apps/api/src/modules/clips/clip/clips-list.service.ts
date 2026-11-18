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
}

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
  constructor(private readonly playback: ClipPlaybackService) {}

  async list(orgId: string, query: ListClipsQuery): Promise<ClipListPage> {
    const groups = await waitingPostGroups(orgId);
    const revision = prisma.clip.fields.revision;
    const base: Prisma.ClipWhereInput = {
      organizationId: orgId,
      ...(query.videoId ? { videoId: query.videoId } : {}),
      ...(query.source && query.source.length > 0
        ? { video: { platform: { in: query.source.map((source) => SOURCE_ENUM[source]) } } }
        : {}),
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
    return Promise.all(
      rows.map(async (row) => {
        const summary = toClipSummary(row, row.posts.length > 0);
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
