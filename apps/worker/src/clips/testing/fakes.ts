/**
 * In-memory stand-ins for the clip activities' outside world, for specs only:
 * the rows, the private and public storage, the downloader and the import
 * tools. Each keeps the same conditional rules as the real binding (a job
 * closes only while open, a missing object deletes fine) so the specs test
 * behaviour, not mocks.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Downloader, MediaFacts } from '@postgear/media-tools';
import { type PrivateStorage, StorageNotFoundError } from '@postgear/storage';
import type { ImportTools } from '../import/import.tools';
import type { ClipNotificationRow } from '../notifications';
import type {
  AssetRow,
  ClipRow,
  ClipRows,
  CloseJobArgs,
  FinishHighlightsArgs,
  FinishDownloadArgs,
  FinishHighlightsResult,
  FinishImportArgs,
  FinishSegmentArgs,
  FinishTranscribeArgs,
  FinishTranscribeResult,
  HighlightRunRow,
  JobRow,
  NewAsset,
  NewHighlightClip,
  VideoLinkRow,
  VideoRow,
} from '../rows';
import { storedRange, withoutKept } from '../highlights/kept';

/** A clip as the fake keeps it (Module 16 reads origin, status and the replace rule). */
export interface FakeClip extends ClipRow {
  organizationId: string;
  origin?: 'MANUAL' | 'AI_SIGNALS';
  status?: 'NEW' | 'DRAFT' | 'HIDDEN';
  exported?: boolean;
  sent?: boolean;
  score?: number | null;
  reasons?: string[];
  highlightRunId?: string | null;
  document?: unknown;
  createdAt?: Date;
}

export const ORG = 'seed-demo-org';
export const JOB_ID = '11111111-2222-4333-8444-555555555555';
export const VIDEO_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const CLIP_ID = '99999999-8888-4777-8666-555555555555';

export function videoRow(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    id: VIDEO_ID,
    organizationId: ORG,
    title: 'Sample Talk',
    durationMs: 180_000,
    fps: 30,
    hasAudio: true,
    status: 'IMPORTING',
    deletedAt: null,
    ...overrides,
  };
}

export function jobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: JOB_ID,
    organizationId: ORG,
    kind: 'IMPORT',
    status: 'RUNNING',
    input: {},
    videoId: VIDEO_ID,
    clipId: null,
    createdAt: new Date('2026-11-18T10:00:00Z'),
    ...overrides,
  };
}

export class FakeRows implements ClipRows {
  jobs = new Map<string, JobRow>();
  videos = new Map<string, VideoRow & { error?: unknown; hdAvailable?: boolean }>();
  assets: AssetRow[] = [];
  notifications: ClipNotificationRow[] = [];
  facts: unknown[] = [];
  usedBytes = 0;
  openSegments = 0;
  mediaKeys = new Set<string>();
  private nextId = 1;

  async job(organizationId: string, jobId: string) {
    const job = this.jobs.get(jobId);
    return job && job.organizationId === organizationId ? { ...job } : null;
  }
  async video(organizationId: string, videoId: string) {
    const video = this.videos.get(videoId);
    return video && video.organizationId === organizationId ? { ...video } : null;
  }
  /** One clip of the sample video unless a spec removes it. */
  clips = new Map<string, FakeClip>([
    [CLIP_ID, { id: CLIP_ID, organizationId: ORG, title: 'Best Moment', videoId: VIDEO_ID }],
  ]);
  /** Module 16: highlight runs, and where each video came from. */
  runs = new Map<string, HighlightRunRow & { found?: number; tracks?: string[] }>();
  links = new Map<string, VideoLinkRow>();
  async clip(organizationId: string, clipId: string) {
    const clip = this.clips.get(clipId);
    return clip && clip.organizationId === organizationId
      ? { id: clip.id, title: clip.title, videoId: clip.videoId }
      : null;
  }
  async writeVideoFacts(_org: string, videoId: string, facts: unknown) {
    this.facts.push({ videoId, ...(facts as object) });
  }
  async videoAssets(_org: string, videoId: string) {
    return this.assets.filter((asset) => asset.videoId === videoId);
  }
  async segmentAssets(_org: string, clipId: string) {
    return this.assets.filter((asset) => asset.clipId === clipId && asset.kind === 'SEGMENT');
  }
  async deleteAssets(_org: string, ids: string[]) {
    this.assets = this.assets.filter((asset) => !ids.includes(asset.id));
  }
  async storageUsedBytes() {
    return (
      this.usedBytes +
      this.assets
        .filter((asset) => asset.kind !== 'PROOF')
        .reduce((sum, asset) => sum + asset.bytes, 0)
    );
  }
  async openClipJobs() {
    return this.openSegments;
  }
  async mediaUsesKey(_org: string, key: string) {
    return this.mediaKeys.has(key);
  }

  private closeIfOpen(jobId: string, status: JobRow['status']): boolean {
    const job = this.jobs.get(jobId);
    if (!job || (job.status !== 'QUEUED' && job.status !== 'RUNNING')) return false;
    job.status = status;
    return true;
  }

  async finishImport(args: FinishImportArgs) {
    const video = this.videos.get(args.videoId);
    if (!video || video.deletedAt) return false;
    if (!this.closeIfOpen(args.jobId, 'DONE')) return false;
    video.status = 'READY';
    for (const asset of args.assets) {
      this.assets.push({
        id: asset.id ?? `asset-${this.nextId++}`,
        kind: asset.kind,
        key: asset.key,
        bytes: asset.bytes,
        videoId: asset.videoId,
        clipId: asset.clipId ?? null,
        meta: asset.meta,
        createdAt: args.now,
      });
    }
    this.notifications.push(args.notification);
    return true;
  }

  async finishSegment(args: FinishSegmentArgs) {
    if (!this.closeIfOpen(args.jobId, 'DONE')) return false;
    if (args.asset) {
      this.assets.push({
        id: args.asset.id ?? `asset-${this.nextId++}`,
        kind: args.asset.kind,
        key: args.asset.key,
        bytes: args.asset.bytes,
        videoId: args.asset.videoId,
        clipId: args.asset.clipId ?? null,
        meta: args.asset.meta,
        createdAt: args.now,
      });
    } else {
      const video = this.videos.get(args.videoId);
      if (video) video.hdAvailable = false;
    }
    return true;
  }

  /** Every close that landed, for specs that read the stored error. */
  closed: CloseJobArgs[] = [];

  async closeJob(args: CloseJobArgs) {
    if (!this.closeIfOpen(args.jobId, args.status)) return false;
    this.closed.push(args);
    const run = args.highlightRunId ? this.runs.get(args.highlightRunId) : undefined;
    if (run && (run.status === 'QUEUED' || run.status === 'RUNNING')) run.status = args.status;
    const video = args.video ? this.videos.get(args.video.id) : undefined;
    if (video && args.video?.mark === 'failed' && video.status === 'IMPORTING') {
      video.status = 'FAILED';
      video.error = args.error;
    }
    if (video && args.video?.mark === 'removed') {
      video.status = 'REMOVED';
      video.deletedAt = args.now;
      this.assets = this.assets.filter((asset) => asset.videoId !== video.id);
    }
    if (args.notification) this.notifications.push(args.notification);
    return true;
  }

  async highlightRun(organizationId: string, runId: string) {
    const run = this.runs.get(runId);
    return run && run.organizationId === organizationId ? { ...run } : null;
  }

  async markRunRunning(_organizationId: string, runId: string) {
    const run = this.runs.get(runId);
    if (run && run.status === 'QUEUED') run.status = 'RUNNING';
  }

  async videoLink(organizationId: string, videoId: string) {
    const video = this.videos.get(videoId);
    if (!video || video.organizationId !== organizationId) return null;
    return (
      this.links.get(videoId) ?? {
        platform: 'upload' as const,
        kind: 'upload' as const,
        externalId: null,
        width: 1280,
        height: 720,
      }
    );
  }

  /** The real binding's rules: closed job writes nothing; only unopened AI clips are replaced. */
  async finishHighlights(args: FinishHighlightsArgs): Promise<FinishHighlightsResult> {
    if (!this.closeIfOpen(args.jobId, 'DONE'))
      return { finished: false, replacedKeys: [], replaced: 0, covered: 0 };
    const run = this.runs.get(args.runId);
    if (run) Object.assign(run, { status: 'DONE', found: args.clips.length, tracks: args.tracks });

    let replaced = 0;
    for (const [id, clip] of [...this.clips]) {
      const replaceable =
        clip.organizationId === args.organizationId &&
        clip.videoId === args.videoId &&
        clip.origin === 'AI_SIGNALS' &&
        clip.status === 'NEW' &&
        !clip.exported &&
        !clip.sent;
      if (replaceable) {
        this.clips.delete(id);
        replaced += 1;
      }
    }
    const kept = [...this.clips.values()]
      .filter(
        (clip) =>
          clip.organizationId === args.organizationId &&
          clip.videoId === args.videoId &&
          clip.origin === 'AI_SIGNALS',
      )
      .map((clip) => storedRange(clip.document));
    const fresh = withoutKept(args.clips, kept);
    fresh.forEach((clip: NewHighlightClip, index) => {
      this.clips.set(clip.id, {
        id: clip.id,
        organizationId: args.organizationId,
        videoId: args.videoId,
        title: clip.title,
        origin: 'AI_SIGNALS',
        status: 'NEW',
        score: clip.score,
        reasons: clip.reasons,
        highlightRunId: args.runId,
        document: clip.document,
        createdAt: new Date(args.now.getTime() - index),
      });
    });

    let replacedKeys: string[] = [];
    if (args.signals) {
      const signals = args.signals;
      const old = this.assets.filter(
        (asset) =>
          asset.videoId === args.videoId && asset.kind === 'SIGNALS' && asset.key !== signals.key,
      );
      this.assets = this.assets.filter((asset) => !old.includes(asset));
      this.assets.push({
        id: signals.id ?? `asset-${this.nextId++}`,
        kind: signals.kind,
        key: signals.key,
        bytes: signals.bytes,
        videoId: signals.videoId,
        clipId: null,
        meta: signals.meta,
        createdAt: args.now,
      });
      replacedKeys = old.map((asset) => asset.key);
    }
    return { finished: true, replacedKeys, replaced, covered: args.clips.length - fresh.length };
  }

  /** Module 18: the DONE downloads' outputs and expiry, by job id. */
  downloads = new Map<string, { output: unknown; expiresAt: Date | null }>();

  async finishDownload(args: FinishDownloadArgs) {
    if (!this.closeIfOpen(args.jobId, 'DONE')) return false;
    this.downloads.set(args.jobId, { output: args.output, expiresAt: args.expiresAt });
    this.assets.push({
      id: args.asset.id ?? `asset-${this.nextId++}`,
      kind: args.asset.kind,
      key: args.asset.key,
      bytes: args.asset.bytes,
      videoId: args.asset.videoId,
      clipId: args.asset.clipId ?? null,
      meta: args.asset.meta,
      createdAt: args.now,
    });
    return true;
  }

  /** Sprint 13, Module 03: the workspace's own caption styles. */
  captionStyles = new Map<
    string,
    { id: string; name: string; look: unknown; organizationId: string }
  >();

  async captionStyle(organizationId: string, styleId: string) {
    const style = this.captionStyles.get(styleId);
    return style && style.organizationId === organizationId
      ? { id: style.id, name: style.name, look: style.look }
      : null;
  }

  /** Sprint 13, Module 02: the DONE listening jobs' outputs, by job id. */
  transcribed = new Map<string, unknown>();

  async finishTranscribe(args: FinishTranscribeArgs): Promise<FinishTranscribeResult> {
    if (!this.closeIfOpen(args.jobId, 'DONE')) return { finished: false, replacedKeys: [] };
    this.transcribed.set(args.jobId, args.output);
    const gone = this.assets.filter(
      (row) =>
        row.kind === 'TRANSCRIPT' && (row.id === args.jobId || row.id === args.replaceAssetId),
    );
    this.assets = this.assets.filter((row) => !gone.includes(row));
    this.assets.push({
      id: args.asset.id ?? `asset-${this.nextId++}`,
      kind: args.asset.kind,
      key: args.asset.key,
      bytes: args.asset.bytes,
      videoId: args.asset.videoId,
      clipId: args.asset.clipId ?? null,
      meta: args.asset.meta,
      createdAt: args.now,
    });
    return {
      finished: true,
      replacedKeys: gone.map((row) => row.key).filter((key) => key !== args.asset.key),
    };
  }

  async downloadRow(organizationId: string, jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || job.organizationId !== organizationId || job.kind !== 'DOWNLOAD') return null;
    return {
      id: job.id,
      organizationId: job.organizationId,
      status: job.status,
      output: this.downloads.get(jobId)?.output ?? null,
      createdAt: job.createdAt,
    };
  }

  async markSaveFailed(_organizationId: string, jobId: string) {
    const entry = this.downloads.get(jobId);
    const output = entry?.output as { media?: { status: string } } | undefined;
    if (!entry || output?.media?.status !== 'saving') return;
    entry.output = { ...output, media: { status: 'failed', mediaId: null } };
  }

  async recordProof(_organizationId: string, asset: NewAsset) {
    const row: AssetRow = {
      id: asset.id ?? `asset-${this.nextId++}`,
      kind: asset.kind,
      key: asset.key,
      bytes: asset.bytes,
      videoId: asset.videoId,
      clipId: asset.clipId ?? null,
      meta: asset.meta,
      createdAt: new Date(),
    };
    const at = this.assets.findIndex((existing) => existing.key === asset.key);
    if (at >= 0) this.assets[at] = { ...row, id: (this.assets[at] as AssetRow).id };
    else this.assets.push(row);
  }
}

/** The private space in memory. `failPutAt` makes the Nth `putFile` (1-based) throw. */
export class FakePrivateStorage
  implements Pick<PrivateStorage, 'putFile' | 'getToFile' | 'delete' | 'deletePrefix'>
{
  objects = new Map<string, Buffer>();
  deleted: string[] = [];
  puts = 0;
  failPutAt: number | null = null;
  onPut: ((key: string) => void) | null = null;

  async putFile(key: string, filePath: string) {
    this.puts += 1;
    if (this.failPutAt === this.puts) throw new Error('storage unavailable');
    const body = await readFile(filePath);
    this.objects.set(key, body);
    this.onPut?.(key);
    return { key, bytes: body.length };
  }
  async getToFile(key: string, filePath: string) {
    const body = this.objects.get(key);
    if (!body) throw new StorageNotFoundError();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
  }
  async delete(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }
  async deletePrefix(prefix: string) {
    let count = 0;
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
        count += 1;
      }
    }
    this.deleted.push(prefix);
    return count;
  }
}

export function sampleFacts(overrides: Partial<MediaFacts> = {}): MediaFacts {
  return {
    durationMs: 180_000,
    width: 1920,
    height: 1080,
    fps: 30,
    constantFrameRate: true,
    rotation: 0,
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    hasAudio: true,
    audioCodec: 'aac',
    sampleRate: 48_000,
    audioChannels: 2,
    bitRate: 2_000_000,
    container: 'mp4',
    ...overrides,
  };
}

/** Import tools that write small files instead of running FFmpeg. */
export function fakeImportTools(options: { facts?: MediaFacts; probeError?: Error } = {}) {
  const calls: string[] = [];
  const tools: ImportTools = {
    async probe() {
      calls.push('probe');
      if (options.probeError) throw options.probeError;
      return options.facts ?? sampleFacts();
    },
    async normalise(opts) {
      calls.push('normalise');
      opts.onProgress?.(50);
      await writeFile(opts.output, Buffer.alloc(1_000, 1));
      opts.onProgress?.(100);
      return {
        mode: 'encode',
        file: opts.output,
        bytes: 1_000,
        meta: { width: 1280, height: 720, fps: 30 },
      };
    },
    async derive(opts) {
      calls.push('derive');
      const sheet = path.join(opts.outDir, 'filmstrip-000.jpg');
      await writeFile(sheet, Buffer.alloc(200, 2));
      let analysisAudio = null;
      if (opts.facts.hasAudio) {
        await writeFile(opts.analysisOut, Buffer.alloc(300, 3));
        analysisAudio = {
          file: opts.analysisOut,
          bytes: 300,
          meta: { sampleRate: 16_000, channels: 1 as const },
        };
      }
      return {
        analysisAudio,
        filmstrip: {
          files: [sheet],
          meta: {
            tileWidth: 160,
            tileHeight: 90,
            columns: 10,
            rows: 10,
            intervalMs: 2_000,
            count: 90,
            sheets: 1,
          },
        },
      };
    },
    async waveform(opts) {
      calls.push(opts.wavFile ? 'waveform' : 'empty-waveform');
      const bytes = opts.wavFile ? Uint8Array.from([1, 2, 3]) : new Uint8Array(0);
      await writeFile(opts.output, bytes);
      return {
        file: opts.output,
        bytes: bytes.length,
        meta: { perSecond: 20, count: bytes.length },
      };
    },
    async poster(opts) {
      calls.push('poster');
      await writeFile(opts.output, Buffer.alloc(100, 4));
      return { file: opts.output, bytes: 100, meta: { atMs: 18_000, width: 1280, height: 720 } };
    },
    async freeDisk() {
      calls.push('free-disk');
    },
  };
  return { tools, calls };
}

/** A downloader whose `fetchProxy` and `fetchFormat` write a small file, or throw `fail`. */
export function fakeDownloader(
  options: { fail?: Error; formatPercent?: number | null } = {},
): Downloader & { proxyCalls: unknown[]; formatCalls: unknown[] } {
  const proxyCalls: unknown[] = [];
  const formatCalls: unknown[] = [];
  return {
    simulated: true,
    proxyCalls,
    formatCalls,
    async probe() {
      throw new Error('not used');
    },
    async fetchProxy(input, onProgress) {
      proxyCalls.push(input);
      if (options.fail) throw options.fail;
      onProgress({ percent: 50 });
      await writeFile(input.outFile, Buffer.alloc(2_000, 9));
      onProgress({ percent: 100 });
      return { path: input.outFile, bytes: 2_000 };
    },
    async fetchRange() {
      throw new Error('not used');
    },
    async fetchFormat(input, onProgress) {
      formatCalls.push(input);
      if (options.fail) throw options.fail;
      onProgress({ percent: options.formatPercent === undefined ? 50 : options.formatPercent });
      await writeFile(input.outFile, Buffer.alloc(3_000, 7));
      return { path: input.outFile, bytes: 3_000 };
    },
  };
}

/** Collects every progress report in order. */
export function fakeProgress() {
  const reports: Array<{ stage: string; progress: number }> = [];
  return {
    reports,
    progress: {
      async report(update: { stage: string; progress: number }) {
        reports.push({ stage: update.stage, progress: Math.round(update.progress) });
      },
      async flush() {},
    },
  };
}
