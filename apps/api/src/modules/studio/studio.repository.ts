/**
 * Every Studio row read and write, in one place.
 *
 * Three rules the whole module leans on:
 *
 * - **Nothing is fetched without `organizationId`.** Not "fetched then
 *   checked": the workspace is part of every `where`, so another workspace's
 *   design is a 404 by construction rather than by a branch somebody could
 *   forget. `studio.service.spec.ts` asserts it from the outside too.
 * - **The revision check is part of the write.** `updateDesign` matches on
 *   `{ id, organizationId, revision }` and reports how many rows it changed.
 *   Reading the revision and then writing would leave a window between the
 *   two in which the other tab's save lands; `updateMany` closes it in the
 *   database.
 * - **Writes name columns, not relations.** `updateMany` takes scalar fields
 *   only, so a link is written as its id (`brandKitId`, `logoMediaId`), and
 *   the write types below say so: a relation write here would compile and
 *   then fail on its first request.
 *
 * Deletes are soft (`deletedAt`), as everywhere else, and every list filters
 * on it.
 */
import { Injectable } from '@nestjs/common';
import {
  type BrandKit,
  type BrandKitSource,
  type Design,
  type DesignFormat,
  type DesignShare,
  type DesignStatus,
  Prisma,
  prisma,
} from '@postgear/db';

export type DesignRow = Design;
export type BrandKitRow = BrandKit;
export type DesignShareRow = DesignShare;

export type SharedDesignRow = DesignShareRow & {
  design: DesignRow & { organization: { name: string } };
};

export interface DesignFilters {
  format?: DesignFormat;
  status?: DesignStatus;
}

/** The columns an editor save may change. */
export interface DesignWrite {
  title?: string;
  document?: Prisma.InputJsonValue;
  format?: DesignFormat;
  presetId?: string;
  brandKitId?: string | null;
  lastSlideIndex?: number;
}

/** The columns a brand kit edit may change. */
export interface BrandKitWrite {
  name?: string;
  description?: string | null;
  websiteUrl?: string | null;
  logoMediaId?: string | null;
  colors?: Prisma.InputJsonValue;
  source?: BrandKitSource;
  headingFont?: string | null;
  bodyFont?: string | null;
  lockLook?: boolean;
  ctaText?: string | null;
  ctaUrl?: string | null;
}

/** Everything a new kit is made of: a created one, or a duplicate of another. */
export interface BrandKitCreate {
  orgId: string;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  logoMediaId: string | null;
  colors: Prisma.InputJsonValue;
  source: BrandKitSource;
  headingFont: string | null;
  bodyFont: string | null;
  lockLook: boolean;
  ctaText: string | null;
  ctaUrl: string | null;
  createdById: string | null;
}

/** A share link's `lastViewedAt` is written at most this often. */
const SHARE_VIEW_RESOLUTION_MS = 60_000;

@Injectable()
export class StudioRepository {
  // -------------------------------------------------------------------------
  // Designs
  // -------------------------------------------------------------------------

  async listDesigns(
    orgId: string,
    filters: DesignFilters,
    page: { skip: number; take: number },
  ): Promise<{ items: DesignRow[]; total: number }> {
    const where = designsWhere(orgId, filters);

    const [items, total] = await Promise.all([
      prisma.design.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
      prisma.design.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * The newest designs whose title contains `term`, for a search.
   *
   * The database narrows by the most selective word and the service checks
   * every word, the way the media and post searches do (`search-terms.ts`):
   * the same matching as everywhere else in the app, and a `%` or `_` typed
   * into the box cannot act as a wildcard, because the second check is exact.
   */
  searchDesigns(
    orgId: string,
    term: string,
    filters: DesignFilters,
    take: number,
  ): Promise<DesignRow[]> {
    return prisma.design.findMany({
      where: {
        ...designsWhere(orgId, filters),
        title: { contains: term, mode: 'insensitive' },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take,
    });
  }

  findDesign(orgId: string, id: string): Promise<DesignRow | null> {
    return prisma.design.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  createDesign(data: {
    orgId: string;
    title: string;
    format: DesignFormat;
    presetId: string;
    brandKitId: string | null;
    document: Prisma.InputJsonValue;
    createdById: string | null;
  }): Promise<DesignRow> {
    return prisma.design.create({
      data: {
        organizationId: data.orgId,
        title: data.title,
        format: data.format,
        presetId: data.presetId,
        brandKitId: data.brandKitId,
        document: data.document,
        createdById: data.createdById,
      },
    });
  }

  /**
   * Saves a design, but only against the revision the editor loaded.
   *
   * Returns the new row, or null when nothing matched. Null means one of two
   * things and the service tells them apart with one more read: the design
   * is gone, or somebody else saved first.
   */
  async updateDesign(
    orgId: string,
    id: string,
    expectedRevision: number,
    data: DesignWrite,
  ): Promise<DesignRow | null> {
    const result = await prisma.design.updateMany({
      where: { id, organizationId: orgId, deletedAt: null, revision: expectedRevision },
      data: { ...data, revision: { increment: 1 } },
    });

    if (result.count === 0) return null;

    return this.findDesign(orgId, id);
  }

  /**
   * Records a finished export without touching `revision`.
   *
   * An export is not an edit: bumping the revision would make the editor's
   * next autosave conflict with a save the user never made. `revision` here
   * is the one the pictures were drawn from, which is what lets Send tell a
   * current export from a stale one.
   */
  async recordExport(
    orgId: string,
    id: string,
    data: { mediaIds: string[]; revision: number; status: DesignStatus },
  ): Promise<DesignRow | null> {
    const result = await prisma.design.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: {
        exportedMediaIds: data.mediaIds,
        lastExportedRevision: data.revision,
        status: data.status,
      },
    });

    if (result.count === 0) return null;

    return this.findDesign(orgId, id);
  }

  async setDesignStatus(orgId: string, id: string, status: DesignStatus): Promise<void> {
    await prisma.design.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { status },
    });
  }

  async softDeleteDesign(orgId: string, id: string): Promise<boolean> {
    const result = await prisma.design.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    return result.count > 0;
  }

  // -------------------------------------------------------------------------
  // Brand kits
  // -------------------------------------------------------------------------

  listBrandKits(orgId: string): Promise<BrandKitRow[]> {
    return prisma.brandKit.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
  }

  findBrandKit(orgId: string, id: string): Promise<BrandKitRow | null> {
    return prisma.brandKit.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  /**
   * Whether a kit id was ever this workspace's, live or deleted.
   *
   * A design keeps naming the kit it was made with after that kit is deleted
   * (the editor says "This brand kit was deleted."), so a save naming a
   * deleted kit is ordinary; one naming a kit this workspace never had is a
   * crafted request, and the service records it.
   */
  async brandKitState(orgId: string, id: string): Promise<'live' | 'deleted' | 'unknown'> {
    const row = await prisma.brandKit.findFirst({
      where: { id, organizationId: orgId },
      select: { deletedAt: true },
    });

    if (!row) return 'unknown';
    return row.deletedAt ? 'deleted' : 'live';
  }

  createBrandKit(data: BrandKitCreate): Promise<BrandKitRow> {
    return prisma.brandKit.create({
      data: {
        organizationId: data.orgId,
        name: data.name,
        description: data.description,
        websiteUrl: data.websiteUrl,
        logoMediaId: data.logoMediaId,
        colors: data.colors,
        source: data.source,
        headingFont: data.headingFont,
        bodyFont: data.bodyFont,
        lockLook: data.lockLook,
        ctaText: data.ctaText,
        ctaUrl: data.ctaUrl,
        createdById: data.createdById,
      },
    });
  }

  /**
   * The names of live kits, by id, for the design cards (Sprint 9b). One
   * query for a whole page of cards; a kit deleted meanwhile is simply
   * absent, and its card shows no kit.
   */
  async brandKitNames(orgId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();

    const rows = await prisma.brandKit.findMany({
      where: { id: { in: [...new Set(ids)] }, organizationId: orgId, deletedAt: null },
      select: { id: true, name: true },
    });

    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async updateBrandKit(
    orgId: string,
    id: string,
    data: BrandKitWrite,
  ): Promise<BrandKitRow | null> {
    const result = await prisma.brandKit.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data,
    });

    if (result.count === 0) return null;

    return this.findBrandKit(orgId, id);
  }

  /**
   * Soft-deletes a kit and unlinks the designs that pointed at it.
   *
   * The designs keep their colours and logo, because those were copied into
   * each document when the kit was applied, and each document still names
   * the kit, which is how the editor knows to say "This brand kit was
   * deleted." Only the row's link goes.
   *
   * In SQL rather than `updateMany`, which would stamp each design's
   * `updatedAt`: losing the link is not an edit, and Recent Designs is
   * ordered by the last change a person made ("Updated just now" on designs
   * nobody touched, moved to the top).
   */
  async softDeleteBrandKit(orgId: string, id: string): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const deleted = await tx.brandKit.updateMany({
        where: { id, organizationId: orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      if (deleted.count === 0) return false;

      await tx.$executeRaw`
        UPDATE "Design" SET "brandKitId" = NULL
        WHERE "organizationId" = ${orgId} AND "brandKitId" = ${id}
      `;

      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Favourites
  // -------------------------------------------------------------------------

  async listFavourites(orgId: string): Promise<string[]> {
    const rows = await prisma.designFavourite.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
      select: { presetId: true },
    });

    return rows.map((row) => row.presetId);
  }

  /** Idempotent: a second add, even a simultaneous one from another tab, is a no-op. */
  async addFavourite(orgId: string, presetId: string, userId: string | null): Promise<void> {
    try {
      await prisma.designFavourite.upsert({
        where: { organizationId_presetId: { organizationId: orgId, presetId } },
        create: { organizationId: orgId, presetId, createdById: userId },
        update: {},
      });
    } catch (error) {
      // Two upserts racing both miss the row and both insert; the loser's
      // unique violation means the favourite exists, which is what was asked.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  async removeFavourite(orgId: string, presetId: string): Promise<void> {
    await prisma.designFavourite.deleteMany({
      where: { organizationId: orgId, presetId },
    });
  }

  // -------------------------------------------------------------------------
  // Shares
  // -------------------------------------------------------------------------

  /** The links that still work: not revoked, not expired. */
  listActiveShares(orgId: string, designId: string, now: Date): Promise<DesignShareRow[]> {
    return prisma.designShare.findMany({
      where: {
        designId,
        revokedAt: null,
        expiresAt: { gt: now },
        design: { organizationId: orgId, deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  countActiveShares(designId: string, now: Date): Promise<number> {
    return prisma.designShare.count({
      where: { designId, revokedAt: null, expiresAt: { gt: now } },
    });
  }

  createShare(data: {
    designId: string;
    tokenHash: string;
    expiresAt: Date;
    createdById: string | null;
  }): Promise<DesignShareRow> {
    return prisma.designShare.create({ data });
  }

  async revokeShare(orgId: string, designId: string, shareId: string): Promise<boolean> {
    const result = await prisma.designShare.updateMany({
      where: {
        id: shareId,
        designId,
        revokedAt: null,
        design: { organizationId: orgId, deletedAt: null },
      },
      data: { revokedAt: new Date() },
    });

    return result.count > 0;
  }

  /**
   * Resolves a share token's hash to its link and design.
   *
   * Looked up by hash, never by the token: the token is not stored. Expiry,
   * revocation and deletion are checked by the service so the public route
   * can answer with one sentence whichever it was.
   */
  findShareByHash(tokenHash: string): Promise<SharedDesignRow | null> {
    return prisma.designShare.findUnique({
      where: { tokenHash },
      include: { design: { include: { organization: { select: { name: true } } } } },
    });
  }

  /**
   * Notes that a link was opened, at most once a minute: a share page left
   * open and refreshed must not turn into a write per request.
   */
  async touchShare(id: string, now: Date): Promise<void> {
    await prisma.designShare.updateMany({
      where: {
        id,
        OR: [
          { lastViewedAt: null },
          { lastViewedAt: { lt: new Date(now.getTime() - SHARE_VIEW_RESOLUTION_MS) } },
        ],
      },
      data: { lastViewedAt: now },
    });
  }
}

function designsWhere(orgId: string, filters: DesignFilters): Prisma.DesignWhereInput {
  return {
    organizationId: orgId,
    deletedAt: null,
    ...(filters.format ? { format: filters.format } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
