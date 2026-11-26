/**
 * Changing a clip (Sprint 12, Modules 07 and 08): save, open, copy, delete.
 *
 * - **Save** (`PATCH /clips/:clipId`) is checked against the revision it was
 *   made from, as Studio's designs are: the read and the write share one
 *   serializable transaction, so of two tabs saving from the same revision
 *   one wins and the other gets 409 `clip_changed_elsewhere` with the
 *   current revision in `details.revision`. Nothing is overwritten.
 *   A document is read with the engine's `parseClipDocument` (422
 *   `clip_document_invalid` with our sentence, never the schema's text),
 *   must name only this clip's video and stay inside it, and its `ratio`
 *   and output length are copied onto the row for lists. A document over
 *   `MAX_DOCUMENT_BYTES` is 413 `clip_document_too_large` before it is read.
 *   Any save bumps the revision. A save without a document (a rename, a
 *   hide) keeps an export that drew the old revision current, since the
 *   picture did not change. A NEW clip that is saved becomes DRAFT.
 * - **Open** (`POST /clips/:clipId/open`): the editor calls it when it opens
 *   a clip, so a NEW clip moves to Drafts. Idempotent, no revision bump: a
 *   status that only says "somebody looked" must not make a save conflict.
 *   A POST, not a side effect of `GET /clips/:clipId`.
 * - **Duplicate**: a new DRAFT with the same document and " copy" on the
 *   name. Its sharp range is the video's, so nothing is fetched again.
 * - **Delete**: its open jobs are cancelled (best effort), its SEGMENT files
 *   go (rows in the transaction, files after, best effort) unless another
 *   clip of the same video still relies on one, and the row goes with its
 *   `ClipPost` rows. An exported `Media` row is left alone.
 */
import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type Clip, ClipAssetKind, ClipStatus, type Prisma, prisma } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import {
  type ClipDocument,
  captionsTrackOf,
  documentRange,
  fingerprintMatches,
  outputDuration,
  parseClipDocument,
  parseSegmentAssetMeta,
  safeParseClipDocument,
} from '@postgear/video-engine';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { ClipCaptionsService } from '../captions/clip-captions.service';
import { ClipErrorException } from '../clip-error.exception';
import { CLIPS_MESSAGES } from '../clips.messages';
import { serializable } from '../clips.tx';
import { OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { MAX_CLIP_TITLE_LENGTH, type PatchClipInput } from './clip-item.schema';
import {
  ClipItemService,
  type ClipView,
  clipNotFound,
  toClipView,
  videoNotFound,
} from './clip-item.service';
import { scheduledClipIds } from './clip-state';
import { storedDocumentRange } from './sharp-source';

/** The largest document a save takes, in bytes of JSON. Under the 1 MB body limit, so it is reachable. */
export const MAX_DOCUMENT_BYTES = 900_000;

const COPY_SUFFIX = ' (Copy)';

@Injectable()
export class ClipEditsService {
  private readonly logger = new Logger(ClipEditsService.name);

  constructor(
    private readonly items: ClipItemService,
    private readonly jobs: ClipJobsService,
    private readonly videos: ClipVideosRepository,
    private readonly limits: ClipLimitsGuard,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
    // Sprint 13: a deleted clip's own transcripts (a supplied file, a translation) go with it.
    private readonly captions: ClipCaptionsService,
  ) {}

  /** `{ clip }` with the new revision. 404, 409 `clip_changed_elsewhere`, 413, 422. */
  async patch(orgId: string, clipId: string, body: PatchClipInput): Promise<{ clip: ClipView }> {
    // The 404 first, so another workspace's id never learns whether its body was valid.
    await this.items.requireClip(orgId, clipId);
    const document = body.document === undefined ? undefined : this.readDocument(clipId, body);

    const saved = await serializable(async (tx) => {
      const clip = await tx.clip.findFirst({ where: { id: clipId, organizationId: orgId } });
      if (!clip) throw clipNotFound();
      if (clip.revision !== body.revision) {
        throw new ClipErrorException(HttpStatus.CONFLICT, 'clip_changed_elsewhere', {
          details: { revision: clip.revision },
        });
      }

      const data: Prisma.ClipUpdateInput = { revision: clip.revision + 1 };
      if (body.title !== undefined) data.title = body.title;
      if (body.status !== undefined) data.status = body.status;
      else if (clip.status === ClipStatus.NEW) data.status = ClipStatus.DRAFT;

      if (document) {
        const video = await tx.clipVideo.findFirst({
          where: { id: clip.videoId, organizationId: orgId },
          select: { durationMs: true },
        });
        this.assertDocumentFits(clipId, clip, document, video?.durationMs ?? null);
        await this.assertCaptionsBelong(tx, orgId, clip, document);
        data.document = document as unknown as Prisma.InputJsonValue;
        data.ratio = document.canvas.ratio;
        data.durationMs = outputDuration(document);
      } else if (clip.lastExportedRevision === clip.revision) {
        // A rename or a hide: the export still shows exactly this clip.
        data.lastExportedRevision = clip.revision + 1;
      }
      // Module 15: a document saved back to exactly what was last exported
      // (an undo, or a change and its reverse) is still that export.
      if (
        document &&
        clip.lastExportedFingerprint !== null &&
        fingerprintMatches(document, clip.lastExportedFingerprint)
      ) {
        data.lastExportedRevision = clip.revision + 1;
      }

      return tx.clip.update({ where: { id: clip.id }, data });
    });

    return { clip: await this.view(orgId, saved) };
  }

  /** The editor opened the clip: NEW becomes DRAFT. `{ clip }`, no revision bump. */
  async open(orgId: string, clipId: string): Promise<{ clip: ClipView }> {
    const clip = await this.items.requireClip(orgId, clipId);
    if (clip.status !== ClipStatus.NEW) return { clip: await this.view(orgId, clip) };

    await prisma.clip.updateMany({
      where: { id: clip.id, organizationId: orgId, status: ClipStatus.NEW },
      data: { status: ClipStatus.DRAFT },
    });
    return { clip: await this.view(orgId, await this.items.requireClip(orgId, clipId)) };
  }

  /** A new DRAFT with the same document. 201 `{ clip }`. */
  async duplicate(orgId: string, userId: string, clipId: string): Promise<{ clip: ClipView }> {
    const clip = await this.items.requireClip(orgId, clipId);
    await this.limits.assertEnabled(orgId);
    const video = await this.videos.findLive(orgId, clip.videoId);
    if (!video) throw videoNotFound();

    const parsed = safeParseClipDocument(clip.document);
    if (!parsed.ok) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'tool_failed', {
        message: CLIPS_MESSAGES.CLIP_UNREADABLE,
      });
    }

    const copy = await prisma.clip.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        videoId: video.id,
        title: copyTitle(clip.title),
        status: ClipStatus.DRAFT,
        origin: clip.origin,
        score: clip.score,
        reasons: clip.reasons,
        document: parsed.doc as unknown as Prisma.InputJsonValue,
        revision: 1,
        ratio: parsed.doc.canvas.ratio,
        durationMs: outputDuration(parsed.doc),
        createdById: userId,
      },
    });
    return { clip: toClipView(copy) };
  }

  /** Deletes a clip and its sharp files. `{ message }`. */
  async remove(orgId: string, clipId: string): Promise<{ message: string }> {
    const clip = await this.items.requireClip(orgId, clipId);

    const open = await prisma.clipJob.findMany({
      where: { organizationId: orgId, clipId: clip.id, status: { in: [...OPEN_JOB_STATUSES] } },
      select: { id: true },
    });
    for (const job of open) {
      try {
        await this.jobs.cancel(orgId, job.id);
      } catch (error) {
        // Already finished, or Temporal is away: the workflow then finds its clip gone.
        this.logger.warn(
          JSON.stringify({
            event: 'clips.clip.delete_cancel_skipped',
            clipId: clip.id,
            jobId: job.id,
            reason: error instanceof Error ? error.name : 'unknown',
          }),
        );
      }
    }

    const [segments, others] = await Promise.all([
      prisma.clipAsset.findMany({
        where: { organizationId: orgId, clipId: clip.id, kind: ClipAssetKind.SEGMENT },
        select: { id: true, key: true, meta: true },
      }),
      prisma.clip.findMany({
        where: { organizationId: orgId, videoId: clip.videoId, id: { not: clip.id } },
        select: { document: true },
      }),
    ]);
    const stillUsed = others
      .map((other) => storedDocumentRange(other.document))
      .filter((range): range is NonNullable<typeof range> => range !== null);
    const doomed = segments.filter((segment) => {
      const meta = parseSegmentAssetMeta(segment.meta);
      return !meta || !stillUsed.some((r) => meta.fromMs <= r.fromMs && meta.toMs >= r.toMs);
    });

    // Before the clip goes: its row's `clipId` would otherwise fall to null, and a clip's own
    // transcript would then pass for the whole video's.
    const transcriptKeys = await this.captions.releaseClip(orgId, clip);

    await prisma.$transaction([
      prisma.clipAsset.deleteMany({
        where: { organizationId: orgId, id: { in: doomed.map((segment) => segment.id) } },
      }),
      prisma.clip.deleteMany({ where: { id: clip.id, organizationId: orgId } }),
    ]);

    const files = [
      ...doomed.map((segment) => ({ id: segment.id, key: segment.key })),
      ...transcriptKeys.map((key) => ({ id: 'transcript', key })),
    ];
    for (const segment of files) {
      try {
        await this.storage.delete(segment.key);
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'clips.clip.file_left',
            clipId: clip.id,
            assetId: segment.id,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    this.logger.log(
      JSON.stringify({
        event: 'clips.clip.deleted',
        orgId,
        clipId: clip.id,
        segmentsDeleted: doomed.length,
        jobsCancelled: open.length,
      }),
    );
    return { message: CLIPS_MESSAGES.CLIP_DELETED };
  }

  private async view(orgId: string, clip: Clip): Promise<ClipView> {
    const scheduled = await scheduledClipIds(orgId, [clip.id]);
    return toClipView(clip, scheduled.has(clip.id));
  }

  /** The body's document, read by the engine: 413 when too large, 422 when it does not read. */
  private readDocument(clipId: string, body: PatchClipInput): ClipDocument {
    const bytes = Buffer.byteLength(JSON.stringify(body.document), 'utf8');
    if (bytes > MAX_DOCUMENT_BYTES) {
      throw new ClipErrorException(HttpStatus.PAYLOAD_TOO_LARGE, 'clip_document_too_large', {
        message: CLIPS_MESSAGES.CLIP_DOCUMENT_TOO_LARGE,
      });
    }
    try {
      return parseClipDocument(body.document);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.clip.document_refused',
          clipId,
          // Issue strings carry paths and our wording, never the values.
          issues: (error as { issues?: readonly string[] }).issues?.slice(0, 5) ?? [],
        }),
      );
      throw invalidDocument();
    }
  }

  /** The document plays only this clip's video, and stays inside it. */
  private assertDocumentFits(
    clipId: string,
    clip: Pick<Clip, 'videoId'>,
    document: ClipDocument,
    videoDurationMs: number | null,
  ): void {
    const foreign = document.sources.some((source) => source.videoId !== clip.videoId);
    const range = documentRange(document);
    const past = videoDurationMs !== null && range !== null && range.toMs > videoDurationMs;
    if (foreign || past) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.clip.document_refused',
          clipId,
          reason: foreign ? 'foreign_video' : 'past_the_end',
        }),
      );
      throw invalidDocument();
    }
  }

  /**
   * Sprint 13: a captions track carries a transcript id a person's document
   * supplied. It is accepted only when it is a transcript of THIS clip's
   * video in THIS workspace, so a saved clip can never point an export at
   * another workspace's words (the worker checks again when it renders).
   */
  private async assertCaptionsBelong(
    tx: Prisma.TransactionClient,
    orgId: string,
    clip: Pick<Clip, 'id' | 'videoId'>,
    document: ClipDocument,
  ): Promise<void> {
    const transcriptId = captionsTranscriptOf(document);
    if (transcriptId === null) return;
    const found = await tx.clipAsset.findFirst({
      where: {
        id: transcriptId,
        organizationId: orgId,
        videoId: clip.videoId,
        kind: ClipAssetKind.TRANSCRIPT,
      },
      select: { id: true },
    });
    if (!found) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.clip.document_refused',
          clipId: clip.id,
          reason: 'foreign_transcript',
        }),
      );
      throw invalidDocument();
    }
  }
}

/** The id of a document's captions transcript, when it has captions. */
function captionsTranscriptOf(document: ClipDocument): string | null {
  return captionsTrackOf(document)?.transcriptAssetId ?? null;
}

/** "Team Talk (1:23) (Copy)", like a duplicated design, capped at the title limit. */
export function copyTitle(title: string): string {
  const base = title.slice(0, MAX_CLIP_TITLE_LENGTH - COPY_SUFFIX.length).trimEnd();
  return `${base || 'Clip'}${COPY_SUFFIX}`;
}

function invalidDocument(): ClipErrorException {
  return new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_document_invalid', {
    message: CLIPS_MESSAGES.CLIP_DOCUMENT_INVALID,
  });
}
