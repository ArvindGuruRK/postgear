/**
 * A workspace's Discover settings: what a workspace that never saved has, who may
 * save, that a place goes in whole, the place that is answered back, and how a row
 * that someone edited by hand is read. The table is a fake that keeps rows the way
 * the real one does, so a save and the read after it can be followed.
 */
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@postgear/db';
import { CHENNAI } from '@postgear/discover-engine';
import type { ActiveOrg } from '../../common/decorators/current-org.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { securityLogger } from '../../common/logging/security-logger';
import type { UpdateSettingsInput } from './dto/settings.schema';
import type { DiscoverSettingsRepository, SettingsPatch, SettingsRow } from './settings.repository';
import { DiscoverSettingsService } from './settings.service';

const NOW = new Date('2026-11-10T10:00:00.000Z');
const ORG_ID = 'org-1';
const SENTENCE = 'Only workspace admins can change the workspace place.';

const admin: ActiveOrg = { id: ORG_ID, role: Role.ADMIN };
const member: ActiveOrg = { id: ORG_ID, role: Role.USER };
const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'a@x.com',
  isSuperAdmin: false,
  onboardingCompletedAt: null,
};
const superAdmin: AuthenticatedUser = { ...user, id: 'root-1', isSuperAdmin: true };

const CHENNAI_BODY = {
  countryCode: 'IN',
  regionCode: 'IN-TN',
  regionName: 'Tamil Nadu',
  city: 'Chennai',
  timeZone: 'Asia/Kolkata',
  locationSource: 'SEARCH',
} satisfies UpdateSettingsInput;

const NEVER_SAVED = {
  countryCode: null,
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: null,
  languages: [],
  topics: [],
  sources: null,
  locationSource: 'NONE',
  place: null,
  updatedAt: null,
};

type StoredRow = SettingsRow & { updatedById: string };

function emptyRow(): SettingsRow {
  return {
    countryCode: null,
    regionCode: null,
    regionName: null,
    city: null,
    timeZone: null,
    languages: [],
    topics: [],
    sources: null,
    locationSource: 'NONE',
    updatedAt: NOW,
  };
}

/** The table: a row per workspace, and a save that changes only the columns it names. */
function fakeTable() {
  const rows = new Map<string, StoredRow>();
  const repository = {
    find: jest.fn(async (orgId: string): Promise<SettingsRow | null> => rows.get(orgId) ?? null),
    upsert: jest.fn(
      async (orgId: string, userId: string, patch: SettingsPatch): Promise<SettingsRow> => {
        const named = Object.fromEntries(
          Object.entries(patch).filter(([, value]) => value !== undefined),
        );
        const row = {
          ...(rows.get(orgId) ?? emptyRow()),
          ...named,
          updatedAt: new Date(),
          updatedById: userId,
        } as StoredRow;
        rows.set(orgId, row);
        return row;
      },
    ),
  };
  return { rows, repository };
}

function build() {
  const table = fakeTable();
  const service = new DiscoverSettingsService(
    table.repository as unknown as DiscoverSettingsRepository,
  );
  return { service, ...table };
}

/** Puts a row in the table as someone with database access could have left it. */
function editByHand(rows: Map<string, StoredRow>, columns: Partial<SettingsRow>): void {
  rows.set(ORG_ID, { ...emptyRow(), ...columns, updatedById: 'someone' });
}

let securityWarn: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  securityWarn = jest.spyOn(securityLogger, 'warn').mockImplementation();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('reading', () => {
  it('answers the defaults for a workspace that never saved anything', async () => {
    const { service, repository } = build();

    await expect(service.get(ORG_ID)).resolves.toEqual(NEVER_SAVED);
    expect(repository.find).toHaveBeenCalledWith(ORG_ID);
  });

  it('writes nothing by reading', async () => {
    const { service, repository, rows } = build();

    await service.get(ORG_ID);

    expect(repository.upsert).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it('answers what was saved, with when, and never who', async () => {
    const { service } = build();
    await service.update(admin, user, {
      ...CHENNAI_BODY,
      languages: ['ta', 'en'],
      topics: ['BUSINESS'],
    });

    await expect(service.get(ORG_ID)).resolves.toEqual({
      countryCode: 'IN',
      regionCode: 'IN-TN',
      regionName: 'Tamil Nadu',
      city: 'Chennai',
      timeZone: 'Asia/Kolkata',
      languages: ['ta', 'en'],
      topics: ['BUSINESS'],
      sources: null,
      locationSource: 'SEARCH',
      place: { ...CHENNAI, newsLanguages: ['ta', 'en'] },
      updatedAt: NOW.toISOString(),
    });
  });

  it("reads only the asking workspace's row", async () => {
    const { service, repository } = build();
    await service.update(admin, user, CHENNAI_BODY);

    await expect(service.get('org-2')).resolves.toEqual(NEVER_SAVED);
    expect(repository.find).toHaveBeenLastCalledWith('org-2');
  });
});

describe('the place that is answered', () => {
  it('is Chennai as every Discover answer carries it, with what News can offer', async () => {
    const { service } = build();

    const { place } = await service.update(admin, user, CHENNAI_BODY);

    expect(place).toEqual({
      countryCode: 'IN',
      countryName: 'India',
      regionCode: 'IN-TN',
      regionName: 'Tamil Nadu',
      city: 'Chennai',
      timeZone: 'Asia/Kolkata',
      languages: ['ta', 'en'],
      newsLanguages: ['ta', 'en'],
    });
  });

  it('is Worldwide for a Worldwide that was saved on purpose', async () => {
    const { service } = build();

    const saved = await service.update(admin, user, {
      countryCode: null,
      locationSource: 'SEARCH',
    });

    expect(saved.countryCode).toBeNull();
    expect(saved.locationSource).toBe('SEARCH');
    expect(saved.place).toEqual({
      countryCode: null,
      countryName: null,
      regionCode: null,
      regionName: null,
      city: null,
      timeZone: null,
      languages: ['en'],
      newsLanguages: ['en'],
    });
  });

  it('is null while no place was ever saved, whatever else was', async () => {
    const { service } = build();

    const saved = await service.update(admin, user, { languages: ['ta'], topics: ['SPORTS'] });

    expect(saved.locationSource).toBe('NONE');
    expect(saved.place).toBeNull();
    expect(saved.languages).toEqual(['ta']);
  });

  it('fills the names and languages a bare country has', async () => {
    const { service } = build();

    const { place } = await service.update(admin, user, {
      countryCode: 'FR',
      locationSource: 'TIMEZONE',
    });

    expect(place).toMatchObject({
      countryCode: 'FR',
      countryName: 'France',
      regionCode: null,
      city: null,
      timeZone: 'Europe/Paris',
      languages: ['fr', 'en'],
      // France has no English edition, so the chip offers only what can really be read.
      newsLanguages: ['fr'],
    });
  });

  it('hands a stored zone on as it was stored', async () => {
    const { service } = build();

    const saved = await service.update(admin, user, { ...CHENNAI_BODY, timeZone: 'Asia/Calcutta' });

    expect(saved.timeZone).toBe('Asia/Calcutta');
    expect(saved.place?.timeZone).toBe('Asia/Calcutta');
  });

  it('is never stored: only the codes and names go to the table', async () => {
    const { service, repository } = build();

    await service.update(admin, user, CHENNAI_BODY);

    const patch = repository.upsert.mock.calls[0][2];
    expect(Object.keys(patch).sort()).toEqual([
      'city',
      'countryCode',
      'locationSource',
      'regionCode',
      'regionName',
      'timeZone',
    ]);
  });
});

describe('who may save', () => {
  it('refuses a member with the sentence, and touches nothing', async () => {
    const { service, repository, rows } = build();

    const error = await service
      .update(member, user, CHENNAI_BODY)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getStatus()).toBe(403);
    expect((error as ForbiddenException).message).toBe(SENTENCE);
    expect((error as ForbiddenException).getResponse()).toEqual({
      message: SENTENCE,
      code: 'settings_admin_only',
    });
    // Not read, not written, and no row made by trying.
    expect(repository.find).not.toHaveBeenCalled();
    expect(repository.upsert).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it('leaves what an admin saved exactly as it was when a member tries', async () => {
    const { service, rows } = build();
    await service.update(admin, user, CHENNAI_BODY);
    const before = { ...rows.get(ORG_ID) };

    await expect(
      service.update(member, { ...user, id: 'user-2' }, { sources: { videos: false } }),
    ).rejects.toThrow(SENTENCE);

    expect(rows.get(ORG_ID)).toEqual(before);
  });

  it.each([
    ['its place', CHENNAI_BODY],
    ['its languages', { languages: ['ta'] }],
    ['its topics', { topics: ['SPORTS'] }],
    ['its switches', { sources: { social: false } }],
    ['clearing the place', { locationSource: 'NONE' }],
  ] as [string, UpdateSettingsInput][])('refuses a member %s alike', async (_name, body) => {
    const { service, repository } = build();

    await expect(service.update(member, user, body)).rejects.toThrow(SENTENCE);
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('logs the refusal with the workspace and the person, and nothing they sent', async () => {
    const { service } = build();

    await service.update(member, user, CHENNAI_BODY).catch(() => undefined);

    expect(securityWarn).toHaveBeenCalledTimes(1);
    expect(securityWarn).toHaveBeenCalledWith('rbac.denied', {
      userId: 'user-1',
      orgId: ORG_ID,
      role: 'USER',
      required: ['ADMIN'],
      route: 'discover/settings',
    });
  });

  it('lets an admin save, and logs nothing about it', async () => {
    const { service, rows } = build();

    await expect(service.update(admin, user, CHENNAI_BODY)).resolves.toMatchObject({
      city: 'Chennai',
    });
    expect(rows.get(ORG_ID)?.city).toBe('Chennai');
    expect(securityWarn).not.toHaveBeenCalled();
  });

  it('lets a super admin save in a workspace they are not a member of', async () => {
    const { service, rows } = build();
    const acting: ActiveOrg = { id: ORG_ID, role: 'SUPERADMIN' };

    await service.update(acting, superAdmin, CHENNAI_BODY);

    expect(rows.get(ORG_ID)?.updatedById).toBe('root-1');
  });

  it('lets a super admin save where their own membership is a plain one', async () => {
    const { service, rows } = build();

    await service.update(member, superAdmin, CHENNAI_BODY);

    expect(rows.get(ORG_ID)?.city).toBe('Chennai');
    expect(securityWarn).not.toHaveBeenCalled();
  });
});

describe('saving', () => {
  it('creates the row on the first save and changes it on the next, noting who saved each time', async () => {
    const { service, repository, rows } = build();

    await service.update(admin, user, CHENNAI_BODY);
    expect(rows.size).toBe(1);
    expect(rows.get(ORG_ID)?.updatedById).toBe('user-1');

    jest.setSystemTime(new Date('2026-11-11T08:30:00.000Z'));
    const second = await service.update(admin, { ...user, id: 'user-2' }, { topics: ['SPORTS'] });

    expect(rows.size).toBe(1);
    expect(rows.get(ORG_ID)?.updatedById).toBe('user-2');
    expect(repository.upsert).toHaveBeenNthCalledWith(1, ORG_ID, 'user-1', expect.any(Object));
    expect(repository.upsert).toHaveBeenNthCalledWith(2, ORG_ID, 'user-2', { topics: ['SPORTS'] });
    // The place from the first save is still there, and the time is the second's.
    expect(second).toMatchObject({
      city: 'Chennai',
      topics: ['SPORTS'],
      updatedAt: '2026-11-11T08:30:00.000Z',
    });
  });

  it('saves under the workspace the request is in, never one it names', async () => {
    const { service, rows } = build();

    await service.update({ id: 'org-2', role: Role.ADMIN }, user, CHENNAI_BODY);

    expect([...rows.keys()]).toEqual(['org-2']);
  });

  it('saves a place whole: a new city never keeps the old region or zone', async () => {
    const { service, repository } = build();
    await service.update(admin, user, CHENNAI_BODY);

    const saved = await service.update(admin, user, {
      countryCode: 'FR',
      city: 'Paris',
      locationSource: 'SEARCH',
    });

    expect(repository.upsert.mock.calls[1][2]).toEqual({
      countryCode: 'FR',
      regionCode: null,
      regionName: null,
      city: 'Paris',
      timeZone: null,
      locationSource: 'SEARCH',
    });
    expect(saved).toMatchObject({
      countryCode: 'FR',
      regionCode: null,
      regionName: null,
      city: 'Paris',
      timeZone: null,
    });
    expect(saved.place).toMatchObject({
      countryName: 'France',
      regionCode: null,
      regionName: null,
      city: 'Paris',
      timeZone: 'Europe/Paris',
    });
  });

  it('leaves the place alone when a save names none', async () => {
    const { service, repository } = build();
    await service.update(admin, user, CHENNAI_BODY);

    const saved = await service.update(admin, user, { languages: ['en', 'ta'] });

    expect(Object.keys(repository.upsert.mock.calls[1][2])).toEqual(['languages']);
    expect(saved).toMatchObject({ city: 'Chennai', regionCode: 'IN-TN', languages: ['en', 'ta'] });
  });

  it.each([
    ['on its own', { locationSource: 'NONE' }],
    [
      'with every field spelled out',
      {
        countryCode: null,
        regionCode: null,
        regionName: null,
        city: null,
        timeZone: null,
        locationSource: 'NONE',
      },
    ],
  ] as [string, UpdateSettingsInput][])(
    'clears the place %s, and keeps everything else',
    async (_name, body) => {
      const { service } = build();
      await service.update(admin, user, { ...CHENNAI_BODY, languages: ['ta'], topics: ['WORLD'] });

      const cleared = await service.update(admin, user, body);

      expect(cleared).toMatchObject({
        countryCode: null,
        regionCode: null,
        regionName: null,
        city: null,
        timeZone: null,
        locationSource: 'NONE',
        place: null,
        languages: ['ta'],
        topics: ['WORLD'],
      });
    },
  );

  it('keeps the languages and the topics in the order they were sent', async () => {
    const { service } = build();

    const saved = await service.update(admin, user, {
      languages: ['en', 'ta', 'hi'],
      topics: ['SPORTS', 'WORLD', 'BUSINESS'],
    });

    expect(saved.languages).toEqual(['en', 'ta', 'hi']);
    expect(saved.topics).toEqual(['SPORTS', 'WORLD', 'BUSINESS']);
  });

  it('replaces the switches whole, and null puts every group back on', async () => {
    const { service } = build();

    const first = await service.update(admin, user, { sources: { trends: false, videos: false } });
    const second = await service.update(admin, user, { sources: { videos: false } });
    const third = await service.update(admin, user, { sources: null });

    expect(first.sources).toEqual({ trends: false, videos: false });
    expect(second.sources).toEqual({ videos: false });
    expect(third.sources).toBeNull();
  });
});

describe('a row someone edited by hand', () => {
  it.each([
    ['text', 'videos'],
    ['a list', ['videos']],
    ['a number', 1],
    ['a boolean', false],
  ])('reads switches stored as %s as none at all', async (_name, sources) => {
    const { service, rows } = build();
    editByHand(rows, { sources });

    await expect(service.get(ORG_ID)).resolves.toMatchObject({ sources: null });
    await expect(service.switchedOff(ORG_ID)).resolves.toEqual([]);
  });

  it('reads only the five switches, and only booleans', async () => {
    const { service, rows } = build();
    editByHand(rows, {
      sources: JSON.parse(
        '{"trends":false,"wikipedia":"false","social":0,"videos":true,"festivals":null,' +
          '"news":false,"__proto__":{"social":false},"constructor":false}',
      ),
    });

    const { sources } = await service.get(ORG_ID);

    expect(sources).toEqual({ trends: false, videos: true });
    expect(Object.keys(sources ?? {})).toEqual(['trends', 'videos']);
    await expect(service.switchedOff(ORG_ID)).resolves.toEqual(['trends']);
  });

  it('does not fall over on a country nobody knows', async () => {
    const { service, rows } = build();
    editByHand(rows, { countryCode: 'ZZ', regionCode: 'nonsense', locationSource: 'SEARCH' });

    const { place } = await service.get(ORG_ID);

    expect(place).toMatchObject({ countryCode: 'ZZ', countryName: null, languages: ['en'] });
  });

  it('answers no place for a row that says none was saved, whatever its columns hold', async () => {
    const { service, rows } = build();
    editByHand(rows, { countryCode: 'IN', city: 'Chennai', locationSource: 'NONE' });

    await expect(service.get(ORG_ID)).resolves.toMatchObject({ place: null });
  });

  it('answers only topics Google News has, since the page sends the first one back', async () => {
    const { service, rows } = build();
    editByHand(rows, { topics: ['GOSSIP', 'SPORTS', 'business', 'WORLD'] });

    await expect(service.get(ORG_ID)).resolves.toMatchObject({ topics: ['SPORTS', 'WORLD'] });
  });
});

describe('the switches the feed asks for', () => {
  it('has none off for a workspace with no row', async () => {
    const { service, repository } = build();

    await expect(service.switchedOff(ORG_ID)).resolves.toEqual([]);
    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.find).toHaveBeenCalledWith(ORG_ID);
  });

  it('names what is off, and only that: a switch that is on or missing is on', async () => {
    const { service } = build();
    await service.update(admin, user, {
      sources: { festivals: false, social: false, wikipedia: true },
    });

    await expect(service.switchedOff(ORG_ID)).resolves.toEqual(['social', 'festivals']);
  });

  it("reads only the asking workspace's switches", async () => {
    const { service } = build();
    await service.update(admin, user, { sources: { videos: false } });

    await expect(service.switchedOff('org-2')).resolves.toEqual([]);
  });
});
