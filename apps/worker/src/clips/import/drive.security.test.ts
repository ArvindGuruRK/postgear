/**
 * Security sweep, Sprint 13 Module 16: a Google Drive import's access token on
 * the worker.
 *
 * What must hold:
 * - the token is never written to a log, on success or on failure (a
 *   console spy over the whole import, with Drive failing on purpose);
 * - it does not outlive its job: wiped after the fetch (existing test,
 *   `import.steps.test.ts` "fetches the file once, stores it as the
 *   ORIGINAL, wipes the token, then runs as an upload"), and also when the
 *   job fails or is cancelled before the fetch finished;
 * - only the picked file is read: the fetch asks for that file id only.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  createDriveFiles,
  createSimulatedDriveFiles,
  DriveError,
  type DriveFiles,
} from '@postgear/media-tools';
import type { PrivateStorage } from '@postgear/storage';
import type { ImportInput } from '@postgear/video-engine';
import { clipFailure } from '../failures';
import { cancelJob, failJob, type OutcomeDeps } from '../job-outcomes';
import {
  FakePrivateStorage,
  FakeRows,
  fakeDownloader,
  fakeImportTools,
  fakeProgress,
  JOB_ID,
  jobRow,
  ORG,
  VIDEO_ID,
  videoRow,
} from '../testing/fakes';
import { type ImportRun, runImport } from './import.steps';

jest.mock('@postgear/db', () => ({ ...jest.requireActual('@postgear/db'), prisma: {} }));

const TOKEN = 'ya29.a-real-looking-drive-token-value';
const SEALED = `sealed:${TOKEN}`;
const FILE_ID = 'sim-drive-talk-0001';
const ORIGINAL_KEY = `clips/${ORG}/${VIDEO_ID}/original-0123456789abcdef0123456789abcdef.mp4`;

const driveInput: ImportInput = {
  videoId: VIDEO_ID,
  origin: {
    type: 'upload',
    originalKey: ORIGINAL_KEY,
    drive: { fileId: FILE_ID, token: SEALED },
  },
  limits: { maxVideoMs: 4 * 60 * 60_000, storageBytes: 10_000_000, retentionDays: 30 },
  expectedBytes: 4_000,
};

let dir: string;
let lines: string[];
let spies: jest.SpyInstance[];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'clip-drive-security-'));
  lines = [];
  spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
    jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(
        args
          .map((arg) =>
            arg instanceof Error
              ? `${arg.message} ${arg.stack}`
              : typeof arg === 'string'
                ? arg
                : JSON.stringify(arg),
          )
          .join(' '),
      );
    }),
  );
});

afterEach(async () => {
  for (const spy of spies) spy.mockRestore();
  await rm(dir, { recursive: true, force: true });
});

function importRun(drive: DriveFiles) {
  const rows = new FakeRows();
  rows.jobs.set(JOB_ID, jobRow({ input: driveInput }));
  rows.videos.set(VIDEO_ID, videoRow());
  const { tools } = fakeImportTools({});
  const { progress } = fakeProgress();
  const run: ImportRun = {
    jobId: JOB_ID,
    organizationId: ORG,
    input: driveInput,
    video: videoRow(),
    dir,
    signal: new AbortController().signal,
    tools,
    downloader: fakeDownloader({}),
    drive,
    openToken: (sealed) => sealed.replace(/^sealed:/, ''),
    privateStorage: new FakePrivateStorage() as unknown as PrivateStorage,
    internal: { chargeImport: jest.fn(async () => ({ charged: true as const, units: 3_000 })) },
    rows,
    progress,
    heartbeat: () => undefined,
    now: () => new Date('2026-11-28T12:00:00Z'),
  };
  return { run, rows };
}

describe('a Drive import', () => {
  it('reads only the picked file, and never writes the token to a log when it works', async () => {
    await writeFile(path.join(dir, 'talk.mp4'), Buffer.alloc(4_000, 3));
    const real = createSimulatedDriveFiles({ samplesDir: dir });
    const asked: string[] = [];
    const drive: DriveFiles = {
      ...real,
      facts: async (fileId, token, signal) => {
        asked.push(`facts:${fileId}`);
        return real.facts(fileId, token, signal);
      },
      fetch: (input, onProgress, signal) => {
        asked.push(`fetch:${input.fileId}`);
        return real.fetch(input, onProgress, signal);
      },
    };
    const { run } = importRun(drive);
    await runImport(run);
    expect(asked).toEqual([`fetch:${FILE_ID}`]);
    const written = lines.join('\n');
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain(SEALED);
  });

  it.each([
    [
      'refuses the token',
      () => ({
        ...createSimulatedDriveFiles({ samplesDir: dir }),
        fetch: async () => {
          throw new DriveError('drive_not_connected');
        },
      }),
    ],
    [
      'answers 401 through the real binding',
      () =>
        createDriveFiles({
          fetchImpl: (async () => new Response(`bad ${TOKEN}`, { status: 401 })) as never,
        }),
    ],
    [
      'fails on the network with the token in its message, through the real binding',
      () =>
        createDriveFiles({
          fetchImpl: (async () => {
            throw new Error(`GET failed: authorization: Bearer ${TOKEN}`);
          }) as never,
        }),
    ],
  ])('never writes the token to a log or a failure when Drive %s', async (_name, makeDrive) => {
    const { run, rows } = importRun(makeDrive());
    const error = await runImport(run).catch((caught: unknown) => caught);
    expect(error).toBeDefined();
    // What the activity hands Temporal: our code, its own sentence, and a log line with no token.
    const failure = clipFailure(error, { activity: 'clipImport', jobId: JOB_ID });
    expect(JSON.stringify({ message: failure.message, details: failure.details })).not.toContain(
      TOKEN,
    );
    expect(String((error as Error).message)).not.toContain(TOKEN);
    const written = lines.join('\n');
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain(SEALED);
    // A failed fetch keeps the token until the job is closed, which wipes it (below).
    expect(rows.driveCalls).toEqual([]);
  });
});

describe('the token when the job ends early', () => {
  function outcomes() {
    const rows = new FakeRows();
    rows.jobs.set(JOB_ID, jobRow({ input: driveInput, status: 'RUNNING' }));
    rows.videos.set(VIDEO_ID, videoRow());
    const deps: OutcomeDeps = {
      rows,
      privateStorage: new FakePrivateStorage(),
      storage: { delete: async () => undefined },
      internal: { reverseCharges: jest.fn(async () => ({ reversed: 0 })) },
      now: () => new Date('2026-11-28T12:00:00Z'),
    };
    return { rows, deps };
  }

  it('is wiped when the job fails', async () => {
    const { rows, deps } = outcomes();
    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'drive_not_connected' });
    expect(rows.driveCalls).toEqual([{ jobId: JOB_ID, original: null }]);
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('is wiped when the job is cancelled', async () => {
    const { rows, deps } = outcomes();
    await cancelJob(deps, { jobId: JOB_ID, organizationId: ORG });
    expect(rows.driveCalls).toEqual([{ jobId: JOB_ID, original: null }]);
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('is left alone for an upload that never came from Drive', async () => {
    const { rows, deps } = outcomes();
    rows.jobs.set(
      JOB_ID,
      jobRow({
        input: { ...driveInput, origin: { type: 'upload', originalKey: ORIGINAL_KEY } },
        status: 'RUNNING',
      }),
    );
    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'tool_failed' });
    expect(rows.driveCalls).toEqual([]);
  });
});
