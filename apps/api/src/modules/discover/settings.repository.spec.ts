/**
 * The two queries of the settings table. Both name the workspace's own id and
 * nothing else, both read the same fixed columns, and a save changes only the
 * columns it was given, in one statement.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: { discoverSettings: { findUnique: jest.fn(), upsert: jest.fn() } },
  };
});

import { Prisma, prisma } from '@postgear/db';
import { DiscoverSettingsRepository, type SettingsPatch } from './settings.repository';

type PrismaMock = { discoverSettings: Record<'findUnique' | 'upsert', jest.Mock> };

const db = prisma as unknown as PrismaMock;
const NOW = new Date('2026-11-10T10:00:00Z');

const COLUMNS = [
  'city',
  'countryCode',
  'interests',
  'languages',
  'locationSource',
  'regionCode',
  'regionName',
  'sources',
  'timeZone',
  'topics',
  'updatedAt',
  'weeklyDigest',
];

const CHENNAI_ROW = {
  countryCode: 'IN',
  regionCode: 'IN-TN',
  regionName: 'Tamil Nadu',
  city: 'Chennai',
  timeZone: 'Asia/Kolkata',
  languages: ['ta', 'en'],
  topics: ['BUSINESS'],
  sources: null,
  interests: [],
  weeklyDigest: false,
  locationSource: 'SEARCH',
  updatedAt: NOW,
};

/** The one upsert a test made, as Prisma was handed it. */
function saved() {
  expect(db.discoverSettings.upsert).toHaveBeenCalledTimes(1);
  return db.discoverSettings.upsert.mock.calls[0][0] as {
    where: object;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
    select: Record<string, boolean>;
  };
}

describe('DiscoverSettingsRepository', () => {
  let repository: DiscoverSettingsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new DiscoverSettingsRepository();
    db.discoverSettings.findUnique.mockResolvedValue(null);
    db.discoverSettings.upsert.mockResolvedValue(CHENNAI_ROW);
  });

  describe('find', () => {
    it("reads the workspace's row by its own id, and nothing else", async () => {
      db.discoverSettings.findUnique.mockResolvedValue(CHENNAI_ROW);

      await expect(repository.find('org_1')).resolves.toBe(CHENNAI_ROW);

      expect(db.discoverSettings.findUnique).toHaveBeenCalledTimes(1);
      expect(db.discoverSettings.findUnique.mock.calls[0][0].where).toEqual({
        organizationId: 'org_1',
      });
    });

    it('selects the settings and not who saved them, or the workspace', async () => {
      await repository.find('org_1');

      const { select } = db.discoverSettings.findUnique.mock.calls[0][0];
      expect(Object.keys(select).sort()).toEqual(COLUMNS);
      expect(Object.values(select)).toEqual(COLUMNS.map(() => true));
    });

    it('answers null for a workspace that never saved anything', async () => {
      await expect(repository.find('org_1')).resolves.toBeNull();
    });
  });

  describe('upsert', () => {
    const place: SettingsPatch = {
      countryCode: 'IN',
      regionCode: 'IN-TN',
      regionName: 'Tamil Nadu',
      city: 'Chennai',
      timeZone: 'Asia/Kolkata',
      locationSource: 'SEARCH',
    };

    it('creates the row under the workspace on a first save, noting who saved', async () => {
      await expect(repository.upsert('org_1', 'user_1', place)).resolves.toBe(CHENNAI_ROW);

      const { where, create } = saved();
      expect(where).toEqual({ organizationId: 'org_1' });
      expect(create).toEqual({ organizationId: 'org_1', updatedById: 'user_1', ...place });
    });

    it('changes the same row on a later save, and notes who saved again', async () => {
      await repository.upsert('org_1', 'user_2', place);

      const { where, update } = saved();
      expect(where).toEqual({ organizationId: 'org_1' });
      expect(update).toEqual({ updatedById: 'user_2', ...place });
      // The key is never rewritten: a row cannot be moved to another workspace.
      expect(update).not.toHaveProperty('organizationId');
    });

    it('is one statement, with the same columns read back as a read', async () => {
      await repository.upsert('org_1', 'user_1', place);

      expect(Object.keys(saved().select).sort()).toEqual(COLUMNS);
    });

    it('leaves alone every column the save does not name', async () => {
      await repository.upsert('org_1', 'user_1', { languages: ['ta', 'en'] });

      const { create, update } = saved();
      for (const data of [create, update]) {
        const named = Object.keys(data).filter((key) => data[key] !== undefined);
        expect(named.filter((key) => key !== 'organizationId').sort()).toEqual([
          'languages',
          'updatedById',
        ]);
      }
    });

    it('writes a cleared place field as null, which is not the same as leaving it alone', async () => {
      await repository.upsert('org_1', 'user_1', {
        countryCode: 'FR',
        regionCode: null,
        regionName: null,
        city: 'Paris',
        timeZone: null,
        locationSource: 'SEARCH',
      });

      expect(saved().update).toMatchObject({ regionCode: null, regionName: null, timeZone: null });
    });

    it('stores the switches as they were given', async () => {
      await repository.upsert('org_1', 'user_1', { sources: { social: false, videos: true } });

      const { create, update } = saved();
      expect(create.sources).toEqual({ social: false, videos: true });
      expect(update.sources).toEqual({ social: false, videos: true });
    });

    it("empties the switches with the database's own null", async () => {
      await repository.upsert('org_1', 'user_1', { sources: null });

      const { create, update } = saved();
      expect(create.sources).toBe(Prisma.DbNull);
      expect(update.sources).toBe(Prisma.DbNull);
    });

    it('carries nothing that is not a column of this table, whatever the patch holds', async () => {
      const smuggled = {
        languages: ['ta'],
        organizationId: 'org_2',
        updatedById: 'someone-else',
        createdAt: NOW,
      } as SettingsPatch;

      await repository.upsert('org_1', 'user_1', smuggled);

      const { where, create, update } = saved();
      expect(where).toEqual({ organizationId: 'org_1' });
      expect(create.organizationId).toBe('org_1');
      expect(create.updatedById).toBe('user_1');
      expect(update.updatedById).toBe('user_1');
      expect(update).not.toHaveProperty('organizationId');
      expect(update).not.toHaveProperty('createdAt');
      expect(create).not.toHaveProperty('createdAt');
    });
  });
});
