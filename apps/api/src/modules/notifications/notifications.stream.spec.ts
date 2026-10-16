/**
 * The stream registry: a push reaches the right workspace only, a repeat of
 * the same row is dropped, an aborted stream is forgotten, and shutdown ends
 * every stream.
 */
import { NotificationStreamRegistry, type StreamSink } from './notifications.stream';

function fakeSink(): StreamSink & {
  events: { type: string; data: unknown }[];
  abort(): void;
  closed: boolean;
} {
  const controller = new AbortController();
  const events: { type: string; data: unknown }[] = [];
  const sink = {
    events,
    closed: false,
    signal: controller.signal,
    send: (type: string, data: unknown) => {
      events.push({ type, data });
    },
    close: () => {
      sink.closed = true;
    },
    abort: () => controller.abort(),
  };
  return sink;
}

const notification = {
  id: 'n1',
  type: 'post.failed',
  title: 'Post failed',
  content: 'Could not publish to Acme Marketing: rejected',
  link: '/org_1/queue?state=ERROR',
  createdAt: new Date('2026-10-16T12:00:00Z'),
};

describe('NotificationStreamRegistry', () => {
  let registry: NotificationStreamRegistry;

  beforeEach(() => {
    registry = new NotificationStreamRegistry();
  });

  afterEach(() => {
    registry.closeAll();
  });

  it('sends ready on register and the row to the workspace it belongs to', () => {
    const a = fakeSink();
    const b = fakeSink();
    void registry.register('org_1', a, 2);
    void registry.register('org_2', b, 0);

    const delivered = registry.push('org_1', notification);

    expect(delivered).toBe(1);
    expect(a.events).toEqual([
      { type: 'ready', data: { unread: 2 } },
      {
        type: 'notification',
        data: {
          notification: { ...notification, createdAt: notification.createdAt.toISOString(), read: false },
          unread: 3,
        },
      },
    ]);
    expect(b.events).toEqual([{ type: 'ready', data: { unread: 0 } }]);
    expect(registry.openWorkspaces().sort()).toEqual(['org_1', 'org_2']);
  });

  it('drops a repeat of a row it has already pushed to a stream', () => {
    const a = fakeSink();
    void registry.register('org_1', a, 0);

    registry.push('org_1', notification);
    registry.push('org_1', notification);
    registry.push('org_1', { ...notification, id: 'n2' });

    expect(a.events.filter((event) => event.type === 'notification')).toHaveLength(2);
    expect(a.events.at(-1)?.data).toMatchObject({ unread: 2 });
  });

  it('forgets a stream when its signal aborts and resolves its lifetime', async () => {
    const a = fakeSink();
    const lifetime = registry.register('org_1', a, 0);
    expect(registry.size('org_1')).toBe(1);

    a.abort();
    await lifetime;

    expect(registry.size('org_1')).toBe(0);
    expect(registry.openWorkspaces()).toEqual([]);
    expect(registry.push('org_1', notification)).toBe(0);
  });

  it('does not register a stream whose client has already gone', async () => {
    const a = fakeSink();
    a.abort();

    await registry.register('org_1', a, 0);

    expect(a.events).toEqual([]);
    expect(registry.size()).toBe(0);
  });

  it('skips a stream that closed without aborting, and drops it', () => {
    const a = fakeSink();
    const b = fakeSink();
    void registry.register('org_1', a, 0);
    void registry.register('org_1', b, 0);
    a.closed = true;

    expect(registry.push('org_1', notification)).toBe(1);
    expect(registry.size('org_1')).toBe(1);
  });

  it('closes every stream on shutdown', async () => {
    const a = fakeSink();
    const b = fakeSink();
    const lifetimes = [registry.register('org_1', a, 0), registry.register('org_2', b, 0)];

    registry.onModuleDestroy();
    await Promise.all(lifetimes);

    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
    expect(registry.size()).toBe(0);
  });
});
