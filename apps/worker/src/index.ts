/**
 * PostGear worker: the process that publishes, and (Sprint 12) works on video.
 *
 * `WORKER_ROLES` picks what this process serves (default: all three):
 * - `publishing`: the original worker on `postgear-scheduling`, unchanged.
 *   The API never publishes anything itself; it writes rows and signals
 *   workflows, and this process does the rest, which is what lets a post go
 *   out with no browser open and no API instance awake.
 * - `media`: Clips imports, sharp ranges and downloads on `postgear-media`,
 *   and the quick helpers (probe, channel list, runtime check) on
 *   `postgear-media-quick`.
 * - `render`: Clips exports on `postgear-render`.
 *
 * One Temporal `Worker` per queue (see `clips/boot.ts`), all sharing one
 * workflow bundle, run together; if one stops on an error the others are
 * shut down too, so the process never limps on half-serving.
 *
 * Start with `npm run dev:worker` (through the repo's `.env`). Needs Temporal
 * from `docker compose up -d`; waits for it rather than crashing if it is still
 * coming up.
 */

import {
  MAINTENANCE_WORKFLOW,
  MAINTENANCE_WORKFLOW_ID,
  SCHEDULING_TASK_QUEUE,
} from '@postgear/scheduling';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { bundleWorkflowCode, Worker } from '@temporalio/worker';
import { createActivities } from './activities';
import { createClipActivities } from './clips/activities';
import { bootClips, mediaSlotShortfall, workerPlan } from './clips/boot';
import type { ClipActivityDeps } from './clips/deps';
import { loadWorkerEnv, servesRole } from './config/env';
import { createAnalyticsSource } from './lib/analytics-source';
import { mediaUrlBuilder } from './lib/media-url';
import { createPublisher } from './lib/publisher';
import { Semaphore } from './lib/semaphore';
import { connectClient, connectWorker } from './lib/temporal';

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const plan = workerPlan(env);
  console.log(`[worker] roles: ${env.WORKER_ROLES.join(', ')}`);

  // Clips first: a missing FFmpeg stops the boot before anything polls.
  let clipDeps: ClipActivityDeps | null = null;
  if (servesRole(env, 'media') || servesRole(env, 'render')) {
    clipDeps = await bootClips(env, { render: servesRole(env, 'render') });
  }

  const connection = await connectWorker(env);

  // The client is only needed by the maintenance reconcile and for starting
  // the maintenance workflow, so it is created once and shared lazily.
  let clientPromise: ReturnType<typeof connectClient> | null = null;
  const temporalClient = () => {
    clientPromise ??= connectClient(env);
    return clientPromise;
  };

  let publishingActivities: ReturnType<typeof createActivities> | null = null;
  if (servesRole(env, 'publishing')) {
    const publisher = createPublisher(env);
    const analytics = createAnalyticsSource(env);
    if (publisher.simulated) {
      console.warn(
        '[worker] PUBLISH_SIMULATION=true: posts are published to a stand-in, not to real platforms.',
      );
    }
    if (analytics.simulated) {
      console.warn(
        '[worker] ANALYTICS_SIMULATION=true: channel and post metrics come from a stand-in, not from the platforms.',
      );
    }
    if (env.AUTOMATION_SIMULATION === 'true') {
      console.warn(
        '[worker] AUTOMATION_SIMULATION=true: workflow steps that leave PostGear send to a stand-in, not to the outside apps.',
      );
    }
    publishingActivities = createActivities({
      env,
      publisher,
      analytics,
      publishGate: new Semaphore(env.WORKER_MAX_CONCURRENT_PUBLISHES),
      temporalClient,
      publicUrl: mediaUrlBuilder(env),
    });
  }
  const clipActivities = clipDeps ? createClipActivities(clipDeps) : null;

  // One bundle for every worker: bundling is the slow part of a boot.
  const workflowBundle = await bundleWorkflowCode({
    workflowsPath: require.resolve('./workflows'),
  });

  const workers: Worker[] = [];
  for (const planned of plan) {
    const activities = planned.activities === 'publishing' ? publishingActivities : clipActivities;
    if (!activities) throw new Error(`No activities were built for the ${planned.role} role.`);
    workers.push(
      await Worker.create({
        connection,
        namespace: env.TEMPORAL_NAMESPACE,
        taskQueue: planned.taskQueue,
        workflowBundle,
        activities,
        maxConcurrentActivityTaskExecutions: planned.maxConcurrentActivityTaskExecutions,
        shutdownGraceTime: planned.shutdownGraceTime,
        // Clip workers: a cancel reaches a running import or export within seconds.
        ...(planned.maxHeartbeatThrottleInterval
          ? { maxHeartbeatThrottleInterval: planned.maxHeartbeatThrottleInterval }
          : {}),
      }),
    );
  }

  if (servesRole(env, 'publishing')) {
    await ensureMaintenanceWorkflow(temporalClient);
  }

  let stopping = false;
  const stopAll = (why: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${why}, finishing in-flight activities…`);
    for (const worker of workers) {
      if (worker.getState() === 'RUNNING') worker.shutdown();
    }
  };
  process.once('SIGINT', () => stopAll('SIGINT received'));
  process.once('SIGTERM', () => stopAll('SIGTERM received'));

  const shortfall = mediaSlotShortfall(env);
  if (shortfall > 0) {
    console.warn(
      `[worker] WORKER_MEDIA_CONCURRENCY is ${env.WORKER_MEDIA_CONCURRENCY}, ${shortfall} fewer than CLIPS_MEDIA_SLOTS + CLIPS_MEDIA_PY_SLOTS: unless other media workers make up the rest, a listen can wait behind the Find Clips runs waiting for it`,
    );
  }

  for (const planned of plan) {
    console.log(
      `[worker] polling "${planned.taskQueue}" (${planned.role}, ${planned.maxConcurrentActivityTaskExecutions} activity slots) on ${env.TEMPORAL_HOST} (namespace ${env.TEMPORAL_NAMESPACE})`,
    );
  }

  const results = await Promise.allSettled(
    workers.map((worker, index) =>
      worker.run().catch((error: unknown) => {
        stopAll(`the ${plan[index].taskQueue} worker stopped on an error`);
        throw error;
      }),
    ),
  );
  await connection.close();

  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failed) throw failed.reason;
  console.log('[worker] stopped');
}

/**
 * Starts the reconcile loop if it is not already running.
 *
 * Idempotent by id: a second worker finds it started and moves on. Failure here
 * is logged, not fatal: the worker is still useful without its safety net, and
 * the next boot tries again.
 */
async function ensureMaintenanceWorkflow(
  temporalClient: () => ReturnType<typeof connectClient>,
): Promise<void> {
  try {
    const client = await temporalClient();
    await client.workflow.start(MAINTENANCE_WORKFLOW, {
      workflowId: MAINTENANCE_WORKFLOW_ID,
      taskQueue: SCHEDULING_TASK_QUEUE,
      args: [],
    });
    console.log('[worker] maintenance workflow started');
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      return;
    }

    console.warn(
      `[worker] could not start the maintenance workflow: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

main().catch((error) => {
  console.error('[worker] fatal:', error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
