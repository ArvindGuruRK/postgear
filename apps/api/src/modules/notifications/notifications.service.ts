/**
 * The notification feed and its read state (Sprint 8, contract §5.2).
 *
 * ## Read state is a cursor, not a flag per row
 *
 * Rows are workspace-scoped (the worker has written them since Sprint 5) and
 * have no per-user state. "Read" is derived: a row is read when it is no
 * older than the viewer's `NotificationCursor.lastReadAt` for this workspace,
 * and a viewer with no cursor yet has read nothing since they joined; the
 * membership's `createdAt` stands in, so a new member is not greeted by a
 * year of history as unread. A superadmin acting without a membership has no
 * join date; for them everything counts until they mark all read.
 *
 * ## `notify()` is the API-side write
 *
 * Billing and webhooks call it; the worker writes its own rows directly. It
 * pushes the row to the open streams of the workspace at once rather than
 * waiting for the dispatcher's next poll: the dispatcher will see it too,
 * and the stream registry drops the repeat.
 */
import { Injectable } from '@nestjs/common';
import { NotificationEmailStatus, type Prisma } from '@postgear/db';
import type { StreamSink } from './notifications.stream';
import { NotificationStreamRegistry } from './notifications.stream';
import type { ListNotificationsQuery } from './dto/notifications.schema';
import {
  type NotificationRecord,
  NotificationsRepository,
} from './notifications.repository';
import {
  AUDIENCE_BY_TYPE,
  DEFAULT_TITLES,
  type NotificationMeta,
  type NotificationType,
} from './notifications.types';

export interface NotificationView {
  id: string;
  type: string;
  title: string | null;
  content: string;
  link: string | null;
  createdAt: string;
  read: boolean;
}

export interface NotificationsPage {
  notifications: NotificationView[];
  unread: number;
  lastReadAt: string | null;
}

export interface NotifyInput {
  organizationId: string;
  type: NotificationType;
  /** Defaults to the type's catalogue title. */
  title?: string;
  content: string;
  /** An app path (`/<orgId>/settings/billing`) or an absolute URL. */
  link?: string | null;
  meta?: NotificationMeta;
  /**
   * Whether the dispatcher should email the type's audience. Defaults to
   * true; a type whose audience is `none` is never emailed regardless.
   */
  email?: boolean;
}

/** What the viewer's read state resolves to. */
export interface ReadState {
  /** Rows created at or before this instant are read. */
  since: Date;
  /** The cursor row's value, or null when the membership date stood in. */
  lastReadAt: Date | null;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly streams: NotificationStreamRegistry,
  ) {}

  async list(userId: string, orgId: string, query: ListNotificationsQuery): Promise<NotificationsPage> {
    const before = query.before ? new Date(query.before) : undefined;
    const [state, rows] = await Promise.all([
      this.readState(userId, orgId),
      this.repository.list({ orgId, limit: query.limit, before }),
    ]);
    const unread = await this.repository.countNewerThan(orgId, state.since);

    return {
      notifications: rows.map((row) => toView(row, state.since)),
      unread,
      lastReadAt: state.lastReadAt?.toISOString() ?? null,
    };
  }

  async unread(userId: string, orgId: string): Promise<number> {
    const state = await this.readState(userId, orgId);
    return this.repository.countNewerThan(orgId, state.since);
  }

  async readAll(userId: string, orgId: string, now = new Date()): Promise<{ unread: 0; lastReadAt: string }> {
    const lastReadAt = await this.repository.upsertCursor(userId, orgId, now);
    return { unread: 0, lastReadAt: lastReadAt.toISOString() };
  }

  /**
   * Attaches a stream to the workspace: `ready { unread }` first, then every
   * new row until the client goes. Resolves when the stream is released.
   */
  async openStream(userId: string, orgId: string, sink: StreamSink): Promise<void> {
    const unread = await this.unread(userId, orgId);
    await this.streams.register(orgId, sink, unread);
  }

  /** Writes a row and pushes it to the workspace's open streams. */
  async notify(input: NotifyInput): Promise<NotificationRecord> {
    const audience = AUDIENCE_BY_TYPE[input.type];
    const email = (input.email ?? true) && audience !== 'none';

    const row = await this.repository.create({
      organizationId: input.organizationId,
      type: input.type,
      title: input.title ?? DEFAULT_TITLES[input.type],
      content: input.content,
      link: input.link ?? null,
      meta: input.meta ? (input.meta as Prisma.InputJsonValue) : null,
      emailStatus: email ? NotificationEmailStatus.PENDING : NotificationEmailStatus.NONE,
    });

    this.streams.push(row.organizationId, row);

    return row;
  }

  /** The cursor, or the membership date, or the beginning of time. */
  async readState(userId: string, orgId: string): Promise<ReadState> {
    const lastReadAt = await this.repository.findCursor(userId, orgId);

    if (lastReadAt) {
      return { since: lastReadAt, lastReadAt };
    }

    const joinedAt = await this.repository.findMembershipCreatedAt(userId, orgId);

    return { since: joinedAt ?? new Date(0), lastReadAt: null };
  }
}

export function toView(row: NotificationRecord, since: Date): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    link: row.link,
    createdAt: row.createdAt.toISOString(),
    read: row.createdAt.getTime() <= since.getTime(),
  };
}
