/**
 * Who may call what, read from the real route metadata through the real guards, in
 * the shape of `automations.routes.spec.ts`: any member may read everything, nothing
 * is public, and a new route can only be added by adding it to this table. Then what
 * the controller itself decides, which is little on purpose.
 *
 * One route writes: saving the workspace's settings. The guard lets a member reach
 * it on purpose, and the settings service refuses them in a sentence of its own,
 * which is followed here from the guard to the table.
 */
import { ForbiddenException, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { Role } from '@postgear/db';
import { CHENNAI, PARIS } from '@postgear/discover-engine';

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { userOrganization: { findFirst: jest.fn() }, user: { findUnique: jest.fn() } },
}));

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DiscoverController } from './discover.controller';
import type { DiscoverService } from './discover.service';
import { FEED_KINDS, type FeedQuery } from './dto/discover.schema';
import type { UpdateSettingsInput } from './dto/settings.schema';
import type { LocalityService } from './locality.service';
import type { DiscoverSettingsRepository } from './settings.repository';
import { DiscoverSettingsService } from './settings.service';

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

const READS = ['status', 'locality', 'search', 'feed', 'settings'];
/** The one route that changes anything. */
const SAVE = 'saveSettings';
const ROUTES = [...READS, SAVE];
const ORG_ID = 'org-1';
const SENTENCE = 'Only workspace admins can change the workspace place.';
const user = { id: 'u1', email: 'a@x.com', isSuperAdmin: false, onboardingCompletedAt: null };
const config = { get: (_key: string, fallback: string) => fallback } as unknown as ConfigService;

function routesOf(): string[] {
  const proto = DiscoverController.prototype as unknown as Record<string, object>;
  return Object.getOwnPropertyNames(proto).filter(
    (name) =>
      name !== 'constructor' &&
      typeof proto[name] === 'function' &&
      Reflect.getMetadata(PATH_METADATA, proto[name]) !== undefined,
  );
}

function contextFor(name: string, request: object) {
  const proto = DiscoverController.prototype as unknown as Record<string, object>;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => proto[name],
    getClass: () => DiscoverController,
  } as never;
}

function isPublic(name: string): boolean {
  const proto = DiscoverController.prototype as unknown as Record<string, object>;
  return (
    new Reflector().getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      proto[name] as never,
      DiscoverController,
    ]) === true
  );
}

describe('Discover routes', () => {
  it('lists every route in the table, and nothing that is not a route', () => {
    expect(routesOf().sort()).toEqual([...ROUTES].sort());
  });

  it.each(READS)('lets a member read %s', async (name) => {
    prisma.userOrganization.findFirst.mockResolvedValue({
      organizationId: ORG_ID,
      role: Role.USER,
    });
    const guard = new RolesGuard(new Reflector(), config);

    await expect(
      guard.canActivate(contextFor(name, { user, cookies: { pg_org: ORG_ID } })),
    ).resolves.toBe(true);
  });

  it('reads and saves the settings at one address, and saving is the only route that is not a read', () => {
    const proto = DiscoverController.prototype as unknown as Record<string, object>;
    const verbOf = (name: string) => Reflect.getMetadata(METHOD_METADATA, proto[name]);

    expect(Reflect.getMetadata(PATH_METADATA, proto.settings)).toBe('settings');
    expect(Reflect.getMetadata(PATH_METADATA, proto[SAVE])).toBe('settings');
    expect(verbOf(SAVE)).toBe(RequestMethod.PATCH);
    for (const name of READS) expect(verbOf(name)).toBe(RequestMethod.GET);
  });

  it.each([
    ["a member, so that the refusal can be the sentence and not the guard's own", Role.USER],
    ['an admin', Role.ADMIN],
  ])('lets %s through the guard to save the settings', async (_name, role) => {
    prisma.userOrganization.findFirst.mockResolvedValue({ organizationId: ORG_ID, role });
    const guard = new RolesGuard(new Reflector(), config);
    const request: { user: typeof user; cookies: object; activeOrg?: unknown } = {
      user,
      cookies: { pg_org: ORG_ID },
    };

    await expect(guard.canActivate(contextFor(SAVE, request))).resolves.toBe(true);
    // The role the route then judges is the one the guard read from the membership.
    expect(request.activeOrg).toEqual({ id: ORG_ID, role });
  });

  it.each(ROUTES)('refuses %s to someone outside the workspace', async (name) => {
    prisma.userOrganization.findFirst.mockResolvedValue(null);
    const guard = new RolesGuard(new Reflector(), config);

    await expect(
      guard.canActivate(contextFor(name, { user, cookies: { pg_org: ORG_ID } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each(ROUTES)('refuses %s with no session', async (name) => {
    expect(isPublic(name)).toBe(false);
    const jwt = { verifyAsync: jest.fn() } as unknown as JwtService;
    const guard = new JwtAuthGuard(jwt, new Reflector(), config);

    await expect(guard.canActivate(contextFor(name, { cookies: {}, headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('DiscoverController', () => {
  const org = { id: ORG_ID, role: Role.USER };
  /** Stands in for whatever the settings service answers. */
  const SAVED = { city: 'Chennai', languages: ['ta', 'en'] };
  const CHENNAI_BODY: UpdateSettingsInput = {
    countryCode: 'IN',
    regionCode: 'IN-TN',
    regionName: 'Tamil Nadu',
    city: 'Chennai',
    timeZone: 'Asia/Kolkata',
    locationSource: 'SEARCH',
  };

  function build() {
    const discover = {
      status: jest.fn(() => ({ simulation: true })),
      feed: jest.fn(async (): Promise<unknown> => ({ kind: 'trending', groups: [] })),
    };
    const localities = {
      fromTimeZone: jest.fn(() => CHENNAI),
      reverse: jest.fn(async () => CHENNAI),
      search: jest.fn(async () => [PARIS]),
    };
    const settings = {
      get: jest.fn(async (): Promise<unknown> => SAVED),
      update: jest.fn(async (): Promise<unknown> => SAVED),
    };
    const controller = new DiscoverController(
      discover as unknown as DiscoverService,
      localities as unknown as LocalityService,
      settings as unknown as DiscoverSettingsService,
    );
    return { controller, discover, localities, settings };
  }

  it('wraps the status in a named key', () => {
    expect(build().controller.status()).toEqual({ status: { simulation: true } });
  });

  it('reads a zone without asking anyone', async () => {
    const { controller, localities } = build();

    const { locality } = await controller.locality(org, { tz: 'Asia/Kolkata' });

    expect(localities.fromTimeZone).toHaveBeenCalledWith('Asia/Kolkata');
    expect(localities.reverse).not.toHaveBeenCalled();
    expect(locality.city).toBe('Chennai');
  });

  it('counts a position against the active workspace', async () => {
    const { controller, localities } = build();

    await controller.locality(org, { lat: 13.08, lng: 80.27 });

    expect(localities.reverse).toHaveBeenCalledWith(ORG_ID, 13.08, 80.27);
  });

  it('adds the languages the News chip can offer to every place it answers', async () => {
    const { controller } = build();

    const reversed = await controller.locality(org, { lat: 13.08, lng: 80.27 });
    const found = await controller.search(org, { q: 'paris' });

    expect(reversed.locality.newsLanguages).toEqual(['ta', 'en']);
    expect(reversed.locality.languages).toEqual(['ta', 'en']);
    // France has no English edition, so the chip offers only what can really be read.
    expect(found.localities[0].languages).toEqual(['fr', 'en']);
    expect(found.localities[0].newsLanguages).toEqual(['fr']);
  });

  it('answers a search that found places with no message', async () => {
    const { controller } = build();

    await expect(controller.search(org, { q: 'paris' })).resolves.not.toHaveProperty('message');
  });

  it('says what to try when a search finds nothing', async () => {
    const { controller, localities } = build();
    localities.search.mockResolvedValue([]);

    await expect(controller.search(org, { q: 'nowhere' })).resolves.toEqual({
      localities: [],
      message: "No places found for 'nowhere'. Try the city's English name.",
    });
  });

  it.each(FEED_KINDS)('passes %s through, and answers what the feed answered', async (kind) => {
    const { controller, discover } = build();
    const answered = { kind, groups: [], unavailable: [] };
    discover.feed.mockResolvedValue(answered);

    await expect(controller.feed(org, { kind, country: 'IN', region: 'IN-TN' })).resolves.toBe(
      answered,
    );

    expect(discover.feed).toHaveBeenCalledTimes(1);
    expect(discover.feed).toHaveBeenCalledWith(ORG_ID, {
      kind,
      language: 'ta',
      topic: undefined,
      locality: expect.objectContaining({ countryCode: 'IN', countryName: 'India' }),
    });
  });

  it('answers videos that are not set up as an answer, not as an error of its own', async () => {
    const { controller, discover } = build();
    const notSetUp = { kind: 'videos', groups: [], unavailable: [], reason: 'not_set_up' };
    discover.feed.mockResolvedValue(notSetUp);

    await expect(controller.feed(org, { kind: 'videos', country: 'IN' })).resolves.toEqual({
      kind: 'videos',
      groups: [],
      unavailable: [],
      reason: 'not_set_up',
    });
  });

  it.each(['videos', 'festivals'] as const)(
    'asks for %s Worldwide without making up a place',
    async (kind) => {
      const { controller, discover } = build();

      await controller.feed(org, { kind });

      expect(discover.feed).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({
          kind,
          language: 'en',
          locality: expect.objectContaining({ countryCode: null, timeZone: null }),
        }),
      );
    },
  );

  it('hands the zone on as it came, since the feed is where it is read', async () => {
    const { controller, discover } = build();

    // The query checks a zone for shape only, so this is one it lets through.
    await controller.feed(org, { kind: 'festivals', country: 'IN', tz: 'Not/AZone' });

    expect(discover.feed).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({
        kind: 'festivals',
        locality: expect.objectContaining({ countryCode: 'IN', timeZone: 'Not/AZone' }),
      }),
    );
  });

  it('lets a refusal from the feed through as it is', async () => {
    const { controller, discover } = build();
    const refusal = new Error('That is a lot of new places at once. Try again in a moment.');
    discover.feed.mockRejectedValue(refusal);

    await expect(controller.feed(org, { kind: 'festivals', country: 'IN' })).rejects.toBe(refusal);
  });

  it('builds the place from the query, with its languages', () => {
    const { controller, discover } = build();
    const query: FeedQuery = {
      kind: 'trending',
      country: 'IN',
      region: 'IN-TN',
      city: 'Chennai',
      tz: 'Asia/Calcutta',
    };

    controller.feed(org, query);

    expect(discover.feed).toHaveBeenCalledWith(ORG_ID, {
      kind: 'trending',
      language: 'ta',
      topic: undefined,
      locality: {
        countryCode: 'IN',
        countryName: 'India',
        regionCode: 'IN-TN',
        regionName: 'Tamil Nadu',
        city: 'Chennai',
        timeZone: 'Asia/Calcutta',
        languages: ['ta', 'en'],
      },
    });
  });

  it('takes the language and the region name the page sends', () => {
    const { controller, discover } = build();

    controller.feed(org, {
      kind: 'news',
      country: 'IN',
      region: 'IN-TN',
      regionName: 'TN',
      lang: 'en',
      topic: 'SPORTS',
    });

    expect(discover.feed).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({
        language: 'en',
        topic: 'SPORTS',
        locality: expect.objectContaining({ regionName: 'TN' }),
      }),
    );
  });

  it('reads no country as Worldwide, in English', () => {
    const { controller, discover } = build();

    controller.feed(org, { kind: 'news' });

    expect(discover.feed).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({
        language: 'en',
        locality: expect.objectContaining({ countryCode: null, city: null }),
      }),
    );
  });

  it.each(FEED_KINDS)(
    "asks for the workspace's switches on %s when the page says so",
    async (kind) => {
      const { controller, discover } = build();

      await controller.feed(org, { kind, country: 'IN', useWorkspaceSources: '1' });

      expect(discover.feed).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({ kind, workspaceSources: true }),
      );
    },
  );

  it('says nothing about switches for a request that did not ask, so its answer is unchanged', async () => {
    const { controller, discover } = build();

    await controller.feed(org, { kind: 'trending', country: 'IN' });

    const handed = discover.feed.mock.calls[0] as unknown[];
    expect(handed).toHaveLength(2);
    expect(handed[1]).not.toHaveProperty('workspaceSources');
  });

  it('answers the hidden groups the feed answered, and takes the workspace only from the session', async () => {
    const { controller, discover } = build();
    const answered = { kind: 'videos', groups: [], unavailable: [], hidden: ['videos'] };
    discover.feed.mockResolvedValue(answered);

    await expect(
      controller.feed(org, { kind: 'videos', country: 'IN', useWorkspaceSources: '1' }),
    ).resolves.toBe(answered);
    expect((discover.feed.mock.calls[0] as unknown[])[0]).toBe(ORG_ID);
  });

  it('wraps the settings of the active workspace in a named key', async () => {
    const { controller, settings } = build();

    await expect(controller.settings(org)).resolves.toEqual({ settings: SAVED });

    expect(settings.get).toHaveBeenCalledTimes(1);
    expect(settings.get).toHaveBeenCalledWith(ORG_ID);
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('hands a save on with the workspace, the person and the body, and wraps what was saved', async () => {
    const { controller, settings } = build();
    const admin = { id: ORG_ID, role: Role.ADMIN };

    await expect(controller.saveSettings(admin, user, CHENNAI_BODY)).resolves.toEqual({
      settings: SAVED,
    });

    expect(settings.update).toHaveBeenCalledTimes(1);
    expect(settings.update).toHaveBeenCalledWith(admin, user, CHENNAI_BODY);
  });

  it('lets a refusal to save through as it is', async () => {
    const { controller, settings } = build();
    const refusal = new ForbiddenException(SENTENCE);
    settings.update.mockRejectedValue(refusal);

    await expect(controller.saveSettings(org, user, CHENNAI_BODY)).rejects.toBe(refusal);
  });
});

describe('saving the settings, from the guard to the table', () => {
  const proto = DiscoverController.prototype as unknown as Record<string, object>;
  const body: UpdateSettingsInput = {
    countryCode: 'IN',
    city: 'Chennai',
    locationSource: 'SEARCH',
  };

  /** The real guard, the real controller and the real settings service, over a table that only counts. */
  function build() {
    const table = {
      find: jest.fn(async () => null),
      upsert: jest.fn(async () => ({
        countryCode: 'IN',
        regionCode: null,
        regionName: null,
        city: 'Chennai',
        timeZone: null,
        languages: [],
        topics: [],
        sources: null,
        locationSource: 'SEARCH',
        updatedAt: new Date('2026-11-10T10:00:00.000Z'),
      })),
    };
    const controller = new DiscoverController(
      {} as DiscoverService,
      {} as LocalityService,
      new DiscoverSettingsService(table as unknown as DiscoverSettingsRepository),
    );
    return { controller, table, guard: new RolesGuard(new Reflector(), config) };
  }

  /** Goes through the guard as the request would, and hands back who it says is asking. */
  async function admitted(guard: RolesGuard, asking: typeof user) {
    const request: { user: typeof user; cookies: object; activeOrg?: { id: string; role: Role } } =
      { user: asking, cookies: { pg_org: ORG_ID } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => proto[SAVE],
      getClass: () => DiscoverController,
    } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    if (!request.activeOrg) throw new Error('The guard resolved no workspace.');
    return request.activeOrg;
  }

  it('refuses a member with the sentence and status 403, and writes nothing', async () => {
    prisma.userOrganization.findFirst.mockResolvedValue({
      organizationId: ORG_ID,
      role: Role.USER,
    });
    const { controller, table, guard } = build();
    const org = await admitted(guard, user);

    const error = await controller.saveSettings(org, user, body).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getStatus()).toBe(403);
    expect((error as ForbiddenException).message).toBe(SENTENCE);
    expect(table.upsert).not.toHaveBeenCalled();
    expect(table.find).not.toHaveBeenCalled();
  });

  it('saves for an admin, under the workspace the guard resolved and as the person asking', async () => {
    prisma.userOrganization.findFirst.mockResolvedValue({
      organizationId: ORG_ID,
      role: Role.ADMIN,
    });
    const { controller, table, guard } = build();
    const org = await admitted(guard, user);

    const { settings } = await controller.saveSettings(org, user, body);

    expect(settings).toMatchObject({
      countryCode: 'IN',
      city: 'Chennai',
      locationSource: 'SEARCH',
    });
    expect(settings.place).toMatchObject({ countryName: 'India', city: 'Chennai' });
    expect(table.upsert).toHaveBeenCalledWith(
      ORG_ID,
      'u1',
      expect.objectContaining({ city: 'Chennai' }),
    );
  });

  it('saves for a super admin who holds no membership in the workspace', async () => {
    prisma.userOrganization.findFirst.mockResolvedValue(null);
    const { controller, table, guard } = build();
    const root = { ...user, id: 'root', isSuperAdmin: true };
    const org = await admitted(guard, root);

    await controller.saveSettings(org, root, body);

    expect(org).toEqual({ id: ORG_ID, role: 'SUPERADMIN' });
    expect(table.upsert).toHaveBeenCalledWith(ORG_ID, 'root', expect.any(Object));
  });
});
