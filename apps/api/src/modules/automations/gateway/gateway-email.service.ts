/**
 * The Email step's API side (Module 12): mail through PostGear's own
 * `MailService` (the message's lines as paragraphs in the PostGear frame,
 * with a plain-text part; Resend, SMTP, or the API console in development).
 *
 * - **Bound**: the call must name a live run's `notify.email` step.
 * - **Checked**: up to 10 addresses (the schema), each a real address
 *   ("'{value}' is not an email address.", 422), repeats sent once; the
 *   subject on one line (no header can be smuggled in), "(Test)" in front
 *   for a test run sent for real.
 * - **Capped**: at most `LIMITS.workflowEmailsPerDay` (200) workflow emails
 *   per workspace per UTC day, counted per recipient from today's `email`
 *   effects; past it, 422 `limit_reached`. The check is not locked, so two
 *   steps racing at the cap can pass it together (at most 10 each); an
 *   abuse guard, not a quota to the email.
 * - **Once each**: one `AutomationEffect` per run and step. Each recipient
 *   is recorded with `save` as soon as their email goes out, so a retry
 *   after a failure skips everyone already written to; a finished step's
 *   retry returns the stored answer. A `sendPlain` that reports failure is
 *   503 `mail_unavailable`, which the worker retries.
 * - **Never stuck**: an address on the suppression list (it bounces, or its
 *   owner reported spam) is skipped up front and named in `skipped`, since
 *   retrying it could never succeed.
 */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LIMITS } from '@postgear/automation';
import { type Prisma, prisma } from '@postgear/db';
import { z } from 'zod';
import { MailService } from '../../mail/mail.service';
import type { GatewayResponse } from './gateway.schema';
import { GatewayBindingService } from './gateway-binding.service';
import type { GatewayEmailInput, GatewayEmailOutput } from './gateway-email.schema';

export const EMAIL_EFFECT_KIND = 'email';
export const EMAIL_LIMIT_MESSAGE = `This workspace has sent its ${LIMITS.workflowEmailsPerDay} workflow emails for today.`;
export const EMAIL_UNAVAILABLE_MESSAGE =
  'PostGear could not send the email just now. It will try again.';

const SUBJECT_MAX = 200;
const emailAddress = z.string().email().max(254);

/** "'kim@' is not an email address." with the value cut to 60 characters on one line. */
export function notAnEmail(value: string): string {
  const line = Array.from(value.replace(/\s+/g, ' ').trim());
  const shown = line.length > 60 ? `${line.slice(0, 57).join('')}...` : line.join('');
  return `'${shown}' is not an email address.`;
}

/** `k***@example.com`: the first character and the domain. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '***';
  return `${address[0]}***${address.slice(at)}`;
}

function oneLine(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The progress an earlier attempt saved (lower case): who already got the
 * email, and who was skipped because their address bounces or complained.
 */
function progressSoFar(previous: Prisma.JsonValue | null, key: 'sentTo' | 'skipped'): string[] {
  if (typeof previous !== 'object' || previous === null || Array.isArray(previous)) return [];
  const list = (previous as Record<string, unknown>)[key];
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
}

/** Emails one effect row stands for: its saved progress, or its finished output's count. */
function sentBy(result: Prisma.JsonValue | null): number {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return 0;
  const record = result as Record<string, unknown>;
  if (Array.isArray(record.sentTo)) return record.sentTo.length;
  const output = record.output as { sent?: unknown } | undefined;
  return typeof output?.sent === 'number' ? output.sent : 0;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

@Injectable()
export class GatewayEmailService {
  private readonly logger = new Logger('AutomationGateway');

  constructor(
    private readonly binding: GatewayBindingService,
    private readonly mail: MailService,
  ) {}

  /** The addresses to write to, checked and without repeats (case does not matter). */
  recipients(to: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of to) {
      const value = raw.trim();
      if (!emailAddress.safeParse(value).success) {
        throw new UnprocessableEntityException({ message: notAnEmail(raw), code: 'invalid_email' });
      }
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
    return out;
  }

  /** Workflow emails this workspace sent today (UTC), recipient by recipient. */
  async sentToday(organizationId: string, now = new Date()): Promise<number> {
    const rows = await prisma.automationEffect.findMany({
      where: { organizationId, kind: EMAIL_EFFECT_KIND, createdAt: { gte: startOfUtcDay(now) } },
      select: { result: true },
    });
    return rows.reduce((total, row) => total + sentBy(row.result), 0);
  }

  async send(input: GatewayEmailInput): Promise<GatewayResponse<GatewayEmailOutput>> {
    const { to, subject, message, ...binding } = input;
    const step = await this.binding.bind(binding, ['notify.email']);
    const recipients = this.recipients(to);

    const line = Array.from(oneLine(subject)).slice(0, SUBJECT_MAX).join('');
    if (!line) {
      throw new UnprocessableEntityException({
        message: 'Write a subject.',
        code: 'missing_subject',
      });
    }
    const fullSubject = step.run.mode === 'test' ? `(Test) ${line}` : line;
    const lines = [
      ...message.split(/\r?\n/),
      '',
      `Sent by the workflow ${oneLine(step.run.automationName)} in PostGear.`,
    ];

    return this.binding.runEffect(binding, EMAIL_EFFECT_KIND, async ({ previous, save }) => {
      const sentTo = progressSoFar(previous, 'sentTo');
      const skipped = progressSoFar(previous, 'skipped');
      const remaining = recipients.filter(
        (address) =>
          !sentTo.includes(address.toLowerCase()) && !skipped.includes(address.toLowerCase()),
      );

      if (remaining.length > 0) {
        const used = await this.sentToday(binding.organizationId);
        if (used + remaining.length > LIMITS.workflowEmailsPerDay) {
          this.logger.warn(
            JSON.stringify({
              event: 'automation.email_limit',
              organizationId: binding.organizationId,
              runId: binding.runId,
              used,
              wanted: remaining.length,
            }),
          );
          throw new UnprocessableEntityException({
            message: EMAIL_LIMIT_MESSAGE,
            code: 'limit_reached',
          });
        }
      }

      for (const address of remaining) {
        // A bouncing or complaining address will never succeed: skip it
        // rather than fail the step into endless retries.
        if (await this.mail.isSuppressed(address)) {
          skipped.push(address.toLowerCase());
          await save({ sentTo, skipped });
          continue;
        }
        const ok = await this.mail.sendPlain(address, fullSubject, lines);
        if (!ok) {
          throw new ServiceUnavailableException({
            message: EMAIL_UNAVAILABLE_MESSAGE,
            code: 'mail_unavailable',
          });
        }
        sentTo.push(address.toLowerCase());
        await save({ sentTo, skipped });
      }

      const skippedRecipients = recipients.filter((address) =>
        skipped.includes(address.toLowerCase()),
      );
      return {
        output: {
          sent: recipients.length - skippedRecipients.length,
          recipients: recipients.map(maskEmail),
          ...(skippedRecipients.length > 0 ? { skipped: skippedRecipients.map(maskEmail) } : {}),
        },
        credits: 0,
      };
    });
  }
}
