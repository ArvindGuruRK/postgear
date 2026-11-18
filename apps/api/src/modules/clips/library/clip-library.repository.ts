/**
 * The shared library's rows (Module 12 stickers, Module 14 sounds). The library is shared by
 * every workspace, so its rows are read by id; a workspace's favourites and
 * its misses are what is per workspace (misses are per word, for growth).
 *
 * Search runs on the generated `search` tsvector ('simple' configuration:
 * name A, tags B, category C) through `to_tsquery` on words cleaned to
 * letters and digits, the last one a prefix (see `stickerTsQuery`), and
 * always adds `status = 'ACTIVE'`. Sounds search the same way on their own
 * table.
 */
import { Injectable } from '@nestjs/common';
import { type ClipLibrarySource, Prisma, prisma } from '@postgear/db';
import type {
  SoundCategory,
  SoundKind,
  StickerCategory,
  StickerKind,
} from '@postgear/video-engine';

/** At most this many words of a search count. */
export const LIBRARY_SEARCH_WORDS = 6;

/**
 * A search as a `to_tsquery` string: lowercased words of letters and digits
 * only (so no operator can be typed in), joined with `&`, the last one a
 * prefix so "fir" finds "fire" while typing. Null for a search with no word.
 */
export function stickerTsQuery(q: string | undefined): string | null {
  const words = (q ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => word.slice(0, 40));
  const unique = [...new Set(words)].slice(0, LIBRARY_SEARCH_WORDS);
  if (unique.length === 0) return null;
  return unique.map((word, k) => (k === unique.length - 1 ? `${word}:*` : word)).join(' & ');
}

/** The words a miss is counted under: the cleaned search, as typed order. */
export function missTerm(q: string): string {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .slice(0, LIBRARY_SEARCH_WORDS)
    .join(' ')
    .slice(0, 80);
}

export interface StickerRow {
  id: string;
  name: string;
  kind: 'STATIC' | 'ANIMATED';
  category: string;
  tags: string[];
  width: number;
  height: number;
  durationMs: number | null;
  fps: number | null;
  frames: number | null;
  fileKey: string;
  previewKey: string | null;
  status: 'STAGED' | 'ACTIVE' | 'HIDDEN' | 'REMOVED';
  requiresCredit: boolean;
  creditLine: string | null;
  sourceUrl: string;
  isFavourite: boolean;
}

export interface StickerSearchFilter {
  tsQuery: string | null;
  kind?: StickerKind;
  category?: StickerCategory;
  favouritesOnly: boolean;
  limit: number;
  offset: number;
}

const KIND_ENUM = { static: 'STATIC', animated: 'ANIMATED' } as const;

/** One sound row as a search and a lookup read it (Module 14). */
export interface SoundRow {
  id: string;
  name: string;
  kind: 'SFX' | 'MUSIC';
  category: string;
  tags: string[];
  durationMs: number;
  bpm: number | null;
  peaks: unknown;
  fileKey: string;
  status: 'STAGED' | 'ACTIVE' | 'HIDDEN' | 'REMOVED';
  licence: string;
  licenceUrl: string;
  author: string;
  sourceUrl: string;
  sourceName: string;
  isFavourite: boolean;
}

export interface SoundSearchFilter {
  tsQuery: string | null;
  kind?: SoundKind;
  category?: SoundCategory;
  favouritesOnly: boolean;
  limit: number;
  offset: number;
}

const SOUND_KIND_ENUM = { sfx: 'SFX', music: 'MUSIC' } as const;

/** What a sound search and lookup select. */
const SOUND_COLUMNS = Prisma.sql`
  s.id, s.name, s.kind::text AS kind, s.category, s.tags, s."durationMs", s.bpm, s.peaks,
  s."fileKey", s.status::text AS status, s.licence, s."licenceUrl", s.author, s."sourceUrl",
  src.name AS "sourceName", (f.id IS NOT NULL) AS "isFavourite"`;

@Injectable()
export class ClipLibraryRepository {
  /** One page of ACTIVE stickers and the total, best match first (newest favourite first on Favourites). */
  async search(
    orgId: string,
    filter: StickerSearchFilter,
  ): Promise<{ rows: StickerRow[]; total: number }> {
    const where: Prisma.Sql[] = [Prisma.sql`s.status = 'ACTIVE'::"ClipLibraryStatus"`];
    if (filter.kind) where.push(Prisma.sql`s.kind = ${KIND_ENUM[filter.kind]}::"ClipStickerKind"`);
    if (filter.category) where.push(Prisma.sql`s.category = ${filter.category}`);
    if (filter.tsQuery) where.push(Prisma.sql`s.search @@ to_tsquery('simple', ${filter.tsQuery})`);
    if (filter.favouritesOnly) where.push(Prisma.sql`f.id IS NOT NULL`);
    const conditions = Prisma.join(where, ' AND ');
    const rank = filter.tsQuery
      ? Prisma.sql`ts_rank_cd(s.search, to_tsquery('simple', ${filter.tsQuery}))`
      : Prisma.sql`0`;
    const order = filter.favouritesOnly
      ? Prisma.sql`f."createdAt" DESC, s.id ASC`
      : Prisma.sql`rank DESC, s.featured DESC, s.name ASC, s.id ASC`;
    const from = Prisma.sql`
      FROM "ClipSticker" s
      JOIN "ClipLibrarySource" src ON src.id = s."sourceId"
      LEFT JOIN "ClipFavourite" f ON f."stickerId" = s.id AND f."organizationId" = ${orgId}`;

    const [rows, counted] = await Promise.all([
      prisma.$queryRaw<StickerRow[]>`
        SELECT s.id, s.name, s.kind::text AS kind, s.category, s.tags, s.width, s.height,
               s."durationMs", s.fps, s.frames, s."fileKey", s."previewKey", s.status::text AS status,
               src."requiresCredit", src."creditLine", src.url AS "sourceUrl",
               (f.id IS NOT NULL) AS "isFavourite", ${rank} AS rank
        ${from}
        WHERE ${conditions}
        ORDER BY ${order}
        LIMIT ${filter.limit} OFFSET ${filter.offset}`,
      prisma.$queryRaw<
        Array<{ total: number }>
      >`SELECT count(*)::int AS total ${from} WHERE ${conditions}`,
    ]);
    return { rows, total: counted[0]?.total ?? 0 };
  }

  /** ACTIVE stickers a category, optionally of one kind. */
  async categoryCounts(kind?: StickerKind): Promise<Array<{ category: string; count: number }>> {
    const groups = await prisma.clipSticker.groupBy({
      by: ['category'],
      where: { status: 'ACTIVE', ...(kind ? { kind: KIND_ENUM[kind] } : {}) },
      _count: { _all: true },
    });
    return groups.map((group) => ({ category: group.category, count: group._count._all }));
  }

  /** A search that found nothing, counted per word so the catalogue can grow where people look. */
  async recordMiss(term: string, kind: 'sticker' | 'sound' = 'sticker'): Promise<void> {
    await prisma.clipLibraryMiss.upsert({
      where: { term_kind: { term, kind } },
      create: { term, kind },
      update: { count: { increment: 1 } },
    });
  }

  /** Stickers by id, with their source's credit, for a clip that already has them (ACTIVE or HIDDEN). */
  async stickersByIds(orgId: string, ids: string[]): Promise<StickerRow[]> {
    if (ids.length === 0) return [];
    return prisma.$queryRaw<StickerRow[]>`
      SELECT s.id, s.name, s.kind::text AS kind, s.category, s.tags, s.width, s.height,
             s."durationMs", s.fps, s.frames, s."fileKey", s."previewKey", s.status::text AS status,
             src."requiresCredit", src."creditLine", src.url AS "sourceUrl",
             (f.id IS NOT NULL) AS "isFavourite"
      FROM "ClipSticker" s
      JOIN "ClipLibrarySource" src ON src.id = s."sourceId"
      LEFT JOIN "ClipFavourite" f ON f."stickerId" = s.id AND f."organizationId" = ${orgId}
      WHERE s.id IN (${Prisma.join(ids)})
        AND s.status IN ('ACTIVE'::"ClipLibraryStatus", 'HIDDEN'::"ClipLibraryStatus")`;
  }

  async isActive(stickerId: string): Promise<boolean> {
    const row = await prisma.clipSticker.findFirst({
      where: { id: stickerId, status: 'ACTIVE' },
      select: { id: true },
    });
    return row !== null;
  }

  /** Idempotent: starring a starred sticker changes nothing. */
  async addFavourite(orgId: string, userId: string, stickerId: string): Promise<void> {
    await prisma.clipFavourite.upsert({
      where: { organizationId_stickerId: { organizationId: orgId, stickerId } },
      create: { organizationId: orgId, stickerId, createdById: userId },
      update: {},
    });
  }

  async removeFavourite(orgId: string, stickerId: string): Promise<void> {
    await prisma.clipFavourite.deleteMany({ where: { organizationId: orgId, stickerId } });
  }

  /** Every source with ACTIVE stickers or sounds, and how many of each. */
  async creditSources(): Promise<Array<ClipLibrarySource & { stickers: number; sounds: number }>> {
    const [stickerCounts, soundCounts] = await Promise.all([
      prisma.clipSticker.groupBy({
        by: ['sourceId'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
      prisma.clipSound.groupBy({
        by: ['sourceId'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);
    const stickers = new Map(stickerCounts.map((count) => [count.sourceId, count._count._all]));
    const sounds = new Map(soundCounts.map((count) => [count.sourceId, count._count._all]));
    const live = [...new Set([...stickers.keys(), ...sounds.keys()])].filter(
      (id) => (stickers.get(id) ?? 0) + (sounds.get(id) ?? 0) > 0,
    );
    if (live.length === 0) return [];
    const sources = await prisma.clipLibrarySource.findMany({
      where: { id: { in: live } },
      orderBy: { name: 'asc' },
    });
    return sources.map((source) => ({
      ...source,
      stickers: stickers.get(source.id) ?? 0,
      sounds: sounds.get(source.id) ?? 0,
    }));
  }

  // --- Sounds (Module 14) -----------------------------------------------------------

  /** One page of ACTIVE sounds and the total, best match first (newest favourite first on Favourites). */
  async searchSounds(
    orgId: string,
    filter: SoundSearchFilter,
  ): Promise<{ rows: SoundRow[]; total: number }> {
    const where: Prisma.Sql[] = [Prisma.sql`s.status = 'ACTIVE'::"ClipLibraryStatus"`];
    if (filter.kind)
      where.push(Prisma.sql`s.kind = ${SOUND_KIND_ENUM[filter.kind]}::"ClipSoundKind"`);
    if (filter.category) where.push(Prisma.sql`s.category = ${filter.category}`);
    if (filter.tsQuery) where.push(Prisma.sql`s.search @@ to_tsquery('simple', ${filter.tsQuery})`);
    if (filter.favouritesOnly) where.push(Prisma.sql`f.id IS NOT NULL`);
    const conditions = Prisma.join(where, ' AND ');
    const rank = filter.tsQuery
      ? Prisma.sql`ts_rank_cd(s.search, to_tsquery('simple', ${filter.tsQuery}))`
      : Prisma.sql`0`;
    const order = filter.favouritesOnly
      ? Prisma.sql`f."createdAt" DESC, s.id ASC`
      : Prisma.sql`rank DESC, s.featured DESC, s.name ASC, s.id ASC`;
    const from = Prisma.sql`
      FROM "ClipSound" s
      JOIN "ClipLibrarySource" src ON src.id = s."sourceId"
      LEFT JOIN "ClipFavourite" f ON f."soundId" = s.id AND f."organizationId" = ${orgId}`;

    const [rows, counted] = await Promise.all([
      prisma.$queryRaw<SoundRow[]>`
        SELECT ${SOUND_COLUMNS}, ${rank} AS rank
        ${from}
        WHERE ${conditions}
        ORDER BY ${order}
        LIMIT ${filter.limit} OFFSET ${filter.offset}`,
      prisma.$queryRaw<
        Array<{ total: number }>
      >`SELECT count(*)::int AS total ${from} WHERE ${conditions}`,
    ]);
    return { rows, total: counted[0]?.total ?? 0 };
  }

  /** ACTIVE sounds a category, optionally of one kind. */
  async soundCategoryCounts(kind?: SoundKind): Promise<Array<{ category: string; count: number }>> {
    const groups = await prisma.clipSound.groupBy({
      by: ['category'],
      where: { status: 'ACTIVE', ...(kind ? { kind: SOUND_KIND_ENUM[kind] } : {}) },
      _count: { _all: true },
    });
    return groups.map((group) => ({ category: group.category, count: group._count._all }));
  }

  /** Sounds by id for a clip that already has them: ACTIVE, HIDDEN and REMOVED (the caller tells them apart). */
  async soundsByIds(orgId: string, ids: string[]): Promise<SoundRow[]> {
    if (ids.length === 0) return [];
    return prisma.$queryRaw<SoundRow[]>`
      SELECT ${SOUND_COLUMNS}
      FROM "ClipSound" s
      JOIN "ClipLibrarySource" src ON src.id = s."sourceId"
      LEFT JOIN "ClipFavourite" f ON f."soundId" = s.id AND f."organizationId" = ${orgId}
      WHERE s.id IN (${Prisma.join(ids)})
        AND s.status IN ('ACTIVE'::"ClipLibraryStatus", 'HIDDEN'::"ClipLibraryStatus", 'REMOVED'::"ClipLibraryStatus")`;
  }

  async isSoundActive(soundId: string): Promise<boolean> {
    const row = await prisma.clipSound.findFirst({
      where: { id: soundId, status: 'ACTIVE' },
      select: { id: true },
    });
    return row !== null;
  }

  /** Idempotent: starring a starred sound changes nothing. */
  async addSoundFavourite(orgId: string, userId: string, soundId: string): Promise<void> {
    await prisma.clipFavourite.upsert({
      where: { organizationId_soundId: { organizationId: orgId, soundId } },
      create: { organizationId: orgId, soundId, createdById: userId },
      update: {},
    });
  }

  async removeSoundFavourite(orgId: string, soundId: string): Promise<void> {
    await prisma.clipFavourite.deleteMany({ where: { organizationId: orgId, soundId } });
  }
}
