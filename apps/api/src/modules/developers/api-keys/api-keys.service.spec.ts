/**
 * The lifecycle rules: the ten-key ceiling, rotation as revoke-plus-create,
 * idempotent revocation, and a foreign workspace reading as not found.
 *
 * The repository is a fake; the key generator is the real one, so the
 * secrets asserted on are the shape the guard will later accept.
 */
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { securityLogger } from '../../../common/logging/security-logger';
import { looksLikeApiKey } from './api-key.crypto';
import type { ApiKeyRow, ApiKeysRepository, RotateApiKeyRecord } from './api-keys.repository';
import { ApiKeysService, MAX_LIVE_API_KEYS } from './api-keys.service';

const ORG = 'org-1';
const USER = 'user-1';

function row(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: 'key-1',
    organizationId: ORG,
    name: 'CI',
    prefix: 'pg_abcdefgh',
    createdById: USER,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-10-16T10:00:00Z'),
    ...overrides,
  };
}

describe('ApiKeysService', () => {
  let repository: jest.Mocked<
    Pick<ApiKeysRepository, 'listForOrg' | 'countLive' | 'findById' | 'create' | 'revoke' | 'rotate'>
  >;
  let service: ApiKeysService;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    repository = {
      listForOrg: jest.fn().mockResolvedValue([]),
      countLive: jest.fn().mockResolvedValue(0),
      findById: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      revoke: jest.fn(),
      rotate: jest.fn(),
    };
    service = new ApiKeysService(repository as unknown as ApiKeysRepository);
    logSpy = jest.spyOn(securityLogger, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('list', () => {
    it('maps rows to views with ISO dates and keeps revoked keys', async () => {
      repository.listForOrg.mockResolvedValue([
        row({ id: 'new', lastUsedAt: new Date('2026-10-16T12:00:00Z') }),
        row({ id: 'old', revokedAt: new Date('2026-10-15T00:00:00Z') }),
      ]);

      const keys = await service.list(ORG);

      expect(repository.listForOrg).toHaveBeenCalledWith(ORG);
      expect(keys).toEqual([
        {
          id: 'new',
          name: 'CI',
          prefix: 'pg_abcdefgh',
          createdAt: '2026-10-16T10:00:00.000Z',
          lastUsedAt: '2026-10-16T12:00:00.000Z',
          revokedAt: null,
        },
        {
          id: 'old',
          name: 'CI',
          prefix: 'pg_abcdefgh',
          createdAt: '2026-10-16T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: '2026-10-15T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('create', () => {
    it('stores the hash and prefix, returns the secret once, and logs by prefix', async () => {
      repository.create.mockImplementation(async (input) =>
        row({ id: 'key-new', name: input.name, prefix: input.prefix }),
      );

      const result = await service.create(ORG, USER, 'Zapier');

      expect(looksLikeApiKey(result.secret)).toBe(true);
      expect(result.key).toMatchObject({ id: 'key-new', name: 'Zapier' });
      expect(result.key.prefix).toBe(result.secret.slice(0, 11));

      const stored = repository.create.mock.calls[0][0];
      expect(stored).toMatchObject({ orgId: ORG, name: 'Zapier', createdById: USER });
      expect(stored.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored).not.toHaveProperty('secret');

      expect(logSpy).toHaveBeenCalledWith('apikey.created', {
        orgId: ORG,
        keyId: 'key-new',
        prefix: result.key.prefix,
      });
      // The secret never reaches the log, under any key name.
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(result.secret);
    });

    it('refuses an eleventh live key with 422 and writes nothing', async () => {
      repository.countLive.mockResolvedValue(MAX_LIVE_API_KEYS);

      await expect(service.create(ORG, USER, 'One too many')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(repository.create).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('counts live keys only, so revoked ones do not use up the allowance', async () => {
      repository.countLive.mockResolvedValue(MAX_LIVE_API_KEYS - 1);
      repository.create.mockResolvedValue(row({ id: 'key-10' }));

      await expect(service.create(ORG, USER, 'Tenth')).resolves.toMatchObject({
        key: { id: 'key-10' },
      });
    });
  });

  describe('rotate', () => {
    it('revokes the old key and returns the new one with a fresh secret and both ids', async () => {
      repository.findById.mockResolvedValue(row({ id: 'key-old', name: 'CI' }));
      repository.rotate.mockImplementation(async (input: RotateApiKeyRecord) => ({
        created: row({ id: 'key-new', name: input.name, prefix: input.prefix }),
        revoked: row({ id: 'key-old', revokedAt: input.at }),
      }));

      const result = await service.rotate(ORG, USER, 'key-old');

      expect(looksLikeApiKey(result.secret)).toBe(true);
      expect(result.key).toMatchObject({ id: 'key-new', name: 'CI', revokedAt: null });
      expect(result.revokedKeyId).toBe('key-old');

      const written = repository.rotate.mock.calls[0][0];
      expect(written).toMatchObject({ orgId: ORG, oldId: 'key-old', name: 'CI', createdById: USER });
      expect(written.prefix).toBe(result.secret.slice(0, 11));

      expect(logSpy).toHaveBeenCalledWith('apikey.rotated', {
        orgId: ORG,
        keyId: 'key-new',
        prefix: result.key.prefix,
        revokedKeyId: 'key-old',
      });
    });

    it('answers 404 for a key in another workspace', async () => {
      // The repository scopes by org, so a foreign id simply does not exist.
      repository.findById.mockResolvedValue(null);

      await expect(service.rotate(ORG, USER, 'someone-elses')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.rotate).not.toHaveBeenCalled();
    });

    it('answers 422 for a key that is already revoked', async () => {
      repository.findById.mockResolvedValue(row({ revokedAt: new Date() }));

      await expect(service.rotate(ORG, USER, 'key-1')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(repository.rotate).not.toHaveBeenCalled();
    });

    it('answers 422 when the key was revoked between the read and the write', async () => {
      repository.findById.mockResolvedValue(row());
      repository.rotate.mockResolvedValue(null);

      await expect(service.rotate(ORG, USER, 'key-1')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('marks the key revoked and logs it', async () => {
      repository.revoke.mockImplementation(async (_org, id, at) => row({ id, revokedAt: at }));

      const view = await service.revoke(ORG, 'key-1');

      expect(view.revokedAt).not.toBeNull();
      expect(logSpy).toHaveBeenCalledWith('apikey.revoked', {
        orgId: ORG,
        keyId: 'key-1',
        prefix: 'pg_abcdefgh',
      });
    });

    it('is idempotent: a second revoke returns the original timestamp and logs nothing', async () => {
      const earlier = new Date('2026-10-01T00:00:00Z');
      repository.revoke.mockResolvedValue(row({ revokedAt: earlier }));

      const view = await service.revoke(ORG, 'key-1');

      expect(view.revokedAt).toBe(earlier.toISOString());
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('answers 404 for a key in another workspace', async () => {
      repository.revoke.mockResolvedValue(null);

      await expect(service.revoke(ORG, 'someone-elses')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
