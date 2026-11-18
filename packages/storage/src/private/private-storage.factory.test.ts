/**
 * The private factory: local in development, S3 when asked, and never local
 * in production.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrivateStorage, LOCAL_PRIVATE_REFUSED, localUrlSecret } from './private-storage.factory';
import { LocalPrivateStorage } from './local-private.storage';
import { S3PrivateStorage } from './s3-private.storage';

describe('createPrivateStorage', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'postgear-factory-'));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('refuses the local binding in production, with a plain next step', () => {
    expect(() =>
      createPrivateStorage({
        provider: 'local',
        nodeEnv: 'production',
        uploadDirectory: join(base, 'uploads'),
        apiUrl: 'http://api',
        urlSecret: 'x'.repeat(40),
      }),
    ).toThrow(LOCAL_PRIVATE_REFUSED);
    expect(LOCAL_PRIVATE_REFUSED).toBe('Clips needs an S3 bucket in production: set the S3 variables.');
  });

  it('builds the local binding beside the uploads in development', () => {
    const storage = createPrivateStorage({
      provider: 'local',
      nodeEnv: 'development',
      uploadDirectory: join(base, 'uploads'),
      apiUrl: 'http://api',
      urlSecret: 'x'.repeat(40),
    });

    expect(storage).toBeInstanceOf(LocalPrivateStorage);
    expect((storage as LocalPrivateStorage).directory).toBe(join(base, 'uploads-private'));
  });

  it('keeps one development secret on disk when none is configured', async () => {
    const folder = join(base, 'uploads-private');
    const first = localUrlSecret(folder);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(localUrlSecret(folder)).toBe(first);
    expect((await readFile(join(folder, '.url-secret'), 'utf8')).trim()).toBe(first);
  });

  it('builds the S3 binding on the private bucket, defaulting its name', () => {
    const storage = createPrivateStorage({
      provider: 's3',
      nodeEnv: 'production',
      apiUrl: 'http://api',
      s3: { region: 'auto', accessKeyId: 'key', secretAccessKey: 'secret' },
    });
    expect(storage).toBeInstanceOf(S3PrivateStorage);
    expect(storage.kind).toBe('s3');
  });

  it('refuses S3 without a key pair', () => {
    expect(() =>
      createPrivateStorage({
        provider: 's3',
        nodeEnv: 'development',
        apiUrl: 'http://api',
        s3: { region: 'auto' },
      }),
    ).toThrow(/S3_ACCESS_KEY/);
  });
});
