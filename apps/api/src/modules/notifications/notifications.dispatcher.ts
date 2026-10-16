/**
 * The notification dispatcher (Sprint 8, contract §5.2): the email outbox
 * and the live push, on one timer.
 *
 * ## Why an outbox
 *
 * The worker writes the row and the email in one place — the row, with
 * `emailStatus = PENDING` — and this loop in the API turns pending rows into
 * mail through the existing `MailService`. One event, one row, one mail
 * path; a row is never emailed twice because the claim is a conditional
 * `updateMany` only one process can win (see the repository), and a row the
 * mail transport refuses is marked `FAILED` and logged rather than retried
 * forever.
 *
 * ## Why a poll, not a hook
 *
 * The rows that matter most are written by another process (the worker),
 * which cannot call into this one. Polling every few seconds is the simplest
 * thing that notices them, and it doubles as the live push: every row newer
 * than the last poll goes to the open SSE streams of its workspace, whoever
 * wrote it. `NotificationsService.notify()` pushes its own rows at once as
 * well; the stream registry drops the repeat.
 *
 * Ticks never overlap — a slow mail server stretches one tick, it does not
 * stack them — and the timer is `unref`'d so it never keeps the process up.
 * Under `NODE_ENV=test` nothing starts; the suite drives `runOnce()`.
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { securityLogger } from '../../common/logging/security-logger';
import { MailService } from '../mail/mail.service';
import {
  type EmailOutcome,
  type NotificationRecord,
  NotificationsRepository,
} from './notifications.repository';
import { NotificationStreamRegistry } from './notifications.stream';
import { AUDIENCE_BY_TYPE, composeEmail, isNotificationType } from './notifications.types';

export const DISPATCH_INTERVAL_MS = 3_000;

/** Rows claimed per tick. Keeps one tick short even after a burst. */
export const CLAIM_BATCH = 25;

/** Rows pushed per tick. A tab that missed more re-fetches the list on reconnect anyway. */
export const PUSH_BATCH = 200;

export interface DispatchReport {
  emailed: { sent: number; skipped: number; failed: number };
  pushed: number;
}

/** The repository surface the dispatcher uses — what a test fakes. */
export type DispatcherStore = Pick<
  NotificationsRepository,
  'claimPending' | 'findRecipients' | 'markEmail' | 'findNewerThan'
>;

/** The mail surface the dispatcher uses. */
export type DispatcherMail = Pick<MailService, 'sendPlain' | 'linkTo'>;

/** Injection token for a test clock; production takes the real one. */
export const DISPATCHER_CLOCK = Symbol('DISPATCHER_CLOCK');

@Injectable()
export class NotificationsDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsDispatcher.name);
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<DispatchReport> | null = null;
  /** The newest `createdAt` pushed so far; rows after it are new to every stream. */
  private lastSeenAt: Date;

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly mail: MailService,
    private readonly streams: NotificationStreamRegistry,
    private readonly config: ConfigService,
    @Optional() @Inject(DISPATCHER_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
    this.lastSeenAt = this.now();
  }

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      return;
    }
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = DISPATCH_INTERVAL_MS): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One pass: the outbox, then the push. Returns the pass already in flight
   * rather than starting another, so two callers can never overlap.
   */
  runOnce(): Promise<DispatchReport> {
    if (this.running) {
      return this.running;
    }

    this.running = this.pass().finally(() => {
      this.running = null;
    });

    return this.running;
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      // A failed tick is the next tick's problem; the timer keeps going.
      this.logger.error(
        `Dispatch tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async pass(): Promise<DispatchReport> {
    const emailed = await this.drainOutbox();
    const pushed = await this.pushNew();
    return { emailed, pushed };
  }

  /* ───────────────────────── the email outbox ───────────────────────── */

  private async drainOutbox(): Promise<DispatchReport['emailed']> {
    const report = { sent: 0, skipped: 0, failed: 0 };
    const claimed = await this.repository.claimPending(CLAIM_BATCH, this.now());

    for (const row of claimed) {
      const outcome = await this.email(row);
      if (outcome === 'SENT') {
        report.sent += 1;
      } else if (outcome === 'SKIPPED') {
        report.skipped += 1;
      } else {
        report.failed += 1;
      }
    }

    return report;
  }

  /** Emails one claimed row to its audience and records how it went. Never throws. */
  private async email(row: NotificationRecord): Promise<EmailOutcome> {
    let outcome: EmailOutcome = 'FAILED';
    let recipients = 0;
    let delivered = 0;

    try {
      const audience = isNotificationType(row.type) ? AUDIENCE_BY_TYPE[row.type] : 'none';
      const members = await this.repository.findRecipients(row.organizationId, audience);
      recipients = members.length;

      if (members.length === 0) {
        outcome = 'SKIPPED';
      } else {
        const { subject, lines } = composeEmail(row, (path) => this.mail.linkTo(path));

        for (const member of members) {
          if (await this.mail.sendPlain(member.email, subject, lines)) {
            delivered += 1;
          }
        }

        outcome = delivered > 0 ? 'SENT' : 'FAILED';
      }
    } catch (error) {
      this.logger.error(
        `Could not email notification ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      outcome = 'FAILED';
    }

    if (outcome === 'FAILED') {
      securityLogger.warn('notification.email_failed', {
        notificationId: row.id,
        orgId: row.organizationId,
        type: row.type,
        recipients,
        delivered,
      });
    }

    try {
      await this.repository.markEmail(row.id, outcome, outcome === 'SENT' ? this.now() : null);
    } catch (error) {
      // The row stays SENDING; the repository offers it again once it is stale.
      this.logger.error(
        `Could not mark notification ${row.id} ${outcome}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return outcome;
  }

  /* ───────────────────────── the live push ───────────────────────── */

  private async pushNew(): Promise<number> {
    const rows = await this.repository.findNewerThan(this.lastSeenAt, PUSH_BATCH);
    let pushed = 0;

    for (const row of rows) {
      pushed += this.streams.push(row.organizationId, row);
      if (row.createdAt.getTime() > this.lastSeenAt.getTime()) {
        this.lastSeenAt = row.createdAt;
      }
    }

    return pushed;
  }

  /** Where the push has read up to. */
  get seenUpTo(): Date {
    return this.lastSeenAt;
  }
}
