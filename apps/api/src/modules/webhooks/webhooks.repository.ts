/**
 * Persistence for outbound webhooks (Sprint 8) — and, like the channels
 * repository, an encryption boundary: the signing secret is AES-256-GCM
 * ciphertext in the row and plaintext only in the one method that mints it.
 * Nothing here ever reads it back out for a caller; the worker decrypts at
 * send time, and the API only ever *replaces* it (rotation).
 *
 * Every read filters `deletedAt: null`; every `where` carries the workspace.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { encrypt, type Prisma, prisma, WebhookDeliveryStatus } from '@postgear/db';
import type { WebhookDeliveryEvent, WebhookEvent } from '@postgear/scheduling';

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  events: string[];
  channelIds: string[];
  disabled: boolean;
  createdAt: Date;
}

export interface DeliveryRow {
  id: string;
  webhookId: string;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface WriteWebhookInput {
  name: string;
  url: string;
  events: WebhookEvent[];
  channelIds: string[];
}

/** `whsec_` + 43 chars of base64url: 32 random bytes, the size of an HMAC-SHA256 key. */
export function mintWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

const WEBHOOK_SELECT = {
  id: true,
  name: true,
  url: true,
  events: true,
  disabled: true,
  createdAt: true,
  integrations: { select: { integrationId: true } },
} as const;

type WebhookRecord = Prisma.WebhooksGetPayload<{ select: typeof WEBHOOK_SELECT }>;

const DELIVERY_SELECT = {
  id: true,
  webhookId: true,
  event: true,
  status: true,
  attempts: true,
  lastStatusCode: true,
  lastError: true,
  lastAttemptAt: true,
  deliveredAt: true,
  createdAt: true,
} as const;

@Injectable()
export class WebhooksRepository {
  async listForOrg(orgId: string): Promise<WebhookRow[]> {
    const rows = await prisma.webhooks.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: WEBHOOK_SELECT,
    });
    return rows.map(toRow);
  }

  async countForOrg(orgId: string): Promise<number> {
    return prisma.webhooks.count({ where: { organizationId: orgId, deletedAt: null } });
  }

  async findById(orgId: string, id: string): Promise<WebhookRow | null> {
    const row = await prisma.webhooks.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: WEBHOOK_SELECT,
    });
    return row ? toRow(row) : null;
  }

  /** Which of `ids` are live channels of this workspace. */
  async liveChannelIds(orgId: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }
    const rows = await prisma.integration.findMany({
      where: { id: { in: ids }, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  /** Creates a hook and returns it with the one-time plaintext secret. */
  async create(orgId: string, input: WriteWebhookInput): Promise<{ webhook: WebhookRow; secret: string }> {
    const secret = mintWebhookSecret();
    const row = await prisma.webhooks.create({
      data: {
        organizationId: orgId,
        name: input.name,
        url: input.url,
        events: input.events,
        secret: encrypt(secret),
        integrations: { create: input.channelIds.map((integrationId) => ({ integrationId })) },
      },
      select: WEBHOOK_SELECT,
    });
    return { webhook: toRow(row), secret };
  }

  /**
   * Updates the fields given. The channel list is replaced whole inside the
   * same transaction as the row, so a crash between the two cannot leave a
   * hook pointed at half its channels.
   */
  async update(
    orgId: string,
    id: string,
    input: Partial<WriteWebhookInput> & { disabled?: boolean },
  ): Promise<WebhookRow | null> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.webhooks.findFirst({
        where: { id, organizationId: orgId, deletedAt: null },
        select: { id: true },
      });
      if (!current) {
        return null;
      }

      if (input.channelIds !== undefined) {
        await tx.integrationsWebhooks.deleteMany({ where: { webhookId: id } });
        if (input.channelIds.length > 0) {
          await tx.integrationsWebhooks.createMany({
            data: input.channelIds.map((integrationId) => ({ webhookId: id, integrationId })),
          });
        }
      }

      const row = await tx.webhooks.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.events !== undefined ? { events: input.events } : {}),
          ...(input.disabled !== undefined ? { disabled: input.disabled } : {}),
        },
        select: WEBHOOK_SELECT,
      });
      return toRow(row);
    });
  }

  /** Replaces the secret; the old one stops verifying at once. */
  async rotateSecret(orgId: string, id: string): Promise<{ webhook: WebhookRow; secret: string } | null> {
    const secret = mintWebhookSecret();
    const result = await prisma.webhooks.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { secret: encrypt(secret) },
    });
    if (result.count === 0) {
      return null;
    }
    const webhook = await this.findById(orgId, id);
    return webhook ? { webhook, secret } : null;
  }

  /**
   * Soft delete. The secret is cleared, not left in a tombstone — the same
   * rule the channels repository applies to tokens.
   */
  async softDelete(orgId: string, id: string): Promise<WebhookRow | null> {
    const webhook = await this.findById(orgId, id);
    if (!webhook) {
      return null;
    }
    await prisma.webhooks.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date(), disabled: true, secret: '' },
    });
    return { ...webhook, disabled: true };
  }

  /** The newest delivery per hook, for the list's status column. */
  async latestDeliveries(orgId: string, webhookIds: string[]): Promise<Map<string, DeliveryRow>> {
    if (webhookIds.length === 0) {
      return new Map();
    }
    const rows = await prisma.webhookDelivery.findMany({
      where: { organizationId: orgId, webhookId: { in: webhookIds } },
      orderBy: [{ webhookId: 'asc' }, { createdAt: 'desc' }],
      distinct: ['webhookId'],
      select: DELIVERY_SELECT,
    });
    return new Map(rows.map((row) => [row.webhookId, row]));
  }

  async listDeliveries(orgId: string, webhookId: string, limit: number): Promise<DeliveryRow[]> {
    return prisma.webhookDelivery.findMany({
      where: { organizationId: orgId, webhookId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: DELIVERY_SELECT,
    });
  }

  /** A PENDING delivery with a ready-made payload; the test send and nothing else. */
  async createDelivery(params: {
    orgId: string;
    webhookId: string;
    event: WebhookDeliveryEvent;
    subjectId?: string;
    payload: (deliveryId: string) => Prisma.InputJsonValue;
  }): Promise<DeliveryRow> {
    const id = randomUUID();
    return prisma.webhookDelivery.create({
      data: {
        id,
        organizationId: params.orgId,
        webhookId: params.webhookId,
        event: params.event,
        deliveryKey: `${params.webhookId}:${params.event}:${params.subjectId ?? id}`,
        payload: params.payload(id),
        status: WebhookDeliveryStatus.PENDING,
      },
      select: DELIVERY_SELECT,
    });
  }
}

function toRow(row: WebhookRecord): WebhookRow {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events,
    channelIds: row.integrations.map((entry) => entry.integrationId),
    disabled: row.disabled,
    createdAt: row.createdAt,
  };
}
