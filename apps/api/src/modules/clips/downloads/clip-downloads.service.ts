/**
 * Download in any format (Sprint 12, Module 18): the link card's Download,
 * the Downloads tab, Save File, Save To Media and Download Original.
 *
 * ## A download, in order
 *
 * 1. **Probe again on the server** (`CLIP_LINK_PROBER`, cached): the browser's
 *    formats are never trusted, and the platform switch and the breaker apply.
 * 2. **The rights tick** (422 `rights_required`). A download makes no
 *    `ClipVideo`, so the record (`byUserId`, `at`, `textVersion`) goes in the
 *    job's input and stays with the row.
 * 3. **The format** must be in the fresh probe (422 `format_gone`).
 * 4. **The same file asked for twice** (same link, same quality, still being
 *    prepared or ready) answers that download and charges nothing.
 * 5. **The limits** (`ClipLimitsGuard.assertCanDownload`): the switch, the
 *    length, the space the file takes while kept. Then the busy cap: three
 *    downloads being prepared at once (409 `downloads_busy`), a fixed safety
 *    cap rather than a plan value.
 * 6. **The charges**, once the job id exists: one unit of
 *    `clips.downloads_per_day` (`clips.download:<jobId>`), then the video's
 *    length on `clips.import_minutes_per_month` (`clips.import:<jobId>`), so
 *    Download is never a way around the import limits.
 * 7. **The row**, in a serializable transaction that checks steps 4 and 5
 *    again (two clicks at once: one creates, the other answers it or is
 *    refused). Both charges are reversed in a `finally` whenever the row was
 *    not written.
 * 8. **Start** the job; the worker prepares the file and sets `expiresAt`.
 *
 * A failed or cancelled download gives both charges back (the worker does
 * it through the internal route); a finished one never does, so a download
 * and delete loop gains nothing.
 */
import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ClipJob } from '@postgear/db';
import { clipKeys, type PrivateStorage } from '@postgear/storage';
import {
  downloadableFormats,
  downloadFileName,
  downloadInputSchema,
  type LinkFormat,
  MAX_OPEN_DOWNLOADS,
} from '@postgear/video-engine';
import { stripControlChars } from '../../../common/sanitize';
import { UsageService } from '../../entitlements/usage.service';
import { MAX_VIDEO_UPLOAD_BYTES } from '../../media/media.messages';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES, mediaTooBigSentence } from '../clips.messages';
import { serializable } from '../clips.tx';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard, estimateDownload } from '../limits/clip-limits.guard';
import { CLIP_LINK_PROBER, type ClipLinkProber } from '../links/clip-links.types';
import { CLIP_RIGHTS_TEXT_VERSION } from '../videos/clip-rights';
import { ClipDownloadsRepository } from './clip-downloads.repository';
import type { StartDownloadInput } from './clip-downloads.schema';
import {
  type DownloadView,
  downloadOutputOf,
  downloadStateOf,
  toDownloadView,
} from './clip-downloads.view';

/** The Downloads tab shows the last two days. */
export const DOWNLOADS_LIST_WINDOW_MS = 48 * 60 * 60_000;

/** A Save File or Download Original address lives five minutes: long enough to start, never a share link. */
export const DOWNLOAD_LINK_SECONDS = 300;

const MAX_TITLE_LENGTH = 300;

export interface StartDownloadOutcome {
  job: ClipJobView;
  download: DownloadView;
  /** The same file was already being prepared or ready: nothing new was made or charged. */
  existing: boolean;
}

@Injectable()
export class ClipDownloadsService {
  private readonly logger = new Logger(ClipDownloadsService.name);

  constructor(
    private readonly repository: ClipDownloadsRepository,
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly usage: UsageService,
    private readonly scheduling: SchedulingService,
    @Inject(CLIP_LINK_PROBER) private readonly prober: ClipLinkProber,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
  ) {}

  // ---- Start -----------------------------------------------------------------

  async start(
    orgId: string,
    userId: string,
    body: StartDownloadInput,
  ): Promise<StartDownloadOutcome> {
    const probe = await this.prober.probe(orgId, body.url);
    if (body.rightsConfirmed !== true) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'rights_required');
    }
    const format = downloadableFormats(probe.info.formats).find(
      (entry) => entry.id === body.formatId,
    );
    if (!format) throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'format_gone');

    const same = (jobs: readonly ClipJob[]): ClipJob | null =>
      jobs.find((job) => isSameFile(job, probe.link, format, new Date())) ?? null;
    const already = same(await this.repository.list(orgId, this.since()));
    if (already) return this.outcome(already, true);

    const durationMs = Math.max(0, Math.round(probe.info.durationMs));
    await this.limits.assertCanDownload(orgId, durationMs, estimateDownload(format, durationMs));
    if ((await this.repository.countOpen(orgId)) >= MAX_OPEN_DOWNLOADS) throw busy();
    const maxBytes = Math.max(1, await this.limits.storageLeftBytes(orgId));

    const jobId = this.jobs.newJobId();
    const row = await this.jobs.build({
      id: jobId,
      orgId,
      userId,
      kind: 'DOWNLOAD',
      input: {
        link: {
          platform: probe.link.platform,
          kind: probe.link.kind,
          externalId: probe.link.externalId,
          canonicalUrl: probe.link.canonicalUrl,
          ...(probe.link.channel ? { channel: probe.link.channel } : {}),
        },
        formatId: format.id,
        label: format.audioOnly ? 'Audio Only' : format.label,
        audioOnly: format.audioOnly,
        title: cleanTitle(probe.info.title),
        durationMs,
        expectedBytes:
          typeof format.bytes === 'number' && format.bytes > 0 ? Math.round(format.bytes) : null,
        maxBytes,
        rights: {
          byUserId: userId,
          at: new Date().toISOString(),
          textVersion: String(CLIP_RIGHTS_TEXT_VERSION),
        },
      },
    });

    let written = false;
    try {
      await this.limits.chargeDownload(orgId, jobId);
      await this.limits.chargeImport(orgId, jobId, durationMs);

      const outcome = await serializable(async (tx) => {
        const found = same(await this.repository.list(orgId, this.since(), tx));
        if (found) return { kind: 'existing' as const, job: found };
        if ((await this.repository.countOpen(orgId, tx)) >= MAX_OPEN_DOWNLOADS) {
          return { kind: 'busy' as const };
        }
        return { kind: 'created' as const, job: await this.jobsRepository.create(row, tx) };
      });
      if (outcome.kind === 'busy') throw busy();
      if (outcome.kind === 'existing') return this.outcome(outcome.job, true);
      written = true;

      await this.jobs.start(outcome.job);
      const fresh = (await this.jobsRepository.find(orgId, outcome.job.id)) ?? outcome.job;
      return this.outcome(fresh, false);
    } finally {
      // Refused, beaten by a twin, or the row never landed: both charges go back.
      if (!written) await this.usage.reverseAllFor(orgId, jobId);
    }
  }

  // ---- Reads -----------------------------------------------------------------

  /** The last two days, newest first (deleted and cancelled ones left out). */
  async list(orgId: string): Promise<{ downloads: DownloadView[] }> {
    const now = new Date();
    const rows = await this.repository.list(orgId, this.since(now));
    return { downloads: rows.map((row) => toDownloadView(row, now)) };
  }

  /**
   * Save File: a signed address for the prepared file, five minutes, named
   * after the video. 409 while it is still being prepared, 404 for a failed,
   * cancelled, deleted or unknown one (another workspace's reads the same),
   * 410 once its 24 hours are over (the file and its asset row are removed
   * then and there; the row stays and reads Expired).
   */
  async fileUrl(orgId: string, jobId: string): Promise<string> {
    const job = await this.require(orgId, jobId);
    const now = new Date();
    const state = downloadStateOf(job, now);
    if (state === 'preparing') {
      throw new ClipErrorException(HttpStatus.CONFLICT, 'download_not_ready');
    }
    const output = downloadOutputOf(job);
    if (state === 'expired' && output) {
      await this.removeFile(orgId, job.id, output.key);
      throw new ClipErrorException(HttpStatus.GONE, 'download_expired');
    }
    if (state !== 'ready' || !output) throw notFound();
    return this.storage.signedUrl(output.key, {
      expiresInSeconds: DOWNLOAD_LINK_SECONDS,
      downloadName: output.fileName,
    });
  }

  // ---- Actions ---------------------------------------------------------------

  /**
   * Save To Media: a ready MP4 at or under Media's video limit is copied to
   * the Media library by the worker (`clipSaveDownloadWorkflow`), which makes
   * its poster and the Media row. The row reads "Saving to Media" meanwhile.
   * Asking again while it saves, or after it saved, answers the row as it is.
   */
  async saveToMedia(orgId: string, jobId: string): Promise<{ download: DownloadView }> {
    const job = await this.require(orgId, jobId);
    const state = downloadStateOf(job, new Date());
    if (state === 'preparing') {
      throw new ClipErrorException(HttpStatus.CONFLICT, 'download_not_ready');
    }
    if (state === 'expired') throw new ClipErrorException(HttpStatus.GONE, 'download_expired');
    const output = downloadOutputOf(job);
    if (state !== 'ready' || !output) throw notFound();
    if (output.ext !== 'mp4') {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'download_audio_only');
    }
    if (output.bytes > MAX_VIDEO_UPLOAD_BYTES) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'media_too_big', {
        message: mediaTooBigSentence(output.bytes, MAX_VIDEO_UPLOAD_BYTES),
      });
    }

    const started = await this.repository.startSaving(orgId, job.id);
    if (started.outcome === 'not_ready') throw notFound();
    if (started.outcome === 'started') {
      const ok = await this.scheduling.startClipSaveDownload(job.id, orgId);
      if (!ok) {
        await this.repository.saveNotStarted(orgId, job.id);
        throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'tools_offline');
      }
    }
    return { download: toDownloadView(started.job) };
  }

  /**
   * Delete Download. One still being prepared is cancelled (its workflow
   * removes what it stored and gives both charges back; the row then reads
   * Cancelled and leaves the tab). A finished, failed or expired one loses
   * its file and asset row; the job row stays as the rights record and
   * leaves the tab. Nothing is given back for a finished one.
   */
  async remove(orgId: string, jobId: string): Promise<{ message: string }> {
    const job = await this.require(orgId, jobId);
    if (job.status === 'QUEUED' || job.status === 'RUNNING') {
      await this.jobs.cancel(orgId, job.id);
      return { message: CLIPS_MESSAGES.DOWNLOAD_DELETED };
    }
    await this.deleteFiles(orgId, job.id);
    await this.repository.markRemoved(orgId, job.id, new Date());
    return { message: CLIPS_MESSAGES.DOWNLOAD_DELETED };
  }

  /**
   * Download Original: an uploaded video's own file, as uploaded, behind a
   * five minute signed address named after the video. Uploads only (422
   * `not_an_upload` for a link import: its light copy is a working file,
   * not a product). No job and no charge: the file is already the workspace's.
   */
  async downloadOriginal(orgId: string, videoId: string): Promise<{ url: string }> {
    if (!isUuid(videoId)) throw videoNotFound();
    const found = await this.repository.uploadOriginal(orgId, videoId);
    switch (found.outcome) {
      case 'not_found':
        throw videoNotFound();
      case 'not_an_upload':
        throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'not_an_upload');
      case 'missing':
        throw new ClipErrorException(HttpStatus.NOT_FOUND, 'original_missing');
      case 'found': {
        const { key, title } = found.original;
        const url = await this.storage.signedUrl(key, {
          expiresInSeconds: DOWNLOAD_LINK_SECONDS,
          downloadName: downloadFileName(title, extensionOf(key)),
        });
        return { url };
      }
    }
  }

  // ---- Shared ----------------------------------------------------------------

  private since(now: Date = new Date()): Date {
    return new Date(now.getTime() - DOWNLOADS_LIST_WINDOW_MS);
  }

  private outcome(job: ClipJob, existing: boolean): StartDownloadOutcome {
    return { job: toJobView(job), download: toDownloadView(job), existing };
  }

  private async require(orgId: string, jobId: string): Promise<ClipJob> {
    const job = isUuid(jobId) ? await this.repository.find(orgId, jobId) : null;
    if (!job) throw notFound();
    return job;
  }

  /** An expired file goes now rather than at the next sweep; the row stays. */
  private async removeFile(orgId: string, jobId: string, key: string): Promise<void> {
    await this.deleteFiles(orgId, jobId);
    await this.repository.removeFileRow(orgId, key);
  }

  /** Best-effort: a storage hiccup is logged and left to the cleanup sweep. */
  private async deleteFiles(orgId: string, jobId: string): Promise<void> {
    try {
      await this.storage.deletePrefix(clipKeys.downloadPrefix(orgId, jobId));
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.download.files_left',
          jobId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

/** Same link and quality, still being prepared or ready: asking again answers it. */
function isSameFile(
  job: ClipJob,
  link: { platform: string; externalId: string },
  format: Pick<LinkFormat, 'id'>,
  now: Date,
): boolean {
  const state = downloadStateOf(job, now);
  if (state !== 'preparing' && state !== 'ready') return false;
  const input = downloadInputSchema.safeParse(job.input);
  return (
    input.success &&
    input.data.formatId === format.id &&
    input.data.link.platform === link.platform &&
    input.data.link.externalId === link.externalId
  );
}

/** The title from the platform: control characters out, whitespace collapsed, capped. */
function cleanTitle(value: string): string {
  return (
    stripControlChars(value).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH) ||
    'Untitled Video'
  );
}

/** The stored file's own extension (`mp4`, `mov`, `mkv`, `webm`), never typed by a person. */
function extensionOf(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'mp4';
}

function busy(): ClipErrorException {
  return new ClipErrorException(HttpStatus.CONFLICT, 'downloads_busy');
}

function notFound(): ClipErrorException {
  return new ClipErrorException(HttpStatus.NOT_FOUND, 'download_not_found');
}

function videoNotFound(): NotFoundException {
  return new NotFoundException({
    message: CLIPS_MESSAGES.VIDEO_NOT_FOUND,
    code: 'video_not_found',
  });
}
