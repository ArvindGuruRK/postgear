/**
 * The Clips cleanup sweep (Sprint 12, Module 19 section 2), called by the
 * worker's maintenance loop on `/internal/clips/sweep` every 15 minutes. It
 * lives in the API, next to the resolver, the ledger and the notifications it
 * needs (the same choice as the reconcile).
 *
 * Every part runs in its own try, on a bounded batch, so one failure never
 * stops the rest and one pass stays well inside its activity timeout:
 *
 * | Part | What |
 * |---|---|
 * | notices and expiry | READY videos whose date is within three days: the plan is read again (a longer plan moves the date instead), the notice goes once and the date is held at least three days after it, a video past its date (with its notice sent) is removed and the bell says why |
 * | short-lived files | prepared downloads and Preview Export files past their `meta.expiresAt`: the files and asset rows go (download job rows stay as the rights record) |
 * | abandoned uploads | uploads started more than 24 hours ago and never completed: the storage upload is aborted, the row removed |
 * | stale sharp ranges | SEGMENT files of link videos nobody used for 14 days, while the platform copy is still there (they can be fetched again); an upload's ORIGINAL is never touched |
 * | unused library files | a workspace's own stickers and sounds older than 30 days that no clip uses |
 * | failed imports | FAILED videos untouched for 7 days, removed with their leftovers |
 * | charge backstop | a Clips charge older than an hour whose job never existed, or ended FAILED or CANCELLED without its refund, is given back (`rev:<entryId>`) |
 * | storage notice | a workspace whose videos use more than its plan allows gets the notice once (`ClipStorageNotice`); the row goes when it is under again |
 * | daily | orphan files (objects under `clips/` with no row, deleted once 24 hours old), overrides past their end date (an `EXPIRE` change row and the stamp), the reconcile report |
 *
 * The daily parts run on the first pass of each UTC day (a Redis key with
 * `SET NX`), or when the request forces them (`daily: true`, for tests and
 * the hand check).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ClipAssetKind,
  ClipJobKind,
  ClipVideoStatus,
  EntitlementChangeAction,
  type Prisma,
  prisma,
} from '@postgear/db';
import type { ClipSweepAnswer } from '@postgear/scheduling';
import { clipKeys, type PrivateStorage } from '@postgear/storage';
import { securityLogger } from '../../../common/logging/security-logger';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { touchOrgEntitlements } from '../../entitlements/entitlement-stamps';
import { UsageService } from '../../entitlements/usage.service';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { NotificationsService, type NotifyInput } from '../../notifications/notifications.service';
import { RedisService } from '../../redis/redis.service';
import { BYTES_PER_GB, gigabytesToBytes } from '../clips.units';
import {
  storageOverLimitNotice,
  videoExpiredNotice,
  videoExpiringNotice,
} from '../internal/clip-notices';
import { OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { DAY_MS, decideDue, NOTICE_BEFORE_MS } from './clip-retention.rules';
import { ClipRetentionService } from './clip-retention.service';

/** Rows looked at per part per pass. */
export const SWEEP_BATCH = 100;
/** An upload never completed is abandoned after this long. */
export const ABANDONED_UPLOAD_MS = DAY_MS;
/** A sharp range of a video nobody used for this long is let go. */
export const STALE_SEGMENT_MS = 14 * DAY_MS;
/** A workspace's own sticker or sound no clip uses is removed after this long. */
export const UNUSED_LIBRARY_MS = 30 * DAY_MS;
/** A failed import is kept this long, so its card can still be tried again. */
export const FAILED_IMPORT_MS = 7 * DAY_MS;
/** A charge with no job is given back once it is this old (the request that made it is long over). */
export const ORPHAN_CHARGE_MS = 60 * 60_000;
/** A file with no row is deleted once it is this old (a running job's files always have rows by then). */
export const ORPHAN_FILE_MS = DAY_MS;
/** Objects one daily orphan check reads (pages of 1,000). */
export const ORPHAN_SCAN_LIMIT = 50_000;

/** The meters whose charges are keyed to a Clips job (`refId` is the job id). */
export const JOB_METERS = [
  'clips.import_minutes_per_month',
  'clips.ai_minutes_per_month',
  'clips.downloads_per_day',
] as const;

/** The Redis key that lets one pass a day run the daily parts. */
export function dailyKey(now: Date): string {
  return `clips:sweep:daily:${now.toISOString().slice(0, 10)}`;
}

const EXPIRE_REASON = 'The override reached its end date.';

@Injectable()
export class ClipSweepService {
  private readonly logger = new Logger(ClipSweepService.name);

  constructor(
    private readonly retention: ClipRetentionService,
    private readonly resolver: EntitlementResolver,
    private readonly usage: UsageService,
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
  ) {}

  async sweep(options: { now?: Date; daily?: boolean } = {}): Promise<ClipSweepAnswer> {
    const now = options.now ?? new Date();
    const failedParts: string[] = [];
    const part = async <T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await run();
      } catch (error) {
        failedParts.push(name);
        this.logger.error(
          JSON.stringify({
            event: 'clips.sweep.part_failed',
            part: name,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
        return fallback;
      }
    };

    const due = await part('expiry', () => this.noticesAndExpiry(now), { noticed: 0, expired: 0 });
    const downloads = await part('short_lived', () => this.shortLivedFiles(now), 0);
    const uploads = await part('uploads', () => this.abandonedUploads(now), 0);
    const segments = await part('segments', () => this.staleSegments(now), 0);
    const library = await part('library', () => this.unusedLibraryFiles(now), 0);
    const failedImports = await part('failed_imports', () => this.failedImports(now), 0);
    const charges = await part('charges', () => this.chargeBackstop(now), 0);
    const storageNotices = await part('storage', () => this.storageNotices(now), 0);

    const runDaily =
      options.daily === true ||
      (await part(
        'daily_gate',
        () => this.redis.setIfAbsent(dailyKey(now), '1', 26 * 3600),
        false,
      ));
    const orphans = runDaily ? await part('orphans', () => this.orphanFiles(now), null) : null;
    const overridesExpired = runDaily
      ? await part('overrides', () => this.expireOverrides(now), null)
      : null;
    if (runDaily) await part('report', () => this.reconcileReport(), undefined);

    const answer: ClipSweepAnswer = {
      noticed: due.noticed,
      expired: due.expired,
      downloads,
      uploads,
      segments,
      library,
      failedImports,
      charges,
      storageNotices,
      orphans,
      overridesExpired,
      failedParts,
    };
    const busy =
      due.noticed +
      due.expired +
      downloads +
      uploads +
      segments +
      library +
      failedImports +
      charges;
    if (busy > 0 || storageNotices > 0 || runDaily || failedParts.length > 0) {
      this.logger.log(JSON.stringify({ event: 'clips.sweep', ...answer }));
    }
    return answer;
  }

  // ---- Notices and expiry ---------------------------------------------------------

  async noticesAndExpiry(now: Date): Promise<{ noticed: number; expired: number }> {
    const videos = await prisma.clipVideo.findMany({
      where: {
        deletedAt: null,
        status: ClipVideoStatus.READY,
        expiresAt: { lte: new Date(now.getTime() + NOTICE_BEFORE_MS) },
        // Videos already told and still inside their three days wait without taking the batch.
        OR: [{ expiryNoticeAt: null }, { expiresAt: { lte: now } }],
      },
      orderBy: { expiresAt: 'asc' },
      take: SWEEP_BATCH,
      select: {
        id: true,
        organizationId: true,
        title: true,
        lastUsedAt: true,
        expiresAt: true,
        expiryNoticeAt: true,
      },
    });

    const days = new Map<string, number>();
    let noticed = 0;
    let expired = 0;
    for (const video of videos) {
      const orgId = video.organizationId;
      if (!days.has(orgId)) days.set(orgId, await this.retention.retentionDays(orgId));
      const retentionDays = days.get(orgId) ?? 1;
      const decision = decideDue(video, retentionDays, now);

      if (decision.kind === 'extend') {
        await prisma.clipVideo.updateMany({
          where: { id: video.id, organizationId: orgId, expiresAt: video.expiresAt },
          data: { expiresAt: decision.expiresAt, expiryNoticeAt: null },
        });
        continue;
      }
      if (decision.kind === 'notice') {
        // The notice promises three days: the date is held at least that far out.
        const held = new Date(
          Math.max(video.expiresAt?.getTime() ?? 0, now.getTime() + NOTICE_BEFORE_MS),
        );
        const marked = await prisma.clipVideo.updateMany({
          where: { id: video.id, organizationId: orgId, expiryNoticeAt: null, deletedAt: null },
          data: { expiryNoticeAt: now, expiresAt: held },
        });
        if (marked.count > 0) {
          noticed += 1;
          await this.notify(videoExpiringNotice(orgId, video, held));
        }
        continue;
      }
      if (decision.kind === 'remove') {
        const removed = await this.retention.removeVideo(orgId, video.id, 'expired', now);
        if (removed) {
          expired += 1;
          await this.notify(videoExpiredNotice(orgId, video, retentionDays));
        }
      }
    }
    return { noticed, expired };
  }

  // ---- Short-lived files (downloads and Preview Export files) ----------------------

  async shortLivedFiles(now: Date): Promise<number> {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; organizationId: string; kind: string; jobId: string | null }>
    >`
      SELECT id, "organizationId", kind::text AS kind, meta->>'jobId' AS "jobId"
      FROM "ClipAsset"
      WHERE kind IN ('DOWNLOAD', 'PROOF')
        AND meta->>'expiresAt' IS NOT NULL
        AND (meta->>'expiresAt')::timestamptz < ${now}
      ORDER BY "createdAt" ASC
      LIMIT ${SWEEP_BATCH}`;

    let removed = 0;
    for (const row of rows) {
      if (row.jobId && isUuid(row.jobId)) {
        const prefix =
          row.kind === 'DOWNLOAD'
            ? clipKeys.downloadPrefix(row.organizationId, row.jobId)
            : clipKeys.proofPrefix(row.organizationId, row.jobId);
        await this.storage.deletePrefix(prefix);
      }
      const gone = await prisma.clipAsset.deleteMany({
        where: { id: row.id, organizationId: row.organizationId },
      });
      removed += gone.count;
    }
    return removed;
  }

  // ---- Abandoned uploads -------------------------------------------------------------

  async abandonedUploads(now: Date): Promise<number> {
    const videos = await prisma.clipVideo.findMany({
      where: {
        platform: 'UPLOAD',
        status: ClipVideoStatus.IMPORTING,
        deletedAt: null,
        createdAt: { lt: new Date(now.getTime() - ABANDONED_UPLOAD_MS) },
        jobs: { none: { kind: ClipJobKind.IMPORT } },
      },
      take: SWEEP_BATCH,
      select: {
        id: true,
        organizationId: true,
        assets: { where: { kind: ClipAssetKind.ORIGINAL }, select: { key: true, meta: true } },
      },
    });

    let removed = 0;
    for (const video of videos) {
      for (const asset of video.assets) {
        const uploadId = uploadIdOf(asset.meta);
        if (uploadId) await this.storage.abortUpload(asset.key, uploadId).catch(() => undefined);
      }
      const marked = await prisma.$transaction(async (tx) => {
        const changed = await tx.clipVideo.updateMany({
          where: {
            id: video.id,
            organizationId: video.organizationId,
            status: ClipVideoStatus.IMPORTING,
            deletedAt: null,
          },
          data: { deletedAt: now, removedReason: 'expired', status: ClipVideoStatus.REMOVED },
        });
        if (changed.count === 0) return false;
        await tx.clipAsset.deleteMany({
          where: { organizationId: video.organizationId, videoId: video.id },
        });
        return true;
      });
      if (marked) {
        removed += 1;
        await this.retention.deleteFiles(video.organizationId, video.id);
      }
    }
    return removed;
  }

  // ---- Stale sharp ranges ---------------------------------------------------------

  async staleSegments(now: Date): Promise<number> {
    const assets = await prisma.clipAsset.findMany({
      where: {
        kind: ClipAssetKind.SEGMENT,
        video: {
          deletedAt: null,
          hdAvailable: true,
          platform: { not: 'UPLOAD' },
          lastUsedAt: { lt: new Date(now.getTime() - STALE_SEGMENT_MS) },
        },
      },
      take: SWEEP_BATCH,
      select: { id: true, organizationId: true, key: true, clipId: true },
    });

    let removed = 0;
    for (const asset of assets) {
      // A sharp range an open export or fetch is reading stays until it ends.
      if (asset.clipId && (await this.clipBusy(asset.organizationId, asset.clipId))) continue;
      await this.storage.delete(asset.key);
      const gone = await prisma.clipAsset.deleteMany({
        where: { id: asset.id, organizationId: asset.organizationId },
      });
      removed += gone.count;
    }
    return removed;
  }

  // ---- Unused workspace stickers and sounds -----------------------------------

  /**
   * A made voice (Sprint 13, Module 09) is a sound like any other here. A
   * clip marked removed with its video (an exported one, kept for its Media
   * file) can never be opened or exported again, so it does not keep a file
   * in use (Sprint 13, Module 15).
   */
  async unusedLibraryFiles(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - UNUSED_LIBRARY_MS);
    const rows = await prisma.$queryRaw<
      Array<{ id: string; organizationId: string; key: string; previewKey: string | null }>
    >`
      SELECT a.id, a."organizationId", a.key, a.meta->>'previewKey' AS "previewKey"
      FROM "ClipAsset" a
      WHERE a."videoId" IS NULL AND a."clipId" IS NULL
        AND (a.kind = 'STICKER' OR (a.kind = 'AUDIO' AND a.meta->>'purpose' = 'sound'))
        AND a."createdAt" < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM "Clip" c
          WHERE c."organizationId" = a."organizationId"
            AND c."removedAt" IS NULL
            AND jsonb_path_exists(
              c.document,
              '$.tracks[*].items[*].ref.asset ? (@ == $id)',
              jsonb_build_object('id', a.id::text)
            )
        )
      ORDER BY a."createdAt" ASC
      LIMIT ${SWEEP_BATCH}`;

    let removed = 0;
    for (const row of rows) {
      await this.storage.delete(row.key);
      if (row.previewKey) await this.storage.delete(row.previewKey).catch(() => undefined);
      const gone = await prisma.clipAsset.deleteMany({
        where: { id: row.id, organizationId: row.organizationId },
      });
      removed += gone.count;
    }
    return removed;
  }

  // ---- Old failed imports -----------------------------------------------------------

  async failedImports(now: Date): Promise<number> {
    const videos = await prisma.clipVideo.findMany({
      where: {
        status: ClipVideoStatus.FAILED,
        deletedAt: null,
        updatedAt: { lt: new Date(now.getTime() - FAILED_IMPORT_MS) },
      },
      take: SWEEP_BATCH,
      select: { id: true, organizationId: true },
    });
    let removed = 0;
    for (const video of videos) {
      if (await this.retention.removeVideo(video.organizationId, video.id, 'expired', now)) {
        removed += 1;
      }
    }
    return removed;
  }

  // ---- The charge backstop -------------------------------------------------------------

  /**
   * Gives back, once, a Clips charge older than an hour that nothing will
   * ever give back: its job never existed, or its job ended FAILED or
   * CANCELLED and the refund did not land (`reverseAllFor` only logs a
   * database error, and the cancel route and the reconcile do not retry).
   * A DONE, QUEUED or RUNNING job keeps its charge. `rev:<entryId>` makes a
   * race with a late refund one row.
   */
  async chargeBackstop(now: Date): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ id: string; organizationId: string }>>`
      SELECT u.id, u."organizationId"
      FROM "UsageEntry" u
      WHERE u.kind = 'CHARGE'
        AND u.meter IN (${JOB_METERS[0]}, ${JOB_METERS[1]}, ${JOB_METERS[2]})
        AND u."refId" IS NOT NULL
        AND u."createdAt" < ${new Date(now.getTime() - ORPHAN_CHARGE_MS)}
        AND NOT EXISTS (SELECT 1 FROM "ClipJob" j WHERE j.id = u."refId" AND j.status NOT IN ('FAILED', 'CANCELLED'))
        AND NOT EXISTS (SELECT 1 FROM "UsageEntry" r WHERE r."reversesId" = u.id)
      ORDER BY u."createdAt" ASC
      LIMIT ${SWEEP_BATCH}`;

    let reversed = 0;
    for (const row of rows) {
      const result = await this.usage.reverse(row.organizationId, row.id);
      if (!result.duplicate) {
        reversed += 1;
        this.logger.warn(
          JSON.stringify({ event: 'clips.sweep.orphan_charge_reversed', entryId: row.id }),
        );
      }
    }
    return reversed;
  }

  // ---- The storage notice -------------------------------------------------------------

  async storageNotices(now: Date): Promise<number> {
    const used = await prisma.clipAsset.groupBy({
      by: ['organizationId'],
      where: {
        kind: { not: ClipAssetKind.PROOF },
        OR: [{ videoId: null }, { video: { deletedAt: null } }],
      },
      _sum: { bytes: true },
    });

    const over = new Map<string, { usedGb: number; limitGb: number }>();
    for (const row of used) {
      const bytes = Number(row._sum.bytes ?? 0n);
      if (bytes <= 0) continue;
      const limitGb = Number(await this.resolver.get(row.organizationId, 'clips.storage_gb', now));
      if (!Number.isFinite(limitGb)) continue;
      if (bytes > gigabytesToBytes(limitGb)) {
        over.set(row.organizationId, { usedGb: bytes / BYTES_PER_GB, limitGb });
      }
    }

    // Under again (or nothing stored): the notice row goes, so a later overrun notifies again.
    await prisma.clipStorageNotice.deleteMany({
      where: { organizationId: { notIn: [...over.keys()] } },
    });

    let sent = 0;
    for (const [orgId, amounts] of over) {
      await prisma.clipStorageNotice.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, overSince: now },
        update: {},
      });
      const claimed = await prisma.clipStorageNotice.updateMany({
        where: { organizationId: orgId, notifiedAt: null },
        data: { notifiedAt: now },
      });
      if (claimed.count > 0) {
        sent += 1;
        await this.notify(storageOverLimitNotice(orgId, amounts.usedGb, amounts.limitGb));
      }
    }
    return sent;
  }

  // ---- Daily: orphan files -------------------------------------------------------

  async orphanFiles(now: Date): Promise<{ objects: number; deleted: number; missing: number }> {
    const cutoff = now.getTime() - ORPHAN_FILE_MS;
    const seen = new Set<string>();
    let objects = 0;
    let deleted = 0;
    let after: string | null = null;
    let complete = false;

    while (objects < ORPHAN_SCAN_LIMIT) {
      const page = await this.storage.list('clips/', { after, limit: 1000 });
      objects += page.objects.length;
      const keys = page.objects.map((object) => object.key);
      for (const key of keys) seen.add(key);
      const known = await this.knownKeys(keys);
      const busy = await this.busyIds(keys);

      for (const object of page.objects) {
        if (known.has(object.key) || object.modifiedAt.getTime() > cutoff) continue;
        if (idsOfKey(object.key).some((id) => busy.has(id))) continue;
        await this.storage.delete(object.key);
        deleted += 1;
      }
      if (!page.next) {
        complete = true;
        break;
      }
      after = page.next;
    }

    // Rows whose file is gone: counted for the log, never deleted here (a person may still need the row).
    let missing = 0;
    if (complete) {
      const rows = await prisma.clipAsset.findMany({
        where: {
          createdAt: { lt: new Date(cutoff) },
          NOT: { kind: ClipAssetKind.ORIGINAL, video: { status: ClipVideoStatus.IMPORTING } },
        },
        select: { key: true },
        take: ORPHAN_SCAN_LIMIT,
      });
      missing = rows.filter((row) => !seen.has(row.key)).length;
    }
    this.logger.log(
      JSON.stringify({ event: 'clips.sweep.orphans', objects, deleted, missing, complete }),
    );
    return { objects, deleted, missing };
  }

  /** The keys of a page that a row points at (its own key, or a sticker's preview). */
  private async knownKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const rows = await prisma.$queryRaw<Array<{ key: string }>>`
      SELECT key FROM "ClipAsset" WHERE key = ANY(${keys})
      UNION
      SELECT meta->>'previewKey' AS key FROM "ClipAsset" WHERE meta->>'previewKey' = ANY(${keys})`;
    return new Set(rows.map((row) => row.key));
  }

  /** Ids in a page's keys that belong to an open job or a video still coming in: never orphans. */
  private async busyIds(keys: string[]): Promise<Set<string>> {
    const ids = [...new Set(keys.flatMap(idsOfKey))];
    if (ids.length === 0) return new Set();
    const [jobs, videos] = await Promise.all([
      prisma.clipJob.findMany({
        where: { id: { in: ids }, status: { in: [...OPEN_JOB_STATUSES] } },
        select: { id: true },
      }),
      prisma.clipVideo.findMany({
        where: { id: { in: ids }, status: ClipVideoStatus.IMPORTING, deletedAt: null },
        select: { id: true },
      }),
    ]);
    return new Set([...jobs, ...videos].map((row) => row.id));
  }

  // ---- Daily: overrides past their end date ------------------------------------------

  async expireOverrides(now: Date): Promise<number> {
    const ended = await prisma.orgEntitlementOverride.findMany({
      where: { expiresAt: { lte: now } },
      take: 500,
      orderBy: { expiresAt: 'asc' },
    });
    let written = 0;
    for (const override of ended) {
      const already = await prisma.entitlementChange.findFirst({
        where: {
          organizationId: override.organizationId,
          key: override.key,
          action: EntitlementChangeAction.EXPIRE,
          createdAt: { gte: override.expiresAt },
        },
        select: { id: true },
      });
      if (already) continue;
      await prisma.entitlementChange.create({
        data: {
          scope: 'ORG',
          organizationId: override.organizationId,
          key: override.key,
          action: EntitlementChangeAction.EXPIRE,
          oldValue: override.value as Prisma.InputJsonValue,
          newValue: undefined,
          reason: EXPIRE_REASON,
          actorId: null,
          actorEmail: null,
        },
      });
      await touchOrgEntitlements(this.redis, override.organizationId);
      written += 1;
      securityLogger.log('entitlement.changed', {
        scope: 'ORG',
        action: 'EXPIRE',
        orgId: override.organizationId,
        key: override.key,
        actor: null,
      });
    }
    return written;
  }

  // ---- Daily: the reconcile report ----------------------------------------------------

  /** Counts for the operator's log: charges with no job, reversals with no original. */
  async reconcileReport(): Promise<void> {
    const [noJob, noOriginal] = await Promise.all([
      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM "UsageEntry" u
        WHERE u.kind = 'CHARGE'
          AND u.meter IN (${JOB_METERS[0]}, ${JOB_METERS[1]}, ${JOB_METERS[2]})
          AND u."refId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "ClipJob" j WHERE j.id = u."refId")
          AND NOT EXISTS (SELECT 1 FROM "UsageEntry" r WHERE r."reversesId" = u.id)`,
      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM "UsageEntry" r
        WHERE r.kind = 'REVERSAL'
          AND NOT EXISTS (SELECT 1 FROM "UsageEntry" o WHERE o.id = r."reversesId")`,
    ]);
    this.logger.log(
      JSON.stringify({
        event: 'clips.sweep.reconcile_report',
        chargesWithNoJob: noJob[0]?.count ?? 0,
        reversalsWithNoOriginal: noOriginal[0]?.count ?? 0,
      }),
    );
  }

  // ---- Shared -----------------------------------------------------------------------

  private async clipBusy(orgId: string, clipId: string): Promise<boolean> {
    const open = await prisma.clipJob.count({
      where: { organizationId: orgId, clipId, status: { in: [...OPEN_JOB_STATUSES] } },
    });
    return open > 0;
  }

  private async notify(input: NotifyInput): Promise<void> {
    try {
      await this.notifications.notify(input);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.sweep.notice_failed',
          type: input.type,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** The video or job id a key sits under: `clips/<org>/<videoId>/...` or `clips/<org>/<folder>/<jobId>/...`. */
export function idsOfKey(key: string): string[] {
  const parts = key.split('/');
  return [parts[2], parts[3]].filter((part): part is string => !!part && isUuid(part));
}

function uploadIdOf(meta: Prisma.JsonValue | null): string | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null;
  const id = (meta as { uploadId?: unknown }).uploadId;
  return typeof id === 'string' ? id : null;
}
