/**
 * The per-key ceiling against a fake store: the sixtieth call passes, the
 * sixty-first is a 429 with a plain `Retry-After`, the message is the
 * contract's, the trip is logged, and keys do not share a bucket.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
// Not re-exported from the package root; the house `resilient-throttler.storage.ts` imports it the same way.
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { securityLogger } from '../../../common/logging/security-logger';
import { DEVELOPERS_MESSAGES } from '../developers.messages';
import { API_KEY_THROTTLER, ApiKeyThrottlerGuard } from './api-key-throttler.guard';

const LIMIT = 60;

/** Counts hits per key for the life of the test; blocked once past the limit. */
class FakeStorage implements ThrottlerStorage {
  readonly hits = new Map<string, number>();
  readonly calls: { key: string; ttl: number; limit: number; name: string }[] = [];

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const totalHits = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, totalHits);
    this.calls.push({ key, ttl, limit, name: throttlerName });

    return {
      totalHits,
      timeToExpire: 42,
      isBlocked: totalHits > limit,
      timeToBlockExpire: 42,
    };
  }
}

function makeContext(keyId: string | undefined, path = '/v1/me') {
  const headers: Record<string, string> = {};
  const req: Record<string, unknown> = {
    method: 'GET',
    path,
    headers,
    ip: '127.0.0.1',
    apiKey: keyId ? { id: keyId, name: 'CI', prefix: 'pg_abcdefgh', organizationId: 'org' } : undefined,
  };
  const res = { header: jest.fn() };

  return {
    req,
    res,
    context: {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      getHandler: () => function handler() {},
      getClass: () => class V1MeController {},
      getType: () => 'http',
    },
  };
}

async function makeGuard(storage: FakeStorage): Promise<ApiKeyThrottlerGuard> {
  const options: ThrottlerModuleOptions = {
    throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
    errorMessage: 'Too many requests. Please slow down and try again.',
  };
  const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
  const config = { get: (key: string) => (key === 'API_RATE_LIMIT_PER_MIN' ? LIMIT : undefined) };

  const guard = new ApiKeyThrottlerGuard(
    options,
    storage,
    reflector,
    config as unknown as ConfigService<never, true>,
  );
  await guard.onModuleInit();

  return guard;
}

describe('ApiKeyThrottlerGuard', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('counts against the apiKey throttler with the configured limit, not the default one', async () => {
    const storage = new FakeStorage();
    const guard = await makeGuard(storage);

    await guard.canActivate(makeContext('key-1').context as never);

    expect(storage.calls).toHaveLength(1);
    expect(storage.calls[0]).toMatchObject({ name: API_KEY_THROTTLER, limit: LIMIT, ttl: 60_000 });
  });

  it('allows the sixtieth call and refuses the sixty-first with 429 and Retry-After', async () => {
    const storage = new FakeStorage();
    const guard = await makeGuard(storage);

    for (let call = 1; call <= LIMIT; call += 1) {
      await expect(guard.canActivate(makeContext('key-1').context as never)).resolves.toBe(true);
    }

    const { context, res } = makeContext('key-1');
    const error = await guard.canActivate(context as never).then(
      () => {
        throw new Error('expected a 429');
      },
      (caught: HttpException) => caught,
    );

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(error.message).toBe(DEVELOPERS_MESSAGES.RATE_LIMITED);
    expect(res.header).toHaveBeenCalledWith('Retry-After', 42);
    // The base guard's suffixed header is still there for clients that read it.
    expect(res.header).toHaveBeenCalledWith(`Retry-After-${API_KEY_THROTTLER}`, 42);
  });

  it('logs a trip by key id and route, never by secret', async () => {
    const storage = new FakeStorage();
    const guard = await makeGuard(storage);
    storage.hits.set(`${API_KEY_THROTTLER}:key-1`, LIMIT);

    await expect(
      guard.canActivate(makeContext('key-1', '/v1/posts').context as never),
    ).rejects.toBeInstanceOf(HttpException);

    expect(warnSpy).toHaveBeenCalledWith('api.throttled', {
      scope: 'apiKey',
      keyId: 'key-1',
      route: 'GET /v1/posts',
      limit: LIMIT,
      hits: LIMIT + 1,
    });
  });

  it('gives every key its own bucket, shared across routes', async () => {
    const storage = new FakeStorage();
    const guard = await makeGuard(storage);

    await guard.canActivate(makeContext('key-1', '/v1/me').context as never);
    await guard.canActivate(makeContext('key-1', '/v1/posts').context as never);
    await guard.canActivate(makeContext('key-2', '/v1/me').context as never);

    expect([...storage.hits.entries()]).toEqual([
      [`${API_KEY_THROTTLER}:key-1`, 2],
      [`${API_KEY_THROTTLER}:key-2`, 1],
    ]);
  });

  it('sets the informational rate-limit headers on an allowed call', async () => {
    const guard = await makeGuard(new FakeStorage());
    const { context, res } = makeContext('key-1');

    await guard.canActivate(context as never);

    expect(res.header).toHaveBeenCalledWith(`X-RateLimit-Limit-${API_KEY_THROTTLER}`, LIMIT);
    expect(res.header).toHaveBeenCalledWith(`X-RateLimit-Remaining-${API_KEY_THROTTLER}`, LIMIT - 1);
  });
});
