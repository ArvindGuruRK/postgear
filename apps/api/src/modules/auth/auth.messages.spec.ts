import { AUTH_MESSAGES, BANNED_MESSAGE_PHRASES } from './auth.messages';

describe('AUTH_MESSAGES', () => {
  const entries = Object.entries(AUTH_MESSAGES);

  it.each(entries)('%s contains no account-enumerating phrase', (key, message) => {
    // This is the enforcement point for the "fix any error message that leaks
    // information" requirement. Adding a message like "No user with that
    // email" to the catalogue fails here rather than reaching production.
    const lowered = message.toLowerCase();
    const hits = BANNED_MESSAGE_PHRASES.filter((phrase) => lowered.includes(phrase));

    expect({ key, message, hits }).toEqual({ key, message, hits: [] });
  });

  it('uses the exact required login-failure wording', () => {
    expect(AUTH_MESSAGES.INVALID_CREDENTIALS).toBe('Incorrect email or password');
  });

  it('uses the exact required password-reset wording', () => {
    expect(AUTH_MESSAGES.PASSWORD_RESET_SENT).toBe(
      "If that email is registered, you'll receive a reset link",
    );
  });

  it('gives lockout no message of its own', () => {
    // A distinct lockout message would tell an attacker that the address is
    // real and that they have found the throttling boundary. Lockout reuses
    // INVALID_CREDENTIALS; the only place the truth is told is the email sent
    // to the account owner.
    const values = Object.values(AUTH_MESSAGES).map((m) => m.toLowerCase());
    expect(values.some((m) => m.includes('lock'))).toBe(false);
  });

  it('names no form field in the validation message', () => {
    const lowered = AUTH_MESSAGES.INVALID_INPUT.toLowerCase();
    for (const field of ['email', 'password', 'name', 'username']) {
      expect(lowered).not.toContain(field);
    }
  });

  it('has no duplicate strings, which would make two causes indistinguishable by accident', () => {
    // Deliberate reuse happens at the *call site* (login and lockout both
    // throw INVALID_CREDENTIALS). Two identical constants would instead mean
    // someone copied a message rather than reusing one.
    const values = Object.values(AUTH_MESSAGES);
    expect(new Set(values).size).toBe(values.length);
  });
});
