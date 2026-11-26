/**
 * The rows Text To Speech reads (Sprint 13, Module 09): a clip's SPEECH jobs
 * and whether the sound a finished one made is still in the workspace. Every
 * query is scoped to the workspace; an id from the URL is never enough.
 */
import { Injectable } from '@nestjs/common';
import { type ClipJob, ClipJobKind, prisma } from '@postgear/db';
import type { ClipsTx } from '../clips.tx';

/** The most of a clip's voice jobs looked at for a repeat (newest first). */
export const VOICE_JOBS_LOOKED_AT = 100;

@Injectable()
export class ClipVoiceRepository {
  /** The clip's SPEECH jobs, newest first. */
  speechJobs(orgId: string, clipId: string, tx: ClipsTx = prisma): Promise<ClipJob[]> {
    return tx.clipJob.findMany({
      where: { organizationId: orgId, clipId, kind: ClipJobKind.SPEECH },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: VOICE_JOBS_LOOKED_AT,
    });
  }

  /** True when the workspace still has this made sound (an AUDIO asset). */
  async soundExists(orgId: string, assetId: string, tx: ClipsTx = prisma): Promise<boolean> {
    const row = await tx.clipAsset.findFirst({
      where: { id: assetId, organizationId: orgId, kind: 'AUDIO' },
      select: { id: true },
    });
    return row !== null;
  }

  /** Takes back a job row whose charge was refused (it never started). */
  async removeJob(orgId: string, jobId: string): Promise<void> {
    await prisma.clipJob.deleteMany({
      where: { id: jobId, organizationId: orgId, kind: ClipJobKind.SPEECH, status: 'QUEUED' },
    });
  }
}
