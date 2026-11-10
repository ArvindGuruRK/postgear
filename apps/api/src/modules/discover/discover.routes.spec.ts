/**
 * Who may call what, read from the real route metadata through the real guards, in
 * the shape of `automations.routes.spec.ts`: any member may read everything, nothing
 * is public, and a new route can only be added by adding it to this table. Then what
 * the controller itself decides, which is little on purpose.
 */
import { ForbiddenException, type HttpException, UnauthorizedException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
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
import type { FeedQuery } from './dto/discover.schema';
import type { LocalityService } from './locality.service';

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

const ROUTES = ['status', 'locality', 'search', 'feed'];
const ORG_ID = 'org-1';
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

  it.each(ROUTES)('lets a member read %s', async (name) => {
    prisma.userOrganization.findFirst.mockResolvedValue({
      organizationId: ORG_ID,
      role: Role.USER,
    });
    const guard = new RolesGuard(new Reflector(), config);

    await expect(
      guard.canActivate(contextFor(name, { user, cookies: { pg_org: ORG_ID } })),
    ).resolves.toBe(true);
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

  function build() {
    const discover = {
      status: jest.fn(() => ({ simulation: true })),
      feed: jest.fn(async () => ({ kind: 'trending', groups: [] })),
    };
    const localities = {
      fromTimeZone: jest.fn(() => CHENNAI),
      reverse: jest.fn(async () => CHENNAI),
      search: jest.fn(async () => [PARIS]),
    };
    const controller = new DiscoverController(
      discover as unknown as DiscoverService,
      localities as unknown as LocalityService,
    );
    return { controller, discover, localities };
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

  it.each(['videos', 'festivals'] as const)('says %s are not here yet', (kind) => {
    const { controller, discover } = build();

    let error: HttpException | undefined;
    try {
      controller.feed(org, { kind });
    } catch (caught) {
      error = caught as HttpException;
    }

    expect(error?.getStatus()).toBe(501);
    expect(error?.message).toBe('Arrives in a later step of this sprint.');
    expect(discover.feed).not.toHaveBeenCalled();
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
});
