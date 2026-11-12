/**
 * Saved Ideas (Sprint 11 Module 10): the only thing that touches `DiscoverIdea`.
 *
 * Every query is scoped on the workspace, so an id from another workspace is
 * the same as one that never existed. Saving is idempotent on the feed's item
 * id: saving a card twice keeps the first copy and its note, and answers it.
 * The limit is counted inside a serializable transaction, so two saves at once
 * cannot both take the last place.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaTransactionClient, prisma } from '@postgear/db';

export interface IdeaRow {
  id: string;
  itemId: string;
  item: Prisma.JsonValue;
  place: Prisma.JsonValue;
  language: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; name: string | null } | null;
}

export interface IdeaWrite {
  itemId: string;
  item: Prisma.InputJsonValue;
  place: Prisma.InputJsonValue;
  language: string;
  note: string | null;
}

export type SaveOutcome = { outcome: 'saved' | 'existing'; row: IdeaRow } | { outcome: 'limit' };

const IDEA_SELECT = {
  id: true,
  itemId: true,
  item: true,
  place: true,
  language: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 25;

async function serializable<T>(work: (tx: PrismaTransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, SERIALIZABLE);
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2002');
      if (!retryable || attempt >= ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
}

@Injectable()
export class DiscoverIdeasRepository {
  /** Newest first: what was saved last is what the team is thinking about. */
  list(orgId: string, limit: number): Promise<IdeaRow[]> {
    return prisma.discoverIdea.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: IDEA_SELECT,
    });
  }

  /** Just the item ids, for the bookmark marks on the feed's cards. */
  async savedItemIds(orgId: string): Promise<string[]> {
    const rows = await prisma.discoverIdea.findMany({
      where: { organizationId: orgId },
      select: { itemId: true },
    });
    return rows.map((row) => row.itemId);
  }

  async save(
    orgId: string,
    userId: string | null,
    write: IdeaWrite,
    limit: number,
  ): Promise<SaveOutcome> {
    return serializable(async (tx): Promise<SaveOutcome> => {
      const existing = await tx.discoverIdea.findUnique({
        where: { organizationId_itemId: { organizationId: orgId, itemId: write.itemId } },
        select: IDEA_SELECT,
      });
      if (existing) return { outcome: 'existing', row: existing };

      const count = await tx.discoverIdea.count({ where: { organizationId: orgId } });
      if (count >= limit) return { outcome: 'limit' };

      const row = await tx.discoverIdea.create({
        data: {
          organizationId: orgId,
          createdById: userId,
          itemId: write.itemId,
          item: write.item,
          place: write.place,
          language: write.language,
          note: write.note,
        },
        select: IDEA_SELECT,
      });
      return { outcome: 'saved', row };
    });
  }

  /** Null when the idea is not this workspace's. */
  async updateNote(orgId: string, id: string, note: string | null): Promise<IdeaRow | null> {
    const changed = await prisma.discoverIdea.updateMany({
      where: { id, organizationId: orgId },
      data: { note },
    });
    if (changed.count === 0) return null;
    return prisma.discoverIdea.findFirst({
      where: { id, organizationId: orgId },
      select: IDEA_SELECT,
    });
  }

  /** False when there was nothing of this workspace's to remove. */
  async remove(orgId: string, id: string): Promise<boolean> {
    const removed = await prisma.discoverIdea.deleteMany({ where: { id, organizationId: orgId } });
    return removed.count > 0;
  }
}
