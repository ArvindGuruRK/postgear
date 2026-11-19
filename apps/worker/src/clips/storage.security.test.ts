/**
 * Security sweep, Module 20: "Storage", the worker's wiring. The worker builds
 * its private space from the same env mapping it boots with
 * (`boot.ts` and `library/cli.ts`), so production on local disk stops it.
 * The factory itself is proved in
 * packages/storage/src/private/private-storage.factory.test.ts:23.
 */
import { createPrivateStorage, LOCAL_PRIVATE_REFUSED } from '@postgear/storage';
import type { WorkerEnv } from '../config/env';
import { privateStorageConfigFrom } from './config';

describe('Clips security: the worker private space', () => {
  const base = {
    STORAGE_PROVIDER: 'local',
    UPLOAD_DIRECTORY: './uploads',
    API_URL: 'https://api.example.com',
    CLIPS_URL_SECRET: 'x'.repeat(48),
  };

  it('passes NODE_ENV through, so production refuses the local disk', () => {
    const env = { ...base, NODE_ENV: 'production' } as unknown as WorkerEnv;
    expect(privateStorageConfigFrom(env).nodeEnv).toBe('production');
    expect(() => createPrivateStorage(privateStorageConfigFrom(env))).toThrow(
      LOCAL_PRIVATE_REFUSED,
    );
  });
});
