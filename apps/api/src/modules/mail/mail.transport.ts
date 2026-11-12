/**
 * How a finished email leaves the building.
 *
 * Picked once at boot, in this order:
 *
 * 1. `RESEND_API_KEY`: Resend's HTTP API through its SDK. Preferred: it works
 *    where outbound SMTP ports are blocked (Railway's smaller plans), and its
 *    idempotency key makes a retry after a timeout safe, so nobody gets the
 *    same reset email twice.
 * 2. `SMTP_HOST`: any SMTP server, through nodemailer.
 * 3. Neither: the console transport, which prints the message, links and all,
 *    so local development gets a working activation link with no mail server.
 *    It refuses to exist when `NODE_ENV=production` (env.ts refuses that
 *    configuration first): a printed reset link in a live log is a leak.
 *
 * Every transport says whether a failure is worth retrying (`transient`).
 */
import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';

export interface OutboundMail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /** The same key on every attempt of one email, so a provider that honours it sends once. */
  idempotencyKey: string;
  /** What kind of email this is, for the provider's dashboard ("password_reset"). */
  kind: string;
}

export interface SendResult {
  /** The provider's id for the message, when it gives one. */
  id: string | null;
}

export type TransportName = 'resend' | 'smtp' | 'console';

export interface MailTransport {
  readonly name: TransportName;
  send(mail: OutboundMail, signal: AbortSignal): Promise<SendResult>;
}

/** A failed send, and whether trying again could help. */
export class MailSendError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'MailSendError';
  }
}

export interface TransportConfig {
  nodeEnv: 'development' | 'test' | 'production';
  resendApiKey?: string;
  smtp?: { host: string; port: number; user?: string; pass?: string };
}

export function createMailTransport(config: TransportConfig): MailTransport {
  if (config.resendApiKey) {
    return new ResendTransport(new Resend(config.resendApiKey));
  }
  if (config.smtp?.host) {
    return new SmtpTransport(config.smtp);
  }
  return new ConsoleTransport(config.nodeEnv);
}

/* ───────────────────────── Resend ───────────────────────── */

/** Resend's error names that mean "try again later" rather than "this will never work". */
const RESEND_TRANSIENT = new Set([
  'rate_limit_exceeded',
  'application_error',
  'internal_server_error',
  'concurrent_idempotent_requests',
]);

/** Minimal slice of the SDK, so tests can hand in a fake. */
export interface ResendLike {
  emails: { send: Resend['emails']['send'] };
}

export class ResendTransport implements MailTransport {
  readonly name = 'resend' as const;

  constructor(private readonly client: ResendLike) {}

  async send(mail: OutboundMail, signal: AbortSignal): Promise<SendResult> {
    let response: Awaited<ReturnType<Resend['emails']['send']>>;
    try {
      response = await this.client.emails.send(
        {
          from: mail.from,
          to: [mail.to],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          headers: mail.headers,
          // Tag values allow letters, numbers, underscores and dashes only.
          tags: [{ name: 'kind', value: mail.kind.replace(/[^A-Za-z0-9_-]/g, '_') }],
        },
        { idempotencyKey: mail.idempotencyKey, signal },
      );
    } catch (error) {
      // A thrown error is the network or the timeout, never Resend's verdict.
      throw new MailSendError(describe(error), true, 'network');
    }

    if (response.error) {
      const { name, statusCode, message } = response.error;
      const transient =
        RESEND_TRANSIENT.has(name) ||
        statusCode === null ||
        statusCode === 429 ||
        statusCode >= 500;
      throw new MailSendError(`${name}: ${message}`, transient, name);
    }

    return { id: response.data?.id ?? null };
  }
}

/* ───────────────────────── SMTP ───────────────────────── */

/** Socket-level failures: the server was unreachable or slow, not unwilling. */
const SMTP_TRANSIENT_CODES = new Set([
  'ETIMEDOUT',
  'ECONNECTION',
  'ECONNRESET',
  'ECONNREFUSED',
  'ESOCKET',
  'EDNS',
  'EAI_AGAIN',
]);

export class SmtpTransport implements MailTransport {
  readonly name = 'smtp' as const;
  private readonly transporter: nodemailer.Transporter;

  constructor(smtp: { host: string; port: number; user?: string; pass?: string }) {
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
      // nodemailer waits minutes by default; a request must not.
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 10_000,
    });
  }

  async send(mail: OutboundMail, signal: AbortSignal): Promise<SendResult> {
    const sending = this.transporter.sendMail({
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: mail.headers,
    });

    try {
      const info = (await abortable(sending, signal)) as { messageId?: string };
      return { id: info.messageId ?? null };
    } catch (error) {
      if (error instanceof MailSendError) throw error;
      const code = (error as { code?: string }).code;
      const responseCode = (error as { responseCode?: number }).responseCode;
      // SMTP 4xx replies are "try later" by definition; 5xx are final.
      const transient =
        (code !== undefined && SMTP_TRANSIENT_CODES.has(code)) ||
        (typeof responseCode === 'number' && responseCode >= 400 && responseCode < 500);
      throw new MailSendError(describe(error), transient, code);
    }
  }
}

/** Rejects as soon as `signal` aborts (nodemailer takes no signal of its own). */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new MailSendError('timed out', true, 'timeout'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new MailSendError('timed out', true, 'timeout'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/* ───────────────────────── console (development only) ───────────────────────── */

export class ConsoleTransport implements MailTransport {
  readonly name = 'console' as const;
  private readonly logger = new Logger('MailConsole');

  constructor(nodeEnv: TransportConfig['nodeEnv']) {
    if (nodeEnv === 'production') {
      throw new Error(
        'No mail transport: set RESEND_API_KEY (or SMTP_HOST). The console transport never runs in production.',
      );
    }
  }

  async send(mail: OutboundMail): Promise<SendResult> {
    this.logger.log(
      [
        '',
        '──────────── EMAIL (console transport) ────────────',
        `To:      ${mail.to}`,
        `Subject: ${mail.subject}`,
        ...Object.entries(mail.headers ?? {}).map(([name, value]) => `${name}: ${value}`),
        '',
        mail.text,
        '───────────────────────────────────────────────────',
      ].join('\n'),
    );
    return { id: null };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
