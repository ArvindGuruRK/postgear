import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { ARGON2_OPTIONS, PasswordService } from './password.service';

// argon2 at 19 MiB is intentionally slow; a handful of hashes per test file is
// still well inside the default timeout, but the margin is not large.
jest.setTimeout(30_000);

const PASSWORD = 'correct-horse-9-battery';

describe('PasswordService', () => {
  const service = new PasswordService();

  describe('hash', () => {
    it('produces an argon2id hash at the configured cost', async () => {
      const hash = await service.hash(PASSWORD);
      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(hash).toContain('m=19456,t=2,p=1');
    });

    it('salts, so the same password hashes differently every time', async () => {
      const [a, b] = await Promise.all([service.hash(PASSWORD), service.hash(PASSWORD)]);
      expect(a).not.toBe(b);
    });
  });

  describe('verify', () => {
    it('accepts the right password', async () => {
      const hash = await service.hash(PASSWORD);
      await expect(service.verify(PASSWORD, hash)).resolves.toMatchObject({
        valid: true,
        format: 'argon2',
        needsRehash: false,
      });
    });

    it('rejects the wrong password', async () => {
      const hash = await service.hash(PASSWORD);
      await expect(service.verify('wrong', hash)).resolves.toMatchObject({ valid: false });
    });

    it('reads a corrupted hash as "wrong password" rather than throwing', async () => {
      // argon2.verify throws on malformed input. A 500 here would confirm the
      // row exists and is broken, which is more than the caller should learn.
      await expect(service.verify(PASSWORD, '$argon2id$garbage')).resolves.toMatchObject({
        valid: false,
      });
    });

    it('flags a hash below the current cost for rehashing', async () => {
      const weak = await argon2.hash(PASSWORD, { ...ARGON2_OPTIONS, memoryCost: 8192 });
      const result = await service.verify(PASSWORD, weak);
      expect(result).toMatchObject({ valid: true, needsRehash: true });
    });

    it('does not flag a correct password against a current hash', async () => {
      const hash = await service.hash(PASSWORD);
      const result = await service.verify(PASSWORD, hash);
      expect(result.needsRehash).toBe(false);
    });
  });

  describe('detectFormat', () => {
    it.each([
      ['argon2', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'],
      ['bcrypt', '$2b$12$abcdefghijklmnopqrstuv'],
      ['bcrypt', '$2a$10$abcdefghijklmnopqrstuv'],
      ['bcrypt', '$2y$12$abcdefghijklmnopqrstuv'],
      ['sha1', createHash('sha1').update(PASSWORD).digest('hex')],
      ['md5', createHash('md5').update(PASSWORD).digest('hex')],
      ['plaintext', 'hunter2'],
    ])('classifies %s', (expected, stored) => {
      expect(service.detectFormat(stored)).toBe(expected);
    });
  });

  describe('legacy migration', () => {
    it('verifies an md5 row and demands a rehash', async () => {
      const stored = createHash('md5').update(PASSWORD).digest('hex');
      await expect(service.verify(PASSWORD, stored)).resolves.toEqual({
        valid: true,
        format: 'md5',
        needsRehash: true,
      });
    });

    it('verifies a sha1 row and demands a rehash', async () => {
      const stored = createHash('sha1').update(PASSWORD).digest('hex');
      await expect(service.verify(PASSWORD, stored)).resolves.toEqual({
        valid: true,
        format: 'sha1',
        needsRehash: true,
      });
    });

    it('verifies a plaintext row and demands a rehash', async () => {
      await expect(service.verify(PASSWORD, PASSWORD)).resolves.toEqual({
        valid: true,
        format: 'plaintext',
        needsRehash: true,
      });
    });

    it('rejects the wrong password against a legacy row', async () => {
      const stored = createHash('md5').update(PASSWORD).digest('hex');
      await expect(service.verify('wrong', stored)).resolves.toMatchObject({ valid: false });
    });

    it('cannot verify bcrypt, so such an account must reset', async () => {
      // Documented limitation, not an oversight: no bcrypt dependency exists
      // in this repo, and the audit script reports any such row before a user
      // discovers it at the login screen.
      const stored = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.';
      await expect(service.verify(PASSWORD, stored)).resolves.toEqual({
        valid: false,
        format: 'bcrypt',
        needsRehash: false,
      });
    });

    it('never reports needsRehash for a failed verification', async () => {
      // Re-hashing on a *failed* attempt would overwrite a good hash with one
      // derived from the attacker's guess.
      for (const stored of [
        createHash('md5').update(PASSWORD).digest('hex'),
        PASSWORD,
        await service.hash(PASSWORD),
      ]) {
        const result = await service.verify('definitely-wrong', stored);
        expect(result.needsRehash).toBe(false);
      }
    });
  });

  describe('burnTime', () => {
    it('resolves without throwing, so the unknown-user branch cannot 500', async () => {
      await expect(service.burnTime('anything')).resolves.toBeUndefined();
    });

    it('costs roughly what a real verification costs', async () => {
      const hash = await service.hash(PASSWORD);

      const realStart = process.hrtime.bigint();
      await service.verify('wrong', hash);
      const realMs = Number(process.hrtime.bigint() - realStart) / 1e6;

      await service.burnTime('warm'); // prime the cached dummy hash
      const dummyStart = process.hrtime.bigint();
      await service.burnTime('wrong');
      const dummyMs = Number(process.hrtime.bigint() - dummyStart) / 1e6;

      // A loose bound on purpose. The claim being tested is "same order of
      // magnitude, not microseconds versus milliseconds" — tightening this
      // would make it a flaky timing test on shared CI hardware.
      expect(dummyMs).toBeGreaterThan(realMs / 10);
      expect(dummyMs).toBeLessThan(realMs * 10);
    });
  });
});
