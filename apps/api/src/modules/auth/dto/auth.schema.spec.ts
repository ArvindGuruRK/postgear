import { PASSWORD_MAX, PASSWORD_MIN } from './common.schema';
import { changePasswordSchema, loginSchema, registerSchema } from './auth.schema';

const validRegistration = {
  email: 'Bob@Example.COM',
  password: 'correct-horse-9-battery',
  name: 'Bob Smith',
};

describe('registerSchema', () => {
  it('normalizes the email', () => {
    const parsed = registerSchema.parse(validRegistration);
    expect(parsed.email).toBe('bob@example.com');
  });

  it('does not touch the password', () => {
    // The single most important assertion in this file. Sanitizing a password
    // silently changes the secret the user chose; see common/sanitize.ts.
    const password = '  <b>p@ss</b>w0rd!  &amp;  ';
    const parsed = registerSchema.parse({ ...validRegistration, password });
    expect(parsed.password).toBe(password);
  });

  it('strips markup from the name', () => {
    const parsed = registerSchema.parse({
      ...validRegistration,
      name: '<script>alert(1)</script>Bob',
    });
    expect(parsed.name).toBe('Bob');
  });

  it('rejects a name that is only markup rather than storing an empty string', () => {
    expect(() => registerSchema.parse({ ...validRegistration, name: '<b></b>' })).toThrow();
  });

  it('rejects unknown keys instead of ignoring them', () => {
    // Mass-assignment guard: without .strict() this would parse cleanly and
    // rely on the service to not pass the field through.
    expect(() => registerSchema.parse({ ...validRegistration, isSuperAdmin: true })).toThrow();
    expect(() => registerSchema.parse({ ...validRegistration, activated: true })).toThrow();
  });

  it.each([
    ['missing @', 'bobexample.com'],
    ['no TLD', 'bob@localhost'],
    ['no domain', 'bob@'],
    ['spaces', 'bo b@example.com'],
    ['double dot domain', 'bob@example..com'],
    ['empty', ''],
  ])('rejects an email that is %s', (_label, email) => {
    expect(() => registerSchema.parse({ ...validRegistration, email })).toThrow();
  });

  it('accepts plus-addressing and subdomains', () => {
    const parsed = registerSchema.parse({
      ...validRegistration,
      email: 'bob.smith+news@mail.example.co.uk',
    });
    expect(parsed.email).toBe('bob.smith+news@mail.example.co.uk');
  });

  it(`rejects a password shorter than ${PASSWORD_MIN}`, () => {
    expect(() =>
      registerSchema.parse({ ...validRegistration, password: 'a1'.repeat(5) }),
    ).toThrow();
  });

  it(`rejects a password longer than ${PASSWORD_MAX} — unbounded input is a CPU DoS`, () => {
    const password = `${'a'.repeat(PASSWORD_MAX)}1`;
    expect(() => registerSchema.parse({ ...validRegistration, password })).toThrow();
  });

  it('rejects a password with no digit, matching the register screen helper text', () => {
    expect(() =>
      registerSchema.parse({ ...validRegistration, password: 'abcdefghijklmnop' }),
    ).toThrow();
  });
});

describe('loginSchema', () => {
  it('does not apply the composition rule, so a legacy password can still sign in', () => {
    // Enforcing the digit rule here would reject valid existing accounts and
    // turn login into a password-policy oracle.
    const parsed = loginSchema.parse({ email: 'bob@example.com', password: 'short' });
    expect(parsed.password).toBe('short');
  });

  it('still normalizes the email, so lookup matches what registration stored', () => {
    const parsed = loginSchema.parse({ email: ' BOB@Example.com ', password: 'x' });
    expect(parsed.email).toBe('bob@example.com');
  });

  it('rejects an empty password rather than hashing nothing', () => {
    expect(() => loginSchema.parse({ email: 'bob@example.com', password: '' })).toThrow();
  });
});

describe('changePasswordSchema', () => {
  it('rejects a "change" that reuses the current password', () => {
    expect(() =>
      changePasswordSchema.parse({
        currentPassword: 'correct-horse-9-battery',
        newPassword: 'correct-horse-9-battery',
      }),
    ).toThrow();
  });

  it('accepts a genuinely new password', () => {
    const parsed = changePasswordSchema.parse({
      currentPassword: 'correct-horse-9-battery',
      newPassword: 'a-different-9-passphrase',
    });
    expect(parsed.newPassword).toBe('a-different-9-passphrase');
  });
});
