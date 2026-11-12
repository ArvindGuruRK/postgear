/**
 * The mail module's two tables of truth: who must not be emailed
 * (`EmailSuppression`, written by Resend's webhook) and the per-person
 * notification switches on `User` that one-click unsubscribe turns off.
 */
import { Injectable } from '@nestjs/common';
import { type EmailSuppressionReason, prisma } from '@postgear/db';
import { TOPIC_COLUMN, type UnsubscribeTopic } from './mail.unsubscribe';

@Injectable()
export class MailRepository {
  async isSuppressed(email: string): Promise<boolean> {
    const row = await prisma.emailSuppression.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true },
    });
    return row !== null;
  }

  /** Records (or refreshes) an address as undeliverable. The latest reason wins. */
  async suppress(entry: {
    email: string;
    reason: EmailSuppressionReason;
    detail: string | null;
    eventId: string | null;
  }): Promise<void> {
    const email = entry.email.trim().toLowerCase();
    await prisma.emailSuppression.upsert({
      where: { email },
      create: { email, reason: entry.reason, detail: entry.detail, eventId: entry.eventId },
      update: { reason: entry.reason, detail: entry.detail, eventId: entry.eventId },
    });
  }

  /** Turns one notification switch off for every account on this address. */
  async unsubscribe(email: string, topic: UnsubscribeTopic): Promise<number> {
    const result = await prisma.user.updateMany({
      where: { email: { equals: email.trim(), mode: 'insensitive' } },
      data: { [TOPIC_COLUMN[topic]]: false },
    });
    return result.count;
  }
}
