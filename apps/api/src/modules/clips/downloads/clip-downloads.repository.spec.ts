/**
 * Save To Media's start (Module 18) against an in-memory transaction: the
 * time it started is kept with `saving`, a second click while it saves
 * starts nothing, and a save past its time limit (its workflow ended without
 * a word) can be asked again. No database.
 */
import type { ClipJob } from '@postgear/db';
import { jobRow, TEST_ORG } from '../testing/rows';
import { ClipDownloadsRepository } from './clip-downloads.repository';
import { SAVE_TO_MEDIA_STALE_MS } from './clip-downloads.view';

const mockRows: ClipJob[] = [];
const mockTx = {
  clipJob: {
    findFirst: jest.fn(
      async ({ where }: { where: { id: string; organizationId: string } }) =>
        mockRows.find(
          (row) => row.id === where.id && row.organizationId === where.organizationId,
        ) ?? null,
    ),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<ClipJob> }) => {
      const row = mockRows.find((entry) => entry.id === where.id) as ClipJob;
      Object.assign(row, data);
      return { ...row };
    }),
  },
};

jest.mock('../clips.tx', () => ({
  serializable: (work: (tx: unknown) => Promise<unknown>) => work(mockTx),
}));

const JOB_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-19T10:00:00.000Z');
const OUTPUT = {
  assetId: '77777777-7777-4777-8777-777777777777',
  key: `clips/${TEST_ORG}/downloads/${JOB_ID}/file.mp4`,
  bytes: 80_000_000,
  ext: 'mp4',
  fileName: 'Talk.mp4',
  durationMs: 600_000,
  width: 1280,
  height: 720,
  fps: 30,
};

function download(
  media?: { status: string; mediaId: string | null; startedAt?: string },
  updatedAt: Date = NOW,
): ClipJob {
  const row = jobRow({
    id: JOB_ID,
    kind: 'DOWNLOAD',
    status: 'DONE',
    videoId: null,
    updatedAt,
    output: media === undefined ? OUTPUT : { ...OUTPUT, media },
  });
  mockRows.push(row);
  return row;
}

const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeEach(() => {
  mockRows.length = 0;
  jest.clearAllMocks();
});

describe('ClipDownloadsRepository.startSaving', () => {
  const repository = new ClipDownloadsRepository();

  it('marks the save started, with the time it started', async () => {
    download();
    const started = await repository.startSaving(TEST_ORG, JOB_ID, NOW);
    expect(started.outcome).toBe('started');
    expect(mockRows[0]?.output).toEqual({
      ...OUTPUT,
      media: { status: 'saving', mediaId: null, startedAt: NOW.toISOString() },
    });
  });

  it('answers a save still inside its time as already, and writes nothing', async () => {
    download({ status: 'saving', mediaId: null, startedAt: ago(10 * 60_000).toISOString() });
    const again = await repository.startSaving(TEST_ORG, JOB_ID, NOW);
    expect(again.outcome).toBe('already');
    expect(mockTx.clipJob.update).not.toHaveBeenCalled();
  });

  it('starts again a save past its time limit, from now', async () => {
    download({
      status: 'saving',
      mediaId: null,
      startedAt: ago(SAVE_TO_MEDIA_STALE_MS + 1_000).toISOString(),
    });
    const again = await repository.startSaving(TEST_ORG, JOB_ID, NOW);
    expect(again.outcome).toBe('started');
    expect(mockRows[0]?.output).toEqual({
      ...OUTPUT,
      media: { status: 'saving', mediaId: null, startedAt: NOW.toISOString() },
    });
  });

  it("times a save written before startedAt was kept from the row's last write", async () => {
    download({ status: 'saving', mediaId: null }, ago(60_000));
    expect((await repository.startSaving(TEST_ORG, JOB_ID, NOW)).outcome).toBe('already');

    mockRows.length = 0;
    download({ status: 'saving', mediaId: null }, ago(SAVE_TO_MEDIA_STALE_MS + 1_000));
    expect((await repository.startSaving(TEST_ORG, JOB_ID, NOW)).outcome).toBe('started');
  });

  it('never starts a saved one again, however old', async () => {
    download(
      { status: 'saved', mediaId: '66666666-6666-4666-8666-666666666666' },
      ago(48 * 60 * 60_000),
    );
    expect((await repository.startSaving(TEST_ORG, JOB_ID, NOW)).outcome).toBe('already');
    expect(mockTx.clipJob.update).not.toHaveBeenCalled();
  });
});
