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
 *   Module 08: a document save also takes away `meta.followOnOpen` (the
 *   editor's first-open Follow The Speaker), keeping the other keys.
 * - **Open** (`POST /clips/:clipId/open`): the editor calls it when it opens
 *   a clip, so a NEW clip moves to Drafts. Idempotent, no revision bump: a
 *   status that only says "somebody looked" must not make a save conflict.
 *   A POST, not a side effect of `GET /clips/:clipId`.
 * - **Duplicate**: a new DRAFT with the same document and " copy" on the
 *   name. Its sharp range is the video's, so nothing is fetched again.
 * - **Delete**: its open jobs are cancelled (best effort), its SEGMENT files
 *   go (rows in the transaction, files after, best effort) unless another
 *   clip of the same video still relies on one, and the row goes with its
 *   `ClipPost` rows. An exported `Media` row is left alone. Module 11: the
 *   bulk delete goes through the same `removeClips`, and a montage that plays
 *   the video counts as a clip that relies on its SEGMENTs.
 * - **Montages** (Module 11): a save checks every captions track against
 *   the video of its own source (a montage has one per source); a copy keeps
 *   `meta.videoIds`, and a montage whose videos include a removed one is not
 *   copied (422 `montage_video_removed`).
 */
import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type Clip, ClipAssetKind, ClipStatus, type Prisma, prisma } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import {
  type CaptionsTrack,
  type ClipDocument,
  fingerprintMatches,
  renderedDuration,
  parseClipDocument,
  parseSegmentAssetMeta,
  safeParseClipDocument,
} from '@postgear/video-engine';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { ClipCaptionsService } from '../captions/clip-captions.service';
import { ClipErrorException } from '../clip-error.exception';
import { documentUsesAiVoice } from './clip-ai-voice';
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
import { hasOpenMarks, withoutFollowOnOpen } from './clip-meta';
import { scheduledClipIds } from './clip-state';
import {
  assertMontageVideosLive,
  isMontage,
  metaVideoIds,
  montagesPlayingVideo,
} from '../montages/montage-videos';
import { storedRangesOnVideo } from './sharp-source';

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
        const videoIds = [...new Set([clip.videoId, ...document.sources.map((s) => s.videoId)])];
        const videos = await tx.clipVideo.findMany({
          where: { id: { in: videoIds }, organizationId: orgId },
          select: { id: true, durationMs: true, status: true, deletedAt: true },
        });
        this.assertDocumentFits(clipId, clip, document, videos);
        await this.assertCaptionsBelong(tx, orgId, clip, document);
        data.document = document as unknown as Prisma.InputJsonValue;
        data.ratio = document.canvas.ratio;
        data.durationMs = renderedDuration(document);
        // Modules 08 and 10: the first document save ends the first-open marks (follow, camera),
        // so a person who turned it off is never overridden on the next open.
        if (hasOpenMarks(clip.meta)) data.meta = withoutFollowOnOpen(clip.meta);
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

    // Module 11: a montage's copy plays the same videos, so they must all still be there.
    await assertMontageVideosLive(prisma, orgId, clip);

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
        durationMs: renderedDuration(parsed.doc),
        createdById: userId,
        // The copy is a montage of the same videos: the removal rules must find it too.
        ...(isMontage(clip) ? { meta: { videoIds: metaVideoIds(clip.meta) } } : {}),
      },
    });
    const view = toClipView(copy);
    view.usesAiVoice = await documentUsesAiVoice(orgId, view.document);
    return { clip: view };
  }

  /** Deletes a clip and its sharp files. `{ message }`. */
  async remove(orgId: string, clipId: string): Promise<{ message: string }> {
    const clip = await this.items.requireClip(orgId, clipId);
    await this.removeClips(orgId, [clip]);
    return { message: CLIPS_MESSAGES.CLIP_DELETED };
  }

  /**
   * Deletes clips the caller already read from this workspace: the single
   * delete, and (Module 11) the bulk one. Their open jobs are cancelled (best
   * effort), their own transcripts go or pass to a clip that still shows
   * them, and their SEGMENT rows and the clip rows go in one transaction;
   * the files after it. A SEGMENT is kept when a clip that stays (a montage
   * that plays its video among them) still relies on it. The transaction
   * counts the rows it deletes: when one of the clips went meanwhile it is a
   * 404 and nothing is deleted.
   */
  async removeClips(orgId: string, clips: readonly Clip[]): Promise<{ deleted: number }> {
    if (clips.length === 0) return { deleted: 0 };
    const ids = clips.map((clip) => clip.id);

    const open = await prisma.clipJob.findMany({
      where: { organizationId: orgId, clipId: { in: ids }, status: { in: [...OPEN_JOB_STATUSES] } },
      select: { id: true, clipId: true },
    });
    for (const job of open) {
      try {
        await this.jobs.cancel(orgId, job.id);
      } catch (error) {
        // Already finished, or Temporal is away: the workflow then finds its clip gone.
        this.logger.warn(
          JSON.stringify({
            event: 'clips.clip.delete_cancel_skipped',
            clipId: job.clipId,
            jobId: job.id,
            reason: error instanceof Error ? error.name : 'unknown',
          }),
        );
      }
    }

    const doomed = await this.doomedSegments(orgId, clips);

    // Before the clips go: a row's `clipId` would otherwise fall to null, and a clip's own
    // transcript would then pass for the whole video's.
    const transcriptKeys: string[] = [];
    for (const clip of clips) {
      transcriptKeys.push(...(await this.captions.releaseClip(orgId, clip, ids)));
    }

    await prisma.$transaction(async (tx) => {
      await tx.clipAsset.deleteMany({
        where: { organizationId: orgId, id: { in: doomed.map((segment) => segment.id) } },
      });
      const gone = await tx.clip.deleteMany({
        where: { id: { in: ids }, organizationId: orgId },
      });
      if (gone.count !== ids.length) throw clipNotFound();
    });

    const files = [
      ...doomed.map((segment) => ({ id: segment.id, clipId: segment.clipId, key: segment.key })),
      ...transcriptKeys.map((key) => ({ id: 'transcript', clipId: null, key })),
    ];
    for (const file of files) {
      try {
        await this.storage.delete(file.key);
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'clips.clip.file_left',
            clipId: file.clipId,
            assetId: file.id,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    for (const clip of clips) {
      this.logger.log(
        JSON.stringify({
          event: 'clips.clip.deleted',
          orgId,
          clipId: clip.id,
          segmentsDeleted: doomed.filter((segment) => segment.clipId === clip.id).length,
          jobsCancelled: open.filter((job) => job.clipId === clip.id).length,
        }),
      );
    }
    return { deleted: ids.length };
  }

  /**
   * The SEGMENT rows of `clips` no clip that stays relies on: a staying clip
   * of the same video (or, Module 11, a montage that plays it) whose range on
   * that video the SEGMENT covers keeps it.
   */
  private async doomedSegments(orgId: string, clips: readonly Clip[]) {
    const ids = clips.map((clip) => clip.id);
    const segments = await prisma.clipAsset.findMany({
      where: { organizationId: orgId, clipId: { in: ids }, kind: ClipAssetKind.SEGMENT },
      select: { id: true, key: true, meta: true, videoId: true, clipId: true },
    });
    if (segments.length === 0) return [];
    const ownVideo = new Map(clips.map((clip) => [clip.id, clip.videoId]));
    const videoOf = (segment: { videoId: string | null; clipId: string | null }) =>
      segment.videoId ?? (segment.clipId ? ownVideo.get(segment.clipId) : undefined) ?? null;
    const videoIds = [...new Set(segments.map(videoOf).filter((id): id is string => id !== null))];

    const others = await prisma.clip.findMany({
      where: {
        organizationId: orgId,
        NOT: { id: { in: ids } },
        OR: videoIds.flatMap((videoId) => [{ videoId }, montagesPlayingVideo(videoId)]),
      },
      select: { document: true },
    });
    const stillUsed = new Map(
      videoIds.map((videoId) => [
        videoId,
        others.flatMap((other) => storedRangesOnVideo(other.document, videoId)),
      ]),
    );
    return segments.filter((segment) => {
      const meta = parseSegmentAssetMeta(segment.meta);
      const videoId = videoOf(segment);
      const used = videoId ? (stillUsed.get(videoId) ?? []) : [];
      return !meta || !used.some((r) => meta.fromMs <= r.fromMs && meta.toMs >= r.toMs);
    });
  }

  private async view(orgId: string, clip: Clip): Promise<ClipView> {
    const scheduled = await scheduledClipIds(orgId, [clip.id]);
    const view = toClipView(clip, scheduled.has(clip.id));
    view.usesAiVoice = await documentUsesAiVoice(orgId, view.document);
    return view;
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

  /**
   * The document plays this clip's video and (Module 10) other live, READY
   * videos of the same workspace (a brand kit's intro or outro; Module 11's
   * montage), and every part stays inside its own video. The clip's own
   * video may have been removed meanwhile (its parts are still checked
   * against the stored length).
   */
  private assertDocumentFits(
    clipId: string,
    clip: Pick<Clip, 'videoId'>,
    document: ClipDocument,
    videos: ReadonlyArray<{
      id: string;
      durationMs: number | null;
      status: string;
      deletedAt: Date | null;
    }>,
  ): void {
    const byId = new Map(videos.map((video) => [video.id, video]));
    const sourceVideo = new Map(document.sources.map((source) => [source.id, source.videoId]));
    const foreign = document.sources.some((source) => {
      if (source.videoId === clip.videoId) return false;
      const video = byId.get(source.videoId);
      return !video || video.deletedAt !== null || video.status !== 'READY';
    });
    const past = document.segments.some((segment) => {
      const videoId = sourceVideo.get(segment.source);
      const durationMs = videoId ? (byId.get(videoId)?.durationMs ?? null) : null;
      return durationMs !== null && segment.sourceOut > durationMs;
    });
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
   * Module 11: a montage has one captions track per source; each must name a
   * transcript of its own source's video (a track without a source follows
   * the clip's own video, as before).
   */
  private async assertCaptionsBelong(
    tx: Prisma.TransactionClient,
    orgId: string,
    clip: Pick<Clip, 'id' | 'videoId'>,
    document: ClipDocument,
  ): Promise<void> {
    const sourceVideo = new Map(document.sources.map((source) => [source.id, source.videoId]));
    const wanted = captionsTracksOf(document).map((track) => ({
      id: track.transcriptAssetId,
      videoId: (track.source ? sourceVideo.get(track.source) : undefined) ?? clip.videoId,
    }));
    if (wanted.length === 0) return;
    const found = await tx.clipAsset.findMany({
      where: {
        id: { in: [...new Set(wanted.map((track) => track.id))] },
        organizationId: orgId,
        kind: ClipAssetKind.TRANSCRIPT,
      },
      select: { id: true, videoId: true },
    });
    const videoOf = new Map(found.map((row) => [row.id, row.videoId]));
    if (wanted.some((track) => videoOf.get(track.id) !== track.videoId)) {
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

/** Every captions track of a document (one, or Module 11's one per source). */
function captionsTracksOf(document: ClipDocument): CaptionsTrack[] {
  return document.tracks.filter((track): track is CaptionsTrack => track.kind === 'captions');
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
