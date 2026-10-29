/**
 * PostGear worker: the process that publishes.
 *
 * One Temporal worker on one task queue, running the workflows in
 * `./workflows` and the activities in `./activities`. The API never publishes
 * anything itself; it writes rows and signals workflows, and this process does
 * the rest, which is what lets a post go out with no browser open and no API
 * instance awake.
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
import { Worker } from '@temporalio/worker';
import { createActivities } from './activities';
import { loadWorkerEnv } from './config/env';
import { createAnalyticsSource } from './lib/analytics-source';
import { mediaUrlBuilder } from './lib/media-url';
import { createPublisher } from './lib/publisher';
import { Semaphore } from './lib/semaphore';
import { connectClient, connectWorker } from './lib/temporal';

/**
 * Activity slots on this worker. Well above the publish cap: the quick
 * database activities every timer needs must never queue behind slow uploads,
 * which the publish gate rations on its own.
 */
const MAX_CONCURRENT_ACTIVITIES = 64;

async function main(): Promise<void> {
  const env = loadWorkerEnv();
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

  const connection = await connectWorker(env);

  // The client is only needed by the maintenance reconcile and for starting
  // the maintenance workflow, so it is created once and shared lazily.
  let clientPromise: ReturnType<typeof connectClient> | null = null;
  const temporalClient = () => {
    clientPromise ??= connectClient(env);
    return clientPromise;
  };

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: SCHEDULING_TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities: createActivities({
      env,
      publisher,
      analytics,
      publishGate: new Semaphore(env.WORKER_MAX_CONCURRENT_PUBLISHES),
      temporalClient,
      publicUrl: mediaUrlBuilder(env),
    }),
    maxConcurrentActivityTaskExecutions: MAX_CONCURRENT_ACTIVITIES,
    // A graceful stop lets an in-flight publish finish rather than cutting it
    // off after the default ten seconds: a cut-off call is the one way a post
    // could go out twice.
    shutdownGraceTime: '11 minutes',
  });

  await ensureMaintenanceWorkflow(temporalClient);

  const shutdown = (signal: string) => {
    console.log(`[worker] ${signal} received, finishing in-flight activities…`);
    worker.shutdown();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  console.log(
    `[worker] polling "${SCHEDULING_TASK_QUEUE}" on ${env.TEMPORAL_HOST} (namespace ${env.TEMPORAL_NAMESPACE})`,
  );

  await worker.run();
  await connection.close();
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
