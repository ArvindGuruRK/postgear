/**
 * Every clip activity, built from one set of clip dependencies. Registered on
 * the `postgear-media`, `postgear-media-quick` and `postgear-render` workers;
 * Temporal routes each task by its queue, so registering the full set on each
 * is harmless and keeps one list.
 *
 * Workflows import only the *type* of this object (`import type`), so nothing
 * here (Prisma, FFmpeg, storage clients) reaches the workflow sandbox.
 */
import type { ClipActivityDeps } from '../deps';
import { type ClipJobActivityOptions, createJobActivities } from './jobs.activities';
import { createProbeActivities } from './probe.activities';
import { createRuntimeActivities } from './runtime.activities';

export type { ClipWorkResult, RenderWaitState } from './jobs.activities';

export function createClipActivities(deps: ClipActivityDeps, options: ClipJobActivityOptions = {}) {
  return {
    ...createRuntimeActivities(deps),
    // Module 03: the probe and the channel list (postgear-media-quick).
    ...createProbeActivities(deps),
    // Modules 04 and 05: import, sharp range, export, and their bookkeeping.
    ...createJobActivities(deps, options),
  };
}

export type ClipActivities = ReturnType<typeof createClipActivities>;
