/**
 * `setIfAbsent`, which is what a lock stands on, so both of its halves are held to
 * the same promise: the one with no Redis, and the one that must be a single atomic
 * command, since a read followed by a write would let two callers both have the lock.
 */

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const client = {
  set: jest.fn(),
  on: jest.fn(),
  quit: jest.fn(async () => 'OK'),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => client),
}));

function configWith(url?: string): ConfigService {
  return { get: () => url } as unknown as ConfigService;
}

beforeEach(() => {
  client.set.mockReset();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  jest.spyOn(Logger.prototype, 'error').mockImplementation();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('RedisService.setIfAbsent', () => {
  describe('with no Redis', () => {
    const service = () => new RedisService(configWith());

    it('sets a free key and refuses a held one', async () => {
      const redis = service();

      await expect(redis.setIfAbsent('lock', 'a', 20)).resolves.toBe(true);
      await expect(redis.setIfAbsent('lock', 'b', 20)).resolves.toBe(false);
      await expect(redis.get('lock')).resolves.toBe('a');
    });

    it('frees the key when its time is up, and not before', async () => {
      jest.useFakeTimers();
      const redis = service();

      await redis.setIfAbsent('lock', 'a', 20);
      jest.advanceTimersByTime(19_999);
      await expect(redis.setIfAbsent('lock', 'b', 20)).resolves.toBe(false);

      jest.advanceTimersByTime(1);
      await expect(redis.setIfAbsent('lock', 'b', 20)).resolves.toBe(true);
    });

    it('sees a key set the ordinary way', async () => {
      const redis = service();

      await redis.set('lock', 'a', 20);

      await expect(redis.setIfAbsent('lock', 'b', 20)).resolves.toBe(false);
    });
  });

  describe('with Redis', () => {
    const service = () => new RedisService(configWith('redis://localhost:6379'));

    it('sends one atomic command, with its expiry in it', async () => {
      client.set.mockResolvedValue('OK');

      await expect(service().setIfAbsent('lock', 'a', 20)).resolves.toBe(true);

      expect(client.set).toHaveBeenCalledTimes(1);
      expect(client.set).toHaveBeenCalledWith('lock', 'a', 'EX', 20, 'NX');
    });

    it('reads the empty reply as someone else having it', async () => {
      client.set.mockResolvedValue(null);

      await expect(service().setIfAbsent('lock', 'a', 20)).resolves.toBe(false);
    });

    it('falls back to the in-process store when Redis fails', async () => {
      client.set.mockRejectedValue(new Error('connection lost'));
      const redis = service();

      await expect(redis.setIfAbsent('lock', 'a', 20)).resolves.toBe(true);
      await expect(redis.setIfAbsent('lock', 'b', 20)).resolves.toBe(false);
    });
  });
});
