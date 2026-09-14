/**
 * Persistence for posts — and the only place a post's row structure is known.
 *
 * ## One post, many rows
 *
 * The inherited schema has no post-with-line-items table. What a user thinks of
 * as "a post" is a **group**: one `Post` row per channel per part, sharing a
 * `group` id. Within a channel, the parts of a thread are chained by
 * `parentPostId`, each part pointing at the one before it:
 *
 *     group g ─┬─ X:        part 1 ← part 2 ← part 3
 *              └─ LinkedIn: part 1 ← part 2 ← part 3
 *
 * Nothing outside this file walks those chains.
 *
 * ## Two reference bugs this is written against
 *
 * - **The group that is not a group.** The reference mints a fresh group id
 *   inside its per-channel save loop, so a post sent to three channels is
 *   stored as three unrelated groups and can never be reopened as one. Here
 *   the group id is minted once, by the service, before any row is written.
 * - **Client-chosen row ids.** The reference upserts rows by an id taken from
 *   the request body, without the organization in the `where`, so a crafted
 *   save can overwrite another workspace's post. Here the client never sends a
 *   row id at all: an existing row is matched by its *position* in its own
 *   channel's chain, inside a group already filtered by organization.
 *
 * ## Why position rather than id
 *
 * Reordering a thread changes which text sits at which position, not which
 * rows exist. Keeping row ids stable by position means the root row of each
 * channel — which Sprint 5's publish workflow is keyed on — survives every
 * edit, reorder included.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, prisma, type PrismaTransactionClient, State } from '@postgear/db';
import { canTransition } from './post-state';

/** One stored row, as the service needs it. */
export interface PostRow {
  id: string;
  group: string;
  integrationId: string;
  parentPostId: string | null;
  state: State;
  publishDate: Date;
  content: string;
  image: string | null;
  settings: string | null;
  createdAt: Date;
  updatedAt: Date;
  integration: {
    id: string;
    name: string;
    providerIdentifier: string;
    picture: string | null;
    profile: string | null;
    deletedAt: Date | null;
  };
}

/** A part, already serialized for storage. */
export interface StoredPart {
  content: string;
  image: string;
}

export interface GroupWrite {
  orgId: string;
  group: string;
  state: 'DRAFT' | 'QUEUE';
  publishDate: Date;
  channels: { integrationId: string; customized: boolean; parts: StoredPart[] }[];
}

export type ReplaceOutcome = 'saved' | 'not_found' | 'locked' | 'conflict';

const ROW_SELECT = {
  id: true,
  group: true,
  integrationId: true,
  parentPostId: true,
  state: true,
  publishDate: true,
  content: true,
  image: true,
  settings: true,
  createdAt: true,
  updatedAt: true,
  integration: {
    select: {
      id: true,
      name: true,
      providerIdentifier: true,
      picture: true,
      profile: true,
      deletedAt: true,
    },
  },
} as const;

/**
 * Serializable, because the optimistic `expectedUpdatedAt` check alone is a
 * read-then-write race: two saves loaded from the same version could both pass
 * it and the second would silently erase the first. Postgres aborts one of two
 * conflicting serializable transactions, and that abort becomes a 409.
 */
const WRITE_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  // A full thread across many channels is hundreds of statements.
  timeout: 20_000,
} as const;

@Injectable()
export class PostsRepository {
  /**
   * The rows of the most recently edited groups.
   *
   * Paged by group rather than by row, so a post sent to eight channels counts
   * once against the limit instead of eating eight places.
   */
  async listRecentGroups(params: {
    orgId: string;
    state?: State;
    limit: number;
  }): Promise<PostRow[]> {
    const groups = await prisma.post.groupBy({
      by: ['group'],
      where: {
        organizationId: params.orgId,
        deletedAt: null,
        ...(params.state ? { state: params.state } : {}),
      },
      _max: { updatedAt: true },
      orderBy: { _max: { updatedAt: 'desc' } },
      take: params.limit,
    });

    if (groups.length === 0) {
      return [];
    }

    return prisma.post.findMany({
      where: {
        organizationId: params.orgId,
        deletedAt: null,
        group: { in: groups.map((entry) => entry.group) },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: ROW_SELECT,
    });
  }

  async findGroup(orgId: string, group: string): Promise<PostRow[]> {
    return prisma.post.findMany({
      where: { organizationId: orgId, group, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: ROW_SELECT,
    });
  }

  async createGroup(write: GroupWrite): Promise<void> {
    await prisma.$transaction(async (tx) => {
      for (const channel of write.channels) {
        await this.writeChain(tx, write, channel, []);
      }
    }, WRITE_OPTIONS);
  }

  /**
   * Replaces a group's content in place.
   *
   * Existing rows are updated by position, missing ones created, surplus ones
   * soft-deleted — and a channel that is no longer targeted has all of its rows
   * soft-deleted. Nothing is hard-deleted: `Errors` and `Comments` reference
   * post ids, and history should outlive an edit.
   */
  async replaceGroup(write: GroupWrite & { expectedUpdatedAt: Date }): Promise<ReplaceOutcome> {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.post.findMany({
          where: { organizationId: write.orgId, group: write.group, deletedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            integrationId: true,
            parentPostId: true,
            state: true,
            updatedAt: true,
          },
        });

        if (existing.length === 0) {
          return 'not_found';
        }

        if (existing.some((row) => !canTransition(row.state, write.state))) {
          return 'locked';
        }

        const latest = Math.max(...existing.map((row) => row.updatedAt.getTime()));

        if (latest !== write.expectedUpdatedAt.getTime()) {
          return 'conflict';
        }

        const byChannel = new Map<string, typeof existing>();

        for (const row of existing) {
          byChannel.set(row.integrationId, [...(byChannel.get(row.integrationId) ?? []), row]);
        }

        for (const channel of write.channels) {
          const chain = orderChain(byChannel.get(channel.integrationId) ?? []);
          await this.writeChain(
            tx,
            write,
            channel,
            chain.map((row) => row.id),
          );
          byChannel.delete(channel.integrationId);
        }

        // Whatever is left belongs to channels this save no longer targets.
        const dropped = [...byChannel.values()].flat().map((row) => row.id);

        if (dropped.length > 0) {
          await tx.post.updateMany({
            where: { id: { in: dropped }, organizationId: write.orgId },
            data: { deletedAt: new Date(), parentPostId: null },
          });
        }

        return 'saved';
      }, WRITE_OPTIONS);
    } catch (error) {
      // P2034: Postgres aborted this transaction to keep a concurrent one
      // serializable. It lost the race, which is a conflict, not a crash.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        return 'conflict';
      }
      throw error;
    }
  }

  /**
   * Soft-deletes a group.
   *
   * A published group is refused: it exists on the platform, and Sprint 7's
   * analytics reads its history.
   */
  async deleteGroup(orgId: string, group: string): Promise<'deleted' | 'not_found' | 'locked'> {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.post.findMany({
        where: { organizationId: orgId, group, deletedAt: null },
        select: { state: true },
      });

      if (rows.length === 0) {
        return 'not_found';
      }

      if (rows.some((row) => row.state === State.PUBLISHED)) {
        return 'locked';
      }

      await tx.post.updateMany({
        where: { organizationId: orgId, group, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      return 'deleted';
    }, WRITE_OPTIONS);
  }

  /**
   * Writes one channel's parts as a chain, reusing `existingIds` by position.
   *
   * Every live row has its `parentPostId` rewritten, so the chain is correct
   * after any reorder, and surplus rows are detached as well as deleted so no
   * live part is ever left pointing at a deleted one.
   */
  private async writeChain(
    tx: PrismaTransactionClient,
    write: GroupWrite,
    channel: GroupWrite['channels'][number],
    existingIds: string[],
  ): Promise<void> {
    const settings = JSON.stringify({ customized: channel.customized });
    let previousId: string | null = null;

    for (const [index, part] of channel.parts.entries()) {
      const data = {
        content: part.content,
        image: part.image,
        settings,
        state: write.state,
        publishDate: write.publishDate,
        parentPostId: previousId,
      };

      const reusedId = existingIds[index];

      if (reusedId) {
        await tx.post.update({ where: { id: reusedId }, data });
        previousId = reusedId;
      } else {
        const created: { id: string } = await tx.post.create({
          data: {
            content: data.content,
            image: data.image,
            settings: data.settings,
            state: data.state,
            publishDate: data.publishDate,
            group: write.group,
            creationMethod: 'WEB',
            organization: { connect: { id: write.orgId } },
            // The workspace and liveness are part of the connect, not just a
            // check the service made earlier: a channel from another workspace,
            // or one disconnected mid-save, fails the insert itself.
            integration: {
              connect: { id: channel.integrationId, organizationId: write.orgId, deletedAt: null },
            },
            ...(previousId ? { parentPost: { connect: { id: previousId } } } : {}),
          },
          select: { id: true },
        });
        previousId = created.id;
      }
    }

    const surplus = existingIds.slice(channel.parts.length);

    if (surplus.length > 0) {
      await tx.post.updateMany({
        where: { id: { in: surplus }, organizationId: write.orgId },
        data: { deletedAt: new Date(), parentPostId: null },
      });
    }
  }
}

/**
 * Orders one channel's rows from root to last part by following parent links.
 *
 * Tolerant of damage rather than trusting it: a row whose parent is not in the
 * set is treated as a root, a cycle cannot loop forever, and anything the walk
 * never reaches is appended in creation order instead of being lost.
 */
export function orderChain<T extends { id: string; parentPostId: string | null }>(rows: T[]): T[] {
  const ids = new Set(rows.map((row) => row.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];

  for (const row of rows) {
    if (row.parentPostId && ids.has(row.parentPostId)) {
      children.set(row.parentPostId, [...(children.get(row.parentPostId) ?? []), row]);
    } else {
      roots.push(row);
    }
  }

  const ordered: T[] = [];
  const seen = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const row = queue.shift() as T;

    if (seen.has(row.id)) {
      continue;
    }

    seen.add(row.id);
    ordered.push(row);
    queue.unshift(...(children.get(row.id) ?? []));
  }

  for (const row of rows) {
    if (!seen.has(row.id)) {
      ordered.push(row);
    }
  }

  return ordered;
}
