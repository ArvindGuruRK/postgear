/**
 * Uploads in parts against a fake private space that keeps uploads and
 * objects in memory: start, sign, complete, the binding to one workspace,
 * a second complete, and a file that turns out bigger than declared.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { HttpException } from '@nestjs/common';
import type { ClipAsset, ClipJob, ClipVideo } from '@postgear/db';
import { decrypt } from '@postgear/db';
import { createSimulatedDriveFiles, type DriveFiles } from '@postgear/media-tools/drive';
import { type PrivateStorage, StorageNotFoundError, type UploadedPart } from '@postgear/storage';
import type { ClipJobsRepository, NewClipJob } from '../jobs/clip-jobs.repository';
import type { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { jobRow, TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import type { ClipDrive } from './clip-drive';
import { ClipUploadsService, partPlan, titleFromFileName } from './clip-uploads.service';
import type { ClipVideosRepository } from './clip-videos.repository';
import type { ClipVideosService } from './clip-videos.service';

const OTHER_ORG = 'other-org';
const MIB = 1024 * 1024;

const store: { videos: ClipVideo[]; assets: ClipAsset[]; jobs: ClipJob[] } = {
  videos: [],
  assets: [],
  jobs: [],
};

const tx = {
  clipVideo: {
    create: jest.fn(async ({ data }: { data: Partial<ClipVideo> }) => {
      const row = videoRow({ ...data, externalId: null, canonicalUrl: null, durationMs: null });
      store.videos.push(row);
      return row;
    }),
  },
  clipAsset: {
    create: jest.fn(async ({ data }: { data: Partial<ClipAsset> }) => {
      const row = {
        id: `asset-${store.assets.length + 1}`,
        clipId: null,
        createdAt: new Date(),
        ...data,
      } as ClipAsset;
      store.assets.push(row);
      return row;
    }),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; organizationId: string };
        data: Partial<ClipAsset>;
      }) => {
        const row = store.assets.find(
          (asset) =>
            asset.id === where.id &&
            asset.organizationId === where.organizationId &&
            (asset.meta as { state?: string }).state === 'uploading',
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    ),
  },
};
jest.mock('../clips.tx', () => ({
  serializable: (work: (client: unknown) => Promise<unknown>) => work(tx),
}));

/** Uploads and objects in memory, the S3 multipart shape. */
class FakePrivateStorage {
  readonly kind = 'local' as const;
  uploads = new Map<string, { key: string; parts: Set<number> }>();
  objects = new Map<string, number>();
  realBytes = 0;

  async createUpload(key: string) {
    const uploadId = `upload-${this.uploads.size + 1}`;
    this.uploads.set(uploadId, { key, parts: new Set() });
    return { uploadId };
  }
  async signPart(key: string, uploadId: string, partNumber: number) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.key !== key) throw new StorageNotFoundError();
    return `https://storage.example/${uploadId}/${partNumber}`;
  }
  async completeUpload(key: string, uploadId: string, parts: UploadedPart[]) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.key !== key) throw new StorageNotFoundError();
    this.uploads.delete(uploadId);
    this.objects.set(key, this.realBytes);
    return { key, bytes: this.realBytes, parts: parts.length };
  }
  async abortUpload(_key: string, uploadId: string) {
    this.uploads.delete(uploadId);
  }
  async stat(key: string) {
    const bytes = this.objects.get(key);
    return bytes === undefined ? null : { key, bytes };
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
  async deletePrefix(prefix: string) {
    let removed = 0;
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

function build(drive: { files: DriveFiles | null } = { files: null }) {
  const storage = new FakePrivateStorage();
  const repository = {
    findUpload: jest.fn(async (orgId: string, uploadId: string) => {
      const asset = store.assets.find(
        (row) =>
          row.organizationId === orgId && (row.meta as { uploadId?: string }).uploadId === uploadId,
      );
      const video =
        asset && store.videos.find((row) => row.id === asset.videoId && row.deletedAt === null);
      return asset && video ? { asset, video } : null;
    }),
    findCard: jest.fn(async (_org: string, id: string) => {
      const video = store.videos.find((row) => row.id === id);
      return video
        ? { ...video, assets: [], jobs: store.jobs.filter((job) => job.videoId === id) }
        : null;
    }),
  };
  const videos = {
    cardView: jest.fn(async (row: ClipVideo & { jobs: ClipJob[] }) => ({
      video: { id: row.id, status: row.status },
      job: row.jobs[0] ? { id: row.jobs[0].id } : null,
    })),
  };
  let jobCount = 0;
  const jobs = {
    newJobId: jest.fn(() => `44444444-4444-4444-8444-${String(++jobCount).padStart(12, '0')}`),
    build: jest.fn(
      async (params: { id: string; orgId: string; videoId: string; input: unknown }) => ({
        id: params.id,
        organizationId: params.orgId,
        kind: 'IMPORT',
        priority: 'normal',
        input: params.input,
        videoId: params.videoId,
        clipId: null,
        highlightRunId: null,
        createdById: TEST_USER,
        expiresAt: null,
      }),
    ),
    start: jest.fn(async () => true),
  };
  const jobsRepository = {
    create: jest.fn(async (job: NewClipJob) => {
      const row = jobRow({ ...(job as unknown as Partial<ClipJob>) });
      store.jobs.push(row);
      return row;
    }),
    removeCancelledVideo: jest.fn(async (_org: string, videoId: string) => {
      const video = store.videos.find((row) => row.id === videoId);
      if (video) video.deletedAt = new Date();
      store.assets = store.assets.filter((asset) => asset.videoId !== videoId);
      return true;
    }),
  };
  const limits = {
    checkUploadStart: jest.fn(async () => undefined),
    assertEnabled: jest.fn(async () => undefined),
    assertUploadSize: jest.fn(async () => undefined),
    assertStorage: jest.fn(async () => undefined),
    importLimits: jest.fn(async () => ({
      maxVideoMs: 3_600_000,
      storageBytes: 5e9,
      retentionDays: 14,
    })),
  };
  const service = new ClipUploadsService(
    repository as unknown as ClipVideosRepository,
    videos as unknown as ClipVideosService,
    jobs as unknown as ClipJobsService,
    jobsRepository as unknown as ClipJobsRepository,
    limits as unknown as ClipLimitsGuard,
    storage as unknown as PrivateStorage,
    drive as unknown as ClipDrive,
  );
  return { service, storage, jobs, limits };
}

const FILE = { name: 'Team Talk.final.mp4', bytes: 40 * MIB, mimeType: 'video/mp4' };

beforeEach(() => {
  store.videos = [];
  store.assets = [];
  store.jobs = [];
  jest.clearAllMocks();
});

describe('ClipUploadsService', () => {
  it('runs start, parts and complete into one import job, never naming a key', async () => {
    const { service, storage, jobs } = build();
    const started = await service.start(TEST_ORG, TEST_USER, FILE);

    expect(started).toEqual({
      videoId: expect.any(String),
      uploadId: 'upload-1',
      partSize: 16 * MIB,
      partCount: 3,
    });
    expect(JSON.stringify(started)).not.toContain('clips/');
    expect(store.videos[0]).toEqual(
      expect.objectContaining({
        platform: 'UPLOAD',
        title: 'Team Talk.final',
        rightsTextVersion: 1,
      }),
    );

    const signed = await service.signParts(TEST_ORG, started.uploadId, { partNumbers: [1, 2, 3] });
    expect(signed.parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);

    storage.realBytes = FILE.bytes;
    const parts = [1, 2, 3].map((partNumber) => ({ partNumber, etag: `"e${partNumber}"` }));
    const done = await service.complete(TEST_ORG, TEST_USER, started.uploadId, { parts });

    expect(done.video.id).toBe(started.videoId);
    expect(store.jobs).toHaveLength(1);
    expect(store.jobs[0]?.input).toEqual(
      expect.objectContaining({
        origin: expect.objectContaining({ type: 'upload' }),
        expectedBytes: FILE.bytes,
      }),
    );
    expect(jobs.start).toHaveBeenCalledTimes(1);
  });

  it('answers the same video and job for a second complete, starting nothing more', async () => {
    const { service, storage, jobs } = build();
    const started = await service.start(TEST_ORG, TEST_USER, FILE);
    storage.realBytes = FILE.bytes;
    const parts = [{ partNumber: 1, etag: '"e1"' }];
    const first = await service.complete(TEST_ORG, TEST_USER, started.uploadId, { parts });
    const second = await service.complete(TEST_ORG, TEST_USER, started.uploadId, { parts });

    expect(second).toEqual(first);
    expect(store.jobs).toHaveLength(1);
    expect(jobs.start).toHaveBeenCalledTimes(1);
  });

  it('never lets another workspace sign or complete the upload', async () => {
    const { service } = build();
    const started = await service.start(TEST_ORG, TEST_USER, FILE);

    await expect(
      service.signParts(OTHER_ORG, started.uploadId, { partNumbers: [1] }),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.complete(OTHER_ORG, TEST_USER, started.uploadId, {
        parts: [{ partNumber: 1, etag: '"e"' }],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a part number past the plan of parts', async () => {
    const { service } = build();
    const started = await service.start(TEST_ORG, TEST_USER, FILE);
    await expect(
      service.signParts(TEST_ORG, started.uploadId, { partNumbers: [4] }),
    ).rejects.toMatchObject({
      status: 422,
    });
  });

  it('refuses a file that is not a video before anything is stored', async () => {
    const { service, storage } = build();
    const error = await service
      .start(TEST_ORG, TEST_USER, { ...FILE, mimeType: 'application/pdf' })
      .catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(422);
    expect(storage.uploads.size).toBe(0);
  });

  it('removes the file and its video when the real size is over the plan', async () => {
    const { service, storage, limits } = build();
    const started = await service.start(TEST_ORG, TEST_USER, FILE);
    storage.realBytes = 3_000 * MIB;
    limits.assertUploadSize.mockRejectedValueOnce(
      new HttpException({ code: 'clips_upload_too_big' }, 402),
    );

    await expect(
      service.complete(TEST_ORG, TEST_USER, started.uploadId, {
        parts: [{ partNumber: 1, etag: '"e1"' }],
      }),
    ).rejects.toMatchObject({ status: 402 });
    expect(storage.objects.size).toBe(0);
    expect(store.videos[0]?.deletedAt).not.toBeNull();
    expect(store.jobs).toHaveLength(0);
  });
});

describe('a file picked in Google Drive (Module 12)', () => {
  const TOKEN = 'ya29.simulated-picker-token';
  let samples: string;
  const previousKey = process.env.ENCRYPTION_KEY_AES256;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY_AES256 = 'd'.repeat(64);
    samples = await mkdtemp(path.join(tmpdir(), 'drive-spec-'));
    await writeFile(path.join(samples, 'talk.mp4'), Buffer.alloc(3_000, 1));
  });
  afterAll(async () => {
    process.env.ENCRYPTION_KEY_AES256 = previousKey;
    await rm(samples, { recursive: true, force: true });
  });

  const withDrive = () => build({ files: createSimulatedDriveFiles({ samplesDir: samples }) });

  it('makes the video, the ORIGINAL row and the job, with the token sealed in the input', async () => {
    const { service, jobs, limits } = withDrive();
    const answer = await service.startFromDrive(TEST_ORG, TEST_USER, {
      fileId: 'sim-drive-talk-0001',
      accessToken: TOKEN,
    });

    expect(answer.video).toMatchObject({ status: 'IMPORTING' });
    expect(limits.checkUploadStart).toHaveBeenCalledWith(TEST_ORG, 3_000);
    expect(store.videos[0]).toMatchObject({
      platform: 'UPLOAD',
      kind: 'UPLOAD',
      title: 'PostGear Sample Talk From Drive',
    });
    expect(store.assets[0]).toMatchObject({ kind: 'ORIGINAL', bytes: 0n });
    const input = store.jobs[0]?.input as {
      origin: { type: string; drive: { fileId: string; token: string } };
      expectedBytes: number;
    };
    expect(input.origin.type).toBe('upload');
    expect(input.origin.drive.fileId).toBe('sim-drive-talk-0001');
    expect(input.origin.drive.token).not.toContain(TOKEN);
    expect(decrypt(input.origin.drive.token)).toBe(TOKEN);
    expect(input.expectedBytes).toBe(3_000);
    expect(jobs.start).toHaveBeenCalledTimes(1);
  });

  it('answers each Drive refusal with its code and makes nothing', async () => {
    const { service } = withDrive();
    const codeOf = (fileId: string) =>
      service
        .startFromDrive(TEST_ORG, TEST_USER, { fileId, accessToken: TOKEN })
        .catch((error: HttpException) => [
          error.getStatus(),
          (error.getResponse() as { code: string }).code,
        ]);
    expect(await codeOf('sim-drive-denied-0001')).toEqual([422, 'drive_not_connected']);
    expect(await codeOf('sim-drive-document-01')).toEqual([422, 'upload_not_video']);
    expect(await codeOf('someone-elses-file-01')).toEqual([404, 'link_not_found']);
    expect(store.videos).toHaveLength(0);
    expect(store.jobs).toHaveLength(0);
  });

  it('is a plain 404 when Drive is not offered', async () => {
    const { service } = build();
    await expect(
      service.startFromDrive(TEST_ORG, TEST_USER, {
        fileId: 'sim-drive-talk-0001',
        accessToken: TOKEN,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('upload helpers', () => {
  it('plans parts of 16 MiB, growing so a file never needs more than 10,000', () => {
    expect(partPlan(1)).toEqual({ partSize: 16 * MIB, partCount: 1 });
    const huge = partPlan(500 * 1024 * MIB);
    expect(huge.partCount).toBeLessThanOrEqual(10_000);
  });

  it('names the video after the file, without its last extension', () => {
    expect(titleFromFileName('Team Talk.final.mp4')).toBe('Team Talk.final');
  });
});
