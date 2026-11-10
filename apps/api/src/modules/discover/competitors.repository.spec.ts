/**
 * The queries of the competitors table. Every one names the workspace and leaves
 * removed rows out, every read asks for the same fixed columns, and the cap is
 * counted inside the same serializable transaction as the insert.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  const table = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  };

  return {
    ...actual,
    prisma: {
      competitor: table,
      // The transaction hands its work the same table, and passes on what it throws.
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) =>
        work({ competitor: table }),
      ),
    },
  };
});

import { Prisma, prisma } from '@postgear/db';
import { CompetitorsRepository, type CompetitorWrite } from './competitors.repository';

type Table = Record<'findMany' | 'findFirst' | 'count' | 'create' | 'updateMany', jest.Mock>;

const db = prisma as unknown as { competitor: Table; $transaction: jest.Mock };
const NOW = new Date('2026-11-10T10:00:00Z');
const SCOPE = { organizationId: 'org_1', deletedAt: null };

const COLUMNS = [
  'blueskyHandle',
  'createdAt',
  'feedUrls',
  'id',
  'lastCheckedAt',
  'lastError',
  'mastodonAcct',
  'name',
  'newsQuery',
  'updatedAt',
  'websiteUrl',
  'youtubeChannelId',
];

const ACME: CompetitorWrite = {
  name: 'Acme',
  websiteUrl: 'https://acme.example/',
  feedUrls: ['https://acme.example/blog/rss.xml'],
  youtubeChannelId: null,
  blueskyHandle: 'acme.example',
  mastodonAcct: null,
  newsQuery: null,
};

const ROW = {
  id: 'c1',
  ...ACME,
  lastCheckedAt: null,
  lastError: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function selected(call: { select: Record<string, boolean> }): string[] {
  return Object.keys(call.select).sort();
}

function aborted(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('The transaction was aborted.', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('CompetitorsRepository', () => {
  let repository: CompetitorsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new CompetitorsRepository();
    db.competitor.findMany.mockResolvedValue([ROW]);
    db.competitor.findFirst.mockResolvedValue(ROW);
    db.competitor.count.mockResolvedValue(0);
    db.competitor.create.mockResolvedValue(ROW);
    db.competitor.updateMany.mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
      work({ competitor: db.competitor }),
    );
  });

  it("lists the workspace's live rows, oldest first, with the fixed columns", async () => {
    await expect(repository.list('org_1')).resolves.toEqual([ROW]);

    const query = db.competitor.findMany.mock.calls[0][0];
    expect(query.where).toEqual(SCOPE);
    expect(query.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(selected(query)).toEqual(COLUMNS);
  });

  it('counts only live rows of the workspace', async () => {
    db.competitor.count.mockResolvedValue(7);

    await expect(repository.count('org_1')).resolves.toBe(7);
    expect(db.competitor.count.mock.calls[0][0].where).toEqual(SCOPE);
  });

  it('finds a row by its id inside the workspace, and never a removed one', async () => {
    await repository.find('org_1', 'c1');

    const query = db.competitor.findFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: 'c1', ...SCOPE });
    expect(selected(query)).toEqual(COLUMNS);
  });

  it('never selects the workspace, who added it, or when it was removed', () => {
    for (const hidden of ['organizationId', 'createdById', 'deletedAt']) {
      expect(COLUMNS).not.toContain(hidden);
    }
  });

  describe('create', () => {
    it('counts and inserts in one serializable transaction', async () => {
      db.competitor.count.mockResolvedValue(19);

      await expect(repository.create('org_1', 'u1', ACME, 20)).resolves.toEqual({
        outcome: 'created',
        row: ROW,
      });

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(db.competitor.count.mock.calls[0][0].where).toEqual(SCOPE);
      const insert = db.competitor.create.mock.calls[0][0];
      expect(insert.data).toEqual({ organizationId: 'org_1', createdById: 'u1', ...ACME });
      expect(selected(insert)).toEqual(COLUMNS);
    });

    it('inserts nothing once the workspace is at its limit', async () => {
      db.competitor.count.mockResolvedValue(20);

      await expect(repository.create('org_1', 'u1', ACME, 20)).resolves.toEqual({
        outcome: 'limit',
      });
      expect(db.competitor.create).not.toHaveBeenCalled();
    });

    it('counts again when Postgres aborts a race for the last place', async () => {
      db.$transaction
        .mockRejectedValueOnce(aborted())
        .mockImplementationOnce(async (work: (tx: unknown) => Promise<unknown>) => {
          // The winner's row is there by now.
          db.competitor.count.mockResolvedValue(20);
          return work({ competitor: db.competitor });
        });

      await expect(repository.create('org_1', 'u1', ACME, 20)).resolves.toEqual({
        outcome: 'limit',
      });
      expect(db.$transaction).toHaveBeenCalledTimes(2);
    });

    it('gives up after three aborted tries, and passes any other failure straight on', async () => {
      db.$transaction.mockRejectedValue(aborted());
      await expect(repository.create('org_1', 'u1', ACME, 20)).rejects.toMatchObject({
        code: 'P2034',
      });
      expect(db.$transaction).toHaveBeenCalledTimes(3);

      db.$transaction.mockReset().mockRejectedValue(new Error('The database is away.'));
      await expect(repository.create('org_1', 'u1', ACME, 20)).rejects.toThrow(
        'The database is away.',
      );
      expect(db.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('changes only the columns it was given, inside the workspace', async () => {
      await expect(
        repository.update('org_1', 'c1', { feedUrls: [], blueskyHandle: null }),
      ).resolves.toEqual(ROW);

      const change = db.competitor.updateMany.mock.calls[0][0];
      expect(change.where).toEqual({ id: 'c1', ...SCOPE });
      // What was not sent is undefined, which Prisma leaves alone. Null clears.
      expect(change.data).toEqual({
        name: undefined,
        websiteUrl: undefined,
        feedUrls: [],
        youtubeChannelId: undefined,
        blueskyHandle: null,
        mastodonAcct: undefined,
        newsQuery: undefined,
      });
    });

    it('lets nothing that is not a settable column ride along', async () => {
      const sneaky = {
        name: 'Renamed',
        organizationId: 'org_2',
        deletedAt: null,
        lastError: 'A response body',
      } as unknown as Partial<CompetitorWrite>;

      await repository.update('org_1', 'c1', sneaky);

      const { data } = db.competitor.updateMany.mock.calls[0][0];
      expect(Object.keys(data)).not.toEqual(
        expect.arrayContaining(['organizationId', 'deletedAt', 'lastError']),
      );
      expect(data.name).toBe('Renamed');
    });

    it("answers null for another workspace's row or a removed one, without reading it", async () => {
      db.competitor.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.update('org_1', 'c1', { name: 'X' })).resolves.toBeNull();
      expect(db.competitor.findFirst).not.toHaveBeenCalled();
    });
  });

  it('removes softly, inside the workspace, and says whether anything was removed', async () => {
    jest.useFakeTimers({ now: NOW });
    try {
      await expect(repository.softDelete('org_1', 'c1')).resolves.toBe(true);

      const change = db.competitor.updateMany.mock.calls[0][0];
      expect(change.where).toEqual({ id: 'c1', ...SCOPE });
      expect(change.data).toEqual({ deletedAt: NOW });

      db.competitor.updateMany.mockResolvedValue({ count: 0 });
      await expect(repository.softDelete('org_1', 'c1')).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('notes a check with the two columns it owns, and nothing else', async () => {
    await repository.noteCheck('org_1', 'c1', {
      lastCheckedAt: NOW,
      lastError: 'YouTube could not be reached.',
    });

    const change = db.competitor.updateMany.mock.calls[0][0];
    expect(change.where).toEqual({ id: 'c1', ...SCOPE });
    expect(change.data).toEqual({
      lastCheckedAt: NOW,
      lastError: 'YouTube could not be reached.',
    });
  });
});
