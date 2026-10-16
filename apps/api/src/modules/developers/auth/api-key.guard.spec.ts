/**
 * The guard's contract: one message for every refusal, the right things on
 * the request on success, and `lastUsedAt` written at most once a minute.
 */
import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@postgear/db';
import { securityLogger } from '../../../common/logging/security-logger';
import { generateApiKey, hashApiKey } from '../api-keys/api-key.crypto';
import type { ApiKeyLookup, ApiKeysRepository } from '../api-keys/api-keys.repository';
import { DEVELOPERS_MESSAGES } from '../developers.messages';
import { ApiKeyGuard, LAST_USED_WRITE_INTERVAL_MS } from './api-key.guard';

const ORG = 'org-1';

function makeContext(headers: Record<string, string | string[]>) {
  const request: Record<string, unknown> = {
    method: 'GET',
    path: '/v1/me',
    headers,
  };

  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    },
  };
}

function lookup(overrides: Partial<ApiKeyLookup> = {}): ApiKeyLookup {
  return {
    id: 'key-1',
    organizationId: ORG,
    name: 'CI',
    prefix: 'pg_abcdefgh',
    revokedAt: null,
    ...overrides,
  };
}

describe('ApiKeyGuard', () => {
  let repository: { findByHash: jest.Mock; touchLastUsed: jest.Mock };
  let guard: ApiKeyGuard;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    repository = {
      findByHash: jest.fn().mockResolvedValue(null),
      touchLastUsed: jest.fn().mockResolvedValue(undefined),
    };
    guard = new ApiKeyGuard(repository as unknown as ApiKeysRepository);
    warnSpy = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  async function refusal(headers: Record<string, string>): Promise<UnauthorizedException> {
    const { context } = makeContext(headers);
    return guard.canActivate(context as never).then(
      () => {
        throw new Error('expected the guard to refuse');
      },
      (error: UnauthorizedException) => error,
    );
  }

  it('refuses a request with no key, without touching the database', async () => {
    const error = await refusal({});

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.message).toBe(DEVELOPERS_MESSAGES.INVALID_API_KEY);
    expect(repository.findByHash).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('apikey.rejected', expect.objectContaining({ reason: 'missing' }));
  });

  it('refuses a malformed key without a lookup and without logging a prefix', async () => {
    const error = await refusal({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.notakey' });

    expect(error.message).toBe(DEVELOPERS_MESSAGES.INVALID_API_KEY);
    expect(repository.findByHash).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'apikey.rejected',
      expect.objectContaining({ reason: 'malformed' }),
    );
    expect(warnSpy.mock.calls[0][1]).not.toHaveProperty('prefix');
  });

  it('refuses an unknown key and logs its prefix', async () => {
    const { secret } = generateApiKey();
    const error = await refusal({ authorization: `Bearer ${secret}` });

    expect(error.message).toBe(DEVELOPERS_MESSAGES.INVALID_API_KEY);
    expect(repository.findByHash).toHaveBeenCalledWith(hashApiKey(secret));
    expect(warnSpy).toHaveBeenCalledWith('apikey.rejected', {
      reason: 'unknown',
      prefix: secret.slice(0, 11),
      route: 'GET /v1/me',
    });
    // The secret itself never reaches the log.
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(secret);
  });

  it('refuses a revoked key with the same message as an unknown one', async () => {
    const { secret } = generateApiKey();
    repository.findByHash.mockResolvedValue(lookup({ revokedAt: new Date() }));

    const error = await refusal({ authorization: `Bearer ${secret}` });

    expect(error.message).toBe(DEVELOPERS_MESSAGES.INVALID_API_KEY);
    expect(warnSpy).toHaveBeenCalledWith(
      'apikey.rejected',
      expect.objectContaining({ reason: 'revoked', keyId: 'key-1', prefix: 'pg_abcdefgh' }),
    );
    expect(repository.touchLastUsed).not.toHaveBeenCalled();
  });

  it('accepts a live key and attaches the workspace as ADMIN and the key principal', async () => {
    const { secret } = generateApiKey();
    repository.findByHash.mockResolvedValue(lookup());
    const { context, request } = makeContext({ authorization: `Bearer ${secret}` });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);

    expect(request.activeOrg).toEqual({ id: ORG, role: Role.ADMIN });
    expect(request.apiKey).toEqual({
      id: 'key-1',
      name: 'CI',
      prefix: 'pg_abcdefgh',
      organizationId: ORG,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('accepts the key from X-API-Key when there is no bearer header', async () => {
    const { secret } = generateApiKey();
    repository.findByHash.mockResolvedValue(lookup());
    const { context, request } = makeContext({ 'x-api-key': secret });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.activeOrg).toEqual({ id: ORG, role: Role.ADMIN });
  });

  it('writes lastUsedAt once per key per minute, with the window in the query', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-16T10:00:00Z'));
    const { secret } = generateApiKey();
    repository.findByHash.mockResolvedValue(lookup());
    const headers = { authorization: `Bearer ${secret}` };

    await guard.canActivate(makeContext(headers).context as never);
    await guard.canActivate(makeContext(headers).context as never);
    await guard.canActivate(makeContext(headers).context as never);

    expect(repository.touchLastUsed).toHaveBeenCalledTimes(1);
    expect(repository.touchLastUsed).toHaveBeenCalledWith(
      'key-1',
      new Date('2026-10-16T10:00:00Z'),
      new Date(new Date('2026-10-16T10:00:00Z').getTime() - LAST_USED_WRITE_INTERVAL_MS),
    );

    jest.setSystemTime(new Date('2026-10-16T10:01:01Z'));
    await guard.canActivate(makeContext(headers).context as never);

    expect(repository.touchLastUsed).toHaveBeenCalledTimes(2);
  });

  it('keeps separate write windows per key', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-16T10:00:00Z'));
    const first = generateApiKey();
    const second = generateApiKey();
    repository.findByHash.mockImplementation(async (hash: string) =>
      lookup({ id: hash === first.keyHash ? 'key-a' : 'key-b' }),
    );

    await guard.canActivate(makeContext({ authorization: `Bearer ${first.secret}` }).context as never);
    await guard.canActivate(makeContext({ authorization: `Bearer ${second.secret}` }).context as never);

    expect(repository.touchLastUsed).toHaveBeenCalledTimes(2);
  });

  it('never fails a request because the timestamp write failed', async () => {
    const { secret } = generateApiKey();
    repository.findByHash.mockResolvedValue(lookup());
    repository.touchLastUsed.mockRejectedValue(new Error('database away'));

    await expect(
      guard.canActivate(makeContext({ authorization: `Bearer ${secret}` }).context as never),
    ).resolves.toBe(true);
    // Let the rejected promise settle so the catch runs inside the test.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
