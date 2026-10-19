/**
 * Persistence for posts, and the only place a post's row structure is known.
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
 * channel, which Sprint 5's publish workflow is keyed on, survives every
 * edit, reorder included.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaTransactionClient, prisma, State } from '@postgear/db';
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
  /** The platform's id and permalink, once published (Sprint 5). */
  releaseId: string | null;
  releaseURL: string | null;
  /** The worker's publish status JSON, on a chain's root row: see `@postgear/scheduling`. */
  error: string | null;
  /** Days between repeats, or null (2026-10-19). Every row of a group holds the same value. */
  intervalInDays: number | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * The row's live tags, in the order they were added (2026-10-19). Only a
   * chain's root carries any; deleted tags are filtered out by the query.
   */
  tags: { tag: { id: string; name: string; color: string } }[];
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
  /** Written on every row of the group; null means no repeat. */
  intervalInDays: number | null;
  /** Live tag ids of this workspace, already checked, in display order. */
  tagIds: string[];
  channels: {
    integrationId: string;
    customized: boolean;
    /** Already validated against the channel's provider: see `validateProviderSettings`. */
    settings: Record<string, unknown>;
    parts: StoredPart[];
  }[];
}

export type ReplaceOutcome = 'saved' | 'not_found' | 'locked' | 'conflict';

/** The root row of one channel's chain: what the scheduler's workflow is keyed on. */
export interface ChainRoot {
  id: string;
  integrationId: string;
  state: State;
}

export interface QueueQuery {
  orgId: string;
  states?: State[];
  channelId?: string;
  from?: Date;
  to?: Date;
  sort: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export type RescheduleOutcome =
  | { outcome: 'saved'; roots: ChainRoot[] }
  | { outcome: 'not_found' }
  | { outcome: 'locked' };

export type PublishNowOutcome =
  | { outcome: 'saved'; roots: ChainRoot[] }
  | { outcome: 'not_found' }
  | { outcome: 'not_queued' };

/**
 * The columns of a `PostRow`. A function of the workspace because the tag
 * join is scoped to it as well as to live tags: a link to another
 * workspace's tag cannot be written (the service checks every id), and if one
 * ever were, it would still never be read back.
 */
function rowSelect(orgId: string) {
  return {
    id: true,
    group: true,
    integrationId: true,
    parentPostId: true,
    state: true,
    publishDate: true,
    content: true,
    image: true,
    settings: true,
    releaseId: true,
    releaseURL: true,
    error: true,
    intervalInDays: true,
    createdAt: true,
    updatedAt: true,
    tags: {
      where: { tag: { orgId, deletedAt: null } },
      orderBy: [{ createdAt: 'asc' }, { tagId: 'asc' }],
      select: { tag: { select: { id: true, name: true, color: true } } },
    },
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
  } satisfies Prisma.PostSelect;
}

/**
 * Serializable, because the optimistic `expectedUpdatedAt` check alone is a
 * read-then-write race: two saves loaded from the same version could both pass
 * it and the second would silently erase the first. Postgres aborts one of two
 * conflicting serializable transactions, and that abort becomes a 409.
 */
/** How many times a create is retried after a serialization failure. */
const CREATE_ATTEMPTS = 3;
const CREATE_RETRY_DELAY_MS = 50;

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
      select: rowSelect(params.orgId),
    });
  }

  async findGroup(orgId: string, group: string): Promise<PostRow[]> {
    return prisma.post.findMany({
      where: { organizationId: orgId, group, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: rowSelect(orgId),
    });
  }

  async createGroup(write: GroupWrite): Promise<void> {
    // Serializable transactions can abort each other even when they touch
    // different rows (Postgres takes predicate locks on the index ranges the
    // chain writes scan). For a *create* nothing was read that could be stale,
    // so the right answer is simply to try again.
    for (let attempt = 1; ; attempt++) {
      try {
        await prisma.$transaction(async (tx) => {
          for (const channel of write.channels) {
            await this.writeChain(tx, write, channel, []);
          }
        }, WRITE_OPTIONS);
        return;
      } catch (error) {
        const serializationFailure =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';

        if (!serializationFailure || attempt >= CREATE_ATTEMPTS) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, CREATE_RETRY_DELAY_MS * attempt));
      }
    }
  }

  /**
   * Replaces a group's content in place.
   *
   * Existing rows are updated by position, missing ones created, surplus ones
   * soft-deleted, and a channel that is no longer targeted has all of its rows
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
   * The root row of each channel's chain in a group.
   *
   * These ids are what the publish workflows are keyed on, so the service
   * reads them around every write: after a save to start or wake workflows,
   * before a delete or a channel removal to cancel them.
   */
  async findRoots(orgId: string, group: string): Promise<ChainRoot[]> {
    return prisma.post.findMany({
      where: { organizationId: orgId, group, deletedAt: null, parentPostId: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, integrationId: true, state: true },
    });
  }

  /**
   * Every row of every group with a root scheduled inside the range.
   *
   * By root rather than by any row because a thread's parts share the root's
   * date and the calendar shows a post once, not once per part.
   */
  async listCalendar(params: { orgId: string; from: Date; to: Date }): Promise<PostRow[]> {
    const groups = await prisma.post.findMany({
      where: {
        organizationId: params.orgId,
        deletedAt: null,
        parentPostId: null,
        publishDate: { gte: params.from, lte: params.to },
      },
      distinct: ['group'],
      select: { group: true },
      // A month of a very busy workspace. Past this the view would be unreadable
      // anyway; the queue list pages.
      take: 1_000,
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
      select: rowSelect(params.orgId),
    });
  }

  /**
   * One page of groups for the queue, ordered by publish time.
   *
   * Filters apply to root rows: a group is listed when any of its channels
   * matches, so "failed" shows a post that published to one channel and failed
   * on another, which is exactly the post that needs attention.
   */
  async listQueue(query: QueueQuery): Promise<{ rows: PostRow[]; total: number }> {
    const where: Prisma.PostWhereInput = {
      organizationId: query.orgId,
      deletedAt: null,
      parentPostId: null,
      ...(query.states && query.states.length > 0 ? { state: { in: query.states } } : {}),
      ...(query.channelId ? { integrationId: query.channelId } : {}),
      ...(query.from || query.to
        ? {
            publishDate: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [page, all] = await Promise.all([
      prisma.post.groupBy({
        by: ['group'],
        where,
        _min: { publishDate: true },
        // The group id breaks ties, so two posts at the same minute cannot
        // swap places between one page and the next.
        orderBy: [{ _min: { publishDate: query.sort } }, { group: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.post.groupBy({ by: ['group'], where }),
    ]);

    if (page.length === 0) {
      return { rows: [], total: all.length };
    }

    const rows = await prisma.post.findMany({
      where: {
        organizationId: query.orgId,
        deletedAt: null,
        group: { in: page.map((entry) => entry.group) },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: rowSelect(query.orgId),
    });

    return { rows, total: all.length };
  }

  /**
   * Moves a group's unpublished channels to a new publish time.
   *
   * Every row of those channels moves (a thread's parts share the root's
   * date) and a channel that had failed goes back to the queue, since a new
   * time is a new attempt. Channels already published stay exactly where they
   * are: they are out there. A group with nothing left to move is `locked`.
   */
  async reschedule(params: {
    orgId: string;
    group: string;
    publishDate: Date;
  }): Promise<RescheduleOutcome> {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.post.findMany({
        where: { organizationId: params.orgId, group: params.group, deletedAt: null },
        select: { id: true, integrationId: true, state: true, parentPostId: true },
      });

      if (rows.length === 0) {
        return { outcome: 'not_found' };
      }

      const movable = rows.filter((row) => row.state !== State.PUBLISHED);

      if (movable.length === 0) {
        return { outcome: 'locked' };
      }

      await tx.post.updateMany({
        where: { id: { in: movable.map((row) => row.id) }, organizationId: params.orgId },
        data: { publishDate: params.publishDate },
      });

      await tx.post.updateMany({
        where: {
          id: { in: movable.map((row) => row.id) },
          organizationId: params.orgId,
          state: State.ERROR,
        },
        data: { state: State.QUEUE, error: null },
      });

      return {
        outcome: 'saved',
        roots: movable
          .filter((row) => row.parentPostId === null)
          .map((row) => ({
            id: row.id,
            integrationId: row.integrationId,
            state: row.state === State.ERROR ? State.QUEUE : row.state,
          })),
      };
    }, WRITE_OPTIONS);
  }

  /**
   * Brings a group's unpublished channels forward to now.
   *
   * Queued and failed channels are moved to the current time and re-queued;
   * channels already published are left as they are, so "post now" on a group
   * that half-succeeded retries only the half that did not.
   */
  async publishNow(params: { orgId: string; group: string }): Promise<PublishNowOutcome> {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.post.findMany({
        where: { organizationId: params.orgId, group: params.group, deletedAt: null },
        select: { id: true, integrationId: true, state: true, parentPostId: true },
      });

      if (rows.length === 0) {
        return { outcome: 'not_found' };
      }

      const pending = rows.filter((row) => row.state === State.QUEUE || row.state === State.ERROR);

      if (pending.length === 0) {
        return { outcome: 'not_queued' };
      }

      await tx.post.updateMany({
        where: { id: { in: pending.map((row) => row.id) }, organizationId: params.orgId },
        data: { publishDate: new Date(), state: State.QUEUE, error: null },
      });

      return {
        outcome: 'saved',
        roots: pending
          .filter((row) => row.parentPostId === null)
          .map((row) => ({ id: row.id, integrationId: row.integrationId, state: State.QUEUE })),
      };
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
    // The composer's flag first, then the provider's options (2026-10-19),
    // on every row of the chain: the worker reads them from whichever row it
    // publishes, and drops `customized` before handing them to the provider.
    const settings = JSON.stringify({ customized: channel.customized, ...channel.settings });
    let previousId: string | null = null;
    let rootId: string | null = null;

    for (const [index, part] of channel.parts.entries()) {
      const data = {
        content: part.content,
        image: part.image,
        settings,
        state: write.state,
        publishDate: write.publishDate,
        intervalInDays: write.intervalInDays,
        parentPostId: previousId,
        // A save is a new version; whatever the worker recorded about the old
        // one (a failure, a retry in progress) no longer describes it.
        error: null,
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
            intervalInDays: data.intervalInDays,
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

      rootId ??= previousId;
    }

    const surplus = existingIds.slice(channel.parts.length);

    if (surplus.length > 0) {
      await tx.post.updateMany({
        where: { id: { in: surplus }, organizationId: write.orgId },
        data: { deletedAt: new Date(), parentPostId: null },
      });
    }

    if (rootId) {
      await this.writeTags(tx, write, rootId);
    }
  }

  /**
   * Replaces a chain root's tags with the save's, keeping their order.
   *
   * Tags hang off the root only (the post as a person sees it, once per
   * channel), and a save is the whole post, so the old links go and the new
   * ones are written with ascending `createdAt`, which is what reads order
   * them by: one `createMany` would stamp them all with the same instant.
   */
  private async writeTags(
    tx: PrismaTransactionClient,
    write: GroupWrite,
    rootId: string,
  ): Promise<void> {
    await tx.tagsPosts.deleteMany({
      where: { postId: rootId, post: { organizationId: write.orgId } },
    });

    if (write.tagIds.length === 0) {
      return;
    }

    const base = Date.now();

    await tx.tagsPosts.createMany({
      data: write.tagIds.map((tagId, index) => ({
        postId: rootId,
        tagId,
        createdAt: new Date(base + index),
      })),
    });
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
