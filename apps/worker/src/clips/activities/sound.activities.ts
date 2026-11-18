/**
 * The uploaded sound check (Module 14) on `postgear-media-quick`:
 * `clipCheckSound` makes a workspace's upload the editor's AAC `.m4a` with
 * its peaks, or marks it failed with the reason. See `sounds/check.ts`.
 */
import { runClipActivity } from '../activity-kit';
import type { ClipActivityDeps } from '../deps';
import { ClipStepError } from '../failures';
import {
  checkSoundUpload,
  type SoundCheckAnswer,
  type SoundCheckInput,
  type SoundCheckRows,
} from '../sounds/check';
import { prismaSoundCheckRows } from '../sounds/rows';

/** An asset id is a UUID; a workspace id is any plain id (the seed's is "seed-demo-org"). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function createSoundActivities(
  deps: Pick<ClipActivityDeps, 'privateStorage' | 'runTool' | 'scratchRoot'>,
  rows: SoundCheckRows = prismaSoundCheckRows,
) {
  return {
    async clipCheckSound(input: SoundCheckInput): Promise<SoundCheckAnswer> {
      return runClipActivity('clipCheckSound', undefined, async (run) => {
        if (!ORG_ID.test(input?.organizationId ?? '') || !UUID.test(input?.assetId ?? '')) {
          throw new ClipStepError('tool_failed', { retryable: false });
        }
        return checkSoundUpload(
          {
            rows,
            privateStorage: deps.privateStorage,
            runTool: deps.runTool,
            scratchRoot: deps.scratchRoot,
          },
          { organizationId: input.organizationId, assetId: input.assetId },
          { signal: run.signal, attempt: run.attempt },
        );
      });
    },
  };
}
