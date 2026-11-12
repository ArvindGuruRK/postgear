/**
 * Resend's delivery webhook: bounces and spam complaints.
 *
 * Resend signs every delivery the Standard Webhooks way (svix-id,
 * svix-timestamp, svix-signature over the exact body bytes, five minutes of
 * clock tolerance), verified here with the reference library. Anything that
 * does not verify is a 400 and a security event.
 *
 * What it changes:
 * - `email.bounced` with a **Permanent** bounce: the address goes on the
 *   suppression list (BOUNCE). Transient and undetermined bounces change
 *   nothing; the mailbox may be full today and fine tomorrow.
 * - `email.complained`: the address goes on the list (COMPLAINT).
 * - Every other event is acknowledged and ignored, so Resend stops retrying.
 *
 * The list stops invitations, notifications and workflow emails, never the
 * account and security mail (see `MailService`). Writing the same address
 * twice is harmless (an upsert), so a redelivered event needs no bookkeeping.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailSuppressionReason } from '@postgear/db';
import { Webhook } from 'standardwebhooks';
import { securityLogger } from '../../common/logging/security-logger';
import { MailRepository } from './mail.repository';
import { maskAddress } from './mail.service';

export interface ResendWebhookHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

export interface ResendWebhookReceipt {
  received: true;
  type: string;
  suppressed: number;
}

interface ResendEvent {
  type?: unknown;
  data?: {
    to?: unknown;
    bounce?: { type?: unknown; subType?: unknown };
  };
}

export const MAIL_WEBHOOK_MESSAGES = {
  NOT_CONFIGURED: 'Mail webhooks are not set up on this server.',
  REJECTED: 'The webhook signature could not be verified.',
} as const;

@Injectable()
export class MailWebhookService {
  private readonly logger = new Logger('MailWebhook');
  private readonly secret: string | null;

  constructor(
    private readonly repository: MailRepository,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('RESEND_WEBHOOK_SECRET') || null;
  }

  async receive(
    rawBody: Buffer | undefined,
    headers: ResendWebhookHeaders,
  ): Promise<ResendWebhookReceipt> {
    if (!this.secret) {
      throw new ServiceUnavailableException(MAIL_WEBHOOK_MESSAGES.NOT_CONFIGURED);
    }

    let event: ResendEvent;
    try {
      if (!rawBody || !headers.id || !headers.timestamp || !headers.signature) {
        throw new Error('missing body or signature headers');
      }
      event = new Webhook(this.secret).verify(rawBody.toString('utf8'), {
        'webhook-id': headers.id,
        'webhook-timestamp': headers.timestamp,
        'webhook-signature': headers.signature,
      }) as ResendEvent;
    } catch (error) {
      securityLogger.warn('mail.webhook_rejected', {
        reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
        hasSignature: Boolean(headers.signature),
        hasBody: Boolean(rawBody),
      });
      throw new BadRequestException(MAIL_WEBHOOK_MESSAGES.REJECTED);
    }

    const type = typeof event.type === 'string' ? event.type : 'unknown';
    const outcome = suppressionFor(event);
    if (!outcome) {
      return { received: true, type, suppressed: 0 };
    }

    for (const address of outcome.addresses) {
      await this.repository.suppress({
        email: address,
        reason: outcome.reason,
        detail: outcome.detail,
        eventId: headers.id ?? null,
      });
      this.logger.warn(
        JSON.stringify({
          event: 'mail.address_suppressed',
          reason: outcome.reason,
          to: maskAddress(address),
          detail: outcome.detail,
        }),
      );
    }

    return { received: true, type, suppressed: outcome.addresses.length };
  }
}

/** What a verified event means for the list, or null when it means nothing. */
export function suppressionFor(
  event: ResendEvent,
): { reason: EmailSuppressionReason; addresses: string[]; detail: string | null } | null {
  const addresses = (Array.isArray(event.data?.to) ? event.data.to : [])
    .filter((value): value is string => typeof value === 'string' && value.includes('@'))
    .map((value) => value.trim().toLowerCase())
    .slice(0, 50);
  if (addresses.length === 0) return null;

  if (event.type === 'email.complained') {
    return { reason: 'COMPLAINT', addresses, detail: 'Marked as spam' };
  }

  if (event.type === 'email.bounced') {
    const bounceType = event.data?.bounce?.type;
    if (typeof bounceType !== 'string' || bounceType.toLowerCase() !== 'permanent') {
      return null;
    }
    const subType = event.data?.bounce?.subType;
    const detail = `Permanent${typeof subType === 'string' && subType ? `, ${subType}` : ''}`;
    return { reason: 'BOUNCE', addresses, detail: detail.slice(0, 120) };
  }

  return null;
}
