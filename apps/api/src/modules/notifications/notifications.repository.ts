/**
 * Persistence for the notification feed, the read cursor and the email outbox.
 *
 * Every read of `Notifications` carries `organizationId` and `deletedAt: null`
 * — the workspace comes from `@CurrentOrg()`, never from the client — and the
 * cursor is keyed on (user, workspace), so reading one workspace's feed never
 * clears another's. The dispatcher's two queries are the only ones that span
 * workspaces, and they are driven by `emailStatus` and `createdAt`, not by a
 * caller.
 *
 * The outbox claim is `updateMany` on one id with the status in the `where`:
 * two API instances that both read a `PENDING` row race on that write, and
 * exactly one of them sees `count === 1`. That is the whole of the
 * "never send twice" guarantee, and it needs no lock.
 */
import { Injectable } from '@nestjs/common';
import { type Prisma, prisma, NotificationEmailStatus, Role } from '@postgear/db';
import type { EmailAudience } from './notifications.types';

/** The columns the feed, the stream and the dispatcher read. */
export const NOTIFICATION_SELECT = {
  id: true,
  organizationId: true,
  type: true,
  title: true,
  content: true,
  link: true,
  meta: true,
  emailStatus: true,
  createdAt: true,
} as const;

export type NotificationRecord = Prisma.NotificationsGetPayload<{
  select: typeof NOTIFICATION_SELECT;
}>;

export interface CreateNotificationInput {
  organizationId: string;
  type: string;
  title: string | null;
  content: string;
  link: string | null;
  meta: Prisma.InputJsonValue | null;
  emailStatus: NotificationEmailStatus;
}

export interface ListInput {
  orgId: string;
  limit: number;
  before?: Date;
}

/** A member the dispatcher may email. */
export interface Recipient {
  email: string;
}

/** How a claimed row's email ends. */
export type EmailOutcome = Extract<NotificationEmailStatus, 'SENT' | 'SKIPPED' | 'FAILED'>;

/** Rows whose email is older than this are never sent: a day-old alert is noise. */
export const EMAIL_MAX_AGE_MS = 24 * 60 * 60_000;

/** A `SENDING` row older than this was claimed by a process that died; it may be claimed again. */
export const SENDING_STALE_MS = 5 * 60_000;

@Injectable()
export class NotificationsRepository {
  async list({ orgId, limit, before }: ListInput): Promise<NotificationRecord[]> {
    return prisma.notifications.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: NOTIFICATION_SELECT,
    });
  }

  /** Rows newer than `since`: the unread count. */
  async countNewerThan(orgId: string, since: Date): Promise<number> {
    return prisma.notifications.count({
      where: { organizationId: orgId, deletedAt: null, createdAt: { gt: since } },
    });
  }

  async findCursor(userId: string, orgId: string): Promise<Date | null> {
    const cursor = await prisma.notificationCursor.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      select: { lastReadAt: true },
    });

    return cursor?.lastReadAt ?? null;
  }

  /** When this user joined the workspace, or null for a superadmin acting without a membership. */
  async findMembershipCreatedAt(userId: string, orgId: string): Promise<Date | null> {
    const membership = await prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      select: { createdAt: true },
    });

    return membership?.createdAt ?? null;
  }

  async upsertCursor(userId: string, orgId: string, lastReadAt: Date): Promise<Date> {
    const cursor = await prisma.notificationCursor.upsert({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      create: { userId, organizationId: orgId, lastReadAt },
      update: { lastReadAt },
      select: { lastReadAt: true },
    });

    return cursor.lastReadAt;
  }

  async create(input: CreateNotificationInput): Promise<NotificationRecord> {
    return prisma.notifications.create({
      data: {
        organizationId: input.organizationId,
        type: input.type,
        title: input.title,
        content: input.content,
        link: input.link,
        meta: input.meta ?? undefined,
        emailStatus: input.emailStatus,
      },
      select: NOTIFICATION_SELECT,
    });
  }

  /**
   * Claims up to `limit` rows whose email is still to be sent, each by a
   * conditional `updateMany` that only one process can win.
   *
   * `PENDING` rows are the usual case. A `SENDING` row whose `updatedAt` is
   * older than {@link SENDING_STALE_MS} was claimed by an instance that never
   * finished — a crash between the claim and the mark — and is offered again.
   */
  async claimPending(limit: number, now: Date): Promise<NotificationRecord[]> {
    const freshest = new Date(now.getTime() - EMAIL_MAX_AGE_MS);
    const stale = new Date(now.getTime() - SENDING_STALE_MS);

    const candidates = await prisma.notifications.findMany({
      where: {
        deletedAt: null,
        createdAt: { gt: freshest },
        OR: [
          { emailStatus: NotificationEmailStatus.PENDING },
          { emailStatus: NotificationEmailStatus.SENDING, updatedAt: { lt: stale } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { ...NOTIFICATION_SELECT, updatedAt: true },
    });

    const claimed: NotificationRecord[] = [];

    for (const candidate of candidates) {
      const { updatedAt, ...row } = candidate;
      const result = await prisma.notifications.updateMany({
        where: {
          id: row.id,
          // The status it had when read. Another instance that got there
          // first has already moved it on, and this write matches nothing.
          emailStatus: row.emailStatus,
          ...(row.emailStatus === NotificationEmailStatus.SENDING ? { updatedAt } : {}),
        },
        data: { emailStatus: NotificationEmailStatus.SENDING },
      });

      if (result.count === 1) {
        claimed.push({ ...row, emailStatus: NotificationEmailStatus.SENDING });
      }
    }

    return claimed;
  }

  async markEmail(id: string, status: EmailOutcome, emailedAt: Date | null): Promise<void> {
    await prisma.notifications.updateMany({
      where: { id },
      data: { emailStatus: status, emailedAt },
    });
  }

  /**
   * The members of a workspace an email about `audience` goes to: live
   * memberships only, filtered by the user's preference or by role.
   * `SUPERADMIN` holds a membership row like anyone else and is an admin.
   */
  async findRecipients(orgId: string, audience: EmailAudience): Promise<Recipient[]> {
    if (audience === 'none') {
      return [];
    }

    const memberships = await prisma.userOrganization.findMany({
      where: {
        organizationId: orgId,
        disabled: false,
        ...(audience === 'admins' ? { role: { in: [Role.ADMIN, Role.SUPERADMIN] } } : {}),
        user: {
          activated: true,
          ...(audience === 'failure_emails' ? { sendFailureEmails: true } : {}),
          ...(audience === 'success_emails' ? { sendSuccessEmails: true } : {}),
        },
      },
      select: { user: { select: { email: true } } },
    });

    const seen = new Set<string>();
    const recipients: Recipient[] = [];

    for (const { user } of memberships) {
      if (!seen.has(user.email)) {
        seen.add(user.email);
        recipients.push({ email: user.email });
      }
    }

    return recipients;
  }

  /** Rows created after `since`, oldest first, for the live push. */
  async findNewerThan(since: Date, limit: number): Promise<NotificationRecord[]> {
    return prisma.notifications.findMany({
      where: { deletedAt: null, createdAt: { gt: since } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: NOTIFICATION_SELECT,
    });
  }
}
