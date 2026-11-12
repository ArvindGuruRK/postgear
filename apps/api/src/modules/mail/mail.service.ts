import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  accountLockedEmail,
  activationEmail,
  duplicateRegistrationEmail,
  type EmailContext,
  messageEmail,
  type NotificationEmailProps,
  notificationEmail,
  passwordResetEmail,
  type RenderedEmail,
  workspaceInvitationEmail,
} from '@postgear/email';
import { randomUUID } from 'node:crypto';
import { DEFAULT_MAIL_FROM } from '../../config/env';
import { MailRepository } from './mail.repository';
import {
  createMailTransport,
  MailSendError,
  type MailTransport,
  type TransportConfig,
} from './mail.transport';
import { signUnsubscribe, type UnsubscribeTopic } from './mail.unsubscribe';

/**
 * Outbound email.
 *
 * Every message is HTML with a plain-text alternative, rendered by
 * `@postgear/email`, and goes out through the transport `mail.transport.ts`
 * picks (Resend, SMTP, or the console in development only).
 *
 * ## Why this is not optional infrastructure
 *
 * Because login failures are deliberately indistinguishable from each other,
 * a locked-out user is told nothing useful by the API. The lockout email is
 * the *only* channel through which the account owner learns what happened and
 * how to recover. If mail is broken, users are locked out with no
 * explanation, so a send failure is logged at error level rather than
 * swallowed.
 *
 * ## Sending never breaks the caller
 *
 * - Nothing here throws into the caller. A user whose account was created
 *   should not see a 500 because the provider was briefly unreachable.
 * - The account and security emails (activation, duplicate sign-up, reset,
 *   lockout) are sent in the background: the request answers at once and
 *   the send carries on. Their callers never needed the outcome.
 * - The rest (invitation, notifications, `sendPlain`) report whether the
 *   message went out, so they are awaited, within a hard time budget.
 * - A transient failure (timeout, 429, 5xx, a dropped socket) is retried
 *   with backoff, each try with its own timeout and the same idempotency key.
 * - Logs are one JSON line per outcome, with the address masked and never the
 *   link or token (`mail.sent`, `mail.retry`, `mail.failed`, `mail.suppressed`).
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Where a message sits: security mail is never skipped, the rest respects suppression. */
type MailCategory = 'security' | 'invitation' | 'notification';

interface Envelope {
  kind: string;
  category: MailCategory;
  to: string;
  email: RenderedEmail;
  headers?: Record<string, string>;
}

export interface NotificationMailOptions {
  /** Adds one-click List-Unsubscribe for this kind of notification in this workspace. */
  unsubscribe?: { topic: UnsubscribeTopic; orgId: string };
}

/** The injection token tests use to hand in a fake transport. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export const MAIL_RETRY = {
  attempts: 3,
  /** Per try. */
  timeoutMs: 10_000,
  /** Before the 2nd and 3rd try; up to 25% jitter is added. */
  backoffMs: [500, 2_000],
  /** No new try starts after this much time has gone. */
  budgetMs: 25_000,
} as const;

const ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: MailTransport;
  private readonly from: string;
  private readonly webUrl: string;
  private readonly apiUrl: string;
  private readonly unsubscribeSecret: string | null;

  /** Overridden in tests so retries do not wait. */
  protected sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  constructor(
    config: ConfigService,
    // The explicit token matters: a `| null` type emits `Object` as the
    // parameter's metadata, which `@Optional()` would quietly resolve to nothing.
    @Optional() @Inject(MailRepository) private readonly repository: MailRepository | null = null,
    @Optional() @Inject(MAIL_TRANSPORT) transport: MailTransport | null = null,
  ) {
    this.from = config.get<string>('SMTP_FROM') || DEFAULT_MAIL_FROM;
    this.webUrl = (config.get<string>('WEB_URL') || 'http://localhost:3000').replace(/\/+$/, '');
    this.apiUrl = (config.get<string>('API_URL') || 'http://localhost:3001').replace(/\/+$/, '');
    this.unsubscribeSecret = config.get<string>('JWT_SECRET') || null;

    const nodeEnv = (config.get<string>('NODE_ENV') || 'development') as TransportConfig['nodeEnv'];
    const host = config.get<string>('SMTP_HOST');
    this.transport =
      transport ??
      createMailTransport({
        nodeEnv,
        resendApiKey: config.get<string>('RESEND_API_KEY') || undefined,
        smtp: host
          ? {
              host,
              port: Number(config.get<number>('SMTP_PORT') ?? 587),
              user: config.get<string>('SMTP_USER') || undefined,
              pass: config.get<string>('SMTP_PASS') || undefined,
            }
          : undefined,
      });

    if (this.transport.name === 'console') {
      this.logger.warn('No RESEND_API_KEY or SMTP_HOST, so email will be printed to the console.');
    } else {
      this.logger.log(`Mail goes out through ${this.transport.name}.`);
    }
  }

  private get context(): EmailContext {
    return { webUrl: this.webUrl };
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
    this.inBackground({
      kind: 'activation',
      category: 'security',
      to,
      email: activationEmail(this.context, { link, expiresInMinutes: 24 * 60 }),
    });
  }

  /**
   * Sent when someone tries to register with an address that already has an
   * account.
   *
   * This exists because the registration endpoint cannot say "that email is
   * taken" without becoming an enumeration oracle. The person who owns the
   * address is the one who should be told, and this is how they are told,
   * including the case where the attempt was not theirs.
   */
  async sendDuplicateRegistration(to: string): Promise<void> {
    this.inBackground({
      kind: 'duplicate_registration',
      category: 'security',
      to,
      email: duplicateRegistrationEmail(this.context),
    });
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const link = `${this.webUrl}/reset-password/${encodeURIComponent(token)}`;
    this.inBackground({
      kind: 'password_reset',
      category: 'security',
      to,
      email: passwordResetEmail(this.context, { link, expiresInMinutes: 60 }),
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
    const resetLink = `${this.webUrl}/reset-password/${encodeURIComponent(token)}`;
    this.inBackground({
      kind: 'account_locked',
      category: 'security',
      to,
      email: accountLockedEmail(this.context, { minutes, resetLink, resetExpiresInMinutes: 60 }),
    });
  }

  /**
   * A workspace invitation (Settings > Team, 2026-10-19).
   *
   * The link is the invitation: a signed token that names the workspace and
   * the role, and is bound to this address, so forwarding it does not let
   * someone else in. The message is the same whether or not the address has
   * a PostGear account, because the API never looks: the landing page offers
   * sign-in and sign-up side by side, and saying either here would make the
   * invite form an account-enumeration oracle for every workspace admin.
   *
   * Names are cut to length and folded onto one line by the template before
   * they reach the subject, the one header a caller's text reaches.
   *
   * Reports the outcome, like `sendPlain`; the admin is not told about a
   * failure (the copy-link path is there for exactly that), but it is logged.
   */
  async sendWorkspaceInvitation(
    to: string,
    invitation: {
      workspaceName: string;
      inviterName: string;
      role: 'ADMIN' | 'USER';
      link: string;
      expiresAt: Date;
    },
  ): Promise<boolean> {
    return this.deliver({
      kind: 'workspace_invitation',
      category: 'invitation',
      to,
      email: workspaceInvitationEmail(this.context, invitation),
    });
  }

  /**
   * A message assembled from lines by a caller (a workflow's Email step).
   * Rendered as paragraphs in the PostGear frame; every line is text, so
   * nothing a caller passes can become markup. Reports the outcome.
   */
  async sendPlain(to: string, subject: string, lines: string[]): Promise<boolean> {
    return this.deliver({
      kind: 'message',
      category: 'notification',
      to,
      email: messageEmail(this.context, { subject, lines }),
    });
  }

  /**
   * A notification (Sprint 8 catalogue) or an owner message, as a summary
   * card. With `unsubscribe`, the message carries one-click List-Unsubscribe
   * headers that turn off that kind of email for this address. Reports the
   * outcome.
   */
  async sendNotification(
    to: string,
    content: NotificationEmailProps,
    options: NotificationMailOptions = {},
  ): Promise<boolean> {
    return this.deliver({
      kind: 'notification',
      category: 'notification',
      to,
      email: notificationEmail(this.context, content),
      headers: options.unsubscribe ? this.unsubscribeHeaders(to, options.unsubscribe) : undefined,
    });
  }

  /**
   * Whether an address is on the suppression list (a hard bounce or a spam
   * complaint). Callers that retry on failure check first, so a suppressed
   * address is skipped rather than retried forever.
   */
  async isSuppressed(to: string): Promise<boolean> {
    return this.suppressed(to.trim());
  }

  /** The absolute URL of a path in the web app, for links in mail. */
  linkTo(path: string): string {
    return `${this.webUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private unsubscribeHeaders(
    to: string,
    target: { topic: UnsubscribeTopic; orgId: string },
  ): Record<string, string> | undefined {
    if (!this.unsubscribeSecret) return undefined;
    const token = signUnsubscribe(this.unsubscribeSecret, {
      email: to,
      topic: target.topic,
      orgId: target.orgId,
    });
    return {
      'List-Unsubscribe': `<${this.apiUrl}/mail/unsubscribe?token=${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  /** Starts a send the caller does not wait for. Its outcome is only logged. */
  private inBackground(envelope: Envelope): void {
    void this.deliver(envelope).catch((error: unknown) => {
      // `deliver` never rejects; this is the belt to its braces.
      this.logger.error(`Background mail crashed: ${scrub(error)}`);
    });
  }

  /**
   * Sends, retrying transient failures. Never throws. Returns whether the
   * message went out (printing counts in development).
   */
  private async deliver(envelope: Envelope): Promise<boolean> {
    const to = envelope.to.trim();
    const base = { kind: envelope.kind, to: maskAddress(to), transport: this.transport.name };

    if (!ADDRESS.test(to) || to.length > 254) {
      this.logger.warn(JSON.stringify({ event: 'mail.invalid_address', ...base }));
      return false;
    }

    if (envelope.category !== 'security' && (await this.suppressed(to))) {
      this.logger.warn(JSON.stringify({ event: 'mail.suppressed', ...base }));
      return false;
    }

    const message = {
      from: this.from,
      to,
      subject: envelope.email.subject,
      html: envelope.email.html,
      text: envelope.email.text,
      headers: envelope.headers,
      idempotencyKey: `${envelope.kind}-${randomUUID()}`,
      kind: envelope.kind,
    };
    const started = Date.now();

    for (let attempt = 1; attempt <= MAIL_RETRY.attempts; attempt += 1) {
      try {
        const result = await this.transport.send(
          message,
          AbortSignal.timeout(MAIL_RETRY.timeoutMs),
        );
        this.logger.log(
          JSON.stringify({
            event: 'mail.sent',
            ...base,
            attempt,
            id: result.id,
            ms: Date.now() - started,
          }),
        );
        return true;
      } catch (error) {
        const transient = error instanceof MailSendError ? error.transient : true;
        const wait = MAIL_RETRY.backoffMs[attempt - 1];
        const canRetry =
          transient &&
          attempt < MAIL_RETRY.attempts &&
          wait !== undefined &&
          Date.now() - started + wait < MAIL_RETRY.budgetMs;

        if (!canRetry) {
          this.logger.error(
            JSON.stringify({
              event: 'mail.failed',
              ...base,
              attempt,
              transient,
              reason: scrub(error),
              ms: Date.now() - started,
            }),
          );
          return false;
        }

        this.logger.warn(
          JSON.stringify({ event: 'mail.retry', ...base, attempt, reason: scrub(error) }),
        );
        await this.sleep(wait + Math.floor(Math.random() * wait * 0.25));
      }
    }

    return false;
  }

  /** A failed lookup must not stop a send: the address is treated as fine. */
  private async suppressed(to: string): Promise<boolean> {
    if (!this.repository) return false;
    try {
      return await this.repository.isSuppressed(to);
    } catch (error) {
      this.logger.warn(`Could not check the suppression list: ${scrub(error)}`);
      return false;
    }
  }
}

/** `k***@example.com`: enough to trace, not enough to harvest. */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '***';
  return `${address[0]}***${address.slice(at)}`;
}

/** An error as one short line with every link (and so every token) taken out. */
export function scrub(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
