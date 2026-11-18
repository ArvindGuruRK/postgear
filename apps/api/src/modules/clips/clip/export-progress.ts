/**
 * The card's export ring (Module 15): how far each clip's newest QUEUED or
 * RUNNING export is, Preview Export left out. Kept apart from the services
 * so the video page and the Clips tab read it without importing each other.
 */
import { ClipJobKind, prisma } from '@postgear/db';
import { OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';

/** Only a RENDER job with this `proof` flag: every RENDER input carries the flag. */
export function proofIs(proof: boolean): { path: string[]; equals: boolean } {
  return { path: ['proof'], equals: proof };
}

/**
 * The progress (0 to 100) of each clip's newest open export, in one query
 * for a page of clips. A clip with none is absent from the map.
 */
export async function exportProgressOf(
  orgId: string,
  clipIds: readonly string[],
): Promise<Map<string, number>> {
  const progress = new Map<string, number>();
  if (clipIds.length === 0) return progress;
  const open = await prisma.clipJob.findMany({
    where: {
      organizationId: orgId,
      clipId: { in: [...clipIds] },
      kind: ClipJobKind.RENDER,
      status: { in: [...OPEN_JOB_STATUSES] },
      input: proofIs(false),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { clipId: true, progress: true },
  });
  for (const job of open) {
    if (job.clipId && !progress.has(job.clipId)) {
      progress.set(job.clipId, Math.max(0, Math.min(100, Math.round(job.progress))));
    }
  }
  return progress;
}
