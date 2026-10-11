/**
 * The activities behind `postPublishWorkflow`.
 *
 * ## Where the Temporal boundary is
 *
 * `@postgear/social-core` throws plain error classes so it stays importable
 * from the API; this file is the one place that knows about Temporal and maps
 * them onto `ApplicationFailure` types. The mapping is the sprint's error
 * branching: `RetryableError` becomes a retryable failure that Temporal's
 * policy backs off and re-runs; `RefreshTokenError` becomes a non-retryable
 * failure the workflow answers with a token refresh; `BadBodyError` fails the
 * post at once, because retrying content a platform refuses only wastes
 * attempts.
 *
 * ## What is written, and when
 *
 * Every failed attempt is recorded on the root row before the failure is
 * thrown, so the queue can show "attempt 2 of 5, retrying at 10:32" while
 * Temporal is waiting. A successful publish is recorded in the same activity
 * call that made it; if that write fails, the results are still returned and
 * the workflow records them through a separate, retried activity rather than
 * publishing a second time.
 */
import { ApplicationFailure, Context } from '@temporalio/activity';
import { decryptNullable, prisma, State } from '@postgear/db';
import {
  backoffAfterAttempt,
  PUBLISH_FAILURE_TYPES,
  PUBLISH_RETRY_POLICY,
  type PostPublishInput,
  type PublishFailureReason,
  type PublishSkipReason,
  parsePublishStatus,
  serializePublishStatus,
} from '@postgear/scheduling';
import {
  BadBodyError,
  type ChannelContext,
  NotEnoughScopesError,
  type PostDetails,
  type PostResponse,
  ProviderError,
  RefreshTokenError,
  RetryableError,
} from '@postgear/social-core';
import {
  buildPostDetails,
  orderChain,
  parseImageIds,
  previousAttemptInFlight,
  previewOf,
} from '../lib/publish-details';
import type { ActivityDeps } from './deps';

export type PublishJob =
  | { status: 'ready'; publishAt: string; integrationId: string }
  | { status: 'skip'; reason: PublishSkipReason };

export interface PublishResult {
  /** True when the rows were updated by this call. */
  recorded: boolean;
  releaseURL: string | null;
  results: PostResponse[];
}

export interface RecordPublishedInput extends PostPublishInput {
  results: PostResponse[];
}

export interface MarkPublishFailedInput extends PostPublishInput {
  reason: PublishFailureReason;
  message: string;
  attempts: number;
}

/** Failure types the publish activity throws; the workflow switches on `type`. */
const TYPES = PUBLISH_FAILURE_TYPES;

/** Heartbeat cadence during the platform call. Under the workflow's one-minute heartbeat timeout. */
const HEARTBEAT_MS = 15_000;

export function createPublishActivities(deps: ActivityDeps) {
  return {
    /**
     * What the workflow needs to decide whether, and when, to publish.
     *
     * Read fresh on every wake-up, so the database — not the workflow's own
     * memory — says when the post goes out. A reschedule, a move back to
     * drafts or a delete all take effect here without the API having to say
     * anything more than "wake up".
     */
    async loadPublishJob(input: PostPublishInput): Promise<PublishJob> {
      const row = await prisma.post.findFirst({
        where: { id: input.postId, organizationId: input.organizationId },
        select: {
          state: true,
          publishDate: true,
          deletedAt: true,
          parentPostId: true,
          integrationId: true,
          integration: { select: { deletedAt: true } },
        },
      });

      if (!row || row.deletedAt) {
        return { status: 'skip', reason: 'deleted' };
      }
      if (row.parentPostId) {
        return { status: 'skip', reason: 'not_root' };
      }
      if (row.state !== State.QUEUE) {
        return { status: 'skip', reason: 'not_queued' };
      }
      if (row.integration.deletedAt) {
        return { status: 'skip', reason: 'channel_gone' };
      }

      return {
        status: 'ready',
        publishAt: row.publishDate.toISOString(),
        integrationId: row.integrationId,
      };
    },

    /**
     * One attempt to publish one channel's chain.
     *
     * Idempotent across retries: a root row that already carries a release id
     * was published by an earlier attempt whose result write won the race, and
     * is returned as-is rather than posted again.
     */
    async publishPost(input: PostPublishInput): Promise<PublishResult> {
      const attempt = Context.current().info.attempt;
      const chain = await loadChain(input);

      if (!chain) {
        throw skipped('deleted');
      }

      const { root, rows, integration } = chain;

      if (root.state === State.PUBLISHED || root.releaseId) {
        return { recorded: true, releaseURL: root.releaseURL, results: [] };
      }
      if (root.state !== State.QUEUE) {
        throw skipped('not_queued');
      }
      if (integration.deletedAt) {
        throw ApplicationFailure.create({
          type: TYPES.channelUnavailable,
          nonRetryable: true,
          message: `${integration.name} was disconnected. Connect it again, or remove it from the post.`,
        });
      }
      if (integration.disabled) {
        throw ApplicationFailure.create({
          type: TYPES.channelUnavailable,
          nonRetryable: true,
          message: `${integration.name} is disabled. Turn it back on and retry the post.`,
        });
      }
      if (integration.inBetweenSteps) {
        throw ApplicationFailure.create({
          type: TYPES.channelUnavailable,
          nonRetryable: true,
          message: `${integration.name} is not set up yet. Finish choosing where it posts to, then retry.`,
        });
      }
      // A token already known to be dead is not worth a round trip; the
      // workflow's refresh branch is the right next step.
      if (integration.refreshNeeded) {
        throw ApplicationFailure.create({
          type: TYPES.refreshToken,
          nonRetryable: true,
          message: `${integration.name} needs reconnecting before PostGear can publish to it.`,
        });
      }

      let provider: ReturnType<ActivityDeps['publisher']['resolve']>;

      try {
        provider = deps.publisher.resolve(integration.providerIdentifier);
      } catch (error) {
        throw ApplicationFailure.create({
          type: TYPES.channelUnavailable,
          nonRetryable: true,
          message: `PostGear cannot publish to ${integration.name}: ${
            error instanceof ProviderError && error.name === 'ProviderNotConfiguredError'
              ? 'its platform is not configured on this deployment.'
              : 'its platform is not supported.'
          }`,
        });
      }

      const details = await renderChain(rows, input.organizationId, deps.publicUrl);
      const validity = await provider.checkValidity(details);

      if (validity !== true) {
        throw ApplicationFailure.create({
          type: TYPES.badBody,
          nonRetryable: true,
          message: validity,
        });
      }

      const token = integration.token ? (decryptNullable(integration.token) ?? '') : '';

      if (!token) {
        throw ApplicationFailure.create({
          type: TYPES.refreshToken,
          nonRetryable: true,
          message: `${integration.name} has no credentials stored. Reconnect it to publish.`,
        });
      }

      const context: ChannelContext = {
        id: integration.id,
        internalId: integration.internalId,
        rootInternalId: integration.rootInternalId ?? integration.internalId,
        providerIdentifier: integration.providerIdentifier,
        name: integration.name,
        profile: integration.profile,
        additionalSettings: parseJsonObject(integration.additionalSettings),
      };

      // A marker from an earlier attempt that never reported back means that
      // attempt died *during* the platform call — the worker was killed, or
      // the activity timed out. The post may be out. Posting again could post
      // it twice, so the outcome is handed to a person instead.
      if (previousAttemptInFlight(root.error, attempt)) {
        throw ApplicationFailure.create({
          type: TYPES.interrupted,
          nonRetryable: true,
          message: `An earlier attempt was cut off while publishing to ${integration.name}. Check the account before retrying.`,
        });
      }

      await prisma.post.updateMany({
        where: { id: root.id, organizationId: input.organizationId },
        data: {
          error: serializePublishStatus({
            kind: 'in_flight',
            attempt,
            startedAt: new Date().toISOString(),
          }),
        },
      });

      let results: PostResponse[];

      try {
        // Heartbeats let Temporal notice a dead worker in a minute rather than
        // at the ten-minute timeout, and deliver a cancellation to a running
        // attempt; the gate rations the platform calls — see lib/semaphore.ts.
        const activity = Context.current();
        const heartbeat = setInterval(() => activity.heartbeat(), HEARTBEAT_MS);

        try {
          results = await deps.publishGate.run(() => provider.post(context, token, details));
        } finally {
          clearInterval(heartbeat);
        }
      } catch (error) {
        throw await recordAttemptFailure(
          input,
          root.id,
          integration.providerIdentifier,
          attempt,
          error,
        );
      }

      const releaseURL = results[0]?.releaseURL ?? null;

      try {
        await writePublished(input, rows, results, integration.name, previewOf(details));
        return { recorded: true, releaseURL, results };
      } catch (error) {
        // The post is out. Recording it is the workflow's job now, through an
        // activity that may be retried freely — this one must not be.
        Context.current().log.error('publish recorded late', {
          postId: input.postId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { recorded: false, releaseURL, results };
      }
    },

    /** Records a publish whose own write failed. Safe to retry. */
    async recordPublished(input: RecordPublishedInput): Promise<void> {
      const chain = await loadChain(input);

      if (!chain) {
        return;
      }

      const details = await renderChain(chain.rows, input.organizationId, deps.publicUrl);
      await writePublished(
        input,
        chain.rows,
        input.results,
        chain.integration.name,
        previewOf(details),
      );
    },

    /** The post failed for good: every part is marked, and the person is told. */
    async markPublishFailed(input: MarkPublishFailedInput): Promise<void> {
      const chain = await loadChain(input);

      if (!chain) {
        return;
      }

      const now = new Date();

      await prisma.$transaction([
        prisma.post.updateMany({
          where: {
            id: { in: chain.rows.map((row) => row.id) },
            organizationId: input.organizationId,
          },
          data: { state: State.ERROR },
        }),
        prisma.post.update({
          where: { id: chain.root.id },
          data: {
            error: serializePublishStatus({
              kind: 'failed',
              reason: input.reason,
              message: input.message,
              attempts: input.attempts,
              failedAt: now.toISOString(),
            }),
          },
        }),
        prisma.errors.create({
          data: {
            organizationId: input.organizationId,
            postId: chain.root.id,
            platform: chain.integration.providerIdentifier,
            message: input.message,
            body: JSON.stringify({ reason: input.reason, attempts: input.attempts }),
          },
        }),
        prisma.notifications.create({
          data: {
            organizationId: input.organizationId,
            content: `Could not publish to ${chain.integration.name}: ${input.message}`,
            link: `/${input.organizationId}/queue?state=ERROR`,
          },
        }),
        ...(input.reason === 'needs_reconnect'
          ? [
              prisma.integration.updateMany({
                where: { id: chain.integration.id, organizationId: input.organizationId },
                data: { refreshNeeded: true },
              }),
            ]
          : []),
      ]);
    },
  };
}

export type PublishActivities = ReturnType<typeof createPublishActivities>;

/* ───────────────────────────── helpers ───────────────────────────── */

type ChainRowRecord = {
  id: string;
  parentPostId: string | null;
  content: string;
  image: string | null;
  settings: string | null;
  state: State;
  releaseId: string | null;
  releaseURL: string | null;
  error: string | null;
};

type IntegrationRecord = {
  id: string;
  internalId: string;
  rootInternalId: string | null;
  providerIdentifier: string;
  name: string;
  profile: string | null;
  token: string;
  additionalSettings: string | null;
  deletedAt: Date | null;
  disabled: boolean;
  inBetweenSteps: boolean;
  refreshNeeded: boolean;
};

const ROW_SELECT = {
  id: true,
  parentPostId: true,
  content: true,
  image: true,
  settings: true,
  state: true,
  releaseId: true,
  releaseURL: true,
  error: true,
} as const;

/**
 * The root row, every live row of its channel's chain, and the channel.
 *
 * The chain is every live row in the same group for the same channel: the
 * repository rewrites `parentPostId` on every save, so following links from
 * the root is enough, and `orderChain` tolerates anything that is not.
 */
async function loadChain(input: PostPublishInput): Promise<{
  root: ChainRowRecord;
  rows: ChainRowRecord[];
  integration: IntegrationRecord;
} | null> {
  const root = await prisma.post.findFirst({
    where: { id: input.postId, organizationId: input.organizationId, deletedAt: null },
    select: {
      ...ROW_SELECT,
      group: true,
      integrationId: true,
      integration: {
        select: {
          id: true,
          internalId: true,
          rootInternalId: true,
          providerIdentifier: true,
          name: true,
          profile: true,
          token: true,
          additionalSettings: true,
          deletedAt: true,
          disabled: true,
          inBetweenSteps: true,
          refreshNeeded: true,
        },
      },
    },
  });

  if (!root) {
    return null;
  }

  const rows = await prisma.post.findMany({
    where: {
      organizationId: input.organizationId,
      group: root.group,
      integrationId: root.integrationId,
      deletedAt: null,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: ROW_SELECT,
  });

  // Only the chain hanging off this root. A group holds one chain per
  // channel, and a channel appears once per group, so this is every row —
  // but the walk is from the root regardless, so a stray row can never be
  // published as part of a thread it does not belong to.
  const ordered = orderChain(rows);
  const index = ordered.findIndex((row) => row.id === root.id);
  const chain = index === -1 ? [root] : ordered.slice(index);

  return { root, rows: chain, integration: root.integration };
}

async function renderChain(
  rows: ChainRowRecord[],
  organizationId: string,
  publicUrl: (key: string) => string,
): Promise<PostDetails[]> {
  const mediaIds = [...new Set(rows.flatMap((row) => parseImageIds(row.image)))];
  const media =
    mediaIds.length === 0
      ? []
      : await prisma.media.findMany({
          where: { id: { in: mediaIds }, organizationId, deletedAt: null },
          select: {
            id: true,
            type: true,
            path: true,
            thumbnail: true,
            alt: true,
            mimeType: true,
            fileSize: true,
            width: true,
            height: true,
          },
        });

  return buildPostDetails(rows, new Map(media.map((item) => [item.id, item])), publicUrl);
}

async function writePublished(
  input: PostPublishInput,
  rows: ChainRowRecord[],
  results: PostResponse[],
  channelName: string,
  preview: string,
): Promise<void> {
  const byRow = new Map(results.map((result) => [result.id, result]));
  const first = results[0];

  await prisma.$transaction([
    ...rows.map((row) => {
      const result = byRow.get(row.id);
      return prisma.post.updateMany({
        where: { id: row.id, organizationId: input.organizationId },
        data: {
          state: State.PUBLISHED,
          error: null,
          ...(result ? { releaseId: result.postId, releaseURL: result.releaseURL } : {}),
        },
      });
    }),
    prisma.notifications.create({
      data: {
        organizationId: input.organizationId,
        content: `Published to ${channelName}${preview ? `: ${preview}` : ''}`,
        link: first?.releaseURL ?? null,
      },
    }),
  ]);
}

/**
 * Classifies a provider failure, records the attempt, and returns the failure
 * to throw. Retryable ones carry the time of the next attempt so the queue can
 * show it; the others are final and the workflow marks the post.
 */
async function recordAttemptFailure(
  input: PostPublishInput,
  rootId: string,
  platform: string,
  attempt: number,
  error: unknown,
): Promise<ApplicationFailure> {
  const message =
    error instanceof Error ? error.message : 'The platform returned an unexpected error.';
  const providerBody = error instanceof ProviderError ? error.providerBody : '';

  await prisma.errors
    .create({
      data: {
        organizationId: input.organizationId,
        postId: rootId,
        platform,
        message,
        body: JSON.stringify({
          attempt,
          type: error instanceof Error ? error.name : typeof error,
          providerBody,
        }),
      },
    })
    .catch(() => undefined);

  if (error instanceof RefreshTokenError) {
    return ApplicationFailure.create({ type: TYPES.refreshToken, nonRetryable: true, message });
  }
  if (error instanceof BadBodyError) {
    return ApplicationFailure.create({ type: TYPES.badBody, nonRetryable: true, message });
  }
  if (error instanceof NotEnoughScopesError) {
    return ApplicationFailure.create({
      type: TYPES.notEnoughScopes,
      nonRetryable: true,
      message,
    });
  }

  // RetryableError, and anything unclassified: let the policy try again. An
  // unclassified error is more likely a platform having a bad minute than a
  // bug, and the bounded policy means a bug costs a few minutes, not forever.
  const retryable = error instanceof RetryableError;
  const backoff = backoffAfterAttempt(attempt);

  if (backoff !== null) {
    await prisma.post
      .updateMany({
        where: { id: rootId, organizationId: input.organizationId },
        data: {
          error: serializePublishStatus({
            kind: 'retrying',
            attempt,
            maxAttempts: PUBLISH_RETRY_POLICY.maximumAttempts,
            nextAttemptAt: new Date(Date.now() + backoff).toISOString(),
            message,
            updatedAt: new Date().toISOString(),
          }),
        },
      })
      .catch(() => undefined);
  }

  return ApplicationFailure.create({
    type: TYPES.retryable,
    nonRetryable: false,
    message: retryable ? message : `Unexpected error while publishing: ${message}`,
  });
}

function skipped(reason: PublishSkipReason): ApplicationFailure {
  return ApplicationFailure.create({
    type: TYPES.skipped,
    nonRetryable: true,
    message: reason,
    details: [reason],
  });
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
