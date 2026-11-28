/**
 * Look For Action's check on stills (Sprint 13, Module 06): the internal
 * route a Find Clips run calls at its `watching` stage, only when the run
 * started with `CLIPS_ACTION_VISION` on (kept on the run, D13-07).
 *
 * The API holds the model client and its keys, so it does the looking:
 * 1. The job must be this workspace's highlights run, and the run must have
 *    started with the vision check on (409 otherwise).
 * 2. Every still key is checked to be one of this job's own still keys
 *    (`clips/<org>/<video>/still-<n>-<job hex>.jpg`); anything else is
 *    refused before a byte is read, so a worker bug can never send another
 *    workspace's picture.
 * 3. The stills are read (each at most 512 KB) and sent as bytes, never as an
 *    address, to the still checker: closed questions, one sentence back.
 * 4. The answer is one verdict a burst (null for a failed call). The worker
 *    blends it and deletes the stills when the run ends.
 *
 * No charge here: Look For Action was charged once when the run started, and
 * it costs the same with the still check on or off. Module 15: that charge
 * (`clips.ai:action:<jobId>`) must still stand, or nothing is sent (409
 * `highlights_failed`), so no picture reaches the model unpaid. Pictures, prompts and
 * answers are never logged: counts and ids only.
 */
import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClipJobKind, prisma } from '@postgear/db';
import type {
  ClipCheckStillsAnswer,
  ClipCheckStillsBody,
  ClipStillVerdict,
} from '@postgear/scheduling';
import type { ModelImage, StillCheckBurst } from '@postgear/ai-engine';
import { AI_ENGINE, type AiEngine } from '../../ai/engine/engine.types';
import { PRIVATE_STORAGE, type PrivateStorage } from '../../media/storage/storage.interface';
import { ClipErrorException } from '../clip-error.exception';
import { liveChargeUnder } from '../clips-ai-charges';
import { actionChargeKey } from './clip-highlights.service';
import { readSetupParams } from './clip-moments.service';

/** A still larger than this is not a still the media service made. */
export const STILL_MAX_BYTES = 512 * 1024;
/** The highest still index a run can write (48 stills). */
const STILL_INDEX_MAX = 47;

/** This job's own still keys, by the shape the media service writes them. */
export function isJobStillKey(key: string, orgId: string, videoId: string, jobId: string): boolean {
  const hex = jobId.replace(/-/g, '').toLowerCase();
  const prefix = `clips/${orgId}/${videoId}/still-`;
  if (!key.startsWith(prefix)) return false;
  const match = /^(\d{1,2})-([0-9a-f]{32})\.jpg$/.exec(key.slice(prefix.length));
  if (!match) return false;
  const index = Number(match[1]);
  return match[2] === hex && index >= 0 && index <= STILL_INDEX_MAX && String(index) === match[1];
}

@Injectable()
export class ClipStillsService {
  private readonly logger = new Logger(ClipStillsService.name);

  constructor(
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
    @Inject(AI_ENGINE) private readonly ai: AiEngine,
  ) {}

  /** `POST /internal/clips/jobs/:jobId/check-stills`. */
  async check(jobId: string, body: ClipCheckStillsBody): Promise<ClipCheckStillsAnswer> {
    const orgId = body.organizationId;
    const job = await prisma.clipJob.findFirst({
      where: { id: jobId, organizationId: orgId, kind: ClipJobKind.HIGHLIGHTS },
      select: { id: true, videoId: true, highlightRunId: true },
    });
    if (!job?.videoId || !job.highlightRunId) throw notFound();
    const run = await prisma.clipHighlightRun.findFirst({
      where: { id: job.highlightRunId, organizationId: orgId },
      select: { params: true },
    });
    const params = run ? readSetupParams(run.params) : null;
    if (!params?.setup.action || !params.actionVision) {
      throw new ClipErrorException(HttpStatus.CONFLICT, 'highlights_failed');
    }
    const videoId = job.videoId;
    for (const burst of body.bursts) {
      for (const key of burst.stillKeys) {
        if (!isJobStillKey(key, orgId, videoId, jobId)) throw notFound();
      }
    }
    // Module 15: pictures go to the model only while the run's Look For Action charge stands
    // (none made, or given back when the motion measure failed or the run ended).
    if ((await liveChargeUnder(orgId, actionChargeKey(job.id))) <= 0) {
      this.logger.warn(JSON.stringify({ event: 'clips.stills.uncharged', jobId: job.id }));
      throw new ClipErrorException(HttpStatus.CONFLICT, 'highlights_failed');
    }

    const writer = this.ai.createSnippetWriter({ orgId });
    if (!writer) throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'captions_off');

    const bursts: StillCheckBurst[] = [];
    let missing = 0;
    for (const burst of body.bursts) {
      const images: ModelImage[] = [];
      for (const key of burst.stillKeys) {
        const bytes = await this.readStill(key);
        if (bytes) images.push({ mimeType: 'image/jpeg', base64: bytes.toString('base64') });
        else missing += 1;
      }
      bursts.push({
        images,
        momentSec: burst.momentSec,
        spanSec: burst.spanSec,
        withSound: burst.withSound,
      });
    }

    let verdicts: Array<ClipStillVerdict | null>;
    try {
      verdicts = await writer.checkStills({ bursts });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.stills.check_failed',
          jobId,
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
      throw new ClipErrorException(HttpStatus.BAD_GATEWAY, 'highlights_failed');
    }
    // A burst with no picture read was never looked at: unchecked, not "nothing".
    verdicts = verdicts.map((verdict, index) =>
      (bursts[index]?.images.length ?? 0) === 0 ? null : verdict,
    );
    this.logger.log(
      JSON.stringify({
        event: 'clips.stills.checked',
        jobId,
        bursts: bursts.length,
        stillsMissing: missing,
        notable: verdicts.filter((verdict) => verdict?.notable).length,
        failed: verdicts.filter((verdict) => verdict === null).length,
      }),
    );
    return { verdicts };
  }

  /** One still's bytes, or null when it is gone or too large. */
  private async readStill(key: string): Promise<Buffer | null> {
    const opened = await this.storage.getStream(key);
    if (!opened) return null;
    if (opened.totalBytes > STILL_MAX_BYTES) {
      opened.body.destroy();
      return null;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of opened.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({ message: 'This job was not found.', code: 'job_not_found' });
}
