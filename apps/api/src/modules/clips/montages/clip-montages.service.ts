/**
 * Create Montage (Sprint 13, Module 11): 2 to 15 clips, from one video or
 * several, stitched into one new clip that opens in the editor and exports
 * like any other.
 *
 * 1. Clips must be on (`assertEnabled`), and the count within 2 to 15 (422
 *    `montage_too_few`, `montage_too_many`) before anything is read.
 * 2. Every id is a live clip of this workspace (not marked removed), or the
 *    whole request is 404 `clip_not_found`. Every video those clips play
 *    (a montage among them counts with all of its videos) is live and READY:
 *    422 `montage_video_removed` for a removed or deleted one, 409
 *    `video_not_ready` otherwise.
 * 3. The engine's `createMontage` builds the document (order, joins, the
 *    title card, each clip's framing as its parts' override, refitted with
 *    each video's real picture size). Its refusals are
 *    422 with their code; `montage_shapes_differ` also answers `ratios`, the
 *    shapes found, so the dialog can ask for one (see the controller).
 * 4. The new clip is written through `ClipItemService.insertClip` (one way a
 *    clip row is made): `origin: MONTAGE`, `videoId` the first clip's video,
 *    `meta.videoIds` every other video, DRAFT, its length the rendered one
 *    (joins and cards counted). No sharp range is fetched for it: its parts
 *    read the sharp ranges its clips already hold. Each of its videos counts
 *    as used (Module 19).
 *
 * The montage is a snapshot: later changes to the original clips change
 * nothing in it. Titles and the title line are never logged, only counts.
 */
import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { type Clip, ClipOrigin, ClipVideoStatus, type Prisma, prisma } from '@postgear/db';
import {
  type ClipDocument,
  createMontage,
  MONTAGE_MAX_CLIPS,
  MONTAGE_MIN_CLIPS,
  type MontageClip,
  type MontageOptions,
  type MontageResult,
  montageRatios,
  type Ratio,
  safeParseClipDocument,
} from '@postgear/video-engine';
import { ClipErrorException } from '../clip-error.exception';
import { CLIPS_MESSAGES } from '../clips.messages';
import { documentUsesAiVoice } from '../clip/clip-ai-voice';
import { MAX_DOCUMENT_BYTES } from '../clip/clip-edits.service';
import { MAX_CLIP_TITLE_LENGTH } from '../clip/clip-item.schema';
import {
  ClipItemService,
  type ClipView,
  clipNotFound,
  toClipView,
} from '../clip/clip-item.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipRetentionService } from '../retention/clip-retention.service';
import type { CreateMontageInput } from './clip-montages.schema';
import { MONTAGE_MESSAGES } from './clip-montages.messages';
import { montageVideoRemoved, videosOfClip } from './montage-videos';

/** What the route answers: the new clip, or the shapes that differ (422 with `ratios`). */
export type MontageOutcome =
  | { kind: 'created'; clip: ClipView }
  | { kind: 'shapes_differ'; ratios: Ratio[] };

@Injectable()
export class ClipMontagesService {
  private readonly logger = new Logger(ClipMontagesService.name);

  constructor(
    private readonly items: ClipItemService,
    private readonly limits: ClipLimitsGuard,
    private readonly retention: ClipRetentionService,
  ) {}

  async create(orgId: string, userId: string, body: CreateMontageInput): Promise<MontageOutcome> {
    await this.limits.assertEnabled(orgId);
    if (body.clipIds.length < MONTAGE_MIN_CLIPS) throw refused('montage_too_few');
    if (body.clipIds.length > MONTAGE_MAX_CLIPS) throw refused('montage_too_many');

    const clips = await this.liveClips(orgId, body.clipIds);
    const videoIds = [...new Set(clips.flatMap((clip) => videosOfClip(clip)))];
    const videos = await this.readyVideos(orgId, videoIds);
    const parts = clips.map((clip) => ({
      id: clip.id,
      title: clip.title,
      document: readDocument(clip),
    }));

    const videoSizes: Record<string, { width: number; height: number }> = {};
    for (const video of videos.values()) {
      if (video.width && video.height) {
        videoSizes[video.id] = { width: video.width, height: video.height };
      }
    }
    const made = this.build(parts, {
      ...(body.ratio ? { ratio: body.ratio } : {}),
      transition: body.transition,
      titleCard: body.titleCard ?? null,
      videoSizes,
    });
    if (!made.ok) {
      this.logger.log(
        JSON.stringify({
          event: 'clips.montage.refused',
          orgId,
          code: made.code,
          clips: clips.length,
        }),
      );
      if (made.code === 'montage_shapes_differ') {
        return { kind: 'shapes_differ', ratios: montageRatios(parts) };
      }
      throw refused(made.code);
    }
    const document = this.checked(made.document);

    const first = clips[0] as Clip;
    const firstVideo = videos.get(first.videoId);
    if (!firstVideo) throw montageVideoRemoved();
    const others = videoIds.filter((id) => id !== first.videoId);
    const meta: Prisma.InputJsonValue = { videoIds: others };

    const { clip } = await this.items.insertClip(orgId, userId, {
      clipId: randomUUID(),
      video: firstVideo,
      document,
      title: montageTitle(body.titleCard ?? null, clips.length),
      origin: ClipOrigin.MONTAGE,
      meta,
      // Its parts read the sharp ranges the original clips already hold.
      segmentRange: null,
    });
    // Module 19: a montage uses every one of its videos (`insertClip` touched the first).
    for (const videoId of others) await this.retention.touchVideo(orgId, videoId);

    this.logger.log(
      JSON.stringify({
        event: 'clips.montage.created',
        orgId,
        clipId: clip.id,
        clips: clips.length,
        videos: videoIds.length,
        transition: body.transition,
        titleCard: Boolean(body.titleCard),
      }),
    );
    const view = toClipView(clip);
    view.usesAiVoice = await documentUsesAiVoice(orgId, view.document);
    return { kind: 'created', clip: view };
  }

  /** The workspace's clips by id, in the order asked, none marked removed; else 404 for all. */
  private async liveClips(orgId: string, ids: readonly string[]): Promise<Clip[]> {
    const rows = await prisma.clip.findMany({
      where: { id: { in: [...ids] }, organizationId: orgId, removedAt: null },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids.map((id) => byId.get(id));
    if (ordered.some((row) => row === undefined)) throw clipNotFound();
    return ordered as Clip[];
  }

  /** Every video live and READY: 422 `montage_video_removed`, 409 `video_not_ready`. */
  private async readyVideos(orgId: string, ids: readonly string[]) {
    const rows = await prisma.clipVideo.findMany({
      where: { id: { in: [...ids] }, organizationId: orgId },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of ids) {
      const video = byId.get(id);
      if (!video || video.deletedAt !== null || video.status === ClipVideoStatus.REMOVED) {
        throw montageVideoRemoved();
      }
    }
    for (const id of ids) {
      if (byId.get(id)?.status !== ClipVideoStatus.READY) {
        throw new ClipErrorException(HttpStatus.CONFLICT, 'video_not_ready');
      }
    }
    return byId;
  }

  /** `createMontage`, whose only throw is a document the schema would refuse (a bug): 422 `tool_failed`. */
  private build(parts: MontageClip[], options: MontageOptions): MontageResult {
    try {
      return createMontage(parts, options);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.montage.build_failed',
          clips: parts.length,
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'tool_failed', {
        message: CLIPS_MESSAGES.CLIP_UNREADABLE,
      });
    }
  }

  /**
   * The engine's document, read once more as a save would read it, and
   * within the size a later save takes (so the editor can always save it).
   */
  private checked(document: ClipDocument): ClipDocument {
    const parsed = safeParseClipDocument(document);
    if (!parsed.ok) {
      this.logger.warn(JSON.stringify({ event: 'clips.montage.document_unreadable' }));
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'tool_failed', {
        message: CLIPS_MESSAGES.CLIP_UNREADABLE,
      });
    }
    if (Buffer.byteLength(JSON.stringify(parsed.doc), 'utf8') > MAX_DOCUMENT_BYTES) {
      throw new ClipErrorException(HttpStatus.PAYLOAD_TOO_LARGE, 'clip_document_too_large', {
        message: CLIPS_MESSAGES.CLIP_DOCUMENT_TOO_LARGE,
      });
    }
    return parsed.doc;
  }
}

/** A clip's stored document, or 422 `tool_failed` when it no longer reads. */
function readDocument(clip: Clip): ClipDocument {
  const parsed = safeParseClipDocument(clip.document);
  if (!parsed.ok) {
    throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'tool_failed', {
      message: CLIPS_MESSAGES.CLIP_UNREADABLE,
    });
  }
  return parsed.doc;
}

/** The title card's line when there is one, else "Montage Of N Clips". */
export function montageTitle(titleCard: string | null, count: number): string {
  const line = titleCard?.trim();
  return line ? line.slice(0, MAX_CLIP_TITLE_LENGTH) : MONTAGE_MESSAGES.DEFAULT_TITLE(count);
}

function refused(code: string): ClipErrorException {
  return new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, code);
}
