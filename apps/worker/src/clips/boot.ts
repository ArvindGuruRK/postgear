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
import {
  createRunTool,
  defaultWatermarkFile,
  type FontsFolder,
  loadFontsFolder,
  loadWatermark,
  toolPaths,
  type WatermarkFile,
  clearStaleScratch,
} from '@postgear/media-tools';
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
import { servesRole, type WorkerEnv } from '../config/env';
import {
  clipsSimulated,
  fontsDirFrom,
  privateStorageConfigFrom,
  publicStorageConfigFrom,
  scratchRootFrom,
} from './config';
import type { ClipActivityDeps } from './deps';
import { createClipInternalClient } from './internal-client';
import { createClipProviders } from './providers';
import { bootRefusal, createClipRuntime, doctorLogLines } from './runtime';
import { selfUpdateYtDlp } from './yt-dlp-update';

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
 * The fonts folder for text in exports. Missing is a warning, not a stop:
 * clips without text still export, and one with text fails `font_missing`.
 * An unreadable or old manifest stops a render worker (the build must be rerun).
 */
async function loadClipFonts(env: WorkerEnv, roles: { render: boolean }): Promise<FontsFolder | null> {
  const dir = fontsDirFrom(env);
  if (!dir) {
    if (roles.render) {
      console.warn('[worker:clips] CLIPS_FONTS_DIR is not set: exports with text will fail.');
    }
    return null;
  }
  try {
    const folder = await loadFontsFolder(dir);
    if (!folder && roles.render) {
      console.warn(
        `[worker:clips] No fonts in ${dir}: exports with text will fail. Run npm run clips:fonts:build.`,
      );
    }
    return folder;
  } catch (error) {
    if (!roles.render) return null;
    throw new Error(
      `The fonts manifest in ${dir} cannot be read (${(error as Error).message}). Run npm run clips:fonts:build.`,
    );
  }
}

/**
 * The "Made with PostGear" mark for exports on a plan without the
 * watermark-free feature (Module 15). Missing is a warning: an export that
 * asks for the mark then fails, every other export works.
 */
async function loadClipWatermark(roles: { render: boolean }): Promise<WatermarkFile | null> {
  const file = defaultWatermarkFile();
  const mark = file ? await loadWatermark(file) : null;
  if (!mark && roles.render) {
    console.warn(
      '[worker:clips] The watermark (packages/media-tools/assets/watermark.png) is missing: exports that carry the mark will fail. Run npm run watermark:make --workspace=@postgear/media-tools.',
    );
  }
  return mark;
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
  const scratchRoot = scratchRootFrom(env);
  await mkdir(scratchRoot, { recursive: true });
  // Module 19: job folders a crash left behind (idle for two hours) go before any job runs.
  const cleared = await clearStaleScratch(scratchRoot);
  if (cleared > 0) console.log(`[clips] Removed ${cleared} scratch folders left by an earlier crash.`);

  const simulation = clipsSimulated(env);
  // Module 20: with YTDLP_SELF_UPDATE, jobs use an updated copy of yt-dlp from the scratch folder.
  const { paths } = await selfUpdateYtDlp({
    enabled: env.YTDLP_SELF_UPDATE === 'true',
    simulation,
    importsLinks: servesRole(env, 'media'),
    paths: toolPaths(env as unknown as Record<string, string | undefined>),
    scratchRoot,
  });
  const runTool = createRunTool(paths);
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
  const fonts = await loadClipFonts(env, roles);
  const watermark = await loadClipWatermark(roles);

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
    fonts,
    watermark,
    providers: createClipProviders({ env, runTool, paths, scratchRoot }),
    runtime,
    internal: createClipInternalClient({
      apiUrl: env.API_URL,
      token: env.AUTOMATION_INTERNAL_TOKEN,
    }),
  };
}
