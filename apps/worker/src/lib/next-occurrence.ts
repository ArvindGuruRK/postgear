/**
 * Repeating posts (2026-10-19, after Postiz's "Repeat Post Every").
 *
 * ## A new post per occurrence, on purpose
 *
 * Postiz repeats by sleeping in the publish workflow and publishing the same
 * row again, overwriting its release URL each time. PostGear keeps every
 * publication instead: when a root with `intervalInDays` publishes, a copy of
 * its chain is queued as a *new* post, `intervalInDays` later. Each
 * occurrence then has its own permalink, its own analytics and its own row in
 * the queue, and the person can edit or delete the upcoming one like any
 * other post. Deleting it, or editing it to stop repeating, ends the chain;
 * a failed publish starts no next occurrence, as in Postiz.
 *
 * ## One next group, created once
 *
 * A post spans channels and each channel publishes on its own workflow, so
 * the channels of one post reach this code separately, possibly hours apart
 * (a retry), and an activity may itself run twice. The next occurrence's
 * group id is therefore *derived* from the current one (`nextOccurrenceGroup`,
 * a UUIDv5), so every channel lands in the same next post, and creation is
 * keyed on (next group, channel): if any row of that channel already exists
 * there, live or deleted, nothing is created. A deleted one is the person
 * having ended the chain, and is never brought back.
 *
 * The plan is pure (`planNextOccurrence`) and the database work runs in one
 * serializable transaction, so two concurrent runs cannot both create.
 */
import { createHash } from 'node:crypto';
import { Prisma, prisma, State } from '@postgear/db';
import {
  POST_PUBLISH_WORKFLOW,
  type PostPublishInput,
  publishWorkflowId,
  SCHEDULING_TASK_QUEUE,
} from '@postgear/scheduling';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { orderChain } from './publish-details';

const DAY_MS = 24 * 60 * 60 * 1_000;

/** The longest interval honoured. The API offers up to 30; this only bounds stored data. */
const MAX_INTERVAL_DAYS = 365;

/**
 * The namespace PostGear's derived group ids are minted in. Random and fixed
 * forever: changing it would derive a different next group for a post whose
 * other channels already used this one.
 */
const NEXT_GROUP_NAMESPACE = '5f0c3b8e-2a71-4c9d-8e46-b1d7a9c2e384';

/** RFC 4122 version 5: SHA-1 of the namespace and the name, as a UUID. */
export function uuidV5(name: string, namespace: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replace(/-/g, ''), 'hex'))
    .update(name, 'utf8')
    .digest();
  const bytes = hash.subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The group the next occurrence of `group` is created in. A UUID, because the
 * API addresses posts by group and refuses anything else.
 */
export function nextOccurrenceGroup(group: string): string {
  return uuidV5(`${group}:next`, NEXT_GROUP_NAMESPACE);
}

/** Whether a stored interval is one worth repeating on: a whole number of days, within reason. */
export function isRepeatInterval(value: number | null | undefined): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_INTERVAL_DAYS
  );
}

/**
 * When the next occurrence publishes: the previous time plus the interval,
 * stepped forward by whole intervals until it is in the future. A weekly post
 * whose publish was retried for an hour keeps its weekday and time; one that
 * was stuck for a fortnight skips the occurrences it missed rather than
 * publishing them all at once. Intervals are exact multiples of 24 hours, as
 * Postiz's are.
 */
export function nextOccurrenceDate(previous: Date, intervalInDays: number, now: Date): Date {
  const step = intervalInDays * DAY_MS;
  const first = previous.getTime() + step;

  if (first > now.getTime()) {
    return new Date(first);
  }

  const missed = Math.floor((now.getTime() - first) / step) + 1;
  return new Date(first + missed * step);
}

/** A row already in the next group, of any channel. */
export interface NextGroupRow {
  id: string;
  integrationId: string;
  parentPostId: string | null;
  deletedAt: Date | null;
  state: State;
  publishDate: Date;
  intervalInDays: number | null;
}

export type NextOccurrencePlan =
  /** The person deleted the upcoming occurrence: the chain has ended. */
  | { action: 'ended' }
  /** This channel's occurrence is already there (an earlier run made it). */
  | { action: 'exists'; rootId: string; state: State }
  | {
      action: 'create';
      publishDate: Date;
      intervalInDays: number | null;
      state: typeof State.QUEUE | typeof State.DRAFT;
    };

/**
 * What to do for one channel, given what the next group already holds.
 *
 * When another channel of the same post got there first, this one joins it:
 * same time (if still ahead), same repeat and same state, so a next
 * occurrence the person already edited (moved, paused as a draft, stopped
 * repeating) is respected rather than contradicted by a late channel.
 */
export function planNextOccurrence(params: {
  integrationId: string;
  previousPublishDate: Date;
  intervalInDays: number;
  existing: NextGroupRow[];
  now: Date;
}): NextOccurrencePlan {
  const mine = params.existing.filter((row) => row.integrationId === params.integrationId);

  if (mine.length > 0) {
    const root = mine.find((row) => row.deletedAt === null && row.parentPostId === null);
    return root ? { action: 'exists', rootId: root.id, state: root.state } : { action: 'ended' };
  }

  const live = params.existing.filter((row) => row.deletedAt === null);

  if (params.existing.length > 0 && live.length === 0) {
    return { action: 'ended' };
  }

  const anchor = live.find((row) => row.parentPostId === null) ?? live[0];

  if (!anchor) {
    return {
      action: 'create',
      publishDate: nextOccurrenceDate(
        params.previousPublishDate,
        params.intervalInDays,
        params.now,
      ),
      intervalInDays: params.intervalInDays,
      state: State.QUEUE,
    };
  }

  return {
    action: 'create',
    publishDate:
      anchor.publishDate.getTime() > params.now.getTime()
        ? anchor.publishDate
        : nextOccurrenceDate(params.previousPublishDate, params.intervalInDays, params.now),
    intervalInDays: anchor.intervalInDays,
    state: anchor.state === State.DRAFT ? State.DRAFT : State.QUEUE,
  };
}

export type NextOccurrenceResult =
  /** Nothing to repeat: not a published root, no interval, or the channel is gone. */
  | { status: 'none' }
  | { status: 'ended' }
  | {
      status: 'created' | 'exists';
      postId: string;
      group: string;
      /** Whether its publish workflow was started (or already ran). */
      scheduled: boolean;
    };

export interface NextOccurrenceDeps {
  temporalClient: () => Promise<Client>;
  log: (message: string, meta: Record<string, unknown>) => void;
  now?: () => Date;
}

const CHAIN_SELECT = {
  id: true,
  parentPostId: true,
  content: true,
  image: true,
  settings: true,
  delay: true,
  title: true,
  description: true,
} as const;

/**
 * Queues the next occurrence of a root that just published, and starts its
 * publish workflow. Safe to run any number of times for the same root.
 */
export async function queueNextOccurrence(
  input: PostPublishInput,
  deps: NextOccurrenceDeps,
): Promise<NextOccurrenceResult> {
  const root = await prisma.post.findFirst({
    where: { id: input.postId, organizationId: input.organizationId, deletedAt: null },
    select: {
      id: true,
      group: true,
      integrationId: true,
      parentPostId: true,
      state: true,
      publishDate: true,
      intervalInDays: true,
      creationMethod: true,
      integration: { select: { deletedAt: true } },
    },
  });

  if (
    !root ||
    root.parentPostId !== null ||
    root.state !== State.PUBLISHED ||
    !isRepeatInterval(root.intervalInDays) ||
    root.integration.deletedAt !== null
  ) {
    return { status: 'none' };
  }

  const interval = root.intervalInDays;

  const rows = await prisma.post.findMany({
    where: {
      organizationId: input.organizationId,
      group: root.group,
      integrationId: root.integrationId,
      deletedAt: null,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: CHAIN_SELECT,
  });

  // The chain hanging off this root, as the publish activity walks it.
  const ordered = orderChain(rows);
  const start = ordered.findIndex((row) => row.id === root.id);
  const chain = start === -1 ? [] : ordered.slice(start);

  if (chain.length === 0) {
    return { status: 'none' };
  }

  const tags = await prisma.tagsPosts.findMany({
    where: { postId: root.id, tag: { orgId: input.organizationId, deletedAt: null } },
    orderBy: [{ createdAt: 'asc' }, { tagId: 'asc' }],
    select: { tagId: true },
  });

  const group = nextOccurrenceGroup(root.group);
  const now = deps.now?.() ?? new Date();

  const outcome = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.post.findMany({
        where: { organizationId: input.organizationId, group },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          integrationId: true,
          parentPostId: true,
          deletedAt: true,
          state: true,
          publishDate: true,
          intervalInDays: true,
        },
      });

      const plan = planNextOccurrence({
        integrationId: root.integrationId,
        previousPublishDate: root.publishDate,
        intervalInDays: interval,
        existing,
        now,
      });

      if (plan.action !== 'create') {
        return plan;
      }

      let previousId: string | null = null;
      let rootId: string | null = null;

      for (const row of chain) {
        const created: { id: string } = await tx.post.create({
          data: {
            content: row.content,
            image: row.image,
            settings: row.settings,
            delay: row.delay,
            title: row.title,
            description: row.description,
            state: plan.state,
            publishDate: plan.publishDate,
            intervalInDays: plan.intervalInDays,
            group,
            creationMethod: root.creationMethod,
            organization: { connect: { id: input.organizationId } },
            // Scoped and alive in the connect itself, as the API writes it.
            integration: {
              connect: {
                id: root.integrationId,
                organizationId: input.organizationId,
                deletedAt: null,
              },
            },
            ...(previousId ? { parentPost: { connect: { id: previousId } } } : {}),
          },
          select: { id: true },
        });

        previousId = created.id;
        rootId ??= created.id;
      }

      if (rootId && tags.length > 0) {
        await tx.tagsPosts.createMany({
          data: tags.map((tag, index) => ({
            postId: rootId as string,
            tagId: tag.tagId,
            // Ascending, so the copy reads back in the same order.
            createdAt: new Date(now.getTime() + index),
          })),
        });
      }

      return { action: 'created' as const, rootId: rootId as string, state: plan.state };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  if (outcome.action === 'ended') {
    return { status: 'ended' };
  }

  const scheduled =
    outcome.state === State.QUEUE
      ? await startPublish(deps, { postId: outcome.rootId, organizationId: input.organizationId })
      : false;

  return {
    status: outcome.action === 'created' ? 'created' : 'exists',
    postId: outcome.rootId,
    group,
    scheduled,
  };
}

/**
 * Starts the occurrence's publish workflow under the id the API uses, so a
 * later save or "post now" from the API signals this very run. Best-effort:
 * the row is queued already, and the maintenance reconcile starts any queued
 * root without a workflow.
 */
async function startPublish(deps: NextOccurrenceDeps, input: PostPublishInput): Promise<boolean> {
  try {
    const client = await deps.temporalClient();
    await client.workflow.start(POST_PUBLISH_WORKFLOW, {
      workflowId: publishWorkflowId(input.postId),
      taskQueue: SCHEDULING_TASK_QUEUE,
      args: [input],
    });
    return true;
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      return true;
    }

    deps.log('next occurrence queued but its workflow did not start; the reconcile will start it', {
      postId: input.postId,
      organizationId: input.organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
