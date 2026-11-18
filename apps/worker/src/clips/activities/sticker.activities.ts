/**
 * The uploaded sticker check (Module 12) on `postgear-media-quick`:
 * `clipCheckSticker` makes a workspace's upload a PNG or APNG, or marks it
 * failed with the reason. See `stickers/check.ts`.
 */
import { runClipActivity } from '../activity-kit';
import type { ClipActivityDeps } from '../deps';
import { ClipStepError } from '../failures';
import { checkStickerUpload, type StickerCheckAnswer, type StickerCheckInput, type StickerCheckRows } from '../stickers/check';
import { prismaStickerCheckRows } from '../stickers/rows';

/** An asset id is a UUID; a workspace id is any plain id (the seed's is "seed-demo-org"). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function createStickerActivities(
  deps: Pick<ClipActivityDeps, 'privateStorage' | 'runTool' | 'scratchRoot'>,
  rows: StickerCheckRows = prismaStickerCheckRows,
) {
  return {
    async clipCheckSticker(input: StickerCheckInput): Promise<StickerCheckAnswer> {
      return runClipActivity('clipCheckSticker', undefined, async (run) => {
        if (!ORG_ID.test(input?.organizationId ?? '') || !UUID.test(input?.assetId ?? '')) {
          throw new ClipStepError('tool_failed', { retryable: false });
        }
        return checkStickerUpload(
          { rows, privateStorage: deps.privateStorage, runTool: deps.runTool, scratchRoot: deps.scratchRoot },
          { organizationId: input.organizationId, assetId: input.assetId },
          { signal: run.signal, attempt: run.attempt },
        );
      });
    },
  };
}
