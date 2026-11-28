/**
 * Sprint 13, Module 16: a Google Drive import keeps its sealed access token
 * in the job's input only until the file is stored. The worker wipes it on
 * its own failure and cancel paths; these are the API's two ways of closing
 * a job the worker never finished (cancel with no workflow, the reconcile's
 * failure), and each must wipe it too.
 */
import type { ClipJob } from '@postgear/db';
import { emptyTables, type FakeTables, fakeClipDb } from '../testing/fake-clip-db';
import { jobRow, TEST_ORG } from '../testing/rows';

let mockDb: Record<string | symbol, unknown> | null = null;
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      {
        get: (_target, key) => {
          const target = (mockDb ?? actual.prisma) as Record<string | symbol, unknown>;
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      },
    ),
  };
});

import { ClipJobsRepository } from './clip-jobs.repository';

const SEALED = 'sealed-drive-token-value-0001';
const JOB = '44444444-4444-4444-8444-444444444444';

function driveImport(overrides: Partial<ClipJob> = {}): ClipJob {
  return jobRow({
    id: JOB,
    kind: 'IMPORT',
    status: 'RUNNING',
    input: {
      origin: { type: 'upload', originalKey: 'k', drive: { fileId: 'file-1', token: SEALED } },
    },
    ...overrides,
  });
}

function tokenOf(tables: FakeTables): unknown {
  const job = tables.jobs.find((row) => row.id === JOB);
  if (!job) throw new Error('the job is gone');
  return (job.input as { origin: { drive: { token: unknown } } }).origin.drive.token;
}

let tables: FakeTables;
const repository = new ClipJobsRepository();

beforeEach(() => {
  tables = emptyTables();
  mockDb = fakeClipDb(tables) as unknown as Record<string | symbol, unknown>;
});

afterAll(() => {
  mockDb = null;
});

describe('the Drive token on a job the API closes', () => {
  it('is wiped when a job with no workflow is cancelled', async () => {
    tables.jobs.push(driveImport());
    expect(await repository.cancelOpen(TEST_ORG, JOB, { code: 'cancelled' })).toBe(true);
    expect(tokenOf(tables)).toBeNull();
    expect(JSON.stringify(tables.jobs)).not.toContain(SEALED);
  });

  it('is wiped when the reconcile fails a job', async () => {
    tables.jobs.push(driveImport({ status: 'QUEUED' }));
    expect(await repository.failOpen(JOB, { code: 'import_failed' }, new Date())).toBe(true);
    expect(tokenOf(tables)).toBeNull();
    expect(JSON.stringify(tables.jobs)).not.toContain(SEALED);
  });

  it('is left alone on a job that was already closed, since nothing changed', async () => {
    tables.jobs.push(driveImport({ status: 'DONE' }));
    expect(await repository.failOpen(JOB, { code: 'import_failed' }, new Date())).toBe(false);
    expect(tokenOf(tables)).toBe(SEALED);
  });

  it('keeps the rest of the input, and leaves a link import untouched', async () => {
    tables.jobs.push(driveImport());
    await repository.cancelOpen(TEST_ORG, JOB, { code: 'cancelled' });
    const input = tables.jobs[0]?.input as { origin: { drive: { fileId: string } } };
    expect(input.origin.drive.fileId).toBe('file-1');

    const link = jobRow({ id: 'link-job', status: 'RUNNING', input: { origin: { type: 'link' } } });
    tables.jobs.push(link);
    await repository.failOpen('link-job', { code: 'import_failed' }, new Date());
    expect(tables.jobs.find((row) => row.id === 'link-job')?.input).toEqual({
      origin: { type: 'link' },
    });
  });
});
