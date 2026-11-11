/**
 * Who may call the reader, read from the real route metadata through the real
 * guards: any member, nobody without a session, nothing public. Then what the
 * engine is built as: which world it reads in, and whether Google News links
 * are resolved.
 */
import { ForbiddenException, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { Role } from '@postgear/db';
import { GOOGLE_NEWS_BATCH_URL, READER_SAMPLE } from '@postgear/discover-engine';

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { userOrganization: { findFirst: jest.fn() }, user: { findUnique: jest.fn() } },
}));

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { readSchema, resolveLinkSchema } from './dto/reader.schema';
import { ReaderController } from './reader.controller';
import { createReaderEngine } from './reader.engine';
import type { ReaderService } from './reader.service';

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

const ROUTES = ['read', 'resolveLink'];
const ORG_ID = 'org-1';
const user = { id: 'u1', email: 'a@x.com', isSuperAdmin: false, onboardingCompletedAt: null };
const config = { get: (_key: string, fallback: string) => fallback } as unknown as ConfigService;
const proto = ReaderController.prototype as unknown as Record<string, object>;

function contextFor(name: string, request: object) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => proto[name],
    getClass: () => ReaderController,
  } as never;
}

describe('Reader routes', () => {
  it('lists every route in the table, and nothing that is not a route', () => {
    const routes = Object.getOwnPropertyNames(proto).filter(
      (name) =>
        name !== 'constructor' &&
        typeof proto[name] === 'function' &&
        Reflect.getMetadata(PATH_METADATA, proto[name]) !== undefined,
    );

    expect(routes.sort()).toEqual([...ROUTES].sort());
  });

  it('takes the address in a POST body, never in a query string, and answers 200', () => {
    const at = (name: string) => [
      RequestMethod[Reflect.getMetadata(METHOD_METADATA, proto[name])],
      Reflect.getMetadata(PATH_METADATA, proto[name]),
      Reflect.getMetadata(HTTP_CODE_METADATA, proto[name]),
    ];

    expect(Reflect.getMetadata(PATH_METADATA, ReaderController)).toBe('discover');
    expect(at('read')).toEqual(['POST', 'read', 200]);
    expect(at('resolveLink')).toEqual(['POST', 'resolve-link', 200]);
  });

  it.each(ROUTES)('lets a member call %s', async (name) => {
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
    const isPublic = new Reflector().getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      proto[name] as never,
      ReaderController,
    ]);
    expect(isPublic).not.toBe(true);

    const jwt = { verifyAsync: jest.fn() } as unknown as JwtService;
    const guard = new JwtAuthGuard(jwt, new Reflector(), config);

    await expect(guard.canActivate(contextFor(name, { cookies: {}, headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('ReaderController', () => {
  const org = { id: ORG_ID, role: Role.USER };

  it('counts a read against the active workspace and wraps the article in a named key', async () => {
    const article = { title: 'A story', url: 'https://news.example/a' };
    const service = { read: jest.fn(async () => article), resolveLink: jest.fn() };
    const controller = new ReaderController(service as unknown as ReaderService);

    await expect(controller.read(org, { url: 'news.example/a' })).resolves.toEqual({ article });
    expect(service.read).toHaveBeenCalledWith(ORG_ID, 'news.example/a');
  });

  it('answers a resolved link as its address', async () => {
    const service = {
      read: jest.fn(),
      resolveLink: jest.fn(async () => 'https://publisher.example/story'),
    };
    const controller = new ReaderController(service as unknown as ReaderService);

    await expect(
      controller.resolveLink(org, { url: 'https://news.google.com/rss/articles/CBMiX' }),
    ).resolves.toEqual({ url: 'https://publisher.example/story' });
    expect(service.resolveLink).toHaveBeenCalledWith(
      ORG_ID,
      'https://news.google.com/rss/articles/CBMiX',
    );
  });
});

describe('the reader bodies', () => {
  it.each([
    ['read', readSchema],
    ['resolve-link', resolveLinkSchema],
  ])('%s takes one address, trimmed, and nothing else', (_name, schema) => {
    expect(schema.parse({ url: '  news.example/story  ' })).toEqual({ url: 'news.example/story' });

    for (const body of [
      {},
      { url: '' },
      { url: '   ' },
      { url: 'two words.example' },
      { url: 'news.example/a\nHost: evil' },
      { url: 42 },
      { url: 'news.example', render: true },
      { url: `https://news.example/${'a'.repeat(5_000)}` },
    ]) {
      expect(schema.safeParse(body).success).toBe(false);
    }
  });
});

describe('createReaderEngine', () => {
  const base = { DISCOVER_GEOCODER_USER_AGENT: 'PostGear/1.0 (test)' } as const;
  const init = { accept: 'text/html', signal: AbortSignal.timeout(5_000), maxBytes: 1024 * 1024 };

  it('reads only sample pages under simulation, whatever it is asked for', async () => {
    const engine = createReaderEngine({
      ...base,
      DISCOVER_SIMULATION: 'true',
      DISCOVER_LINK_DECODE: 'true',
    });

    expect(engine.simulation).toBe(true);
    const sample = await engine.fetch(READER_SAMPLE.article, init);
    const standIn = await engine.fetch('https://www.a-real-newspaper.example/story/123', init);
    expect(sample.body).toContain('Sample: written by hand');
    // A stranger's address is never fetched: it answers the same sample.
    expect(standIn).toMatchObject({ status: 200, body: sample.body });
    await expect(engine.fetch(READER_SAMPLE.missing, init)).resolves.toMatchObject({ status: 404 });

    const batch = await engine.fetch(GOOGLE_NEWS_BATCH_URL, {
      ...init,
      post: { body: 'f.req=x', contentType: 'application/x-www-form-urlencoded' },
    });
    expect(batch.body).toContain('garturlres');
  });

  it('still refuses private addresses under simulation, and looks no name up', async () => {
    const engine = createReaderEngine({
      ...base,
      DISCOVER_SIMULATION: 'true',
      DISCOVER_LINK_DECODE: 'true',
    });

    for (const url of ['http://10.0.0.1/', 'http://127.0.0.1/', 'http://localhost/']) {
      await expect(engine.guard(url)).resolves.toMatchObject({ ok: false });
    }
    // `.example` has no DNS: a real lookup would fail closed.
    await expect(engine.guard(READER_SAMPLE.article)).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ['true', true],
    ['false', false],
  ] as const)('reads DISCOVER_LINK_DECODE=%s', (flag, expected) => {
    const engine = createReaderEngine({
      ...base,
      DISCOVER_SIMULATION: 'false',
      DISCOVER_LINK_DECODE: flag,
    });

    expect(engine.linkDecode).toBe(expected);
    expect(engine.simulation).toBe(false);
  });
});
