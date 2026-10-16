/**
 * The feed's read state and the API-side write, against a fake repository
 * and a real stream registry.
 *
 * The property that matters most is how "read" is derived: from the cursor
 * when there is one, from the membership's join date when there is not, and
 * from the beginning of time for a superadmin with neither.
 */
import { NotificationEmailStatus } from '@postgear/db';
import type {
  CreateNotificationInput,
  NotificationRecord,
  NotificationsRepository,
} from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { NotificationStreamRegistry, type StreamSink } from './notifications.stream';

const T0 = new Date('2026-10-16T10:00:00Z');
const T1 = new Date('2026-10-16T11:00:00Z');
const T2 = new Date('2026-10-16T12:00:00Z');

function row(id: string, createdAt: Date, overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id,
    organizationId: 'org_1',
    type: 'post.published',
    title: 'Post published',
    content: `Published ${id}`,
    link: null,
    meta: null,
    emailStatus: NotificationEmailStatus.NONE,
    createdAt,
    ...overrides,
  };
}

function fakeSink(): StreamSink & { events: { type: string; data: unknown }[] } {
  const controller = new AbortController();
  const events: { type: string; data: unknown }[] = [];
  return {
    events,
    signal: controller.signal,
    closed: false,
    send: (type, data) => {
      events.push({ type, data });
    },
    close: () => undefined,
  };
}

type RepositoryMock = Record<
  'list' | 'countNewerThan' | 'findCursor' | 'findMembershipCreatedAt' | 'upsertCursor' | 'create',
  jest.Mock
>;

describe('NotificationsService', () => {
  let repository: RepositoryMock;
  let streams: NotificationStreamRegistry;
  let service: NotificationsService;

  beforeEach(() => {
    repository = {
      list: jest.fn(async () => [row('n1', T2), row('n2', T1), row('n3', T0)]),
      countNewerThan: jest.fn(async () => 0),
      findCursor: jest.fn(async () => null),
      findMembershipCreatedAt: jest.fn(async () => null),
      upsertCursor: jest.fn(async (_u, _o, at: Date) => at),
      create: jest.fn(),
    };
    streams = new NotificationStreamRegistry();
    service = new NotificationsService(
      repository as unknown as NotificationsRepository,
      streams,
    );
  });

  afterEach(() => {
    streams.closeAll();
  });

  describe('read state', () => {
    it('reads from the cursor when there is one', async () => {
      repository.findCursor.mockResolvedValue(T1);
      repository.countNewerThan.mockResolvedValue(1);

      const page = await service.list('u1', 'org_1', { limit: 20 });

      expect(page.notifications.map((item) => [item.id, item.read])).toEqual([
        ['n1', false],
        ['n2', true],
        ['n3', true],
      ]);
      expect(page.unread).toBe(1);
      expect(page.lastReadAt).toBe(T1.toISOString());
      expect(repository.countNewerThan).toHaveBeenCalledWith('org_1', T1);
      expect(repository.findMembershipCreatedAt).not.toHaveBeenCalled();
    });

    it('falls back to the membership date when there is no cursor', async () => {
      repository.findMembershipCreatedAt.mockResolvedValue(T0);
      repository.countNewerThan.mockResolvedValue(2);

      const page = await service.list('u1', 'org_1', { limit: 20 });

      expect(page.notifications.map((item) => item.read)).toEqual([false, false, true]);
      expect(page.unread).toBe(2);
      expect(page.lastReadAt).toBeNull();
      expect(repository.countNewerThan).toHaveBeenCalledWith('org_1', T0);
    });

    it('counts everything for a superadmin with neither cursor nor membership', async () => {
      const page = await service.list('u1', 'org_1', { limit: 20 });

      expect(page.notifications.every((item) => !item.read)).toBe(true);
      expect(repository.countNewerThan).toHaveBeenCalledWith('org_1', new Date(0));
    });

    it('passes the page bounds through and parses the cursor', async () => {
      await service.list('u1', 'org_1', { limit: 5, before: T1.toISOString() });

      expect(repository.list).toHaveBeenCalledWith({ orgId: 'org_1', limit: 5, before: T1 });
    });

    it('unread uses the same derivation', async () => {
      repository.findCursor.mockResolvedValue(T2);
      repository.countNewerThan.mockResolvedValue(0);

      expect(await service.unread('u1', 'org_1')).toBe(0);
      expect(repository.countNewerThan).toHaveBeenCalledWith('org_1', T2);
    });
  });

  describe('readAll', () => {
    it('upserts the cursor to now and answers zero', async () => {
      const result = await service.readAll('u1', 'org_1', T2);

      expect(repository.upsertCursor).toHaveBeenCalledWith('u1', 'org_1', T2);
      expect(result).toEqual({ unread: 0, lastReadAt: T2.toISOString() });
    });
  });

  describe('openStream', () => {
    it('sends ready with the unread count and keeps the stream until it aborts', async () => {
      repository.findCursor.mockResolvedValue(T0);
      repository.countNewerThan.mockResolvedValue(3);
      const sink = fakeSink();
      const controller = new AbortController();
      Object.defineProperty(sink, 'signal', { value: controller.signal });

      let settled = false;
      const lifetime = service.openStream('u1', 'org_1', sink).then(() => {
        settled = true;
      });
      // The unread count is two awaited reads away; a macrotask lets them run.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sink.events).toEqual([{ type: 'ready', data: { unread: 3 } }]);
      expect(streams.size('org_1')).toBe(1);
      expect(settled).toBe(false);

      controller.abort();
      await lifetime;

      expect(settled).toBe(true);
      expect(streams.size('org_1')).toBe(0);
    });
  });

  describe('notify', () => {
    beforeEach(() => {
      repository.create.mockImplementation(async (input: CreateNotificationInput) => ({
        id: 'n_new',
        organizationId: input.organizationId,
        type: input.type,
        title: input.title,
        content: input.content,
        link: input.link,
        meta: input.meta,
        emailStatus: input.emailStatus,
        createdAt: T2,
      }));
    });

    it('writes a PENDING row with the catalogue title and pushes it to the workspace', async () => {
      const sink = fakeSink();
      void streams.register('org_1', sink, 0);
      const other = fakeSink();
      void streams.register('org_2', other, 0);

      const created = await service.notify({
        organizationId: 'org_1',
        type: 'billing.payment_failed',
        content: 'The last payment for PostGear Demo Org failed.',
        link: '/org_1/settings/billing',
        meta: { tier: 'PRO' },
      });

      expect(repository.create).toHaveBeenCalledWith({
        organizationId: 'org_1',
        type: 'billing.payment_failed',
        title: 'Payment failed',
        content: 'The last payment for PostGear Demo Org failed.',
        link: '/org_1/settings/billing',
        meta: { tier: 'PRO' },
        emailStatus: NotificationEmailStatus.PENDING,
      });
      expect(created.id).toBe('n_new');
      expect(sink.events).toEqual([
        { type: 'ready', data: { unread: 0 } },
        {
          type: 'notification',
          data: {
            notification: {
              id: 'n_new',
              type: 'billing.payment_failed',
              title: 'Payment failed',
              content: 'The last payment for PostGear Demo Org failed.',
              link: '/org_1/settings/billing',
              createdAt: T2.toISOString(),
              read: false,
            },
            unread: 1,
          },
        },
      ]);
      expect(other.events).toEqual([{ type: 'ready', data: { unread: 0 } }]);
    });

    it('writes NONE when email is declined, and for a type nobody is mailed about', async () => {
      await service.notify({
        organizationId: 'org_1',
        type: 'billing.activated',
        content: 'Your PRO plan is active.',
        email: false,
      });
      await service.notify({ organizationId: 'org_1', type: 'info', content: 'Hello.' });

      expect(
        repository.create.mock.calls.map(([input]: [CreateNotificationInput]) => input.emailStatus),
      ).toEqual([
        NotificationEmailStatus.NONE,
        NotificationEmailStatus.NONE,
      ]);
    });

    it('keeps a title the caller gave', async () => {
      await service.notify({
        organizationId: 'org_1',
        type: 'billing.trial_started',
        title: 'Your 14-day trial has started',
        content: 'Enjoy PRO until October 30.',
      });

      expect(repository.create.mock.calls[0][0].title).toBe('Your 14-day trial has started');
    });
  });
});
