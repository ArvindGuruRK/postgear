/**
 * Security sweep, Sprint 13 Module 16: a Google Drive import's access token
 * on the API.
 *
 * What must hold, beyond `clip-uploads.service.spec.ts` ("makes the video,
 * the ORIGINAL row and the job, with the token sealed in the input",
 * "answers each Drive refusal with its code and makes nothing"):
 * - the token is never logged (a logger spy over a working import and every
 *   refusal) and never in an answer: not in the card, not in any job view,
 *   whatever state the job is in;
 * - only the picked file is read: a file id that is a path, a query or
 *   another file's address is refused by the body schema, and the Drive
 *   facts call is asked about the picked id only;
 * - the stored input holds the token sealed, never as text.
 *
 * The worker wipes it after the fetch, on failure and on cancel
 * (`apps/worker/src/clips/import/drive.security.test.ts`).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import type { ClipJob } from '@postgear/db';
import { createSimulatedDriveFiles, type DriveFiles } from '@postgear/media-tools/drive';
import type { PrivateStorage } from '@postgear/storage';
import { toJobView } from '../jobs/clip-job-view';
import type { ClipJobsRepository, NewClipJob } from '../jobs/clip-jobs.repository';
import type { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { jobRow, TEST_ORG, TEST_USER } from '../testing/rows';
import type { ClipDrive } from './clip-drive';
import { ClipUploadsService } from './clip-uploads.service';
import { driveImportSchema } from './clip-videos.schema';
import type { ClipVideosRepository } from './clip-videos.repository';
import type { ClipVideosService } from './clip-videos.service';

const TOKEN = 'ya29.a-real-looking-picker-token';

const tx = {
  clipVideo: { create: jest.fn(async ({ data }: { data: unknown }) => data) },
  clipAsset: { create: jest.fn(async ({ data }: { data: unknown }) => data) },
};
jest.mock('../clips.tx', () => ({
  serializable: (work: (client: unknown) => Promise<unknown>) => work(tx),
}));

let samples: string;
const previousKey = process.env.ENCRYPTION_KEY_AES256;
beforeAll(async () => {
  process.env.ENCRYPTION_KEY_AES256 = 'e'.repeat(64);
  samples = await mkdtemp(path.join(tmpdir(), 'drive-security-'));
  await writeFile(path.join(samples, 'talk.mp4'), Buffer.alloc(3_000, 1));
});
afterAll(async () => {
  process.env.ENCRYPTION_KEY_AES256 = previousKey;
  await rm(samples, { recursive: true, force: true });
});

let lines: string[];
let spies: jest.SpyInstance[];
beforeEach(() => {
  lines = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  spies = [
    ...(['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(capture),
    ),
    ...(['log', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(capture),
    ),
  ];
});
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

function build() {
  const real = createSimulatedDriveFiles({ samplesDir: samples });
  const asked: string[] = [];
  const files: DriveFiles = {
    ...real,
    facts: async (fileId, token, signal) => {
      asked.push(fileId);
      return real.facts(fileId, token, signal);
    },
  };
  const created: ClipJob[] = [];
  const service = new ClipUploadsService(
    {
      findCard: jest.fn(async () => ({ id: 'video', jobs: created })),
    } as unknown as ClipVideosRepository,
    {
      cardView: jest.fn(async (row: { jobs: ClipJob[] }) => ({
        video: { id: 'video', status: 'IMPORTING' },
        job: row.jobs[0] ? toJobView(row.jobs[0]) : null,
      })),
    } as unknown as ClipVideosService,
    {
      newJobId: () => '44444444-4444-4444-8444-000000000001',
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
    } as unknown as ClipJobsService,
    {
      create: jest.fn(async (job: NewClipJob) => {
        const row = jobRow({ ...(job as unknown as Partial<ClipJob>) });
        created.push(row);
        return row;
      }),
    } as unknown as ClipJobsRepository,
    {
      checkUploadStart: jest.fn(async () => undefined),
      importLimits: jest.fn(async () => ({
        maxVideoMs: 3_600_000,
        storageBytes: 5e9,
        retentionDays: 14,
      })),
    } as unknown as ClipLimitsGuard,
    {} as unknown as PrivateStorage,
    { files } as unknown as ClipDrive,
  );
  return { service, asked, created };
}

describe('a Drive import on the API', () => {
  it('asks Drive about the picked file only, stores the token sealed, and never answers or logs it', async () => {
    const { service, asked, created } = build();
    const answer = await service.startFromDrive(TEST_ORG, TEST_USER, {
      fileId: 'sim-drive-talk-0001',
      accessToken: TOKEN,
    });
    expect(asked).toEqual(['sim-drive-talk-0001']);
    expect(JSON.stringify(answer)).not.toContain(TOKEN);
    const stored = JSON.stringify(created[0]?.input);
    expect(stored).not.toContain(TOKEN);
    expect(stored).toContain('"drive"');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it.each(['sim-drive-denied-0001', 'sim-drive-document-01', 'someone-elses-file-01'])(
    'never logs or answers the token when Drive refuses %s',
    async (fileId) => {
      const { service } = build();
      const error = await service
        .startFromDrive(TEST_ORG, TEST_USER, { fileId, accessToken: TOKEN })
        .catch((caught: unknown) => caught);
      expect(
        JSON.stringify((error as { getResponse?: () => unknown }).getResponse?.()),
      ).not.toContain(TOKEN);
      expect(String((error as Error).message)).not.toContain(TOKEN);
      expect(lines.join('\n')).not.toContain(TOKEN);
    },
  );

  it.each(['QUEUED', 'RUNNING', 'FAILED', 'CANCELLED', 'DONE'] as const)(
    'shows no input in a job view, %s',
    (status) => {
      const view = toJobView(
        jobRow({
          kind: 'IMPORT',
          status,
          input: {
            origin: {
              type: 'upload',
              originalKey: 'k',
              drive: { fileId: 'f', token: `sealed-${TOKEN}` },
            },
          },
          error: status === 'FAILED' ? { code: 'drive_not_connected', message: 'x' } : null,
        }),
      );
      const text = JSON.stringify(view);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain('"drive"');
      expect(view).not.toHaveProperty('input');
    },
  );
});

describe('the Drive body', () => {
  const good = { fileId: 'sim-drive-talk-0001', accessToken: TOKEN };

  it('takes the picked file id and the token', () => {
    expect(driveImportSchema.safeParse(good).success).toBe(true);
  });

  it.each([
    ['a path', '../files/someone-else'],
    ['a sub-resource', 'sim-drive-talk-0001/permissions'],
    ['a query', 'sim-drive-talk-0001?alt=media&fields=*'],
    ['a fragment', 'sim-drive-talk-0001#x'],
    ['an encoded slash', 'sim-drive-talk%2F0001'],
    ['a whole address', 'https://www.googleapis.com/drive/v3/files/abc'],
    ['a new line', 'sim-drive-talk-0001\nx'],
    ['nothing much', 'short'],
  ])('refuses a file id that is %s', (_name, fileId) => {
    expect(driveImportSchema.safeParse({ ...good, fileId }).success).toBe(false);
  });

  it('refuses a field it does not know', () => {
    expect(driveImportSchema.safeParse({ ...good, organizationId: 'other-org' }).success).toBe(
      false,
    );
    expect(driveImportSchema.safeParse({ ...good, url: 'https://evil.example' }).success).toBe(
      false,
    );
  });
});
