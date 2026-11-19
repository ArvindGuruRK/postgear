/**
 * `publishRun` through the Prisma store (Module 20): a run published from
 * the command line passes the same rule as the operator screen's Publish Run
 * (`libraryPublishRefusal`), so only the items it allows go live and the rest
 * stay staged.
 */
const mockFindStickers = jest.fn();
const mockFindSounds = jest.fn();
const mockUpdateStickers = jest.fn();
const mockUpdateSounds = jest.fn();

jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: {
      clipSticker: { findMany: mockFindStickers, updateMany: mockUpdateStickers },
      clipSound: { findMany: mockFindSounds, updateMany: mockUpdateSounds },
      $transaction: (work: Promise<unknown>[]) => Promise.all(work),
    },
  };
});

import { prismaLibraryStore } from './store';

const CREDITED = { requiresCredit: true, creditLine: 'Icons by Kenney (CC0)' };
const OWING = { requiresCredit: true, creditLine: '  ' };
const FREE = { requiresCredit: false, creditLine: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateStickers.mockImplementation(async ({ where }) => ({ count: where.id.in.length }));
  mockUpdateSounds.mockImplementation(async ({ where }) => ({ count: where.id.in.length }));
});

describe('prismaLibraryStore().publishRun', () => {
  it('publishes only the staged items the shared rule allows', async () => {
    mockFindStickers.mockResolvedValue([
      { id: 'ok', licence: 'CC0-1.0', origin: 'kenney', source: CREDITED },
      { id: 'bad-licence', licence: 'CC-BY-NC-4.0', origin: 'kenney', source: CREDITED },
      { id: 'bad-origin', licence: 'CC0-1.0', origin: 'somewhere', source: FREE },
      { id: 'owes-credit', licence: 'CC0-1.0', origin: 'noto', source: OWING },
    ]);
    mockFindSounds.mockResolvedValue([
      { id: 'sound-ok', licence: 'CC0-1.0', origin: 'own', source: FREE },
      // A sound never takes CC BY: a credit cannot ride inside a finished video.
      { id: 'sound-by', licence: 'CC-BY-4.0', origin: 'own', source: CREDITED },
    ]);

    const published = await prismaLibraryStore().publishRun('run-1', 'operator-1');

    expect(published).toBe(2);
    expect(mockUpdateStickers).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: 'run-1', status: 'STAGED', id: { in: ['ok'] } },
        data: expect.objectContaining({ status: 'ACTIVE', statusById: 'operator-1' }),
      }),
    );
    expect(mockUpdateSounds).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: 'run-1', status: 'STAGED', id: { in: ['sound-ok'] } },
      }),
    );
  });

  it('publishes nothing when every staged item is held back', async () => {
    mockFindStickers.mockResolvedValue([
      { id: 'bad-licence', licence: 'ALL-RIGHTS-RESERVED', origin: 'kenney', source: FREE },
    ]);
    mockFindSounds.mockResolvedValue([]);

    expect(await prismaLibraryStore().publishRun('run-2', null)).toBe(0);
    expect(mockUpdateStickers).toHaveBeenCalledWith(
      expect.objectContaining({ where: { runId: 'run-2', status: 'STAGED', id: { in: [] } } }),
    );
  });
});
