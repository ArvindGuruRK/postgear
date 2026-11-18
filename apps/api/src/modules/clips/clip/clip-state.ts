/**
 * A clip's state in the library (Sprint 12, Module 07 section 4): one of
 * `new`, `draft`, `exported`, `scheduled`, `hidden`, worked out here and
 * never stored, so it cannot drift from the facts it is made of.
 *
 * The rules, in order (the first that holds wins):
 *
 * 1. **hidden**: the clip's status is HIDDEN.
 * 2. **scheduled**: it has a `ClipPost` whose post group still has a post
 *    waiting (a `Post` of that group, not deleted, in state QUEUE: the
 *    publisher's "waiting to go out", see `modules/posts/post-state.ts`).
 * 3. **exported**: the last export drew this very revision.
 * 4. **new**: the status is NEW (an AI clip nobody opened yet).
 * 5. **draft**: anything else.
 *
 * `clipStateOf` applies them to one row; `stateWhere` writes the same rules
 * as a Prisma filter, so the list's filter and counts and each card's
 * badge always agree (the spec checks one against the other).
 *
 * "Waiting" is read once per request: `waitingPostGroups` finds the post
 * groups the workspace's clips were sent to that still have a post waiting
 * (two queries, whatever the number of clips), and every filter and state
 * reuses that list.
 */
import { ClipStatus, type Prisma, type PrismaTransactionClient, prisma, State } from '@postgear/db';

export const CLIP_STATES = ['new', 'draft', 'exported', 'scheduled', 'hidden'] as const;
export type ClipState = (typeof CLIP_STATES)[number];

/** The list's status filter: a state, or `all` (every state but hidden). */
export const CLIP_STATUS_FILTERS = ['all', ...CLIP_STATES] as const;
export type ClipStatusFilter = (typeof CLIP_STATUS_FILTERS)[number];

/** The facts a state is made of. */
export interface ClipStateFacts {
  status: ClipStatus;
  revision: number;
  lastExportedRevision: number | null;
}

/** One clip's state; `scheduled` is whether one of its post groups still has a post waiting. */
export function clipStateOf(clip: ClipStateFacts, scheduled: boolean): ClipState {
  if (clip.status === ClipStatus.HIDDEN) return 'hidden';
  if (scheduled) return 'scheduled';
  if (clip.lastExportedRevision !== null && clip.lastExportedRevision === clip.revision) {
    return 'exported';
  }
  if (clip.status === ClipStatus.NEW) return 'new';
  return 'draft';
}

/**
 * A reference to the clip's own `revision` column, for "the last export drew
 * this very revision" in a query (`prisma.clip.fields.revision`). Passed in
 * so the rules stay a pure function a spec can run against rows.
 */
export type RevisionField = Prisma.IntFieldRefInput<'Clip'>;

/** The Prisma filter for one status filter, given the waiting post groups. */
export function stateWhere(
  filter: ClipStatusFilter,
  waitingGroups: readonly string[],
  revision: RevisionField,
): Prisma.ClipWhereInput {
  const waiting = { postGroup: { in: [...waitingGroups] } };
  const exported: Prisma.ClipWhereInput = { lastExportedRevision: { equals: revision } };
  // `NOT (a = b)` is NULL, not true, when `a` is NULL: never exported is said out loud.
  const notExported: Prisma.ClipWhereInput = {
    OR: [{ lastExportedRevision: null }, { NOT: exported }],
  };

  switch (filter) {
    case 'all':
      return { status: { not: ClipStatus.HIDDEN } };
    case 'hidden':
      return { status: ClipStatus.HIDDEN };
    case 'scheduled':
      return { status: { not: ClipStatus.HIDDEN }, posts: { some: waiting } };
    case 'exported':
      return { status: { not: ClipStatus.HIDDEN }, posts: { none: waiting }, ...exported };
    case 'new':
      return { status: ClipStatus.NEW, posts: { none: waiting }, ...notExported };
    case 'draft':
      return { status: ClipStatus.DRAFT, posts: { none: waiting }, ...notExported };
  }
}

/**
 * The post groups this workspace's clips were sent to that still have a
 * post waiting. Two queries for the whole workspace, never one per clip.
 * `clipIds` narrows the first query to some clips (a page, or one clip).
 */
export async function waitingPostGroups(
  orgId: string,
  clipIds?: readonly string[],
  client: PrismaTransactionClient = prisma,
): Promise<string[]> {
  if (clipIds && clipIds.length === 0) return [];
  const sent = await client.clipPost.findMany({
    where: { organizationId: orgId, ...(clipIds ? { clipId: { in: [...clipIds] } } : {}) },
    select: { postGroup: true },
    distinct: ['postGroup'],
  });
  if (sent.length === 0) return [];
  const waiting = await client.post.findMany({
    where: {
      organizationId: orgId,
      group: { in: sent.map((row) => row.postGroup) },
      state: State.QUEUE,
      deletedAt: null,
    },
    select: { group: true },
    distinct: ['group'],
  });
  return waiting.map((row) => row.group);
}

/** The ids, among `clipIds`, of clips with a post group still waiting (two queries). */
export async function scheduledClipIds(
  orgId: string,
  clipIds: readonly string[],
  client: PrismaTransactionClient = prisma,
): Promise<Set<string>> {
  const groups = await waitingPostGroups(orgId, clipIds, client);
  if (groups.length === 0) return new Set();
  const rows = await client.clipPost.findMany({
    where: { organizationId: orgId, clipId: { in: [...clipIds] }, postGroup: { in: groups } },
    select: { clipId: true },
  });
  return new Set(rows.map((row) => row.clipId));
}
