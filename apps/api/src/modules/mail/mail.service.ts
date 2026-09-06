import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Outbound email.
 *
 * Sprint 2's brief says to stub the send until the provider is chosen in
 * Sprint 8. This does slightly better than a stub: it is a real nodemailer
 * transport when `SMTP_HOST` is configured, and a console transport that
 * prints the full message (including the clickable link) when it is not. So
 * local development gets a usable activation link without a mail server, and
 * production is a config change rather than a code change.
 *
 * ## Why this is not optional infrastructure
 *
 * Because login failures are deliberately indistinguishable from each other,
 * a locked-out user is told nothing useful by the API. The lockout email is
 * the *only* channel through which the account owner learns what happened and
 * how to recover. If mail is broken, users are locked out with no
 * explanation — so a send failure is logged at error level rather than
 * swallowed.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;
  private readonly webUrl: string;

  constructor(config: ConfigService) {
    this.from = config.get<string>('SMTP_FROM', 'PostGear <no-reply@postgear.local>');
    this.webUrl = config.get<string>('WEB_URL', 'http://localhost:3000');

    const host = config.get<string>('SMTP_HOST');

    if (!host) {
      this.transporter = null;
      this.logger.warn('SMTP_HOST is not set — email will be printed to the console.');
      return;
    }

    const port = config.get<number>('SMTP_PORT', 587);
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASS');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  /**
   * Confirms a new account.
   *
   * The token goes in the URL, which means it lands in the browser history and
   * in any referrer the landing page leaks. Acceptable because it is
   * single-use and short-lived (24h), which is the standard trade every
   * email-confirmation flow makes.
   */
  async sendActivation(to: string, token: string): Promise<void> {
    const link = `${this.webUrl}/verify?token=${encodeURIComponent(token)}`;

    await this.send({
      to,
      subject: 'Confirm your PostGear account',
      text: [
        'Welcome to PostGear.',
        '',
        'Confirm your email address to finish setting up your account:',
        link,
        '',
        'This link expires in 24 hours.',
        "If you didn't create this account, you can ignore this email.",
      ].join('\n'),
    });
  }

  /**
   * Sent when someone tries to register with an address that already has an
   * account.
   *
   * This exists because the registration endpoint cannot say "that email is
   * taken" without becoming an enumeration oracle. The person who owns the
   * address is the one who should be told, and this is how they are told —
   * including the case where the attempt was not theirs.
   */
  async sendDuplicateRegistration(to: string): Promise<void> {
    await this.send({
      to,
      subject: 'Someone tried to sign up with your email',
      text: [
        'Someone just tried to create a PostGear account with this email address.',
        '',
        'You already have an account, so nothing has changed. If it was you, sign in',
        `instead: ${this.webUrl}/login`,
        '',
        `If you've forgotten your password, reset it: ${this.webUrl}/reset-password`,
        '',
        'If this was not you, no action is needed — the attempt did not reveal',
        'anything about your account.',
      ].join('\n'),
    });
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const link = `${this.webUrl}/reset-password/${encodeURIComponent(token)}`;

    await this.send({
      to,
      subject: 'Reset your PostGear password',
      text: [
        'Someone asked to reset the password for this PostGear account.',
        '',
        link,
        '',
        'This link expires in one hour and can only be used once.',
        "If you didn't ask for this, you can ignore this email — your password",
        'has not changed.',
      ].join('\n'),
    });
  }

  /**
   * The lockout notification, and the one place the truth about a lockout is
   * ever stated.
   *
   * The API returns "Incorrect email or password" for a locked account, on
   * purpose. Without this email the real owner has no way to distinguish
   * "I mistyped again" from "I am locked out for fifteen minutes".
   */
  async sendAccountLocked(to: string, minutes: number, token: string): Promise<void> {
    const link = `${this.webUrl}/reset-password/${encodeURIComponent(token)}`;

    await this.send({
      to,
      subject: 'Your PostGear account is temporarily locked',
      text: [
        `There have been several failed sign-in attempts on this account, so it is`,
        `locked for ${minutes} minutes.`,
        '',
        'If that was you, wait and try again — or reset your password now to sign',
        'in straight away:',
        link,
        '',
        'This link expires in one hour.',
        '',
        'If it was not you, someone is guessing at your password. Resetting it is',
        'the fastest way to be sure.',
      ].join('\n'),
    });
  }

  /**
   * Sends, or prints.
   *
   * Never throws. A mail failure must not roll back the operation that
   * triggered it — a user whose account was created successfully should not
   * see a 500 because the SMTP server was briefly unreachable. The failure is
   * logged at error level so it is visible in monitoring.
   */
  private async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        [
          '',
          '──────────── EMAIL (console transport) ────────────',
          `To:      ${message.to}`,
          `Subject: ${message.subject}`,
          '',
          message.text,
          '───────────────────────────────────────────────────',
        ].join('\n'),
      );
      return;
    }

    try {
      await this.transporter.sendMail({ from: this.from, ...message });
    } catch (error) {
      this.logger.error(
        `Failed to send "${message.subject}" to ${message.to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
