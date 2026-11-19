/**
 * "May this workspace bring in this video?" (Sprint 12, Module 04 section 1).
 *
 * A thin adapter over `EntitlementResolver` and `UsageService`, so the call
 * sites read as the rule they apply. There is no table of clip limits here
 * and no constant: every number comes from the resolver, every allowance is
 * charged on the usage ledger, and every refusal is the resolver's typed 402
 * (`{ message, code, details }`, whole numbers, the sentence from
 * `@postgear/entitlements`). The checks run in the documented order:
 *
 * 1. `clips.enabled` (`clips_not_in_plan`)
 * 2. `clips.max_video_minutes` against the probed length (`clips_video_too_long`)
 * 3. `clips.storage_gb`: the space used (a gauge over `ClipAsset.bytes`) plus
 *    the estimate (`clips_storage_full`)
 * 4. `clips.import_minutes_per_month`, charged with the probed length
 *    (`clips_minutes_used`), key `clips.import:<jobId>`
 *
 * and for uploads `clips.upload_max_gb` on the declared size, then again on
 * the real size at complete (`clips_upload_too_big`).
 *
 * A download in any format (Module 18) runs checks 1 to 3 on its own length
 * and size (`assertCanDownload`), then two charges once its job id exists:
 * the import minutes (4, the same meter and key shape, so Download is never
 * a way around the import limits) and one unit of `clips.downloads_per_day`
 * (`clips_downloads_today`), key `clips.download:<jobId>`.
 *
 * The worker never resolves a plan value: `importLimits` is what the API
 * copies into the job input, so a plan change mid-import changes nothing.
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@postgear/db';
import {
  ENCODE_SPECS,
  EXPORT_QUALITIES,
  type ExportQuality,
  type ImportLimits,
  type LinkFormat,
  type LinkInfo,
} from '@postgear/video-engine';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { type ConsumeResult, UsageService } from '../../entitlements/usage.service';
import { BYTES_PER_GB, gigabytesToBytes, MS_PER_MINUTE } from '../clips.units';

/** Videos up to two hours are kept at 720p; longer ones at 480p (Module 04, `importFetch`). */
export const PROXY_TALL_UNTIL_MS = 2 * 60 * 60_000;

/**
 * Stored bits a second for a video whose platform gave no size: the light
 * copy at its height, plus the small sound file, filmstrip and waveform.
 */
const ESTIMATE_BITS_PER_SECOND = { 720: 2_500_000, 480: 1_200_000, extras: 64_000 } as const;

export interface ImportEstimate {
  /** What the import will add to the workspace's video space. */
  storedBytes: number;
  /** The fetched file's size when the platform said, for the worker's free-disk check. */
  expectedBytes: number | null;
}

/** The meter key import minutes are charged on. */
export const IMPORT_METER = 'clips.import_minutes_per_month' as const;

/** The idempotency key of a job's import charge. */
export function importChargeKey(jobId: string): string {
  return `clips.import:${jobId}`;
}

/** The daily meter downloads are counted on (midnight UTC to midnight UTC). */
export const DOWNLOADS_METER = 'clips.downloads_per_day' as const;

/** The idempotency key of a download job's daily charge. */
export function downloadChargeKey(jobId: string): string {
  return `clips.download:${jobId}`;
}

/** Stored bits a second for a download whose platform gave no size, by height (and MP3's own rate). */
const DOWNLOAD_BITS_PER_SECOND = {
  1080: 5_000_000,
  720: 2_500_000,
  480: 1_200_000,
  low: 800_000,
  mp3: 192_000,
} as const;

/**
 * How much space a prepared download takes while it is kept: the platform's
 * size when it gave one, else the length times a typical bit rate for the
 * height. Audio Only is converted to a 192 kbps MP3, so its size comes from
 * the length, never from the platform's M4A. Never negative.
 */
export function estimateDownload(
  format: Pick<LinkFormat, 'height' | 'bytes' | 'audioOnly'>,
  durationMs: number,
): number {
  const seconds = Math.max(0, durationMs) / 1000;
  if (format.audioOnly) return Math.ceil((seconds * DOWNLOAD_BITS_PER_SECOND.mp3) / 8);
  if (typeof format.bytes === 'number' && format.bytes > 0) return Math.round(format.bytes);
  const height = format.height ?? 0;
  const rate =
    height > 720
      ? DOWNLOAD_BITS_PER_SECOND[1080]
      : height > 480
        ? DOWNLOAD_BITS_PER_SECOND[720]
        : height > 360
          ? DOWNLOAD_BITS_PER_SECOND[480]
          : DOWNLOAD_BITS_PER_SECOND.low;
  return Math.ceil((seconds * rate) / 8);
}

/** Import minutes for a length, in display units (a 61 min 30 s video is 61.5). */
export function importMinutes(durationMs: number): number {
  return Math.max(1, Math.round(durationMs)) / MS_PER_MINUTE;
}

/**
 * How much space an import will take, from the probe. The format nearest
 * the light copy's height with a size from the platform wins; without one
 * the length times a typical bit rate stands in. Never negative.
 */
export function estimateImport(info: Pick<LinkInfo, 'durationMs' | 'formats'>): ImportEstimate {
  const target = info.durationMs > PROXY_TALL_UNTIL_MS ? 480 : 720;
  const seconds = Math.max(0, info.durationMs) / 1000;
  const fitting = info.formats
    .filter((format) => !format.audioOnly && format.height !== null && format.height <= target)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
  const expectedBytes =
    fitting && typeof fitting.bytes === 'number' && fitting.bytes > 0
      ? Math.round(fitting.bytes)
      : null;

  const extras = Math.ceil((seconds * ESTIMATE_BITS_PER_SECOND.extras) / 8);
  const video = expectedBytes ?? Math.ceil((seconds * ESTIMATE_BITS_PER_SECOND[target]) / 8);
  return { storedBytes: video + extras, expectedBytes };
}

@Injectable()
export class ClipLimitsGuard {
  constructor(
    private readonly resolver: EntitlementResolver,
    private readonly usage: UsageService,
  ) {}

  /** 1. The feature is on for this plan. */
  async assertEnabled(orgId: string): Promise<void> {
    await this.resolver.assert(orgId, 'clips.enabled', (enabled) => enabled === true);
  }

  /** 2. The probed length is at most the plan's longest video. Unknown lengths pass (the worker checks). */
  async assertLength(orgId: string, durationMs: number | null): Promise<void> {
    if (durationMs === null || !Number.isFinite(durationMs)) return;
    await this.resolver.assert(
      orgId,
      'clips.max_video_minutes',
      (minutes) => durationMs <= minutes * MS_PER_MINUTE,
      { needed: Math.ceil(durationMs / MS_PER_MINUTE) },
    );
  }

  /** 3. The space used plus what this adds stays inside the plan's video space. */
  async assertStorage(orgId: string, addingBytes: number): Promise<void> {
    const used = await this.storageUsedBytes(orgId);
    await this.resolver.assert(
      orgId,
      'clips.storage_gb',
      (gb) => used + Math.max(0, addingBytes) <= gigabytesToBytes(gb),
      { used: Math.ceil(used / BYTES_PER_GB) },
    );
  }

  /** Uploads: the file's size is at most the plan's largest upload. */
  async assertUploadSize(orgId: string, bytes: number): Promise<void> {
    await this.resolver.assert(
      orgId,
      'clips.upload_max_gb',
      (gb) => bytes <= gigabytesToBytes(gb),
      { needed: Math.ceil(bytes / BYTES_PER_GB) },
    );
  }

  /** Checks 1 to 3 for a link import, in order. The charge (4) follows once the job id exists. */
  async checkLinkImport(orgId: string, durationMs: number, storedBytes: number): Promise<void> {
    await this.assertEnabled(orgId);
    await this.assertLength(orgId, durationMs);
    await this.assertStorage(orgId, storedBytes);
  }

  /**
   * Module 18: checks 1 to 3 for a download, in order: the switch, the
   * length (`clips.max_video_minutes`), then the space the prepared file
   * takes while it is kept. The charges follow once the job id exists.
   */
  async assertCanDownload(orgId: string, durationMs: number, storedBytes: number): Promise<void> {
    await this.assertEnabled(orgId);
    await this.assertLength(orgId, durationMs);
    await this.assertStorage(orgId, storedBytes);
  }

  /**
   * Module 18: one download counted on the day's meter. Idempotent through
   * `clips.download:<jobId>`. Throws the typed 402 (`clips_downloads_today`,
   * with the plan's number) past the allowance.
   */
  chargeDownload(orgId: string, jobId: string): Promise<ConsumeResult> {
    return this.usage.consume(orgId, DOWNLOADS_METER, 1, {
      idempotencyKey: downloadChargeKey(jobId),
      refId: jobId,
    });
  }

  /** Module 18: bytes the plan's video space still has (the most a download may write). */
  async storageLeftBytes(orgId: string): Promise<number> {
    const [gb, used] = await Promise.all([
      this.resolver.get(orgId, 'clips.storage_gb'),
      this.storageUsedBytes(orgId),
    ]);
    return Math.max(0, gigabytesToBytes(Number(gb)) - used);
  }

  /** The upload start's checks: the switch, the size, then the space. */
  async checkUploadStart(orgId: string, bytes: number): Promise<void> {
    await this.assertEnabled(orgId);
    await this.assertUploadSize(orgId, bytes);
    await this.assertStorage(orgId, bytes);
  }

  /**
   * 4. Charges the import minutes for one job. Idempotent through
   * `clips.import:<jobId>`: a double click, a retried request or a replayed
   * activity charges once. Throws the typed 402 (`clips_minutes_used`).
   */
  chargeImport(orgId: string, jobId: string, durationMs: number): Promise<ConsumeResult> {
    return this.usage.consume(orgId, IMPORT_METER, importMinutes(durationMs), {
      idempotencyKey: importChargeKey(jobId),
      refId: jobId,
      meta: { durationMs: Math.round(durationMs) },
    });
  }

  /** The plan values an import job carries, so the worker never resolves one. */
  async importLimits(orgId: string): Promise<ImportLimits> {
    const values = await this.resolver.getMany(orgId, [
      'clips.max_video_minutes',
      'clips.storage_gb',
      'clips.retention_days',
    ]);
    return {
      maxVideoMs: Math.max(
        1,
        Math.floor(Number(values['clips.max_video_minutes']) * MS_PER_MINUTE),
      ),
      storageBytes: Math.max(0, gigabytesToBytes(Number(values['clips.storage_gb']))),
      retentionDays: Math.max(1, Math.floor(Number(values['clips.retention_days']))),
    };
  }

  /** The plan's best export quality that can be stored ('4k' is reserved, so it reads as the best one). */
  async bestExportQuality(orgId: string): Promise<ExportQuality> {
    const value = await this.resolver.get(orgId, 'clips.export_max_quality');
    return (EXPORT_QUALITIES as readonly string[]).includes(value)
      ? (value as ExportQuality)
      : EXPORT_QUALITIES[EXPORT_QUALITIES.length - 1];
  }

  /** The tallest picture worth fetching for a clip's sharp range: the best quality's short side. */
  async bestExportHeight(orgId: string): Promise<number> {
    return ENCODE_SPECS[await this.bestExportQuality(orgId)].shortSide;
  }

  /**
   * Bytes the workspace's kept files take: assets of videos not removed, and
   * clip files with no video. A gauge, not a ledger. Preview Export files
   * (PROOF, gone within 24 hours) are ours to keep and never count (Module 15).
   */
  async storageUsedBytes(orgId: string): Promise<number> {
    const result = await prisma.clipAsset.aggregate({
      where: {
        organizationId: orgId,
        kind: { not: 'PROOF' },
        OR: [{ videoId: null }, { video: { deletedAt: null } }],
      },
      _sum: { bytes: true },
    });
    return Number(result._sum.bytes ?? 0n);
  }
}
