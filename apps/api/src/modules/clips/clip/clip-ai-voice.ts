/**
 * Whether a clip plays a made-up voice (Sprint 13, Module 09): any sound
 * item of its document refers to one of the workspace's sounds whose meta
 * says `madeByAi: true` (a voice Text To Speech made). The clip view carries
 * it as `usesAiVoice`, which Module 13 reads to suggest the AI label (D13-10:
 * only for a made-up voice, never for captions, cuts or following a speaker).
 *
 * One small query, and only when the document plays an uploaded sound.
 */
import { prisma } from '@postgear/db';
import { type ClipDocument, soundFilesNeeded } from '@postgear/video-engine';
import { isUuid } from '../clips.ids';

export async function documentUsesAiVoice(
  orgId: string,
  document: Pick<ClipDocument, 'tracks'> | null,
): Promise<boolean> {
  if (!document) return false;
  const ids = soundFilesNeeded(document).flatMap((file) =>
    'asset' in file && isUuid(file.asset) ? [file.asset] : [],
  );
  if (ids.length === 0) return false;
  const found = await prisma.clipAsset.findFirst({
    where: {
      organizationId: orgId,
      id: { in: ids },
      kind: 'AUDIO',
      meta: { path: ['madeByAi'], equals: true },
    },
    select: { id: true },
  });
  return found !== null;
}
