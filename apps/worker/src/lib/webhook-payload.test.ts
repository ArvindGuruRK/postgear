/**
 * The payload shape and the enqueue against a fake Prisma client: which hooks
 * match, the delivery key, idempotency on a retry, and that the stored
 * payload carries the delivery's own id.
 */
import {
  buildWebhookPayload,
  enqueueWebhookDeliveries,
  type WebhookEnqueueClient,
  webhookDeliveryKey,
} from './webhook-payload';

const post = {
  id: 'group-1',
  rootId: 'root-1',
  state: 'PUBLISHED' as const,
  publishAt: '2026-10-16T10:00:00.000Z',
  url: 'https://linkedin.com/feed/update/1',
  preview: 'Hello',
  channel: { id: 'ch-1', name: 'Acme Marketing', provider: 'linkedin' },
};

describe('webhook payload', () => {
  it('keys a delivery on the hook, the event and the subject', () => {
    expect(webhookDeliveryKey('hook-1', 'post.published', 'root-1')).toBe(
      'hook-1:post.published:root-1',
    );
  });

  it('builds the documented envelope, with the error block only when there is one', () => {
    const now = new Date('2026-10-16T10:00:01Z');
    expect(
      buildWebhookPayload({ deliveryId: 'd-1', event: 'post.published', workspaceId: 'org', post, now }),
    ).toEqual({
      id: 'd-1',
      event: 'post.published',
      createdAt: '2026-10-16T10:00:01.000Z',
      workspaceId: 'org',
      data: { post },
    });

    const failed = buildWebhookPayload({
      deliveryId: 'd-2',
      event: 'post.failed',
      workspaceId: 'org',
      post: { ...post, state: 'ERROR', url: null },
      error: { reason: 'needs_reconnect', message: 'Reconnect it', attempts: 1 },
      now,
    });
    expect(failed.data.error).toEqual({ reason: 'needs_reconnect', message: 'Reconnect it', attempts: 1 });
  });
});

describe('enqueueWebhookDeliveries', () => {
  function fakeClient(hooks: { id: string }[]) {
    const created: Record<string, unknown>[] = [];
    const existing = new Map<string, { id: string }>();
    const client = {
      webhooks: { findMany: jest.fn().mockResolvedValue(hooks) },
      webhookDelivery: {
        createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
          let count = 0;
          for (const row of data) {
            const key = row.deliveryKey as string;
            if (!existing.has(key)) {
              existing.set(key, { id: row.id as string });
              created.push(row);
              count += 1;
            }
          }
          return { count };
        }),
        findMany: jest.fn(async ({ where }: { where: { deliveryKey: { in: string[] } } }) =>
          where.deliveryKey.in.flatMap((key) => {
            const row = existing.get(key);
            return row ? [row] : [];
          }),
        ),
      },
    };
    return { client: client as unknown as WebhookEnqueueClient, created, raw: client };
  }

  const input = {
    organizationId: 'org-1',
    event: 'post.published' as const,
    integrationId: 'ch-1',
    subjectId: 'root-1',
    post,
  };

  it('asks only for live, enabled hooks subscribed to the event on this channel or every channel', async () => {
    const { client, raw } = fakeClient([]);

    expect(await enqueueWebhookDeliveries(client, input)).toEqual([]);

    expect(raw.webhooks.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        deletedAt: null,
        disabled: false,
        events: { has: 'post.published' },
        OR: [{ integrations: { none: {} } }, { integrations: { some: { integrationId: 'ch-1' } } }],
      },
      select: { id: true },
    });
    expect(raw.webhookDelivery.createMany).not.toHaveBeenCalled();
  });

  it('creates one PENDING row per hook whose stored payload carries its own delivery id', async () => {
    const { client, created } = fakeClient([{ id: 'hook-a' }, { id: 'hook-b' }]);

    const ids = await enqueueWebhookDeliveries(client, input);

    expect(ids).toHaveLength(2);
    expect(created.map((row) => row.deliveryKey)).toEqual([
      'hook-a:post.published:root-1',
      'hook-b:post.published:root-1',
    ]);
    for (const row of created) {
      expect(ids).toContain(row.id);
      expect((row.payload as { id: string }).id).toBe(row.id);
      expect((row.payload as { data: { post: unknown } }).data.post).toEqual(post);
    }
  });

  it('is idempotent: a second run finds the rows and returns the same ids', async () => {
    const { client, raw } = fakeClient([{ id: 'hook-a' }]);

    const first = await enqueueWebhookDeliveries(client, input);
    const second = await enqueueWebhookDeliveries(client, input);

    expect(second).toEqual(first);
    expect(raw.webhookDelivery.createMany).toHaveBeenCalledTimes(2);
    expect(raw.webhookDelivery.createMany.mock.calls[1][0]).toMatchObject({ skipDuplicates: true });
  });
});
