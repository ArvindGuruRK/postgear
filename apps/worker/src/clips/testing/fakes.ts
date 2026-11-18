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
  FinishImportArgs,
  FinishSegmentArgs,
  JobRow,
  VideoRow,
} from '../rows';

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
  clips = new Map<string, ClipRow & { organizationId: string }>([
    [CLIP_ID, { id: CLIP_ID, organizationId: ORG, title: 'Best Moment', videoId: VIDEO_ID }],
  ]);
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
    return this.usedBytes + this.assets.reduce((sum, asset) => sum + asset.bytes, 0);
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

  async closeJob(args: CloseJobArgs) {
    if (!this.closeIfOpen(args.jobId, args.status)) return false;
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

/** A downloader whose `fetchProxy` writes a small file, or throws `fail`. */
export function fakeDownloader(
  options: { fail?: Error } = {},
): Downloader & { proxyCalls: unknown[] } {
  const proxyCalls: unknown[] = [];
  return {
    simulated: true,
    proxyCalls,
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
    async fetchFormat() {
      throw new Error('not used');
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
