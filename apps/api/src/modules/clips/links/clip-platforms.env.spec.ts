/**
 * `CLIPS_PLATFORMS` (Sprint 13, Module 12): any id of the sites table, the
 * default is every site that is on by default (D13-08), and a site with no
 * yt-dlp extractor (Threads) may be switched on under simulation only.
 */
import { DEFAULT_ON_SITES } from '@postgear/video-engine';
import { validateEnv } from '../../../config/env';

const base = {
  DATABASE_URL: 'postgresql://localhost/db',
  JWT_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY_AES256: 'a'.repeat(64),
};

function boot(env: Record<string, string>): string {
  try {
    validateEnv({ ...base, ...env });
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('CLIPS_PLATFORMS', () => {
  it('defaults to the twelve sites that are on, with the four off ones and Threads left out', () => {
    const env = validateEnv(base);
    expect(env.CLIPS_PLATFORMS).toEqual([...DEFAULT_ON_SITES]);
    expect(env.CLIPS_PLATFORMS).toHaveLength(12);
    for (const off of ['tiktok', 'instagram', 'zoom', 'dropbox', 'threads']) {
      expect(env.CLIPS_PLATFORMS).not.toContain(off);
    }
  });

  it('takes any site id, and refuses one that is not in the table', () => {
    expect(validateEnv({ ...base, CLIPS_PLATFORMS: 'twitch,tiktok' }).CLIPS_PLATFORMS).toEqual([
      'twitch',
      'tiktok',
    ]);
    expect(boot({ CLIPS_PLATFORMS: 'twitch,bilibili' })).toMatch(/CLIPS_PLATFORMS/);
  });

  it('allows Threads (no extractor yet) under simulation only', () => {
    expect(boot({ CLIPS_PLATFORMS: 'threads' })).toMatch(/threads, which yt-dlp cannot read yet/);
    expect(boot({ CLIPS_PLATFORMS: 'threads', CLIPS_SIMULATION: 'true' })).toBe('');
  });
});
