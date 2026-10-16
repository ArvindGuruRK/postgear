/**
 * The dispatcher against a fake outbox and a fake mail transport: what it
 * claims, who it writes to for each type and preference, how a row ends
 * (SENT / SKIPPED / FAILED), the live push and its high-water mark, and that
 * two passes never overlap.
 */
import type { ConfigService } from '@nestjs/config';
import { NotificationEmailStatus } from '@postgear/db';
import { securityLogger } from '../../common/logging/security-logger';
import type { MailService } from '../mail/mail.service';
import {
  CLAIM_BATCH,
  DISPATCH_INTERVAL_MS,
  NotificationsDispatcher,
} from './notifications.dispatcher';
import type {
  NotificationRecord,
  NotificationsRepository,
  Recipient,
} from './notifications.repository';
import { NotificationStreamRegistry, type StreamSink } from './notifications.stream';
import type { EmailAudience } from './notifications.types';

const NOW = new Date('2026-10-16T12:00:00Z');

type Member = { email: string; role: 'ADMIN' | 'USER'; success: boolean; failure: boolean };

/** An in-memory outbox with the repository's claim semantics. */
class FakeRepository {
  rows: NotificationRecord[] = [];
  members = new Map<string, Member[]>();
  claimPending = jest.fn(async (limit: number, _now: Date) => {
    const claimed = this.rows
      .filter((row) => row.emailStatus === NotificationEmailStatus.PENDING)
      .slice(0, limit);
    for (const row of claimed) {
      row.emailStatus = NotificationEmailStatus.SENDING;
    }
    return claimed.map((row) => ({ ...row }));
  });
  findRecipients = jest.fn(async (orgId: string, audience: EmailAudience): Promise<Recipient[]> => {
    const members = this.members.get(orgId) ?? [];
    const wanted = members.filter((m) => {
      switch (audience) {
        case 'failure_emails':
          return m.failure;
        case 'success_emails':
          return m.success;
        case 'admins':
          return m.role === 'ADMIN';
        default:
          return false;
      }
    });
    return wanted.map((m) => ({ email: m.email }));
  });
  markEmail = jest.fn(async (id: string, status: 'SENT' | 'SKIPPED' | 'FAILED', emailedAt: Date | null) => {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row) {
      row.emailStatus = status;
      (row as NotificationRecord & { emailedAt?: Date | null }).emailedAt = emailedAt;
    }
  });
  findNewerThan = jest.fn(async (since: Date, limit: number) =>
    this.rows
      .filter((row) => row.createdAt.getTime() > since.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map((row) => ({ ...row })),
  );

  status(id: string): string | undefined {
    return this.rows.find((row) => row.id === id)?.emailStatus;
  }
}

function row(
  id: string,
  overrides: Partial<NotificationRecord> & { minutesAgo?: number } = {},
): NotificationRecord {
  const { minutesAgo = 0, ...rest } = overrides;
  return {
    id,
    organizationId: 'org_1',
    type: 'post.failed',
    title: 'Post failed',
    content: 'Could not publish to Acme Marketing: rejected',
    link: '/org_1/queue?state=ERROR',
    meta: { channelName: 'Acme Marketing', provider: 'linkedin', reason: 'rejected' },
    emailStatus: NotificationEmailStatus.PENDING,
    createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    ...rest,
  };
}

function fakeSink(): StreamSink & { events: { type: string; data: unknown }[] } {
  const events: { type: string; data: unknown }[] = [];
  return {
    events,
    signal: new AbortController().signal,
    closed: false,
    send: (type, data) => {
      events.push({ type, data });
    },
    close: () => undefined,
  };
}

describe('NotificationsDispatcher', () => {
  let repository: FakeRepository;
  let mail: { sendPlain: jest.Mock; linkTo: jest.Mock };
  let streams: NotificationStreamRegistry;
  let clock: Date;
  let dispatcher: NotificationsDispatcher;
  let warn: jest.SpyInstance;

  const build = (env = 'test') =>
    new NotificationsDispatcher(
      repository as unknown as NotificationsRepository,
      mail as unknown as MailService,
      streams,
      { get: () => env } as unknown as ConfigService,
      () => clock,
    );

  beforeEach(() => {
    repository = new FakeRepository();
    repository.members.set('org_1', [
      { email: 'admin@example.com', role: 'ADMIN', success: true, failure: true },
      { email: 'member@example.com', role: 'USER', success: false, failure: true },
      { email: 'quiet@example.com', role: 'USER', success: false, failure: false },
    ]);
    mail = {
      sendPlain: jest.fn(async () => true),
      linkTo: jest.fn((path: string) => `http://localhost:3000${path}`),
    };
    streams = new NotificationStreamRegistry();
    clock = new Date(NOW.getTime() - 60_000);
    dispatcher = build();
    clock = NOW;
    warn = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    dispatcher.stop();
    streams.closeAll();
    warn.mockRestore();
  });

  describe('the email outbox', () => {
    it('claims a batch, mails each member of the audience, and marks the row SENT', async () => {
      repository.rows.push(row('n1'));

      const report = await dispatcher.runOnce();

      expect(repository.claimPending).toHaveBeenCalledWith(CLAIM_BATCH, NOW);
      expect(repository.findRecipients).toHaveBeenCalledWith('org_1', 'failure_emails');
      expect(mail.sendPlain).toHaveBeenCalledTimes(2);
      expect(mail.sendPlain.mock.calls.map(([to]) => to)).toEqual([
        'admin@example.com',
        'member@example.com',
      ]);
      const [, subject, lines] = mail.sendPlain.mock.calls[0];
      expect(subject).toBe('[PostGear] Could not publish to Acme Marketing on LinkedIn');
      expect(lines).toContain('http://localhost:3000/org_1/queue?state=ERROR');
      expect(repository.markEmail).toHaveBeenCalledWith('n1', 'SENT', NOW);
      expect(report.emailed).toEqual({ sent: 1, skipped: 0, failed: 0 });
      expect(warn).not.toHaveBeenCalled();
    });

    it('picks the audience by type: success emails for a published post, admins for billing', async () => {
      repository.rows.push(
        row('n1', { type: 'post.published', title: 'Post published' }),
        row('n2', { type: 'billing.payment_failed', title: 'Payment failed' }),
        row('n3', { type: 'webhook.failed', title: 'Webhook delivery failed' }),
      );

      await dispatcher.runOnce();

      expect(repository.findRecipients.mock.calls.map(([, audience]) => audience)).toEqual([
        'success_emails',
        'admins',
        'admins',
      ]);
      // Only the admin has success emails on; only the admin is an admin.
      expect(mail.sendPlain.mock.calls.map(([to]) => to)).toEqual([
        'admin@example.com',
        'admin@example.com',
        'admin@example.com',
      ]);
    });

    it('marks SKIPPED, without sending, when nobody wants the mail', async () => {
      repository.members.set('org_1', [
        { email: 'quiet@example.com', role: 'USER', success: false, failure: false },
      ]);
      repository.rows.push(row('n1'));

      const report = await dispatcher.runOnce();

      expect(mail.sendPlain).not.toHaveBeenCalled();
      expect(repository.markEmail).toHaveBeenCalledWith('n1', 'SKIPPED', null);
      expect(report.emailed).toEqual({ sent: 0, skipped: 1, failed: 0 });
    });

    it('never emails a type with no audience, even when its row says PENDING', async () => {
      repository.rows.push(row('n1', { type: 'info', title: null }));

      await dispatcher.runOnce();

      expect(mail.sendPlain).not.toHaveBeenCalled();
      expect(repository.status('n1')).toBe('SKIPPED');
    });

    it('marks FAILED and logs when every send fails, SENT when at least one went out', async () => {
      repository.rows.push(row('n1'), row('n2'));
      mail.sendPlain
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const report = await dispatcher.runOnce();

      expect(repository.markEmail).toHaveBeenCalledWith('n1', 'FAILED', null);
      expect(repository.markEmail).toHaveBeenCalledWith('n2', 'SENT', NOW);
      expect(report.emailed).toEqual({ sent: 1, skipped: 0, failed: 1 });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('notification.email_failed', {
        notificationId: 'n1',
        orgId: 'org_1',
        type: 'post.failed',
        recipients: 2,
        delivered: 0,
      });
    });

    it('marks FAILED when the transport throws, and carries on with the next row', async () => {
      repository.rows.push(row('n1'), row('n2'));
      mail.sendPlain.mockRejectedValueOnce(new Error('SMTP down'));

      const report = await dispatcher.runOnce();

      expect(repository.status('n1')).toBe('FAILED');
      expect(repository.status('n2')).toBe('SENT');
      expect(report.emailed).toEqual({ sent: 1, skipped: 0, failed: 1 });
    });

    it('does not touch a row another instance already claimed', async () => {
      repository.rows.push(row('n1', { emailStatus: NotificationEmailStatus.SENDING }));

      const report = await dispatcher.runOnce();

      expect(mail.sendPlain).not.toHaveBeenCalled();
      expect(report.emailed).toEqual({ sent: 0, skipped: 0, failed: 0 });
    });
  });

  describe('the live push', () => {
    it('pushes rows newer than the last poll to their workspace and advances the mark', async () => {
      const a = fakeSink();
      const b = fakeSink();
      void streams.register('org_1', a, 0);
      void streams.register('org_2', b, 0);
      repository.rows.push(
        row('old', { minutesAgo: 5, emailStatus: NotificationEmailStatus.SENT }),
        row('n1', { minutesAgo: 0.5, emailStatus: NotificationEmailStatus.NONE }),
        row('n2', { organizationId: 'org_2', emailStatus: NotificationEmailStatus.NONE }),
      );

      const first = await dispatcher.runOnce();

      expect(first.pushed).toBe(2);
      expect(a.events.map((event) => event.type)).toEqual(['ready', 'notification']);
      expect(a.events[1].data).toMatchObject({ notification: { id: 'n1', read: false }, unread: 1 });
      expect(b.events[1].data).toMatchObject({ notification: { id: 'n2' }, unread: 1 });
      expect(dispatcher.seenUpTo).toEqual(NOW);

      const second = await dispatcher.runOnce();

      expect(second.pushed).toBe(0);
      expect(repository.findNewerThan).toHaveBeenLastCalledWith(NOW, expect.any(Number));
    });

    it('does not push the same row twice to a stream that already received it', async () => {
      const a = fakeSink();
      void streams.register('org_1', a, 0);
      repository.rows.push(row('n1', { emailStatus: NotificationEmailStatus.NONE }));

      // The service pushed it at write time; the poll sees it again.
      streams.push('org_1', repository.rows[0]);
      const report = await dispatcher.runOnce();

      expect(report.pushed).toBe(0);
      expect(a.events.filter((event) => event.type === 'notification')).toHaveLength(1);
    });
  });

  describe('scheduling', () => {
    it('returns the pass in flight instead of starting another', async () => {
      let release: (rows: NotificationRecord[]) => void = () => undefined;
      repository.claimPending.mockImplementationOnce(
        () => new Promise<NotificationRecord[]>((resolve) => {
          release = resolve;
        }),
      );

      const first = dispatcher.runOnce();
      const second = dispatcher.runOnce();

      expect(second).toBe(first);
      expect(repository.claimPending).toHaveBeenCalledTimes(1);

      release([]);
      await first;

      await dispatcher.runOnce();
      expect(repository.claimPending).toHaveBeenCalledTimes(2);
    });

    it('does not start under NODE_ENV=test', () => {
      jest.useFakeTimers();
      try {
        dispatcher.onModuleInit();
        jest.advanceTimersByTime(DISPATCH_INTERVAL_MS * 3);
        expect(repository.claimPending).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('ticks on its interval otherwise, and stops on shutdown', async () => {
      jest.useFakeTimers();
      try {
        const live = build('development');
        live.onModuleInit();

        await jest.advanceTimersByTimeAsync(DISPATCH_INTERVAL_MS);
        expect(repository.claimPending).toHaveBeenCalledTimes(1);

        live.onModuleDestroy();
        await jest.advanceTimersByTimeAsync(DISPATCH_INTERVAL_MS * 2);
        expect(repository.claimPending).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('survives a failing tick', async () => {
      jest.useFakeTimers();
      try {
        const live = build('development');
        repository.claimPending.mockRejectedValueOnce(new Error('db away'));
        live.onModuleInit();

        await jest.advanceTimersByTimeAsync(DISPATCH_INTERVAL_MS);
        await jest.advanceTimersByTimeAsync(DISPATCH_INTERVAL_MS);
        expect(repository.claimPending).toHaveBeenCalledTimes(2);

        live.stop();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
