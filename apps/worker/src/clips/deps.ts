/**
 * What every clip activity is built with (the `media` and `render` roles).
 *
 * Kept apart from the publishing `ActivityDeps` on purpose: a worker started
 * with `WORKER_ROLES=publishing` builds none of this (no storage clients, no
 * doctor, no FFmpeg), so publishing never depends on video tools being
 * installed.
 */
import type { RunTool, ToolPaths } from '@postgear/media-tools';
import type { PrivateStorage, StorageBackend } from '@postgear/storage';
import type { WorkerEnv } from '../config/env';
import type { ClipInternalClient } from './internal-client';
import type { ClipProviders } from './providers';
import type { ClipRuntime } from './runtime';

export interface ClipActivityDeps {
  env: WorkerEnv;
  /** The public media space: finished exports and their posters (they become Media rows). */
  storage: StorageBackend;
  /** The private clips space: originals, light copies, filmstrips, sharp ranges. */
  privateStorage: PrivateStorage;
  runTool: RunTool;
  paths: ToolPaths;
  /** `CLIPS_SCRATCH_DIR` resolved: every job works in `<scratchRoot>/<jobId>/`. */
  scratchRoot: string;
  providers: ClipProviders;
  runtime: ClipRuntime;
  internal: ClipInternalClient;
}
