/**
 * What an outbound webhook carries, and how deliveries are enqueued (Sprint 8).
 *
 * ## One row per occurrence
 *
 * `deliveryKey` is `<webhookId>:<event>:<subjectId>`, unique in the table.
 * The publish activities that create deliveries can be retried by Temporal;
 * `createMany({ skipDuplicates })` on that key means a retry finds the rows
 * already there and enqueues nothing twice. A test send uses a fresh id as
 * its subject, so every test is its own delivery.
 *
 * ## The payload is built once, at enqueue time
 *
 * It is stored on the row and sent as-is on every attempt, so a receiver
 * that sees a retry sees the same bytes (and the same signature input) as the
 * first try, and so a post edited after it published does not change what a
 * delivery about the publish says.
 */
import type { Prisma } from '@postgear/db';
import type { WebhookDeliveryEvent, WebhookEvent } from '@postgear/scheduling';

export interface WebhookPostPayload {
  /** The post as a person sees it: the group id. */
  id: string;
  /** The root row of this channel's chain. */
  rootId: string;
  state: 'PUBLISHED' | 'ERROR' | 'QUEUE' | 'DRAFT';
  publishAt: string;
  url: string | null;
  preview: string;
  channel: { id: string; name: string; provider: string };
}

export interface WebhookErrorPayload {
  reason: string;
  message: string;
  attempts: number;
}

export interface WebhookPayload {
  id: string;
  event: WebhookDeliveryEvent;
  createdAt: string;
  workspaceId: string;
  data: { post: WebhookPostPayload; error?: WebhookErrorPayload };
}

export function webhookDeliveryKey(webhookId: string, event: string, subjectId: string): string {
  return `${webhookId}:${event}:${subjectId}`;
}

/** A sample post for test sends, so a receiver sees the real shape before any post exists. */
export function sampleWebhookPost(workspaceId: string): WebhookPostPayload {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    rootId: 'sample-post',
    state: 'PUBLISHED',
    publishAt: new Date().toISOString(),
    url: 'https://example.com/posts/sample',
    preview: 'A sample post from PostGear to show what a delivery looks like.',
    channel: { id: `sample-channel-${workspaceId.slice(0, 8)}`, name: 'Sample channel', provider: 'linkedin' },
  };
}

/** The payload with the delivery's own id and time filled in. Pure. */
export function buildWebhookPayload(params: {
  deliveryId: string;
  event: WebhookDeliveryEvent;
  workspaceId: string;
  post: WebhookPostPayload;
  error?: WebhookErrorPayload;
  now?: Date;
}): WebhookPayload {
  return {
    id: params.deliveryId,
    event: params.event,
    createdAt: (params.now ?? new Date()).toISOString(),
    workspaceId: params.workspaceId,
    data: params.error ? { post: params.post, error: params.error } : { post: params.post },
  };
}

/** The subset of a Prisma client the enqueue needs: the real client or a transaction. */
export type WebhookEnqueueClient = {
  webhooks: { findMany: Prisma.WebhooksDelegate['findMany'] };
  webhookDelivery: {
    createMany: Prisma.WebhookDeliveryDelegate['createMany'];
    findMany: Prisma.WebhookDeliveryDelegate['findMany'];
  };
};

export interface EnqueueWebhooksInput {
  organizationId: string;
  event: WebhookEvent;
  /** The channel the event happened on; hooks scoped to other channels are skipped. */
  integrationId: string;
  /** What `deliveryKey` is keyed on: the root post id. */
  subjectId: string;
  post: WebhookPostPayload;
  error?: WebhookErrorPayload;
  now?: Date;
}

/**
 * Creates one PENDING delivery per matching webhook and returns their ids.
 *
 * Matching: the workspace's live, enabled hooks whose `events` include the
 * event and whose channel list is empty (every channel) or names this one.
 * Idempotent on `deliveryKey`; the ids returned are of every matching row,
 * including ones an earlier run created, so a retry still starts the
 * workflows it may have missed.
 */
export async function enqueueWebhookDeliveries(
  client: WebhookEnqueueClient,
  input: EnqueueWebhooksInput,
): Promise<string[]> {
  const hooks = await client.webhooks.findMany({
    where: {
      organizationId: input.organizationId,
      deletedAt: null,
      disabled: false,
      events: { has: input.event },
      OR: [
        { integrations: { none: {} } },
        { integrations: { some: { integrationId: input.integrationId } } },
      ],
    },
    select: { id: true },
  });

  if (hooks.length === 0) {
    return [];
  }

  const keys = hooks.map((hook) => webhookDeliveryKey(hook.id, input.event, input.subjectId));

  // The delivery id is minted here so the stored payload can carry it; the
  // id of a row that already existed is read back below.
  await client.webhookDelivery.createMany({
    data: hooks.map((hook, index) => {
      const deliveryId = crypto.randomUUID();
      return {
        id: deliveryId,
        organizationId: input.organizationId,
        webhookId: hook.id,
        event: input.event,
        deliveryKey: keys[index],
        payload: buildWebhookPayload({
          deliveryId,
          event: input.event,
          workspaceId: input.organizationId,
          post: input.post,
          error: input.error,
          now: input.now,
        }) as unknown as Prisma.InputJsonValue,
      };
    }),
    skipDuplicates: true,
  });

  const rows = await client.webhookDelivery.findMany({
    where: { deliveryKey: { in: keys } },
    select: { id: true },
  });

  return rows.map((row) => row.id);
}
