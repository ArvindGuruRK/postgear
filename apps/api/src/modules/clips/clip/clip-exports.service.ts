/**
 * A clip's exports and Preview Export (Sprint 13, Module 15):
 *
 * - `POST /clips/:clipId/exports` freezes the document, its revision and
 *   its `documentFingerprint` into a RENDER job. The quality must be one the
 *   plan allows (402 `clips_quality_requires_plan`, the plan pattern every
 *   module uses), the revision must still be the clip's (409
 *   `clip_changed_elsewhere`), and one export at a time per clip (409
 *   `export_running`, decided in a serializable transaction; a running
 *   preview does not count). The mark and the queue priority are the plan's,
 *   read once.
 * - `GET /clips/:clipId/exports` is the history: the last five exports,
 *   newest first, any status, each with its quality, fingerprint, Media file
 *   (a public address, as Media serves it) and the sound it ended with.
 * - `POST /clips/:clipId/previews` starts a proof: the same RENDER job with
 *   `proof: true`, the plan's mark, always low priority, no plan lock, no
 *   charge, not in the history and no bell. A preview already QUEUED or
 *   RUNNING is answered instead of a second one.
 * - `GET /clips/:clipId/previews/latest` is the newest proof, with a signed
 *   address (one hour) while its file is kept (24 hours after it finished).
 *
 * Sprint 13, Module 11: an export is made QUEUED and started by the fair
 * render queue (`ClipJobsService.startWaitingRenders`), one export at a time
 * per workspace; a preview skips the queue. Export All
 * (`exports/clip-batch-exports.service.ts`) freezes each clip with the same
 * `freezeClipForExport` and the same plan values.
 *
 * Every route answers 404 for another workspace's clip before anything else.
 * Module 11: a montage whose videos include a removed one is 422
 * `montage_video_removed` on every export route (`assertMontageVideosLive`).
 * An export or preview checks every video the document plays (Module 10: a
 * brand intro or outro is another video): each must be the workspace's,
 * live and READY, or it is refused as the clip's own video would be.
 */
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type Clip, type ClipJob, ClipJobKind, prisma } from '@postgear/db';
import type { PrivateStorage, StorageBackend } from '@postgear/storage';
import {
  allowedQualities,
  type ClipDocument,
  documentFingerprint,
  EXPORT_QUALITIES,
  type ExportQuality,
  JOB_PRIORITIES,
  type JobPriority,
  qualityLockedSentence,
  renderOutputSchema,
  safeParseClipDocument,
} from '@postgear/video-engine';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { PRIVATE_STORAGE, STORAGE_BACKEND } from '../../media/storage/storage.interface';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';
import { type ClipsTx, serializable } from '../clips.tx';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository, OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { assertMontageVideosLive, touchVideosOfClip } from '../montages/montage-videos';
import { ClipRetentionService } from '../retention/clip-retention.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import type { ExportClipInput, PreviewClipInput } from './clip-item.schema';
import { clipNotFound, exportFileName, videoNotFound } from './clip-item.service';
import { proofIs } from './export-progress';

/** How many exports the history shows. */
export const EXPORT_HISTORY_SIZE = 5;
/** How long a preview's file is kept after it finished (the PROOF row's `meta.expiresAt`). */
export const PREVIEW_KEEP_MS = 24 * 60 * 60 * 1000;
/** How long a preview's signed address works. */
export const PREVIEW_URL_SECONDS = 60 * 60;
/** A proof's quality is fixed by `PROOF_SPEC`; the input still names one (any). */
const PREVIEW_QUALITY: ExportQuality = '720p';

/** The plan values an export reads, once. */
export const EXPORT_PLAN_KEYS = [
  'clips.export_max_quality',
  'clips.export_watermark',
  'clips.queue_priority',
] as const;

/** The finished file in Media, as the history shows it. */
export interface ClipExportMedia {
  id: string;
  /** The public address Media serves the file from (`GET /media/{id}/download` saves it under its name). */
  url: string;
  posterUrl: string | null;
  name: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** The sound the export ended with (Module 14), as the job recorded it. */
export interface ClipExportLoudness {
  inputLufs: number | null;
  inputTp: number | null;
  finalLufs: number | null;
  mode: 'linear' | 'dynamic' | 'skipped';
}

export interface ClipExportView {
  job: ClipJobView;
  quality: ExportQuality;
  /** The exported document's fingerprint; null for an export made before Module 15. */
  fingerprint: string | null;
  /** Null until it is done, or when the Media file was deleted. */
  media: ClipExportMedia | null;
  loudness: ClipExportLoudness | null;
}

export interface ClipPreviewView {
  job: ClipJobView;
  fingerprint: string | null;
  /** A signed address (about an hour), only when done and its file is still kept. */
  url: string | null;
  /** When the file goes (24 hours after it finished); null until it is done. */
  expiresAt: string | null;
}

interface StoredRenderInput {
  quality?: unknown;
  fingerprint?: unknown;
  proof?: unknown;
}

function inputOf(job: Pick<ClipJob, 'input'>): StoredRenderInput {
  return job.input && typeof job.input === 'object' ? (job.input as StoredRenderInput) : {};
}

export function fingerprintOf(job: Pick<ClipJob, 'input'>): string | null {
  const value = inputOf(job).fingerprint;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function qualityOf(job: Pick<ClipJob, 'input'>): ExportQuality {
  const value = inputOf(job).quality;
  return (EXPORT_QUALITIES as readonly unknown[]).includes(value)
    ? (value as ExportQuality)
    : PREVIEW_QUALITY;
}

function outputOf(job: Pick<ClipJob, 'output'>) {
  const parsed = renderOutputSchema.safeParse(job.output);
  return parsed.success ? parsed.data : null;
}

export function priorityOf(value: unknown): JobPriority {
  return (JOB_PRIORITIES as readonly unknown[]).includes(value) ? (value as JobPriority) : 'normal';
}

@Injectable()
export class ClipExportsService {
  private readonly logger = new Logger(ClipExportsService.name);

  constructor(
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly videos: ClipVideosRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly resolver: EntitlementResolver,
    @Inject(STORAGE_BACKEND) private readonly storage: StorageBackend,
    @Inject(PRIVATE_STORAGE) private readonly privateStorage: PrivateStorage,
    private readonly retention: ClipRetentionService,
  ) {}

  /** 202 `{ job }`. */
  async start(
    orgId: string,
    userId: string,
    clipId: string,
    body: ExportClipInput,
  ): Promise<{ job: ClipJobView }> {
    await this.requireClip(orgId, clipId);
    await this.limits.assertEnabled(orgId);
    const plan = await this.resolver.getMany(orgId, EXPORT_PLAN_KEYS);
    const max = plan['clips.export_max_quality'];
    if (!allowedQualities(typeof max === 'string' ? max : null).includes(body.quality)) {
      throw new EntitlementRefusedException(
        'clips_quality_requires_plan',
        qualityLockedSentence(body.quality),
      );
    }

    const made = await serializable(async (tx) => {
      const { clip, video, doc } = await this.readClip(tx, orgId, clipId, body.revision);
      const running = await tx.clipJob.count({
        where: {
          organizationId: orgId,
          clipId: clip.id,
          kind: ClipJobKind.RENDER,
          status: { in: [...OPEN_JOB_STATUSES] },
          input: proofIs(false),
        },
      });
      if (running > 0) throw new ClipErrorException(HttpStatus.CONFLICT, 'export_running');

      const row = await this.jobs.build({
        id: this.jobs.newJobId(),
        orgId,
        userId,
        kind: 'RENDER',
        videoId: video.id,
        clipId: clip.id,
        priority: priorityOf(plan['clips.queue_priority']),
        input: {
          clipId: clip.id,
          videoId: video.id,
          revision: clip.revision,
          document: doc,
          quality: body.quality,
          proof: false,
          watermark: plan['clips.export_watermark'] === true,
          name: exportFileName(clip.title),
          fingerprint: documentFingerprint(doc),
        },
      });
      return { job: await this.jobsRepository.create(row, tx), clip };
    });
    const { job } = made;

    // Module 19: an export counts as using the clip's video (a montage's: every one it plays).
    await touchVideosOfClip(this.retention, orgId, made.clip);
    await this.jobs.start(job);
    const fresh = (await this.jobsRepository.find(orgId, job.id)) ?? job;
    return { job: toJobView(fresh) };
  }

  /** `{ exports }`: the last five exports, newest first, any status; never a preview. */
  async history(orgId: string, clipId: string): Promise<{ exports: ClipExportView[] }> {
    const clip = await this.requireClip(orgId, clipId);
    const rows = await prisma.clipJob.findMany({
      where: {
        organizationId: orgId,
        clipId: clip.id,
        kind: ClipJobKind.RENDER,
        input: proofIs(false),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_HISTORY_SIZE,
    });

    const outputs = new Map(rows.map((row) => [row.id, outputOf(row)]));
    const mediaIds = [
      ...new Set(
        rows
          .filter((row) => row.status === 'DONE')
          .map((row) => outputs.get(row.id)?.mediaId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const media =
      mediaIds.length > 0
        ? await prisma.media.findMany({
            where: { organizationId: orgId, id: { in: mediaIds }, deletedAt: null },
          })
        : [];
    const byId = new Map(media.map((row) => [row.id, row]));

    return {
      exports: rows.map((row) => {
        const output = outputs.get(row.id) ?? null;
        const file =
          row.status === 'DONE' && output?.mediaId ? byId.get(output.mediaId) : undefined;
        return {
          job: toJobView(row),
          quality: qualityOf(row),
          fingerprint: fingerprintOf(row),
          media: file
            ? {
                id: file.id,
                url: this.storage.publicUrl(file.path),
                posterUrl: file.thumbnail ? this.storage.publicUrl(file.thumbnail) : null,
                name: file.name,
                bytes: file.fileSize,
                width: file.width ?? null,
                height: file.height ?? null,
                durationMs: file.durationMs ?? null,
              }
            : null,
          loudness: output?.loudness ?? null,
        };
      }),
    };
  }

  /** 202 `{ job }`: the open preview when there is one, else a new one. */
  async startPreview(
    orgId: string,
    userId: string,
    clipId: string,
    body: PreviewClipInput,
  ): Promise<{ job: ClipJobView }> {
    await this.requireClip(orgId, clipId);
    await this.limits.assertEnabled(orgId);
    const watermark = await this.resolver.get(orgId, 'clips.export_watermark');

    const outcome = await serializable(async (tx) => {
      const { clip, video, doc } = await this.readClip(tx, orgId, clipId, body.revision);
      const open = await tx.clipJob.findFirst({
        where: {
          organizationId: orgId,
          clipId: clip.id,
          kind: ClipJobKind.RENDER,
          status: { in: [...OPEN_JOB_STATUSES] },
          input: proofIs(true),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (open) return { job: open, created: false };

      const row = await this.jobs.build({
        id: this.jobs.newJobId(),
        orgId,
        userId,
        kind: 'RENDER',
        videoId: video.id,
        clipId: clip.id,
        priority: 'low',
        input: {
          clipId: clip.id,
          videoId: video.id,
          revision: clip.revision,
          document: doc,
          quality: PREVIEW_QUALITY,
          proof: true,
          watermark: watermark === true,
          name: exportFileName(clip.title),
          fingerprint: documentFingerprint(doc),
        },
      });
      return { job: await this.jobsRepository.create(row, tx), created: true };
    });

    if (outcome.created) await this.jobs.start(outcome.job);
    const fresh = (await this.jobsRepository.find(orgId, outcome.job.id)) ?? outcome.job;
    return { job: toJobView(fresh) };
  }

  /** `{ preview }`: the newest proof, or null when the clip has none. */
  async latestPreview(
    orgId: string,
    clipId: string,
    now: Date = new Date(),
  ): Promise<{ preview: ClipPreviewView | null }> {
    const clip = await this.requireClip(orgId, clipId);
    const job = await prisma.clipJob.findFirst({
      where: {
        organizationId: orgId,
        clipId: clip.id,
        kind: ClipJobKind.RENDER,
        input: proofIs(true),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!job) return { preview: null };

    const done = job.status === 'DONE' && job.finishedAt !== null;
    const expiresAt = done ? new Date((job.finishedAt as Date).getTime() + PREVIEW_KEEP_MS) : null;
    const proofKey = done ? (outputOf(job)?.proofKey ?? null) : null;
    // Module 15: a clip marked removed with a video it plays (a montage whose
    // first video is another one keeps its own row) never signs its preview again.
    const kept = expiresAt !== null && now.getTime() < expiresAt.getTime() && !clip.removedAt;
    return {
      preview: {
        job: toJobView(job),
        fingerprint: fingerprintOf(job),
        url: proofKey && kept ? await this.sign(proofKey) : null,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    };
  }

  /** 404 for another workspace's clip, an unknown one, or an id that is not a UUID. */
  private async requireClip(orgId: string, clipId: string) {
    const clip = isUuid(clipId)
      ? await prisma.clip.findFirst({
          where: { id: clipId, organizationId: orgId },
          select: { id: true, removedAt: true },
        })
      : null;
    if (!clip) throw clipNotFound();
    return clip;
  }

  /** The clip, its READY video and its document, read inside the transaction. */
  private readClip(tx: ClipsTx, orgId: string, clipId: string, revision: number | undefined) {
    return freezeClipForExport(tx, this.videos, orgId, clipId, revision);
  }

  /** A one hour read address for the preview's file, or null when it cannot be made. */
  private async sign(key: string): Promise<string | null> {
    try {
      return await this.privateStorage.signedUrl(key, { expiresInSeconds: PREVIEW_URL_SECONDS });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.preview.sign_failed',
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
      return null;
    }
  }
}

/** What an export freezes of a clip. */
export interface FrozenClip {
  clip: Pick<Clip, 'id' | 'revision' | 'title' | 'origin' | 'videoId' | 'meta'>;
  video: { id: string };
  doc: ClipDocument;
}

/**
 * The clip, its READY video and its document, read inside the export's
 * transaction (the single export, Preview Export and Export All). 404 for
 * another workspace's clip or a gone video, 409 `clip_changed_elsewhere`
 * for a stale revision, 409 `video_not_ready`, 422 for a document that no
 * longer reads. Every other video the document plays must be live and READY
 * too.
 */
export async function freezeClipForExport(
  tx: ClipsTx,
  videos: ClipVideosRepository,
  orgId: string,
  clipId: string,
  revision: number | undefined,
): Promise<FrozenClip> {
  const clip = await tx.clip.findFirst({ where: { id: clipId, organizationId: orgId } });
  if (!clip) throw clipNotFound();
  if (revision !== undefined && revision !== clip.revision) {
    throw new ClipErrorException(HttpStatus.CONFLICT, 'clip_changed_elsewhere', {
      details: { revision: clip.revision },
    });
  }
  // Module 11 (builder D's rule): a montage whose videos include a removed one is 422
  // `montage_video_removed`, checked before its first video so the sentence names the montage.
  await assertMontageVideosLive(tx, orgId, clip);
  const video = await videos.findLive(orgId, clip.videoId, tx);
  if (!video) throw videoNotFound();
  if (video.status !== 'READY') {
    throw new ClipErrorException(HttpStatus.CONFLICT, 'video_not_ready');
  }
  const parsed = safeParseClipDocument(clip.document);
  if (!parsed.ok) {
    throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'tool_failed', {
      message: CLIPS_MESSAGES.CLIP_UNREADABLE,
    });
  }
  // Module 10: every other video the clip plays (a brand intro or outro, Module 11's montage)
  // is frozen with it and must be live and READY too; a removed one fails like the clip's own.
  const others = [
    ...new Set(
      parsed.doc.sources.map((source) => source.videoId).filter((videoId) => videoId !== video.id),
    ),
  ];
  for (const videoId of others) {
    const other = await videos.findLive(orgId, videoId, tx);
    if (!other) throw videoNotFound();
    if (other.status !== 'READY') {
      throw new ClipErrorException(HttpStatus.CONFLICT, 'video_not_ready');
    }
  }
  return { clip, video, doc: parsed.doc };
}
