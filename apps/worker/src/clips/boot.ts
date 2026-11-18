/**
 * Which Temporal workers this process runs, and the Clips setup the `media`
 * and `render` roles need (Module 02, section 3).
 *
 * `workerPlan` is pure so the role switch is tested without Temporal:
 * - `publishing`: the existing worker on `postgear-scheduling`, unchanged.
 * - `media`: `postgear-media` (imports, sharp ranges, downloads) with
 *   `WORKER_MEDIA_CONCURRENCY` slots, and `postgear-media-quick` (probe,
 *   channel list, runtime check) with its own slots, so a person waiting on
 *   a probe never queues behind two long imports.
 * - `render`: `postgear-render` with `RENDER_CONCURRENCY` slots (default 1:
 *   FFmpeg uses every core by itself).
 */
import { mkdir } from 'node:fs/promises';
import { createRunTool, toolPaths } from '@postgear/media-tools';
import {
  MEDIA_QUICK_CONCURRENCY,
  MEDIA_QUICK_TASK_QUEUE,
  MEDIA_TASK_QUEUE,
  RENDER_TASK_QUEUE,
  SCHEDULING_TASK_QUEUE,
  type WorkerRole,
} from '@postgear/scheduling';
import { createPrivateStorage, createStorage } from '@postgear/storage';
import type { Duration } from '@temporalio/common';
import type { WorkerEnv } from '../config/env';
import {
  clipsSimulated,
  privateStorageConfigFrom,
  publicStorageConfigFrom,
  scratchRootFrom,
} from './config';
import type { ClipActivityDeps } from './deps';
import { createClipInternalClient } from './internal-client';
import { createClipProviders } from './providers';
import { bootRefusal, createClipRuntime, doctorLogLines } from './runtime';

/** Activity slots on the publishing worker (see the comment in `index.ts`). */
export const PUBLISHING_ACTIVITY_SLOTS = 64;

export interface PlannedWorker {
  role: WorkerRole;
  taskQueue: string;
  /** Which activity set it registers. */
  activities: 'publishing' | 'clips';
  maxConcurrentActivityTaskExecutions: number;
  /** How long a graceful stop waits for running activities. */
  shutdownGraceTime: Duration;
  /**
   * Clip workers only: the longest gap between heartbeats the SDK sends. A
   * cancel reaches an activity only in a heartbeat's answer, so this is how
   * quickly a cancelled import or export stops (the default is 60 seconds).
   */
  maxHeartbeatThrottleInterval?: Duration;
}

/** How quickly a clip activity hears a cancel. */
export const CLIP_HEARTBEAT_THROTTLE: Duration = '5 seconds';

export function workerPlan(
  env: Pick<WorkerEnv, 'WORKER_ROLES' | 'WORKER_MEDIA_CONCURRENCY' | 'RENDER_CONCURRENCY'>,
): PlannedWorker[] {
  const roles = new Set(env.WORKER_ROLES);
  const plan: PlannedWorker[] = [];
  if (roles.has('publishing')) {
    plan.push({
      role: 'publishing',
      taskQueue: SCHEDULING_TASK_QUEUE,
      activities: 'publishing',
      maxConcurrentActivityTaskExecutions: PUBLISHING_ACTIVITY_SLOTS,
      // A cut-off publish is the one way a post could go out twice.
      shutdownGraceTime: '11 minutes',
    });
  }
  if (roles.has('media')) {
    plan.push({
      role: 'media',
      taskQueue: MEDIA_TASK_QUEUE,
      activities: 'clips',
      maxConcurrentActivityTaskExecutions: env.WORKER_MEDIA_CONCURRENCY,
      // An import can run for hours: a stop cancels it (heartbeats carry the
      // cancel to FFmpeg) and Temporal retries it on the next worker.
      shutdownGraceTime: '1 minute',
      maxHeartbeatThrottleInterval: CLIP_HEARTBEAT_THROTTLE,
    });
    plan.push({
      role: 'media',
      taskQueue: MEDIA_QUICK_TASK_QUEUE,
      activities: 'clips',
      maxConcurrentActivityTaskExecutions: MEDIA_QUICK_CONCURRENCY,
      shutdownGraceTime: '30 seconds',
      maxHeartbeatThrottleInterval: CLIP_HEARTBEAT_THROTTLE,
    });
  }
  if (roles.has('render')) {
    plan.push({
      role: 'render',
      taskQueue: RENDER_TASK_QUEUE,
      activities: 'clips',
      maxConcurrentActivityTaskExecutions: env.RENDER_CONCURRENCY,
      shutdownGraceTime: '1 minute',
      maxHeartbeatThrottleInterval: CLIP_HEARTBEAT_THROTTLE,
    });
  }
  return plan;
}

/**
 * Builds the clip dependencies: tool paths, the doctor (logged, and fatal for
 * a missing FFmpeg or, with `render`, a build that cannot render), both
 * storage spaces, the providers and the internal client. Throws a plain
 * sentence when the boot must stop.
 */
export async function bootClips(
  env: WorkerEnv,
  roles: { render: boolean },
): Promise<ClipActivityDeps> {
  const paths = toolPaths(env as unknown as Record<string, string | undefined>);
  const runTool = createRunTool(paths);
  const scratchRoot = scratchRootFrom(env);
  await mkdir(scratchRoot, { recursive: true });

  const simulation = clipsSimulated(env);
  const runtime = createClipRuntime({
    runTool,
    paths,
    simulation,
    platforms: env.CLIPS_PLATFORMS,
    scratchRoot,
  });
  const report = await runtime.doctor(true);
  for (const line of doctorLogLines(report, { simulation })) console.log(line);

  const refusal = bootRefusal(report, roles);
  if (refusal) throw new Error(refusal);

  if (simulation) {
    console.warn(
      '[worker] CLIPS_SIMULATION=true: links are answered from fixtures and the sample videos; nothing is fetched from YouTube, Twitch or Kick.',
    );
  } else if (!report.linksOk) {
    console.warn(
      '[worker:clips] yt-dlp is not ready, so link imports will fail. Uploads and exports still work.',
    );
  }
  if (!env.AUTOMATION_INTERNAL_TOKEN) {
    console.warn(
      '[worker:clips] AUTOMATION_INTERNAL_TOKEN is not set: upload charges, refunds and finished exports cannot reach the API.',
    );
  }

  return {
    env,
    storage: createStorage(publicStorageConfigFrom(env)),
    privateStorage: createPrivateStorage(privateStorageConfigFrom(env)),
    runTool,
    paths,
    scratchRoot,
    providers: createClipProviders({ env, runTool, paths, scratchRoot }),
    runtime,
    internal: createClipInternalClient({
      apiUrl: env.API_URL,
      token: env.AUTOMATION_INTERNAL_TOKEN,
    }),
  };
}
