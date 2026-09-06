import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Provider, type User, prisma } from '@postgear/db';
import { securityLogger } from '../../common/logging/security-logger';
import { MailService } from '../mail/mail.service';
import { AUTH_MESSAGES } from './auth.messages';
import type { LoginDto, RegisterDto } from './dto/auth.schema';
import { LockoutService } from './lockout.service';
import { PasswordService } from './password.service';
import type { OAuthProfile } from './providers/auth-provider.interface';
import { ACTIVATION_TTL_MS, RESET_TTL_MS, TokenService } from './token.service';

/**
 * Registration, login, activation and password recovery.
 *
 * ## The rule this whole file is shaped by
 *
 * Every response must be indistinguishable from every other response for the
 * same operation, whatever actually happened. Registration returns the same
 * body whether the address was free or taken. Login returns the same error for
 * an unknown email, a wrong password, an unactivated account and a locked one.
 * Reset returns the same body whether or not an account exists.
 *
 * That is what makes the API useless as an account-enumeration oracle, and it
 * is why several methods here do work whose only purpose is to *not* be fast —
 * see `PasswordService.burnTime`.
 *
 * ## The `[email, providerName]` trap
 *
 * `User` is unique on the **pair**, not on email (see SCHEMA_NOTES). So
 * `findUnique({ where: { email } })` does not compile and
 * `findUnique({ where: { email_providerName } })` silently misses a user who
 * signed up through a different provider. Local auth therefore looks up the
 * pair explicitly; OAuth deliberately looks up email alone. Both choices are
 * commented where they happen.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  isSuperAdmin: boolean;
  onboardingStep: number;
  onboardingCompletedAt: Date | null;
}

@Injectable()
export class AuthService {
  private readonly lockoutMinutes: number;

  constructor(
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly lockout: LockoutService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.lockoutMinutes = config.get<number>('LOCKOUT_MINUTES', 15);
  }

  /**
   * Creates an account, or quietly does nothing if the address is taken.
   *
   * The caller cannot tell which happened — same status, same body, and
   * roughly the same latency, because the duplicate branch still hashes the
   * password before discarding it.
   *
   * The owner of an already-registered address is told by email that someone
   * tried. That is the honest resolution of the tension between "don't confirm
   * the address exists to a stranger" and "don't leave a real user confused
   * about why signup silently did nothing".
   */
  async register(dto: RegisterDto): Promise<void> {
    // Email alone, across every provider: someone who signed up with Google
    // and now tries a password signup should not get a second account.
    const existing = await prisma.user.findFirst({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existing) {
      // Hash anyway. Skipping it would make the duplicate path measurably
      // faster than the create path, which is the timing side-channel the
      // identical response body exists to close.
      await this.passwords.hash(dto.password);

      securityLogger.warn('register.duplicate', { email: dto.email });
      await this.mail.sendDuplicateRegistration(dto.email);
      return;
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const activation = this.tokens.issue(ACTIVATION_TTL_MS);

    await prisma.user.create({
      data: {
        email: dto.email,
        password: passwordHash,
        passwordChangedAt: new Date(),
        providerName: Provider.LOCAL,
        name: dto.name,
        lastName: dto.lastName ?? null,
        timezone: dto.timezone ?? 0,
        // Explicitly false. The column's default is `true` (inherited from
        // Postiz) and is deliberately left alone so the seeded users stay
        // usable — see the migration note in SCHEMA_NOTES.
        activated: false,
        activationTokenHash: activation.hash,
        activationTokenExpiresAt: activation.expiresAt,
        // No UserOrganization row. A user with zero memberships is a valid,
        // persistable state for the whole of onboarding.
      },
    });

    securityLogger.log('register.succeeded', { email: dto.email });
    await this.mail.sendActivation(dto.email, activation.raw);
  }

  /**
   * Confirms an account from an emailed token.
   *
   * The token is cleared on success, so the link is single-use.
   */
  async activate(rawToken: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { activationTokenHash: this.tokens.hash(rawToken) },
      select: { id: true, email: true, activationTokenExpiresAt: true },
    });

    if (!user || this.tokens.isExpired(user.activationTokenExpiresAt)) {
      securityLogger.warn('activation.failed', { reason: user ? 'expired' : 'unknown-token' });
      return false;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { activated: true, activationTokenHash: null, activationTokenExpiresAt: null },
    });

    securityLogger.log('activation.succeeded', { userId: user.id, email: user.email });
    return true;
  }

  /**
   * Verifies credentials and returns the user, or throws the one generic error.
   *
   * Order of operations matters and is not arbitrary:
   *
   *  1. Apply the progressive delay **before** looking anything up, so it
   *     applies equally to a wrong email and a wrong password.
   *  2. On an unknown email, still burn a hash's worth of CPU.
   *  3. Check the lock **before** verifying the password, so a locked account
   *     cannot be used as a free password oracle during its lockout window.
   */
  async login(dto: LoginDto, ip: string): Promise<User> {
    await this.lockout.applyProgressiveDelay(ip, dto.email);

    // Email alone. A user created through Google has `providerName: GOOGLE`
    // and no password; looking up the LOCAL pair would miss them entirely and
    // report "wrong password" for an account that simply has none, while a
    // user who set a password later would be found under whichever provider
    // row they were created with.
    const user = await prisma.user.findFirst({ where: { email: dto.email } });

    if (!user) {
      await this.passwords.burnTime(dto.password);
      await this.lockout.recordUnknownEmailFailure(ip, dto.email);
      securityLogger.warn('login.failed', { email: dto.email, ip, reason: 'unknown-email' });
      throw new UnauthorizedException(AUTH_MESSAGES.INVALID_CREDENTIALS);
    }

    if (this.lockout.isLocked(user)) {
      await this.passwords.burnTime(dto.password);
      securityLogger.warn('login.failed', { userId: user.id, ip, reason: 'locked' });
      // Same exception as a wrong password. The user learns the truth from the
      // lockout email, not from here.
      throw new UnauthorizedException(AUTH_MESSAGES.INVALID_CREDENTIALS);
    }

    if (!user.password) {
      // An OAuth-only account. Telling the caller "use Google instead" would
      // confirm the address is registered and reveal how.
      await this.passwords.burnTime(dto.password);
      await this.registerFailure(user, ip, dto.email, 'no-password');
      throw new UnauthorizedException(AUTH_MESSAGES.INVALID_CREDENTIALS);
    }

    const { valid, format, needsRehash } = await this.passwords.verify(dto.password, user.password);

    if (!valid) {
      await this.registerFailure(user, ip, dto.email, 'bad-password');
      throw new UnauthorizedException(AUTH_MESSAGES.INVALID_CREDENTIALS);
    }

    if (!user.activated) {
      await this.registerFailure(user, ip, dto.email, 'not-activated');
      throw new UnauthorizedException(AUTH_MESSAGES.INVALID_CREDENTIALS);
    }

    // The only moment the plaintext is available to re-hash from. Upgrading a
    // legacy or under-cost hash here is what makes the migration transparent:
    // no forced reset, no batch job.
    if (needsRehash) {
      await prisma.user.update({
        where: { id: user.id },
        data: { password: await this.passwords.hash(dto.password), passwordChangedAt: new Date() },
      });
      securityLogger.log('password.rehashed', { userId: user.id, from: format });
    }

    await this.lockout.recordSuccess(user.id, ip, dto.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastOnline: new Date(), ip },
    });

    securityLogger.log('login.succeeded', { userId: user.id, ip });
    return user;
  }

  /**
   * Finds or creates the user behind an OAuth profile.
   *
   * ## Linking by email, deliberately
   *
   * The schema's `@@unique([email, providerName])` permits the same address to
   * exist twice under different providers, which would split one person into
   * two accounts with two separate sets of workspaces. The sprint's Definition
   * of Done requires attaching to the existing user instead, so the lookup is
   * on **email alone** and the found row is reused as-is — its original
   * `providerName` is left untouched, since rewriting it would break that
   * user's password login.
   *
   * The safety condition is that the provider must have told us the address is
   * verified; both provider implementations refuse to return an unverified
   * one. Without that check this method would be an account-takeover: register
   * the victim's address at a provider, sign in, inherit their workspaces.
   */
  async findOrCreateFromOAuth(profile: OAuthProfile, provider: Provider): Promise<User> {
    const existing = await prisma.user.findFirst({ where: { email: profile.email } });

    if (existing) {
      // Backfill the provider id if this is the first time they have used it,
      // but do not touch providerName or password.
      if (!existing.providerId) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { providerId: profile.providerId },
        });
      }

      // An OAuth sign-in proves control of the address, which is exactly what
      // activation was waiting for.
      if (!existing.activated) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { activated: true, activationTokenHash: null, activationTokenExpiresAt: null },
        });
      }

      securityLogger.log('oauth.succeeded', {
        userId: existing.id,
        provider,
        linked: true,
      });

      return prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    }

    const created = await prisma.user.create({
      data: {
        email: profile.email,
        providerName: provider,
        providerId: profile.providerId,
        name: profile.name ?? null,
        timezone: 0,
        // No password: this account signs in through the provider. `login()`
        // handles the null case without leaking that it is null.
        password: null,
        // The provider vouched for the address, so there is nothing to confirm.
        activated: true,
      },
    });

    securityLogger.log('oauth.succeeded', { userId: created.id, provider, linked: false });
    return created;
  }

  /**
   * Issues a reset token if the address has an account, and says nothing
   * either way.
   *
   * Always returns void: the controller sends the identical
   * `PASSWORD_RESET_SENT` body regardless.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await prisma.user.findFirst({ where: { email }, select: { id: true } });

    securityLogger.log('password.reset_requested', { email, existed: Boolean(user) });

    if (!user) {
      return;
    }

    const reset = this.tokens.issue(RESET_TTL_MS);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash: reset.hash,
        passwordResetTokenExpiresAt: reset.expiresAt,
      },
    });

    await this.mail.sendPasswordReset(email, reset.raw);
  }

  /**
   * Consumes a reset token and sets a new password.
   *
   * Also clears the lockout, which is the documented escape hatch: a locked-out
   * user who cannot wait fifteen minutes resets instead, using the link from
   * the lockout email.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { passwordResetTokenHash: this.tokens.hash(rawToken) },
      select: { id: true, passwordResetTokenExpiresAt: true },
    });

    if (!user || this.tokens.isExpired(user.passwordResetTokenExpiresAt)) {
      return false;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await this.passwords.hash(newPassword),
        passwordChangedAt: new Date(),
        passwordResetTokenHash: null,
        passwordResetTokenExpiresAt: null,
        // Proving control of the mailbox is at least as strong as clicking an
        // activation link, so a reset also activates.
        activated: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    securityLogger.log('password.reset_completed', { userId: user.id });
    return true;
  }

  /** Changes the password of an already-authenticated user. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });

    if (!user?.password) {
      return false;
    }

    const { valid } = await this.passwords.verify(currentPassword, user.password);

    if (!valid) {
      securityLogger.warn('login.failed', { userId, reason: 'change-password-bad-current' });
      return false;
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        // Re-hashed through the same argon2id path as registration, so a
        // password change can never downgrade the stored format.
        password: await this.passwords.hash(newPassword),
        passwordChangedAt: new Date(),
      },
    });

    return true;
  }

  /**
   * Mints the session JWT.
   *
   * Carries `sub` and `email` only. No role and no organization: both change
   * without the token changing, and baking them in would mean a revoked
   * membership kept working until expiry. `RolesGuard` resolves them per
   * request instead.
   */
  async issueToken(user: { id: string; email: string }): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, email: user.email });
  }

  /** The shape returned by `/auth/me`. Never includes the password hash. */
  toSessionUser(user: User): SessionUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
      onboardingStep: user.onboardingStep,
      onboardingCompletedAt: user.onboardingCompletedAt,
    };
  }

  /**
   * Shared failure bookkeeping: increment, and send the lockout email exactly
   * once, on the attempt that crosses the threshold.
   */
  private async registerFailure(
    user: { id: string; email: string },
    ip: string,
    email: string,
    reason: string,
  ): Promise<void> {
    const { justLocked } = await this.lockout.recordFailure(user.id, ip, email);

    securityLogger.warn('login.failed', { userId: user.id, ip, reason });

    if (justLocked) {
      // A reset token rides along with the notification so the user has an
      // immediate way out rather than only being told to wait.
      const reset = this.tokens.issue(RESET_TTL_MS);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetTokenHash: reset.hash,
          passwordResetTokenExpiresAt: reset.expiresAt,
        },
      });
      await this.mail.sendAccountLocked(user.email, this.lockoutMinutes, reset.raw);
    }
  }
}
