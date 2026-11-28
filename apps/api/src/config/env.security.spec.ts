/**
 * Security sweep, Simulation and Secrets at boot (Sprint 13, Module 16), the
 * API's half.
 *
 * - `MEDIA_SIMULATION=true` stops the API in production, and so does
 *   `CLIPS_SIMULATION=true` while `MEDIA_SIMULATION` is unset (the media
 *   service follows it then). `AI_SIMULATION=true` stops it too.
 * - Production needs `MEDIA_INTERNAL_TOKEN`, and a refusal names a variable,
 *   never its value.
 * - The switches that send anything to a hosted service (`CLIPS_ACTION_VISION`,
 *   `CLIPS_TTS`) are off unless set to "true".
 *
 * The worker's half: `apps/worker/src/config/env.security.test.ts`; the
 * Python service's: `apps/media/tests/test_service_security.py`. Sprint 12's
 * `CLIPS_SIMULATION` refusal: `modules/clips/clips-simulation.security.spec.ts`.
 */
import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://localhost/db',
  JWT_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY_AES256: 'a'.repeat(64),
};
const TOKEN = 'media-internal-token-0123456789abcdef0123456789';
const MEDIA_REFUSAL = 'MEDIA_SIMULATION cannot be "true" when NODE_ENV=production';
const AI_REFUSAL = 'AI_SIMULATION cannot be "true" when NODE_ENV=production';
const TOKEN_REFUSAL = 'MEDIA_INTERNAL_TOKEN is required when NODE_ENV=production';

function bootMessage(env: Record<string, string>): string {
  try {
    validateEnv({ ...base, ...env });
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('MEDIA_SIMULATION at boot', () => {
  it('stops the API in production when it is on', () => {
    expect(bootMessage({ NODE_ENV: 'production', MEDIA_SIMULATION: 'true' })).toContain(
      MEDIA_REFUSAL,
    );
  });

  it('stops it when CLIPS_SIMULATION is on and MEDIA_SIMULATION is unset or blank (it follows)', () => {
    for (const media of [undefined, '']) {
      const env: Record<string, string> = { NODE_ENV: 'production', CLIPS_SIMULATION: 'true' };
      if (media !== undefined) env.MEDIA_SIMULATION = media;
      expect(bootMessage(env)).toContain(MEDIA_REFUSAL);
    }
  });

  it('says nothing about it with simulation off, or outside production', () => {
    expect(bootMessage({ NODE_ENV: 'production', MEDIA_SIMULATION: 'false' })).not.toContain(
      MEDIA_REFUSAL,
    );
    expect(bootMessage({ NODE_ENV: 'production' })).not.toContain(MEDIA_REFUSAL);
    expect(validateEnv({ ...base, MEDIA_SIMULATION: 'true' }).MEDIA_SIMULATION).toBe('true');
  });
});

describe('AI_SIMULATION at boot', () => {
  it('stops the API in production', () => {
    expect(bootMessage({ NODE_ENV: 'production', AI_SIMULATION: 'true' })).toContain(AI_REFUSAL);
  });

  it('is off unless set, and blank reads as off', () => {
    expect(bootMessage({ NODE_ENV: 'production' })).not.toContain(AI_REFUSAL);
    expect(validateEnv({ ...base }).AI_SIMULATION).toBe('false');
    expect(validateEnv({ ...base, AI_SIMULATION: '' }).AI_SIMULATION).toBe('false');
  });
});

describe('the internal token at boot', () => {
  it('is required in production and optional locally', () => {
    expect(bootMessage({ NODE_ENV: 'production' })).toContain(TOKEN_REFUSAL);
    expect(bootMessage({ NODE_ENV: 'production', MEDIA_INTERNAL_TOKEN: TOKEN })).not.toContain(
      TOKEN_REFUSAL,
    );
    expect(validateEnv({ ...base }).MEDIA_INTERNAL_TOKEN).toBeUndefined();
  });

  it('refuses a short one by name, never repeating its value', () => {
    const short = 'short-media-token-1234';
    const message = bootMessage({ MEDIA_INTERNAL_TOKEN: short });
    expect(message).toContain('MEDIA_INTERNAL_TOKEN');
    expect(message).not.toContain(short);
  });

  it('never repeats a key or the token in any refusal', () => {
    const openai = 'sk-live-openai-key-0123456789abcdef';
    const openrouter = 'sk-or-v1-openrouter-key-0123456789abcdef';
    const message = bootMessage({
      NODE_ENV: 'production',
      AI_SIMULATION: 'true',
      MEDIA_SIMULATION: 'true',
      MEDIA_INTERNAL_TOKEN: TOKEN,
      OPENAI_API_KEY: openai,
      OPENROUTER_API_KEY: openrouter,
    });
    expect(message).toContain(AI_REFUSAL);
    for (const secret of [TOKEN, openai, openrouter]) expect(message).not.toContain(secret);
  });
});

describe('the switches that send anything to a hosted service', () => {
  it('are off unless set to "true", and blank reads as off', () => {
    const plain = validateEnv({ ...base });
    expect(plain.CLIPS_ACTION_VISION).toBe('false');
    expect(plain.CLIPS_TTS).toBe('false');
    const blank = validateEnv({ ...base, CLIPS_ACTION_VISION: '', CLIPS_TTS: '' });
    expect(blank.CLIPS_ACTION_VISION).toBe('false');
    expect(blank.CLIPS_TTS).toBe('false');
    expect(bootMessage({ CLIPS_TTS: 'yes' })).toContain('CLIPS_TTS');
    expect(bootMessage({ CLIPS_ACTION_VISION: '1' })).toContain('CLIPS_ACTION_VISION');
  });
});
