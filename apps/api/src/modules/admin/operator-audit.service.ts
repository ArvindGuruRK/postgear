/**
 * The record of every operator write (Sprint 12, Module 19 section 7): one
 * `operator.action` security event, and one mail to `OWNER_EMAIL` per save,
 * so the owner hears of every change to plans, overrides, usage, the library
 * and every rights request removal, whoever made it.
 *
 * **Outside production the mail is printed to the API console, never sent.**
 * A developer's `.env` may hold a real Resend key and the owner's real
 * address; a test save on a laptop must not reach their inbox. In production
 * (staging included) it goes through `MailService` like any other mail, and a
 * failed send is logged, never a failed save: the change is already
 * committed and in the Change Log.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { securityLogger } from '../../common/logging/security-logger';
import { MailService } from '../mail/mail.service';

export interface OperatorActionRecord {
  /** A dotted name, such as `clips.video_removed` or `plans.saved`. */
  action: string;
  /** The mail's subject after "Operator change: ". Plain words, Title Case not needed. */
  summary: string;
  /** One line per change, already in words ("Clips Storage, Pro: 50 GB to 60 GB"). */
  lines: string[];
  reason: string;
  /** Ids the log should carry (workspace, video, key...). Never secrets. */
  target?: Record<string, unknown>;
}

@Injectable()
export class OperatorAuditService {
  private readonly logger = new Logger(OperatorAuditService.name);
  private readonly ownerEmail: string | null;
  private readonly production: boolean;

  constructor(
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.ownerEmail = config.get<string>('OWNER_EMAIL') || null;
    this.production = config.get<string>('NODE_ENV') === 'production';
  }

  async record(
    actor: Pick<AuthenticatedUser, 'id' | 'email'>,
    record: OperatorActionRecord,
  ): Promise<void> {
    securityLogger.log('operator.action', {
      action: record.action,
      actorId: actor.id,
      actorEmail: actor.email,
      reason: record.reason,
      ...(record.target ?? {}),
    });

    const subject = `Operator change: ${record.summary}`;
    const lines = [
      ...record.lines,
      `Reason: ${record.reason}`,
      `By: ${actor.email}`,
      `When: ${new Date().toISOString()}`,
    ];
    if (!this.ownerEmail) return;
    if (!this.production) {
      this.logger.log(
        JSON.stringify({
          event: 'operator.mail_not_sent',
          note: 'Outside production the owner mail is printed here, never sent.',
          to: this.ownerEmail,
          subject,
          lines,
        }),
      );
      return;
    }
    try {
      const sent = await this.mail.sendPlain(this.ownerEmail, subject, lines);
      if (!sent)
        this.logger.warn(JSON.stringify({ event: 'operator.mail_failed', action: record.action }));
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'operator.mail_failed',
          action: record.action,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
