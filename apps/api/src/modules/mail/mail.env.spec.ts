/**
 * Mail at boot. Production must never start without a real transport, a real
 * sender and an owner address: the console transport would print live reset
 * links into the logs, and owner mail would go to a no-reply inbox.
 */
import { DEFAULT_MAIL_FROM, validateEnv } from '../../config/env';

const base = {
  DATABASE_URL: 'postgresql://localhost/db',
  JWT_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY_AES256: 'a'.repeat(64),
};

/** Everything production needs apart from mail. */
const production = {
  ...base,
  NODE_ENV: 'production',
  AUTOMATION_INTERNAL_TOKEN: 'b'.repeat(64),
};

/** A complete production mail setup, with placeholder values. */
const mail = {
  RESEND_API_KEY: 're_placeholder_key',
  SMTP_FROM: 'PostGear <no-reply@send.example.com>',
  OWNER_EMAIL: 'owner@example.com',
};

function bootMessage(env: Record<string, string>): string {
  try {
    validateEnv(env);
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('mail environment', () => {
  it('boots locally with no mail settings at all (the console transport)', () => {
    const env = validateEnv(base);
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.SMTP_FROM).toBe(DEFAULT_MAIL_FROM);
    expect(env.OWNER_EMAIL).toBeUndefined();
  });

  it('reads the blank strings .env.example ships as unset', () => {
    const env = validateEnv({
      ...base,
      SMTP_HOST: '',
      RESEND_API_KEY: '',
      OWNER_EMAIL: '',
      SMTP_FROM: '',
    });
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.SMTP_FROM).toBe(DEFAULT_MAIL_FROM);
  });

  it('boots in production with Resend, a real sender and an owner', () => {
    expect(bootMessage({ ...production, ...mail })).toBe('');
  });

  it('boots in production with SMTP instead of Resend', () => {
    const { RESEND_API_KEY: _unused, ...smtp } = mail;
    expect(bootMessage({ ...production, ...smtp, SMTP_HOST: 'smtp.example.com' })).toBe('');
  });

  it('refuses production without a transport', () => {
    const { RESEND_API_KEY: _unused, ...rest } = mail;
    expect(bootMessage({ ...production, ...rest })).toContain(
      'RESEND_API_KEY (or SMTP_HOST) is required when NODE_ENV=production',
    );
  });

  it('refuses production with the local sender', () => {
    expect(bootMessage({ ...production, ...mail, SMTP_FROM: '' })).toContain('SMTP_FROM must be');
    expect(bootMessage({ ...production, ...mail, SMTP_FROM: 'Me <me@postgear.local>' })).toContain(
      'SMTP_FROM must be',
    );
  });

  it('refuses production without OWNER_EMAIL, and a malformed one anywhere', () => {
    const { OWNER_EMAIL: _unused, ...rest } = mail;
    expect(bootMessage({ ...production, ...rest })).toContain(
      'OWNER_EMAIL is required when NODE_ENV=production',
    );
    expect(bootMessage({ ...base, OWNER_EMAIL: 'not an address' })).toContain('OWNER_EMAIL');
  });
});
