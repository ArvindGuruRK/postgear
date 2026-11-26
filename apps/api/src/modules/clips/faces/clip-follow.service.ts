/**
 * Follow The Speaker for the clips a Find Clips run made (Sprint 13, Module
 * 08): the internal route the worker calls once the run has written its
 * clips (`POST /internal/clips/jobs/:jobId/follow-speaker`).
 *
 * The API decides, never the worker: the run's own setup (kept on the run
 * when it started) must have Follow The Speaker on, on a shape that can
 * follow. Then:
 * 1. Every clip of the run is marked `meta.followOnOpen = 'speaker'` (beside
 *    `seen`). Only a clip still at its first revision: one somebody already
 *    saved keeps what they made. The editor computes the path on first open.
 * 2. Faces are asked for the best three clips by score, through
 *    `ClipFacesService.ensure` (free; a covering file is reused, a covering
 *    job joined), so those open fast. The rest are found on first open.
 *
 * Nothing here fails the run: faces off (`faces_off`) stops the asking
 * quietly, any other refusal is counted. Logs carry ids and counts only.
 */
import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClipJobKind, prisma } from '@postgear/db';
import { canFollow, followFacesClipIds } from '@postgear/video-engine';
import { ClipErrorException } from '../clip-error.exception';
import { followsOnOpen, withFollowOnOpen } from '../clip/clip-meta';
import { readSetupParams } from '../highlights/clip-moments.service';
import { ClipFacesService } from './clip-faces.service';

/** The answer the worker reads (counts only). */
export interface FollowSpeakerAnswer {
  /** False when the run's setup did not ask to follow (nothing was done). */
  follow: boolean;
  /** Clips marked to follow on first open. */
  marked: number;
  /** Of the best clips: faces already there, a job started or joined, refused. */
  faces: { ready: number; running: number; failed: number };
  /** The media service was off: faces were not asked for. */
  facesOff: boolean;
}

@Injectable()
export class ClipFollowService {
  private readonly logger = new Logger(ClipFollowService.name);

  constructor(private readonly faces: ClipFacesService) {}

  /** `POST /internal/clips/jobs/:jobId/follow-speaker`: see the file comment. Safe to repeat. */
  async forRun(jobId: string, orgId: string): Promise<FollowSpeakerAnswer> {
    const job = await prisma.clipJob.findFirst({
      where: { id: jobId, organizationId: orgId, kind: ClipJobKind.HIGHLIGHTS },
      select: { id: true, highlightRunId: true },
    });
    if (!job?.highlightRunId) throw notFound();
    const run = await prisma.clipHighlightRun.findFirst({
      where: { id: job.highlightRunId, organizationId: orgId },
      select: { id: true, params: true },
    });
    if (!run) throw notFound();
    const answer: FollowSpeakerAnswer = {
      follow: false,
      marked: 0,
      faces: { ready: 0, running: 0, failed: 0 },
      facesOff: false,
    };
    const setup = readSetupParams(run.params)?.setup;
    if (!setup?.follow || !canFollow(setup.ratio)) return answer;
    answer.follow = true;

    const clips = await prisma.clip.findMany({
      where: { organizationId: orgId, highlightRunId: run.id },
      select: { id: true, score: true, meta: true, revision: true },
    });
    for (const clip of clips) {
      if (clip.revision !== 1 || followsOnOpen(clip.meta)) continue;
      // `revision: 1` again in the write: a save that lands between the read and here wins.
      const { count } = await prisma.clip.updateMany({
        where: { id: clip.id, organizationId: orgId, revision: 1 },
        data: { meta: withFollowOnOpen(clip.meta) },
      });
      answer.marked += count;
    }

    for (const clipId of followFacesClipIds(clips)) {
      try {
        const outcome = await this.faces.ensure(orgId, null, clipId);
        if (outcome.status === 'ready') answer.faces.ready += 1;
        else answer.faces.running += 1;
      } catch (error) {
        if (error instanceof ClipErrorException && error.clipCode === 'faces_off') {
          answer.facesOff = true;
          break;
        }
        answer.faces.failed += 1;
        this.logger.warn(
          JSON.stringify({
            event: 'clips.follow.faces_refused',
            orgId,
            jobId,
            clipId,
            status: error instanceof HttpException ? error.getStatus() : null,
          }),
        );
      }
    }

    this.logger.log(
      JSON.stringify({
        event: 'clips.follow.run',
        orgId,
        jobId,
        runId: run.id,
        clips: clips.length,
        marked: answer.marked,
        ...answer.faces,
        facesOff: answer.facesOff,
      }),
    );
    return answer;
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({ message: 'This job was not found.', code: 'job_not_found' });
}
