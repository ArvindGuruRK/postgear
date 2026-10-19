/**
 * Persistence for post tags, and the only writer of the `Tags` table.
 *
 * Every read filters `deletedAt: null`; every `where` carries the workspace.
 * A deleted tag stays in the table (its `TagsPosts` links still point at it),
 * which is why "deleted" has to mean invisible everywhere a tag is read,
 * including the posts repository's join.
 *
 * ## Why the writes are serializable
 *
 * "No two live tags share a name" is a rule about *other* rows, checked by
 * reading them first. Under read committed, two creates of "Launch" could
 * both read "no such tag" and both insert. Serializable makes Postgres abort
 * one of them instead, and the retry then sees the other's tag. The same goes
 * for the per-workspace cap.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaTransactionClient, prisma } from '@postgear/db';

export interface TagRow {
  id: string;
  name: string;
  color: string;
}

export type CreateTagOutcome =
  | { outcome: 'created'; tag: TagRow }
  | { outcome: 'name_taken' }
  | { outcome: 'too_many' };

export type UpdateTagOutcome =
  | { outcome: 'updated'; tag: TagRow }
  | { outcome: 'not_found' }
  | { outcome: 'name_taken' };

const TAG_SELECT = { id: true, name: true, color: true } as const;

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 50;

@Injectable()
export class TagsRepository {
  /** The workspace's live tags, alphabetically. */
  async list(orgId: string): Promise<TagRow[]> {
    return prisma.tags.findMany({
      where: { orgId, deletedAt: null },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: TAG_SELECT,
    });
  }

  /** Which of `ids` are live tags of this workspace. Unknown, foreign and deleted ids are simply absent. */
  async findLive(orgId: string, ids: string[]): Promise<TagRow[]> {
    if (ids.length === 0) {
      return [];
    }

    return prisma.tags.findMany({
      where: { id: { in: ids }, orgId, deletedAt: null },
      select: TAG_SELECT,
    });
  }

  async create(
    orgId: string,
    input: { name: string; color: string },
    maxTags: number,
  ): Promise<CreateTagOutcome> {
    return serializable(async (tx) => {
      if ((await tx.tags.count({ where: { orgId, deletedAt: null } })) >= maxTags) {
        return { outcome: 'too_many' };
      }

      if (await nameTaken(tx, orgId, input.name)) {
        return { outcome: 'name_taken' };
      }

      const tag = await tx.tags.create({
        data: { orgId, name: input.name, color: input.color },
        select: TAG_SELECT,
      });

      return { outcome: 'created', tag };
    });
  }

  async update(
    orgId: string,
    id: string,
    input: { name?: string; color?: string },
  ): Promise<UpdateTagOutcome> {
    return serializable(async (tx) => {
      const current = await tx.tags.findFirst({
        where: { id, orgId, deletedAt: null },
        select: { id: true },
      });

      if (!current) {
        return { outcome: 'not_found' };
      }

      // Renaming a tag to a different casing of its own name is allowed;
      // taking another live tag's name is not.
      if (input.name !== undefined && (await nameTaken(tx, orgId, input.name, id))) {
        return { outcome: 'name_taken' };
      }

      const tag = await tx.tags.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
        },
        select: TAG_SELECT,
      });

      return { outcome: 'updated', tag };
    });
  }

  /**
   * Soft delete. The links to posts are kept (they are history), and every
   * read of a post's tags filters the deleted tag out, so it disappears from
   * every post at once.
   */
  async softDelete(orgId: string, id: string): Promise<boolean> {
    const result = await prisma.tags.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    return result.count > 0;
  }
}

/** Whether a live tag of this workspace already has `name`, ignoring case. */
async function nameTaken(
  tx: PrismaTransactionClient,
  orgId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const clash = await tx.tags.findFirst({
    where: {
      orgId,
      deletedAt: null,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  return clash !== null;
}

/**
 * Runs `work` in a serializable transaction, retrying when Postgres aborts it
 * to keep a concurrent one serializable (P2034). The retry re-reads, so the
 * loser of a race on one name sees the winner's tag and answers 409.
 */
async function serializable<T>(work: (tx: PrismaTransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(work, SERIALIZABLE);
    } catch (error) {
      const aborted =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';

      if (!aborted || attempt >= ATTEMPTS) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
}
