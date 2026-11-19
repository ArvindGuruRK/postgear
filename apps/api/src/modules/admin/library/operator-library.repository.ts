/**
 * The rows the operator's Library screen reads and changes (Sprint 12,
 * Module 19 section 9): ingest runs, stickers and sounds in every status,
 * the deny list, the searches that found nothing, and the credit sources.
 *
 * The product's own reads (`ClipLibraryRepository`) always add
 * `status = 'ACTIVE'`; these do not, since an operator looks after staged,
 * hidden and removed items too. A table name is never built from input: the
 * two item tables are picked from a fixed map.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type ClipLibrarySource, Prisma, prisma } from '@postgear/db';
import type { LibraryItemType } from '@postgear/video-engine';
import type { LibraryStatus } from './operator-library.schema';

/** At most this many runs, deny rows and gaps a list answers. */
export const RUNS_LISTED = 100;
export const DENY_LISTED = 200;
export const MISSES_LISTED = 50;

export interface StatusCounts {
  staged: number;
  active: number;
  hidden: number;
  removed: number;
}

export interface RunRow {
  id: string;
  origin: string;
  args: unknown;
  startedAt: Date;
  finishedAt: Date | null;
  accepted: number;
  rejected: number;
  rejectionsByReason: unknown;
  reportKey: string | null;
  stickers: StatusCounts;
  sounds: StatusCounts;
}

/** One item as the list shows it. */
export interface ItemListRow {
  id: string;
  name: string;
  kind: string;
  category: string;
  status: LibraryStatus;
  licence: string;
  author: string;
  authorUrl: string | null;
  sourceUrl: string;
  origin: string;
  runId: string;
  fileKey: string;
  previewKey: string | null;
  durationMs: number | null;
  createdAt: Date;
  statusAt: Date | null;
  statusReason: string | null;
  sourceId: string;
  sourceName: string;
}

export interface ItemListFilter {
  type: LibraryItemType;
  status?: LibraryStatus;
  kind?: string;
  category?: string;
  origin?: string;
  tsQuery: string | null;
  runId?: string;
  limit: number;
  offset: number;
}

/** One item with everything its dialog shows and every rule needs. */
export interface ItemDetailRow {
  id: string;
  name: string;
  kind: string;
  category: string;
  tags: string[];
  status: LibraryStatus;
  statusReason: string | null;
  statusById: string | null;
  statusAt: Date | null;
  licence: string;
  licenceUrl: string;
  author: string;
  authorUrl: string | null;
  origin: string;
  originId: string | null;
  sourceUrl: string;
  originalWork: boolean;
  retrievedAt: Date;
  sourceChecksum: string;
  runId: string;
  fileKey: string;
  previewKey: string | null;
  bytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
  source: Pick<
    ClipLibrarySource,
    'id' | 'code' | 'name' | 'licence' | 'requiresCredit' | 'creditLine'
  >;
}

/** A staged item of a run, with what the publish rules read. */
export interface StagedItemRow {
  type: LibraryItemType;
  id: string;
  name: string;
  licence: string;
  origin: string;
  requiresCredit: boolean;
  creditLine: string | null;
}

export interface SourceRow extends ClipLibrarySource {
  stickers: StatusCounts;
  sounds: StatusCounts;
}

const TABLES = {
  sticker: Prisma.raw('"ClipSticker"'),
  sound: Prisma.raw('"ClipSound"'),
} as const;

const KIND_SQL: Record<string, Prisma.Sql> = {
  static: Prisma.sql`s.kind = 'STATIC'::"ClipStickerKind"`,
  animated: Prisma.sql`s.kind = 'ANIMATED'::"ClipStickerKind"`,
  sfx: Prisma.sql`s.kind = 'SFX'::"ClipSoundKind"`,
  music: Prisma.sql`s.kind = 'MUSIC'::"ClipSoundKind"`,
};

const SOURCE_SELECT = {
  id: true,
  code: true,
  name: true,
  licence: true,
  requiresCredit: true,
  creditLine: true,
} as const;

function emptyCounts(): StatusCounts {
  return { staged: 0, active: 0, hidden: 0, removed: 0 };
}

/** Folds `groupBy` rows of (key, status, count) into counts per key. */
function countsBy<K extends string>(
  rows: Array<{ status: string; _count: { _all: number } } & Record<K, string>>,
  key: K,
): Map<string, StatusCounts> {
  const out = new Map<string, StatusCounts>();
  for (const row of rows) {
    const counts = out.get(row[key]) ?? emptyCounts();
    const field = row.status.toLowerCase() as keyof StatusCounts;
    if (field in counts) counts[field] += row._count._all;
    out.set(row[key], counts);
  }
  return out;
}

@Injectable()
export class OperatorLibraryRepository {
  /** The newest runs, with how many of their items sit in each status. */
  async runs(): Promise<RunRow[]> {
    const runs = await prisma.clipLibraryRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: RUNS_LISTED,
    });
    return this.withCounts(runs);
  }

  async run(id: string): Promise<RunRow | null> {
    const run = await prisma.clipLibraryRun.findUnique({ where: { id } });
    if (!run) return null;
    const [counted] = await this.withCounts([run]);
    return counted ?? null;
  }

  /** A run's STAGED items with their source's credit facts, both tables asked. */
  async stagedItemsOf(runId: string): Promise<StagedItemRow[]> {
    const select = {
      id: true,
      name: true,
      licence: true,
      origin: true,
      source: { select: { requiresCredit: true, creditLine: true } },
    } as const;
    const where = { runId, status: 'STAGED' as const };
    const [stickers, sounds] = await Promise.all([
      prisma.clipSticker.findMany({ where, select, orderBy: { name: 'asc' } }),
      prisma.clipSound.findMany({ where, select, orderBy: { name: 'asc' } }),
    ]);
    const flatten = (type: LibraryItemType) => (row: (typeof stickers)[number]) => ({
      type,
      id: row.id,
      name: row.name,
      licence: row.licence,
      origin: row.origin,
      requiresCredit: row.source.requiresCredit,
      creditLine: row.source.creditLine,
    });
    return [...stickers.map(flatten('sticker')), ...sounds.map(flatten('sound'))];
  }

  /**
   * Moves the given STAGED items of a run to ACTIVE in one transaction and
   * answers how many moved (one already published elsewhere is skipped).
   */
  async publishRunItems(
    runId: string,
    ids: { sticker: string[]; sound: string[] },
    actorId: string,
  ): Promise<number> {
    const data = {
      status: 'ACTIVE' as const,
      statusAt: new Date(),
      statusById: actorId,
      statusReason: null,
    };
    const [stickers, sounds] = await prisma.$transaction([
      prisma.clipSticker.updateMany({
        where: { runId, status: 'STAGED', id: { in: ids.sticker } },
        data,
      }),
      prisma.clipSound.updateMany({
        where: { runId, status: 'STAGED', id: { in: ids.sound } },
        data,
      }),
    ]);
    return stickers.count + sounds.count;
  }

  /** One page of items in any status and the total, best match first when searched. */
  async items(filter: ItemListFilter): Promise<{ rows: ItemListRow[]; total: number }> {
    const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (filter.status) where.push(Prisma.sql`s.status = ${filter.status}::"ClipLibraryStatus"`);
    // A kind of the other type (a sticker kind on sounds) matches nothing.
    if (filter.kind) where.push(KIND_SQL[filter.kind] ?? Prisma.sql`FALSE`);
    if (filter.category) where.push(Prisma.sql`s.category = ${filter.category}`);
    if (filter.origin) where.push(Prisma.sql`s.origin = ${filter.origin}`);
    if (filter.runId) where.push(Prisma.sql`s."runId" = ${filter.runId}`);
    if (filter.tsQuery) where.push(Prisma.sql`s.search @@ to_tsquery('simple', ${filter.tsQuery})`);
    const conditions = Prisma.join(where, ' AND ');
    const rank = filter.tsQuery
      ? Prisma.sql`ts_rank_cd(s.search, to_tsquery('simple', ${filter.tsQuery}))`
      : Prisma.sql`0`;
    const from = Prisma.sql`
      FROM ${TABLES[filter.type]} s
      JOIN "ClipLibrarySource" src ON src.id = s."sourceId"`;
    const preview = filter.type === 'sticker' ? Prisma.sql`s."previewKey"` : Prisma.sql`NULL`;

    const [rows, counted] = await Promise.all([
      prisma.$queryRaw<ItemListRow[]>`
        SELECT s.id, s.name, s.kind::text AS kind, s.category, s.status::text AS status, s.licence,
               s.author, s."authorUrl", s."sourceUrl", s.origin, s."runId", s."fileKey",
               ${preview} AS "previewKey", s."durationMs", s."createdAt", s."statusAt",
               s."statusReason", src.id AS "sourceId", src.name AS "sourceName", ${rank} AS rank
        ${from}
        WHERE ${conditions}
        ORDER BY rank DESC, s."createdAt" DESC, s.name ASC, s.id ASC
        LIMIT ${filter.limit} OFFSET ${filter.offset}`,
      prisma.$queryRaw<Array<{ total: number }>>`
        SELECT count(*)::int AS total ${from} WHERE ${conditions}`,
    ]);
    return { rows, total: counted[0]?.total ?? 0 };
  }

  async item(type: LibraryItemType, id: string): Promise<ItemDetailRow | null> {
    if (type === 'sticker') {
      const row = await prisma.clipSticker.findUnique({
        where: { id },
        include: { source: { select: SOURCE_SELECT } },
      });
      if (!row) return null;
      return { ...row, kind: row.kind, status: row.status };
    }
    const row = await prisma.clipSound.findUnique({
      where: { id },
      include: { source: { select: SOURCE_SELECT } },
    });
    if (!row) return null;
    return {
      ...row,
      kind: row.kind,
      status: row.status,
      previewKey: null,
      width: null,
      height: null,
    };
  }

  /**
   * How many clips (not in the bin) place this item: a JSON containment over
   * clip documents, which reach a library item as
   * `tracks[].items[].ref = { library, id }`.
   */
  async usageCount(type: LibraryItemType, id: string): Promise<number> {
    const needle = JSON.stringify({ tracks: [{ items: [{ ref: { library: type, id } }] }] });
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM "Clip"
      WHERE "removedAt" IS NULL AND document @> ${needle}::jsonb`;
    return rows[0]?.count ?? 0;
  }

  /**
   * Moves one item between statuses when it is still in one of `from`;
   * answers false when it moved meanwhile (the caller reloads and decides).
   */
  async setStatus(
    type: LibraryItemType,
    id: string,
    from: LibraryStatus[],
    to: Exclude<LibraryStatus, 'REMOVED'>,
    reason: string | null,
    actorId: string,
  ): Promise<boolean> {
    const where = { id, status: { in: from } };
    const data = { status: to, statusReason: reason, statusById: actorId, statusAt: new Date() };
    const result =
      type === 'sticker'
        ? await prisma.clipSticker.updateMany({ where, data })
        : await prisma.clipSound.updateMany({ where, data });
    return result.count === 1;
  }

  /**
   * The removal's database half, in one transaction: the deny entry first
   * (by checksum and by origin id, so neither the same file nor the same
   * upstream item can be ingested again), then the row goes to REMOVED with
   * its evidence kept. The files are deleted by the caller after the commit.
   */
  async markRemoved(
    type: LibraryItemType,
    item: Pick<ItemDetailRow, 'id' | 'sourceChecksum' | 'origin' | 'originId'>,
    reason: string,
    actorId: string,
  ): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      // ON CONFLICT DO NOTHING: either key already denied means it stays denied.
      await tx.$executeRaw`
        INSERT INTO "ClipLibraryDeny" (id, "sourceChecksum", origin, "originId", reason, "createdAt")
        VALUES (${randomUUID()}, ${item.sourceChecksum}, ${item.origin}, ${item.originId}, ${reason}, now())
        ON CONFLICT DO NOTHING`;
      const where = { id: item.id, status: { not: 'REMOVED' as const } };
      const data = {
        status: 'REMOVED' as const,
        statusReason: reason,
        statusById: actorId,
        statusAt: new Date(),
      };
      const result =
        type === 'sticker'
          ? await tx.clipSticker.updateMany({ where, data })
          : await tx.clipSound.updateMany({ where, data });
      return result.count === 1;
    });
  }

  async deny() {
    return prisma.clipLibraryDeny.findMany({ orderBy: { createdAt: 'desc' }, take: DENY_LISTED });
  }

  async misses() {
    return prisma.clipLibraryMiss.findMany({
      orderBy: [{ count: 'desc' }, { lastAt: 'desc' }],
      take: MISSES_LISTED,
    });
  }

  /** Every source, with its stickers and sounds counted by status. */
  async sources(): Promise<SourceRow[]> {
    const [sources, stickerCounts, soundCounts] = await Promise.all([
      prisma.clipLibrarySource.findMany({ orderBy: { name: 'asc' } }),
      prisma.clipSticker.groupBy({ by: ['sourceId', 'status'], _count: { _all: true } }),
      prisma.clipSound.groupBy({ by: ['sourceId', 'status'], _count: { _all: true } }),
    ]);
    const stickers = countsBy(stickerCounts, 'sourceId');
    const sounds = countsBy(soundCounts, 'sourceId');
    return sources.map((source) => ({
      ...source,
      stickers: stickers.get(source.id) ?? emptyCounts(),
      sounds: sounds.get(source.id) ?? emptyCounts(),
    }));
  }

  async source(id: string): Promise<ClipLibrarySource | null> {
    return prisma.clipLibrarySource.findUnique({ where: { id } });
  }

  async updateSource(
    id: string,
    data: { creditLine?: string | null; changeNote?: string | null; noticeText?: string | null },
  ): Promise<ClipLibrarySource> {
    return prisma.clipLibrarySource.update({ where: { id }, data });
  }

  /** The addresses of the people who last changed items, for the item dialog. */
  async emailsOf(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });
    return new Map(users.map((user) => [user.id, user.email]));
  }

  private async withCounts(runs: Array<Omit<RunRow, 'stickers' | 'sounds'>>): Promise<RunRow[]> {
    if (runs.length === 0) return [];
    const runIds = runs.map((run) => run.id);
    const [stickerCounts, soundCounts] = await Promise.all([
      prisma.clipSticker.groupBy({
        by: ['runId', 'status'],
        where: { runId: { in: runIds } },
        _count: { _all: true },
      }),
      prisma.clipSound.groupBy({
        by: ['runId', 'status'],
        where: { runId: { in: runIds } },
        _count: { _all: true },
      }),
    ]);
    const stickers = countsBy(stickerCounts, 'runId');
    const sounds = countsBy(soundCounts, 'runId');
    return runs.map((run) => ({
      ...run,
      stickers: stickers.get(run.id) ?? emptyCounts(),
      sounds: sounds.get(run.id) ?? emptyCounts(),
    }));
  }
}
