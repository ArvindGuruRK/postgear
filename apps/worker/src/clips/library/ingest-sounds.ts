/**
 * The sound ingest engine (Module 14, research 10 section 8.2): Module 12's
 * steps with a sound's rules. For each candidate a source offers, in order
 * and one at a time:
 *
 * 1. the sound guard, on the source's own words, before any download (the
 *    licence allow-list, brands, derivative signals, the original-work rule);
 * 2. dedupe by `(origin, originId)` and the deny list;
 * 3. the bytes (12 MB at most), sniffed for their real type, then dedupe by
 *    their SHA-256 and the deny list again;
 * 4. `normaliseSound`: stereo, 48 kHz, silence trimmed, 5 ms fades, levelled
 *    (-16 LUFS, or -3 dBFS peak for a short effect), AAC `.m4a`, peaks; a
 *    music candidate too short for music may fall back to an effect
 *    category its adapter names (Kenney's jingles);
 * 5. the file into the public bucket under its content hash
 *    (`library/sounds/<2 hex>/<sha256>.m4a`, cached for a year);
 * 6. the row, `STAGED` with its full evidence (or `ACTIVE` with
 *    `--auto-publish`, which only `own` and `kenney` may use);
 * 7. the licence report into the private bucket, and the run's counts.
 *
 * A dry run does everything up to the file, then writes nothing.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  type NormalisedSound,
  normaliseSound,
  type RunTool,
  SoundError,
  sniffSoundType,
} from '@postgear/media-tools';
import { clipKeys, libraryKeys, type PrivateStorage, type StorageBackend } from '@postgear/storage';
import {
  type AcceptedSound,
  countReasons,
  type RejectedItem,
  type SoundLicenceReport,
  soundReportMarkdown,
} from './report';
import { guardSoundCandidate } from './sound-licence';
import type { SoundStore } from './store';
import {
  AUTO_PUBLISH_SOUND_ORIGINS,
  isSoundCategory,
  LibraryError,
  type SoundAdapter,
  type SoundCategory,
  type SoundKind,
  soundKindOfCategory,
} from './types';

/** The most a source sound may weigh before it is even looked at. */
export const MAX_SOUND_SOURCE_BYTES = 12 * 1024 * 1024;

export interface SoundIngestDeps {
  store: SoundStore;
  storage: Pick<StorageBackend, 'put'>;
  privateStorage: Pick<PrivateStorage, 'put'>;
  runTool: RunTool;
  /** A folder the run may work in; its own subfolder is removed at the end. */
  scratchRoot: string;
  /** The shared brand list; the guard adds the sound-only words. */
  brands: readonly string[];
  now?: () => Date;
  log?: (line: string) => void;
}

export interface SoundIngestOptions {
  limit?: number;
  category?: SoundCategory;
  kind?: SoundKind;
  dryRun?: boolean;
  autoPublish?: boolean;
  /** What the operator typed, kept on the run row. */
  args?: Record<string, unknown>;
}

export interface SoundIngestResult {
  runId: string;
  report: SoundLicenceReport;
  markdown: string;
  reportKey: string | null;
}

const LENGTH_REASON = { sound_too_short: 'too_short', sound_too_long: 'too_long' } as const;

export async function ingestSounds(
  adapter: SoundAdapter,
  deps: SoundIngestDeps,
  options: SoundIngestOptions = {},
): Promise<SoundIngestResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const dryRun = options.dryRun ?? false;
  const autoPublish = options.autoPublish ?? false;
  if (autoPublish && !(AUTO_PUBLISH_SOUND_ORIGINS as readonly string[]).includes(adapter.origin)) {
    throw new LibraryError(
      `${adapter.origin} may not use --auto-publish: its sounds wait for a review.`,
    );
  }

  const startedAt = now();
  const candidates = await adapter.candidates();
  const sourceId = dryRun ? 'dry-run' : await deps.store.upsertSource(adapter.source);
  const runId = dryRun
    ? randomUUID()
    : await deps.store.createRun(adapter.origin, { kind: 'sound', ...(options.args ?? {}) });
  const scratch = mkdtempSync(path.join(deps.scratchRoot, 'library-sounds-'));

  const accepted: AcceptedSound[] = [];
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

      const guard = guardSoundCandidate(candidate, { brands: deps.brands });
      if (guard.ok && options.category && guard.category !== options.category) continue;
      if (guard.ok && options.kind && guard.kind !== options.kind) continue;
      considered += 1;
      if (!guard.ok) {
        reject(guard.reason, guard.detail);
        continue;
      }
      if (await deps.store.isDenied(adapter.origin, candidate.originId, null)) {
        reject('denied', 'removed before, it cannot come back');
        continue;
      }
      if (await deps.store.hasSoundOrigin(adapter.origin, candidate.originId)) {
        reject('duplicate', 'already in the library');
        continue;
      }

      let bytes: Buffer;
      try {
        bytes = await adapter.read(candidate, MAX_SOUND_SOURCE_BYTES);
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
      if (seen.has(checksum) || (await deps.store.hasSoundChecksum(checksum))) {
        reject('duplicate', 'the same file is already in the library');
        continue;
      }
      seen.add(checksum);
      const type = sniffSoundType(bytes.subarray(0, 16));
      if (!type) {
        reject('not_a_sound', 'not an MP3, WAV, M4A, AAC, OGG or FLAC');
        continue;
      }

      const base = `sound-${considered}`;
      const input = `${base}.in.${type}`;
      writeFileSync(path.join(scratch, input), bytes);
      let category = guard.category;
      let kind = guard.kind;
      const normalise = () =>
        normaliseSound({
          runTool: deps.runTool,
          cwd: scratch,
          input,
          output: `${base}.m4a`,
          kind,
          category,
        });
      let made: NormalisedSound | null = null;
      try {
        try {
          made = await normalise();
        } catch (error) {
          // Kenney's jingles: too short for music, kept as an effect.
          const fallback = candidate.shortCategory;
          if (
            error instanceof SoundError &&
            error.code === 'sound_too_short' &&
            kind === 'music' &&
            isSoundCategory(fallback) &&
            soundKindOfCategory(fallback) === 'sfx' &&
            (!options.kind || options.kind === 'sfx') &&
            (!options.category || options.category === fallback)
          ) {
            category = fallback;
            kind = 'sfx';
            made = await normalise();
          } else {
            throw error;
          }
        }
      } catch (error) {
        if (error instanceof SoundError) {
          if (error.code === 'sound_too_short' || error.code === 'sound_too_long') {
            reject(LENGTH_REASON[error.code], error.code);
            continue;
          }
          if (error.code === 'sound_unusable') {
            reject('unusable', 'it does not decode as a sound');
            continue;
          }
        }
        throw error;
      }
      if (!made) continue;

      const file = readFileSync(path.join(scratch, made.file));
      const hash = createHash('sha256').update(file).digest('hex');
      const fileKey = libraryKeys.sound(hash);
      const retrievedAt = now();
      let id: string | null = null;
      if (!dryRun) {
        await deps.storage.put(fileKey, file, 'audio/mp4');
        id = await deps.store.createSound({
          sourceId,
          runId,
          kind,
          name: candidate.name.trim(),
          tags: guard.tags,
          category,
          durationMs: made.durationMs,
          bpm: candidate.bpm ?? null,
          loudnessLufs: round1(made.loudnessLufs),
          truePeakDb: round1(made.truePeakDb),
          peaks: made.peaks,
          fileKey,
          bytes: made.bytes,
          licence: guard.licence,
          licenceUrl: candidate.licenceUrl ?? adapter.source.licenceUrl,
          author: candidate.creator,
          authorUrl: candidate.creatorUrl,
          origin: adapter.origin,
          originId: candidate.originId,
          sourceUrl: candidate.sourceUrl,
          originalWork: candidate.originalWork,
          retrievedAt,
          sourceChecksum: checksum,
          publish: autoPublish,
        });
        if (!id) {
          reject('duplicate', 'another run, or the same made file, is already in the library');
          continue;
        }
      }
      accepted.push({
        id,
        name: candidate.name.trim(),
        kind,
        category,
        licence: guard.licence,
        creator: candidate.creator,
        sourceUrl: candidate.sourceUrl,
        originId: candidate.originId,
        retrievedAt: retrievedAt.toISOString(),
        sourceChecksum: checksum,
        durationMs: made.durationMs,
        loudnessLufs: round1(made.loudnessLufs),
        truePeakDb: round1(made.truePeakDb),
        bytes: made.bytes,
        fileKey,
      });
      log(
        `  ${dryRun ? 'would add' : 'added'} ${candidate.originId} (${kind}, ${category}, ${(made.durationMs / 1000).toFixed(1)} s)`,
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const report: SoundLicenceReport = {
    kind: 'sound',
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
  const markdown = soundReportMarkdown(report);
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

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
