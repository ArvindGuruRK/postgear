/**
 * The library ingest engine (Module 12, research 10 section 8.2): for each
 * candidate a source offers, in order and one at a time:
 *
 * 1. the licence guard, on the source's own words, before any download;
 * 2. dedupe by `(origin, originId)` and the deny list;
 * 3. the bytes (6 MB at most), sniffed for their real type, then dedupe by
 *    their SHA-256 and the deny list again;
 * 4. `normaliseSticker` (the same function a workspace upload goes through);
 * 5. the files into the public bucket under their content hash, cached for
 *    a year (`library/stickers/<2 hex>/<sha256>.apng|.png` and its preview);
 * 6. the row, `STAGED` with its full evidence (or `ACTIVE` with
 *    `--auto-publish`, which only `own`, `kenney` and `noto` may use);
 * 7. the licence report into the private bucket, and the run's counts.
 *
 * A dry run does everything up to the files, then writes nothing.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  normaliseSticker,
  type RunTool,
  StickerError,
  sniffStickerType,
} from '@postgear/media-tools';
import { clipKeys, libraryKeys, type PrivateStorage, type StorageBackend } from '@postgear/storage';
import { guardCandidate } from './licence';
import {
  type AcceptedItem,
  countReasons,
  type LicenceReport,
  type RejectedItem,
  reportMarkdown,
} from './report';
import type { LibraryStore } from './store';
import {
  AUTO_PUBLISH_ORIGINS,
  LibraryError,
  type StickerAdapter,
  type StickerCategory,
} from './types';

/** The most a source file may weigh before it is even looked at. */
export const MAX_SOURCE_BYTES = 6 * 1024 * 1024;

export interface IngestDeps {
  store: LibraryStore;
  storage: Pick<StorageBackend, 'put'>;
  privateStorage: Pick<PrivateStorage, 'put'>;
  runTool: RunTool;
  /** A folder the run may work in; its own subfolder is removed at the end. */
  scratchRoot: string;
  brands: readonly string[];
  now?: () => Date;
  log?: (line: string) => void;
}

export interface IngestOptions {
  limit?: number;
  category?: StickerCategory;
  dryRun?: boolean;
  autoPublish?: boolean;
  /** What the operator typed, kept on the run row. */
  args?: Record<string, unknown>;
}

export interface IngestResult {
  runId: string;
  report: LicenceReport;
  markdown: string;
  reportKey: string | null;
}

export async function ingestStickers(
  adapter: StickerAdapter,
  deps: IngestDeps,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const dryRun = options.dryRun ?? false;
  const autoPublish = options.autoPublish ?? false;
  if (autoPublish && !(AUTO_PUBLISH_ORIGINS as readonly string[]).includes(adapter.origin)) {
    throw new LibraryError(
      `${adapter.origin} may not use --auto-publish: its items wait for a review.`,
    );
  }

  const startedAt = now();
  const candidates = await adapter.candidates();
  const sourceId = dryRun ? 'dry-run' : await deps.store.upsertSource(adapter.source);
  const runId = dryRun
    ? randomUUID()
    : await deps.store.createRun(adapter.origin, options.args ?? {});
  const scratch = mkdtempSync(path.join(deps.scratchRoot, 'library-'));

  const accepted: AcceptedItem[] = [];
  const rejected: RejectedItem[] = [];
  const seen = new Set<string>();
  let considered = 0;

  try {
    for (const candidate of candidates) {
      if (options.limit !== undefined && considered >= options.limit) break;
      const reject = (reason: RejectedItem['reason'], detail: string) => {
        rejected.push({ name: candidate.name, originId: candidate.originId, reason, detail });
        log(`  refused ${candidate.originId}: ${reason} (${detail})`);
      };

      const guard = guardCandidate(candidate, { brands: deps.brands });
      if (guard.ok && options.category && guard.category !== options.category) continue;
      considered += 1;
      if (!guard.ok) {
        reject(guard.reason, guard.detail);
        continue;
      }
      if (await deps.store.isDenied(adapter.origin, candidate.originId, null)) {
        reject('denied', 'removed before, it cannot come back');
        continue;
      }
      if (await deps.store.hasOrigin(adapter.origin, candidate.originId)) {
        reject('duplicate', 'already in the library');
        continue;
      }

      let bytes: Buffer;
      try {
        bytes = await adapter.read(candidate, MAX_SOURCE_BYTES);
      } catch (error) {
        reject(
          'fetch_failed',
          error instanceof Error ? error.message.slice(0, 200) : 'could not read it',
        );
        continue;
      }
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (await deps.store.isDenied(adapter.origin, candidate.originId, checksum)) {
        reject('denied', 'the same file was removed before');
        continue;
      }
      if (seen.has(checksum) || (await deps.store.hasChecksum(checksum))) {
        reject('duplicate', 'the same file is already in the library');
        continue;
      }
      seen.add(checksum);
      const type = sniffStickerType(bytes.subarray(0, 16));
      if (!type) {
        reject('not_a_picture', 'not a PNG, GIF or WebP');
        continue;
      }

      const base = `item-${considered}`;
      const input = `${base}.in.${type}`;
      writeFileSync(path.join(scratch, input), bytes);
      let made: Awaited<ReturnType<typeof normaliseSticker>>;
      try {
        made = await normaliseSticker({
          runTool: deps.runTool,
          cwd: scratch,
          input,
          outputBase: base,
          targetPx: candidate.emojiLike ? 256 : 512,
        });
      } catch (error) {
        if (
          error instanceof StickerError &&
          (error.code === 'sticker_unusable' || error.code === 'sticker_too_large')
        ) {
          reject(error.code === 'sticker_unusable' ? 'unusable' : 'too_large', error.code);
          continue;
        }
        throw error;
      }

      const file = readFileSync(path.join(scratch, made.file));
      const hash = createHash('sha256').update(file).digest('hex');
      const fileKey = libraryKeys.sticker(hash, made.animated ? 'apng' : 'png');
      const previewKey = libraryKeys.preview(hash);
      let id: string | null = null;
      if (!dryRun) {
        await deps.storage.put(fileKey, file, made.animated ? 'image/apng' : 'image/png');
        await deps.storage.put(
          previewKey,
          readFileSync(path.join(scratch, made.preview)),
          'image/webp',
        );
        id = await deps.store.createSticker({
          sourceId,
          runId,
          animated: made.animated,
          name: candidate.name.trim(),
          tags: candidate.tags,
          category: guard.category,
          width: made.width,
          height: made.height,
          durationMs: made.durationMs,
          frames: made.frames,
          fps: made.fps,
          fileKey,
          previewKey,
          bytes: made.bytes,
          licence: guard.licence,
          licenceUrl: candidate.licenceUrl ?? adapter.source.licenceUrl,
          author: candidate.creator,
          authorUrl: candidate.creatorUrl,
          origin: adapter.origin,
          originId: candidate.originId,
          sourceUrl: candidate.sourceUrl,
          originalWork: candidate.originalWork,
          retrievedAt: now(),
          sourceChecksum: checksum,
          publish: autoPublish,
        });
        if (!id) {
          reject('duplicate', 'another run added it at the same time');
          continue;
        }
      }
      accepted.push({
        id,
        name: candidate.name.trim(),
        category: guard.category,
        licence: guard.licence,
        creator: candidate.creator,
        sourceUrl: candidate.sourceUrl,
        originId: candidate.originId,
        animated: made.animated,
        width: made.width,
        height: made.height,
        bytes: made.bytes,
        fileKey,
      });
      log(
        `  ${dryRun ? 'would add' : 'added'} ${candidate.originId} (${made.animated ? 'moving' : 'still'})`,
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const report: LicenceReport = {
    runId,
    origin: adapter.origin,
    source: adapter.source.name,
    dryRun,
    autoPublished: autoPublish && !dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    accepted,
    rejected,
    rejectionsByReason: countReasons(rejected),
  };
  const markdown = reportMarkdown(report);
  if (dryRun) return { runId, report, markdown, reportKey: null };

  const reportKey = clipKeys.libraryReport(runId, 'md');
  await deps.privateStorage.put(
    clipKeys.libraryReport(runId, 'json'),
    Buffer.from(JSON.stringify(report, null, 2)),
    'application/json',
  );
  await deps.privateStorage.put(reportKey, Buffer.from(markdown), 'text/markdown; charset=utf-8');
  await deps.store.finishRun(runId, {
    accepted: accepted.length,
    rejected: rejected.length,
    rejectionsByReason: report.rejectionsByReason as Record<string, number>,
    reportKey,
  });
  return { runId, report, markdown, reportKey };
}
