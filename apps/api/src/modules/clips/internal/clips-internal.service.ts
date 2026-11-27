/**
 * What the worker asks of the API for Clips (Sprint 12, Modules 04 and 05):
 * the usage ledger, the Media library and starting the next waiting job.
 * The worker writes job, video and asset rows itself, as publishing does;
 * it never holds the ledger or makes a Media row. Every call is idempotent,
 * so a retried activity simply calls again.
 *
 * - **charge-import**: an upload's import minutes, once the file's length is
 *   known. The same `UsageService.consume` and the same key as a link import
 *   (`clips.import:<jobId>`), so a replay charges once; answers the charged
 *   thousandths, also when an earlier attempt already charged. A refusal is
 *   the typed 402 (`clips_minutes_used`).
 * - **reverse**: every charge made for the job, in full. Never refused.
 * - **finish-export**: the export becomes a Media row, the clip is marked
 *   exported at the frozen revision, the job's output names the Media row
 *   and the bell says so. One serializable transaction: two calls at once
 *   make one Media row, and a second call answers the first one's id.
 * - **finish-save-download** (Module 18): Save To Media's copy of a finished
 *   download becomes a Media row (`origin: 'upload'`: the person's own file,
 *   not a clip), and the download's `output.media` says `saved`. One
 *   serializable transaction, so a retried call answers the same row; a call
 *   for a download that is not saving (deleted, or never asked) is a 409.
 * - **settled**: a job ended; start the workspace's waiting imports and
 *   the exports the fair render queue allows (Sprint 13, Module 11), and,
 *   for an export of a batch, write the batch's one notice when it was the
 *   last to end. An export of a batch rings no bell of its own at
 *   finish-export: the batch notice counts it.
 * - **auto-edit** and **apply-recipe** (Sprint 13, Module 10): an AUTO_EDIT
 *   job's clip, and a Find Clips run's recipe on its clips, both made by
 *   `ClipRecipeApplierService`.
 * - Tenancy: every job is looked up by its id AND the workspace the body
 *   names, so a mixed-up call is a 404, never a write to another workspace.
 */
import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ClipJobKind, ClipJobStatus, type Prisma, prisma } from '@postgear/db';
import type {
  ClipApplyRecipeAnswer,
  ClipAutoEditAnswer,
  ClipChargeImportAnswer,
  ClipFinishExportAnswer,
  ClipFinishSaveDownloadAnswer,
  ClipReverseAnswer,
  ClipSettledAnswer,
} from '@postgear/scheduling';
import {
  autoEditInputSchema,
  type DownloadMedia,
  downloadOutputSchema,
} from '@postgear/video-engine';
import { UsageService } from '../../entitlements/usage.service';
import { MediaService } from '../../media/media.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';
import { readSetupParams } from '../highlights/clip-moments.service';
import { serializable } from '../clips.tx';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipRecipeApplierService } from '../recipes/clip-recipe-applier.service';
import { batchIdOf, ClipBatchNoticeService } from '../exports/clip-batch-notice.service';
import { exportReadyNotice } from './clip-notices';
import type {
  ChargeImportBody,
  FinishExportBody,
  FinishSaveDownloadBody,
  OrgOnlyBody,
  ReverseBody,
} from './clips-internal.schema';

const OPEN: readonly ClipJobStatus[] = [ClipJobStatus.QUEUED, ClipJobStatus.RUNNING];

@Injectable()
export class ClipsInternalService {
  private readonly logger = new Logger(ClipsInternalService.name);

  constructor(
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly usage: UsageService,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
    // Sprint 13, Module 10: Auto-Edit's clip and a run's recipe (optional only for older specs).
    @Optional() private readonly recipes?: ClipRecipeApplierService,
    // Sprint 13, Module 11: Export All's one notice (optional only for older specs).
    @Optional() private readonly batchNotices?: ClipBatchNoticeService,
  ) {}

  /**
   * Module 10, `POST .../auto-edit`: an AUTO_EDIT job's last stage. The job
   * must be this workspace's AUTO_EDIT job and still open; its input names
   * the clip id, so a retried call answers the clip already made (also once
   * the job is closed). A closed job whose clip was never made is a 409.
   */
  async autoEdit(jobId: string, body: OrgOnlyBody): Promise<ClipAutoEditAnswer> {
    const job = await this.requireJob(body.organizationId, jobId);
    if (job.kind !== ClipJobKind.AUTO_EDIT || !this.recipes) throw jobNotFound();
    const input = autoEditInputSchema.safeParse(job.input);
    if (!input.success) throw jobNotFound();
    if (!OPEN.includes(job.status)) {
      const made = await prisma.clip.findFirst({
        where: { id: input.data.clipId, organizationId: body.organizationId },
        select: { id: true },
      });
      if (!made) {
        throw new ConflictException({ message: CLIPS_MESSAGES.JOB_FINISHED, code: 'job_finished' });
      }
    }
    return this.recipes.createAutoEditClip(body.organizationId, job.createdById, {
      clipId: input.data.clipId,
      videoId: input.data.videoId,
      recipeId: input.data.recipeId,
      range: input.data.range,
    });
  }

  /**
   * Module 10, `POST .../apply-recipe`: a Find Clips run's recipe (with its
   * setup on top) on the run's new clips. The job must be this workspace's
   * HIGHLIGHTS job (checked by the applier, as the follow route does).
   */
  async applyRecipe(jobId: string, body: OrgOnlyBody): Promise<ClipApplyRecipeAnswer> {
    if (!isUuid(jobId) || !this.recipes) throw jobNotFound();
    return this.recipes.applyToRun(body.organizationId, jobId);
  }

  async chargeImport(jobId: string, body: ChargeImportBody): Promise<ClipChargeImportAnswer> {
    const job = await this.requireJob(body.organizationId, jobId);
    if (job.kind !== ClipJobKind.IMPORT) throw jobNotFound();

    if (!OPEN.includes(job.status)) {
      // A closed job is never charged now; an earlier attempt's charge is still answered.
      const earlier = await this.chargeOf(body.organizationId, jobId);
      if (earlier !== null) return { charged: true, units: earlier };
      throw new ConflictException({ message: CLIPS_MESSAGES.JOB_FINISHED, code: 'job_finished' });
    }

    const result = await this.limits.chargeImport(body.organizationId, jobId, body.durationMs);
    const units = await this.entryUnits(body.organizationId, result.entryId);
    return { charged: true, units };
  }

  async reverseCharges(jobId: string, body: ReverseBody): Promise<ClipReverseAnswer> {
    if (!isUuid(jobId)) throw jobNotFound();
    if (body.step === 'action') return { reversed: await this.reverseAction(jobId, body) };
    return { reversed: await this.usage.reverseAllFor(body.organizationId, jobId) };
  }

  /**
   * Module 06: Look For Action's charge only, when its motion measure failed
   * and the run went on without it. The entry is read from the run (never
   * from the worker), so only this job's own action charge can be given back.
   */
  private async reverseAction(jobId: string, body: ReverseBody): Promise<number> {
    const job = await prisma.clipJob.findFirst({
      where: { id: jobId, organizationId: body.organizationId, kind: ClipJobKind.HIGHLIGHTS },
      select: { highlightRunId: true },
    });
    if (!job?.highlightRunId) throw jobNotFound();
    const run = await prisma.clipHighlightRun.findFirst({
      where: { id: job.highlightRunId, organizationId: body.organizationId },
      select: { params: true },
    });
    const entry = run ? readSetupParams(run.params)?.charges.action : null;
    if (!entry) return 0;
    const reversed = await this.usage.reverse(body.organizationId, entry);
    return reversed.duplicate ? 0 : 1;
  }

  async settled(jobId: string, body: OrgOnlyBody): Promise<ClipSettledAnswer> {
    const job = await this.requireJob(body.organizationId, jobId);
    const started = await this.jobs.startWaiting(body.organizationId);
    const renders = await this.jobs.startRendersQuietly(body.organizationId);
    await this.batchNotices?.settleJob(job);
    return { started: started.length + renders.length };
  }

  async finishExport(jobId: string, body: FinishExportBody): Promise<ClipFinishExportAnswer> {
    if (!isUuid(jobId)) throw jobNotFound();
    const orgId = body.organizationId;

    const outcome = await serializable(async (tx) => {
      const job = await tx.clipJob.findFirst({ where: { id: jobId, organizationId: orgId } });
      if (!job || job.kind !== ClipJobKind.RENDER) throw jobNotFound();

      const input = (job.input ?? {}) as { clipId?: unknown; revision?: unknown; proof?: unknown };
      if (
        input.clipId !== body.clipId ||
        input.revision !== body.revision ||
        input.proof === true
      ) {
        this.logger.error(JSON.stringify({ event: 'clips.export.finish_mismatch', jobId }));
        throw jobNotFound();
      }

      const existing = mediaIdOf(job.output);
      if (existing) return { mediaId: existing, created: false as const };
      if (!OPEN.includes(job.status)) {
        throw new ConflictException({ message: CLIPS_MESSAGES.JOB_FINISHED, code: 'job_finished' });
      }

      const media = await this.media.saveRendered(
        {
          orgId,
          key: body.key,
          posterKey: body.posterKey,
          bytes: body.bytes,
          durationMs: body.durationMs,
          width: body.width,
          height: body.height,
          fps: body.fps,
          name: body.name,
        },
        tx,
      );

      // An older revision finishing late never overwrites a newer export's mark.
      // The fingerprint (Module 15) lets a save that returns to this document
      // keep the clip exported (see `ClipEditsService.patch`).
      await tx.clip.updateMany({
        where: {
          id: body.clipId,
          organizationId: orgId,
          OR: [{ lastExportedRevision: null }, { lastExportedRevision: { lte: body.revision } }],
        },
        data: {
          lastExportedRevision: body.revision,
          lastExportedFingerprint: body.fingerprint ?? null,
          exportedMediaId: media.id,
        },
      });
      await tx.clipJob.update({
        where: { id: job.id },
        data: {
          output: {
            mediaId: media.id,
            proofKey: null,
            durationMs: body.durationMs,
          } satisfies Prisma.InputJsonValue,
        },
      });
      const clip = await tx.clip.findFirst({
        where: { id: body.clipId, organizationId: orgId },
        select: { id: true, title: true },
      });
      // Module 11: an export of a batch is counted in the batch's one notice instead.
      return { mediaId: media.id, created: true as const, clip, batched: batchIdOf(job) !== null };
    });

    if (outcome.created && outcome.clip && !outcome.batched) {
      await this.notifications
        .notify(exportReadyNotice(orgId, outcome.clip, outcome.mediaId))
        .catch((error: unknown) =>
          this.logger.warn(
            JSON.stringify({
              event: 'clips.export.notice_failed',
              jobId,
              reason: error instanceof Error ? error.message : String(error),
            }),
          ),
        );
    }
    return { mediaId: outcome.mediaId };
  }

  async finishSaveDownload(
    jobId: string,
    body: FinishSaveDownloadBody,
  ): Promise<ClipFinishSaveDownloadAnswer> {
    if (!isUuid(jobId)) throw jobNotFound();
    const orgId = body.organizationId;

    return serializable(async (tx) => {
      const job = await tx.clipJob.findFirst({ where: { id: jobId, organizationId: orgId } });
      if (!job || job.kind !== ClipJobKind.DOWNLOAD || job.status !== ClipJobStatus.DONE) {
        throw jobNotFound();
      }
      const output = downloadOutputSchema.safeParse(job.output);
      if (!output.success || output.data.ext !== 'mp4') throw jobNotFound();

      const media = output.data.media;
      if (media?.status === 'saved' && media.mediaId) return { mediaId: media.mediaId };
      if (media?.status !== 'saving') {
        throw new ConflictException({
          message: CLIPS_MESSAGES.SAVE_NOT_STARTED,
          code: 'save_not_started',
        });
      }

      const saved = await this.media.saveRendered(
        {
          orgId,
          key: body.key,
          posterKey: body.posterKey,
          bytes: body.bytes,
          durationMs: body.durationMs,
          width: body.width,
          height: body.height,
          fps: body.fps,
          name: output.data.fileName,
          origin: 'upload',
        },
        tx,
      );
      const done: DownloadMedia = { status: 'saved', mediaId: saved.id };
      await tx.clipJob.update({
        where: { id: job.id },
        data: { output: { ...output.data, media: done } as Prisma.InputJsonValue },
      });
      return { mediaId: saved.id };
    });
  }

  private async requireJob(orgId: string, jobId: string) {
    const job = isUuid(jobId) ? await this.jobsRepository.find(orgId, jobId) : null;
    if (!job) throw jobNotFound();
    return job;
  }

  /** What an earlier attempt charged for this job, in thousandths, or null. */
  private async chargeOf(orgId: string, jobId: string): Promise<number | null> {
    const entry = await prisma.usageEntry.findFirst({
      where: { organizationId: orgId, idempotencyKey: `clips.import:${jobId}` },
      select: { units: true },
    });
    return entry ? entry.units : null;
  }

  private async entryUnits(orgId: string, entryId: string): Promise<number> {
    const entry = await prisma.usageEntry.findFirst({
      where: { id: entryId, organizationId: orgId },
      select: { units: true },
    });
    return entry?.units ?? 0;
  }
}

function jobNotFound(): NotFoundException {
  return new NotFoundException({ message: CLIPS_MESSAGES.JOB_NOT_FOUND, code: 'job_not_found' });
}

/** The Media row a RENDER job's output already names, if any. */
function mediaIdOf(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  const mediaId = (output as { mediaId?: unknown }).mediaId;
  return typeof mediaId === 'string' && isUuid(mediaId) ? mediaId : null;
}
