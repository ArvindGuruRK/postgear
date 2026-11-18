/**
 * The API's storage settings: the storage code and its own tests moved to
 * `@postgear/storage`; what stays here is the env schema the API boots with.
 */
import { validateEnv } from '../../../config/env';

describe('storage environment validation', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost/db',
    JWT_SECRET: 'x'.repeat(32),
    ENCRYPTION_KEY_AES256: 'a'.repeat(64),
  };

  it('boots with local storage and no S3 settings', () => {
    expect(validateEnv(base).STORAGE_PROVIDER).toBe('local');
  });

  it('refuses to boot with half an S3 configuration, naming each missing setting', () => {
    expect(() => validateEnv({ ...base, STORAGE_PROVIDER: 's3', S3_BUCKET_NAME: 'media' })).toThrow(
      /S3_ACCESS_KEY[\s\S]*S3_SECRET_KEY[\s\S]*S3_PUBLIC_URL/,
    );
  });
});
