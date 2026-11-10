/**
 * Persistence for the competitors a workspace follows (Module 07), and the only
 * reader and writer of the `Competitor` table.
 *
 * Every `where` carries the workspace and `deletedAt: null`, so another
 * workspace's row and a removed row are the same thing to a caller: not there.
 *
 * ## The cap is counted and inserted in one transaction
 *
 * A workspace follows 20 at most. Counting and then inserting in two steps lets
 * two people add the twentieth at the same moment and both get in. So the count
 * and the insert run in one serializable transaction: Postgres aborts one of two
 * that race, the retry counts again, and it sees the other's row.
 *
 * Nothing a competitor publishes is ever written here. `lastError` is one
 * sentence the service wrote, and `noteCheck` is the only way it gets in.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaTransactionClient, prisma } from '@postgear/db';

export interface CompetitorRow {
  id: string;
  name: string;
  websiteUrl: string | null;
  feedUrls: string[];
  youtubeChannelId: string | null;
  blueskyHandle: string | null;
  mastodonAcct: string | null;
  newsQuery: string | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Everything a person can set on a competitor. */
export interface CompetitorWrite {
  name: string;
  websiteUrl: string | null;
  feedUrls: string[];
  youtubeChannelId: string | null;
  blueskyHandle: string | null;
  mastodonAcct: string | null;
  newsQuery: string | null;
}

export type CreateOutcome = { outcome: 'created'; row: CompetitorRow } | { outcome: 'limit' };

const COMPETITOR_SELECT = {
  id: true,
  name: true,
  websiteUrl: true,
  feedUrls: true,
  youtubeChannelId: true,
  blueskyHandle: true,
  mastodonAcct: true,
  newsQuery: true,
  lastCheckedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 25;

/** Column by column, so nothing that is not a settable column can ride along. */
function columnsOf(write: Partial<CompetitorWrite>) {
  return {
    name: write.name,
    websiteUrl: write.websiteUrl,
    feedUrls: write.feedUrls,
    youtubeChannelId: write.youtubeChannelId,
    blueskyHandle: write.blueskyHandle,
    mastodonAcct: write.mastodonAcct,
    newsQuery: write.newsQuery,
  };
}

/**
 * Runs `work` in a serializable transaction, retrying when Postgres aborts it to
 * keep a concurrent one serializable (P2034). The retry reads again, so the loser
 * of a race for the last place sees the winner's row.
 */
async function serializable<T>(work: (tx: PrismaTransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, SERIALIZABLE);
    } catch (error) {
      const aborted =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!aborted || attempt >= ATTEMPTS) throw error;

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
}

@Injectable()
export class CompetitorsRepository {
  /** Oldest first, so a new one lands at the end of the tab and nothing above it moves. */
  async list(orgId: string): Promise<CompetitorRow[]> {
    return prisma.competitor.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: COMPETITOR_SELECT,
    });
  }

  async count(orgId: string): Promise<number> {
    return prisma.competitor.count({ where: { organizationId: orgId, deletedAt: null } });
  }

  async find(orgId: string, id: string): Promise<CompetitorRow | null> {
    return prisma.competitor.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: COMPETITOR_SELECT,
    });
  }

  /** Adds one unless the workspace already follows `limit`. */
  async create(
    orgId: string,
    userId: string | null,
    write: CompetitorWrite,
    limit: number,
  ): Promise<CreateOutcome> {
    return serializable(async (tx): Promise<CreateOutcome> => {
      const live = await tx.competitor.count({ where: { organizationId: orgId, deletedAt: null } });
      if (live >= limit) return { outcome: 'limit' };

      const row = await tx.competitor.create({
        // The name by itself: a row cannot be made without one, and the type says so.
        data: { organizationId: orgId, createdById: userId, ...columnsOf(write), name: write.name },
        select: COMPETITOR_SELECT,
      });
      return { outcome: 'created', row };
    });
  }

  /** Changes the columns given and leaves the rest. Null when the row is not this workspace's, or is gone. */
  async update(
    orgId: string,
    id: string,
    write: Partial<CompetitorWrite>,
  ): Promise<CompetitorRow | null> {
    const changed = await prisma.competitor.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: columnsOf(write),
    });
    return changed.count === 0 ? null : this.find(orgId, id);
  }

  /** A soft delete. False when there was nothing of this workspace's to remove. */
  async softDelete(orgId: string, id: string): Promise<boolean> {
    const removed = await prisma.competitor.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return removed.count > 0;
  }

  /** When its items were last read, and the one sentence about what went wrong, or null. */
  async noteCheck(
    orgId: string,
    id: string,
    note: { lastCheckedAt: Date; lastError: string | null },
  ): Promise<void> {
    await prisma.competitor.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { lastCheckedAt: note.lastCheckedAt, lastError: note.lastError },
    });
  }
}
