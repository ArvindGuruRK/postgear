/**
 * A Media video's poster and length (Module 19) on `postgear-media`:
 *
 * - `mediaVideoFacts`: fetch, probe, poster, write (`media-facts/facts.ts`).
 * - `mediaVideoFactsGaveUp`: after the last attempt failed, the row is
 *   marked checked without facts, so it is not tried on every pass.
 *
 * Part of the clip activity set, so only a worker with the `media` or
 * `render` role registers it; a `publishing`-only worker has no FFmpeg and
 * never sees these.
 */
import { assertFreeDisk, probeFile, withScratch } from '@postgear/media-tools';
import type { MediaVideoFactsInput } from '@postgear/scheduling';
import { runClipActivity } from '../activity-kit';
import type { ClipActivityDeps } from '../deps';
import { ClipStepError } from '../failures';
import {
  type MediaFactsTools,
  type MediaVideoFactsOutcome,
  makeWebpPoster,
  runMediaVideoFacts,
} from '../media-facts/facts';
import { type MediaFactsRows, mediaFactsRows } from '../media-facts/rows';

export type { MediaVideoFactsOutcome } from '../media-facts/facts';

/** Media ids are UUIDs and a workspace id a plain id (the seed's is "seed-demo-org"); both end up in a folder name. */
const PLAIN_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Room for the largest Media video (250 MB) and its poster, with plenty to spare. */
const SCRATCH_BYTES = 512 * 1024 * 1024;

export interface MediaFactsActivityOptions {
  rows?: MediaFactsRows;
  tools?: MediaFactsTools;
  now?: () => Date;
}

function checkedInput(input: MediaVideoFactsInput): MediaVideoFactsInput {
  if (!PLAIN_ID.test(input?.organizationId ?? '') || !PLAIN_ID.test(input?.mediaId ?? '')) {
    throw new ClipStepError('tool_failed', { retryable: false });
  }
  return { organizationId: input.organizationId, mediaId: input.mediaId };
}

function log(event: string, meta: Record<string, unknown>): void {
  console.warn(JSON.stringify({ event, ...meta }));
}

export function createMediaFactsActivities(
  deps: Pick<ClipActivityDeps, 'storage' | 'runTool' | 'scratchRoot'>,
  options: MediaFactsActivityOptions = {},
) {
  const rows = options.rows ?? mediaFactsRows();
  const now = options.now ?? (() => new Date());
  const tools: MediaFactsTools = options.tools ?? {
    probe: (file, opts) => probeFile(deps.runTool, file, opts),
    poster: (opts) => makeWebpPoster({ ...opts, runTool: deps.runTool }),
  };

  return {
    async mediaVideoFacts(input: MediaVideoFactsInput): Promise<MediaVideoFactsOutcome> {
      return runClipActivity('mediaVideoFacts', input?.mediaId, async (activity) => {
        const ref = checkedInput(input);
        const scratchId = activity.scratchId(`media-${ref.mediaId}`);
        return runMediaVideoFacts(
          {
            rows,
            storage: deps.storage,
            tools,
            now,
            heartbeat: activity.heartbeat,
            signal: activity.signal,
            log,
            scratch: (fn) =>
              withScratch(deps.scratchRoot, scratchId, async (dir) => {
                await assertFreeDisk(dir, SCRATCH_BYTES);
                return fn(dir);
              }),
          },
          ref,
        );
      });
    },

    async mediaVideoFactsGaveUp(input: MediaVideoFactsInput): Promise<void> {
      const ref = checkedInput(input);
      await rows.markChecked(ref.organizationId, ref.mediaId, now());
    },
  };
}
