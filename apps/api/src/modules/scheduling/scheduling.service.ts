/**
 * The API's side of the scheduler: start, wake, hurry and cancel workflows.
 *
 * ## Best-effort by design
 *
 * Every method here swallows Temporal errors and returns whether the call
 * reached the server. A person saving a post must not get a 500 because the
 * scheduler was restarting; the row is written first, and the worker's
 * maintenance workflow (`apps/worker/src/workflows/maintenance.workflow.ts`)
 * reconciles any row whose workflow is missing within fifteen minutes. The
 * failure is logged loudly, and `status()` lets the UI say "scheduler
 * unreachable" so the gap is visible rather than silent.
 *
 * ## Why signals rather than start/terminate
 *
 * Each post row has exactly one workflow id (`@postgear/scheduling`), and
 * `signalWithStart` is idempotent against it: a running workflow receives the
 * signal, a finished or never-started one is started and then signalled. So
 * "schedule", "reschedule" and "post now" are each one call, with no listing,
 * no terminate-and-recreate, and no race between the two. The workflow treats
 * the database as the truth and only needs to be *told to look*.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ANALYTICS_SYNC_WORKFLOW,
  analyticsSyncWorkflowId,
  CANCEL_SIGNAL,
  POST_PUBLISH_WORKFLOW,
  PUBLISH_NOW_SIGNAL,
  PUBLISH_RETRY_POLICY,
  publishWorkflowId,
  type RetryPolicyValues,
  SCHEDULING_TASK_QUEUE,
  SYNC_NOW_SIGNAL,
  TOKEN_REFRESH_WORKFLOW,
  tokenRefreshWorkflowId,
  WAKE_SIGNAL,
} from '@postgear/scheduling';
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';
import type { Env } from '../../config/env';

/** A post row the scheduler should be told about: the root row of one channel's chain. */
export interface ScheduledRoot {
  postId: string;
  organizationId: string;
}

/** A channel whose analytics loop should be started, or told to sync now (Sprint 7). */
export interface AnalyticsChannel {
  integrationId: string;
  organizationId: string;
}

export interface SchedulerStatus {
  /** The Temporal server answered. */
  reachable: boolean;
  /** At least one worker is polling the task queue. Null when unreachable. */
  workerOnline: boolean | null;
  taskQueue: string;
  retryPolicy: RetryPolicyValues;
}

/** The minimal client surface this service uses — what a test substitutes. */
export interface SchedulingClient {
  workflow: Pick<Client['workflow'], 'signalWithStart' | 'getHandle'>;
  workflowService: Pick<Client['workflowService'], 'describeTaskQueue'>;
  connection: { close(): Promise<void> };
}

/** How long a status probe may take before the scheduler counts as unreachable. */
const STATUS_TIMEOUT_MS = 3_000;

/**
 * How long any scheduler call may hold a request. A half-open connection must
 * not keep a person's save hanging; past this the save succeeds without the
 * scheduler and the maintenance loop catches up.
 */
const CALL_TIMEOUT_MS = 5_000;

export type TemporalConnect = (address: string, namespace: string) => Promise<SchedulingClient>;

/**
 * The connection factory, as an injection token so a test can hand the service
 * a fake client. The module provides the real one; a plain default parameter
 * would have Nest try to inject `Function` and fail at boot.
 */
export const TEMPORAL_CONNECT = Symbol('TEMPORAL_CONNECT');

@Injectable()
export class SchedulingService implements OnModuleDestroy {
  private readonly logger = new Logger(SchedulingService.name);
  private readonly address: string;
  private readonly namespace: string;
  private clientPromise: Promise<SchedulingClient> | null = null;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(TEMPORAL_CONNECT) private readonly connect: TemporalConnect,
  ) {
    this.address = config.get('TEMPORAL_HOST', { infer: true });
    this.namespace = config.get('TEMPORAL_NAMESPACE', { infer: true });
  }

  /**
   * Makes sure a queued row has a workflow waiting for its publish time.
   *
   * Idempotent: a workflow that already exists is woken and re-reads the row,
   * which is exactly what a reschedule needs.
   */
  async schedulePublish(roots: ScheduledRoot[]): Promise<boolean> {
    return this.signalEach(roots, WAKE_SIGNAL);
  }

  /** Publishes queued rows as soon as a worker picks them up. */
  async publishNow(roots: ScheduledRoot[]): Promise<boolean> {
    return this.signalEach(roots, PUBLISH_NOW_SIGNAL);
  }

  /**
   * Tells the workflows of rows that left the queue to stop waiting.
   *
   * A workflow that is not running is simply not there to cancel — which is
   * fine, since a row that is no longer `QUEUE` is skipped the moment any
   * workflow re-reads it.
   */
  async cancelPublish(postIds: string[]): Promise<boolean> {
    if (postIds.length === 0) {
      return true;
    }

    return this.attempt('cancel', async (client) => {
      await Promise.all(
        postIds.map(async (postId) => {
          try {
            await client.workflow.getHandle(publishWorkflowId(postId)).signal(CANCEL_SIGNAL);
          } catch (error) {
            if (!(error instanceof WorkflowNotFoundError)) {
              throw error;
            }
          }
        }),
      );
    });
  }

  /** Starts, or wakes, the refresh loop that keeps a channel's token alive. */
  async ensureTokenRefresh(integrationId: string, organizationId: string): Promise<boolean> {
    return this.attempt('token refresh', async (client) => {
      await client.workflow.signalWithStart(TOKEN_REFRESH_WORKFLOW, {
        workflowId: tokenRefreshWorkflowId(integrationId),
        taskQueue: SCHEDULING_TASK_QUEUE,
        args: [{ integrationId, organizationId }],
        signal: WAKE_SIGNAL,
        signalArgs: [],
      });
    });
  }

  /**
   * Sprint 7: asks each channel's analytics loop to sync now, starting the
   * loop if it is not running. The same idempotent `signalWithStart` as a
   * publish: a running loop is signalled, a missing one is started and then
   * signalled, and the loop itself holds repeated requests to one sync per
   * two minutes.
   */
  async syncAnalyticsNow(channels: AnalyticsChannel[]): Promise<boolean> {
    if (channels.length === 0) {
      return true;
    }

    return this.attempt('analytics sync', async (client) => {
      await Promise.all(
        channels.map((channel) =>
          client.workflow.signalWithStart(ANALYTICS_SYNC_WORKFLOW, {
            workflowId: analyticsSyncWorkflowId(channel.integrationId),
            taskQueue: SCHEDULING_TASK_QUEUE,
            args: [
              { integrationId: channel.integrationId, organizationId: channel.organizationId },
            ],
            signal: SYNC_NOW_SIGNAL,
            signalArgs: [],
          }),
        ),
      );
    });
  }

  /** What the UI shows in its scheduler pill. Never throws. */
  async status(): Promise<SchedulerStatus> {
    const base = {
      taskQueue: SCHEDULING_TASK_QUEUE,
      retryPolicy: PUBLISH_RETRY_POLICY,
    };

    try {
      const client = await this.client();
      const described = await withTimeout(
        client.workflowService.describeTaskQueue({
          namespace: this.namespace,
          taskQueue: { name: SCHEDULING_TASK_QUEUE, kind: 1 },
          // TASK_QUEUE_TYPE_WORKFLOW: a worker that polls for workflow tasks
          // is a worker that can run the publish.
          taskQueueType: 1,
        }),
        STATUS_TIMEOUT_MS,
      );

      return {
        ...base,
        reachable: true,
        workerOnline: (described.pollers?.length ?? 0) > 0,
      };
    } catch {
      this.discardClient();
      return { ...base, reachable: false, workerOnline: null };
    }
  }

  /** Forgets the cached client and closes its connection, so a retry starts clean. */
  private discardClient(): void {
    const stale = this.clientPromise;
    this.clientPromise = null;

    if (stale) {
      void stale.then((client) => client.connection.close()).catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const pending = this.clientPromise;
    this.clientPromise = null;

    if (pending) {
      await pending.then((client) => client.connection.close()).catch(() => undefined);
    }
  }

  private async signalEach(roots: ScheduledRoot[], signal: string): Promise<boolean> {
    if (roots.length === 0) {
      return true;
    }

    return this.attempt(signal, async (client) => {
      await Promise.all(
        roots.map((root) =>
          client.workflow.signalWithStart(POST_PUBLISH_WORKFLOW, {
            workflowId: publishWorkflowId(root.postId),
            taskQueue: SCHEDULING_TASK_QUEUE,
            args: [{ postId: root.postId, organizationId: root.organizationId }],
            signal,
            signalArgs: [],
          }),
        ),
      );
    });
  }

  /**
   * Runs one scheduler call. Returns false — and drops the cached client so
   * the next call reconnects — when Temporal cannot be reached.
   */
  private async attempt(
    label: string,
    run: (client: SchedulingClient) => Promise<void>,
  ): Promise<boolean> {
    try {
      await withTimeout(run(await this.client()), CALL_TIMEOUT_MS);
      return true;
    } catch (error) {
      this.discardClient();
      this.logger.warn(
        JSON.stringify({
          event: 'scheduling.unavailable',
          action: label,
          address: this.address,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
  }

  private client(): Promise<SchedulingClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.connect(this.address, this.namespace).catch((error) => {
        this.clientPromise = null;
        throw error;
      });
    }

    return this.clientPromise;
  }
}

export async function connectTemporal(
  address: string,
  namespace: string,
): Promise<SchedulingClient> {
  const connection = await Connection.connect({ address, connectTimeout: '5s' });
  return new Client({ connection, namespace });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
