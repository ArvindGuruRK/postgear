/**
 * Discover's flags at boot. The one that really matters is the refusal: recorded
 * headlines must never be able to reach a customer as today's news.
 */
import { validateEnv } from '../../config/env';

const base = {
  DATABASE_URL: 'postgresql://localhost/db',
  JWT_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY_AES256: 'a'.repeat(64),
};

const REFUSAL = 'DISCOVER_SIMULATION cannot be "true" when NODE_ENV=production';

function bootMessage(env: Record<string, string>): string {
  try {
    validateEnv({ ...base, ...env });
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('Discover environment', () => {
  it('defaults to the real feeds and OpenStreetMap, saying who it is', () => {
    const env = validateEnv(base);

    expect(env.DISCOVER_SIMULATION).toBe('false');
    expect(env.DISCOVER_GEOCODER).toBe('nominatim');
    expect(env.DISCOVER_GEOCODER_USER_AGENT).toBe('PostGear/1.0 (+https://postgear.rkay.in)');
    expect(env.DISCOVER_LINK_DECODE).toBe('true');
    expect(env.YOUTUBE_API_KEY).toBeUndefined();
  });

  it('reads a blank as unset, which is how .env.example ships them', () => {
    const env = validateEnv({ ...base, DISCOVER_GEOCODER_USER_AGENT: '', YOUTUBE_API_KEY: '' });

    expect(env.DISCOVER_GEOCODER_USER_AGENT).toBe('PostGear/1.0 (+https://postgear.rkay.in)');
    expect(env.YOUTUBE_API_KEY).toBeUndefined();
  });

  it('allows simulation outside production', () => {
    expect(validateEnv({ ...base, DISCOVER_SIMULATION: 'true' }).DISCOVER_SIMULATION).toBe('true');
  });

  it('refuses simulation in production', () => {
    expect(bootMessage({ NODE_ENV: 'production', DISCOVER_SIMULATION: 'true' })).toContain(REFUSAL);
  });

  it('says nothing about it when production has simulation off', () => {
    expect(bootMessage({ NODE_ENV: 'production', DISCOVER_SIMULATION: 'false' })).not.toContain(
      REFUSAL,
    );
  });

  it('turns finding places off, and refuses a finder it does not know', () => {
    expect(validateEnv({ ...base, DISCOVER_GEOCODER: 'off' }).DISCOVER_GEOCODER).toBe('off');
    expect(bootMessage({ DISCOVER_GEOCODER: 'google' })).toContain('DISCOVER_GEOCODER');
  });
});
