/**
 * Outbound webhooks: what a workspace has configured, and the test send
 * (Sprint 8, PRD 5.10).
 *
 * The service owns the rules — the URL policy, the per-workspace cap, that
 * a hook may only name this workspace's channels — and the repository the
 * rows. Delivery itself is the worker's: a test send creates a delivery row
 * and asks the scheduler to start its workflow, exactly the path a real
 * post outcome takes, so what a receiver sees from "Send test" is what it
 * will see for real.
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WebhookDeliveryStatus } from '@postgear/db';
import type { WebhookEvent } from '@postgear/scheduling';
import { securityLogger } from '../../common/logging/security-logger';
import type { Env } from '../../config/env';
import { SchedulingService } from '../scheduling/scheduling.service';
import type { CreateWebhookInput, UpdateWebhookInput } from './dto/webhooks.schema';
import { MAX_WEBHOOKS_PER_WORKSPACE } from './dto/webhooks.schema';
import { judgeWebhookUrl } from './webhook-url';
import { WEBHOOK_MESSAGES } from './webhooks.messages';
import { type DeliveryRow, type WebhookRow, WebhooksRepository } from './webhooks.repository';

export interface WebhookView {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  channelIds: string[];
  disabled: boolean;
  createdAt: string;
  lastDelivery: { status: WebhookDeliveryStatus; at: string; statusCode: number | null } | null;
}

export interface DeliveryView {
  id: string;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

/** How many deliveries the history shows. */
export const DELIVERY_HISTORY_LIMIT = 20;

@Injectable()
export class WebhooksService {
  private readonly allowPrivate: boolean;

  constructor(
    private readonly repository: WebhooksRepository,
    private readonly scheduling: SchedulingService,
    config: ConfigService<Env, true>,
  ) {
    this.allowPrivate = config.get('WEBHOOK_ALLOW_PRIVATE_URLS', { infer: true }) === 'true';
  }

  /** Whether this deployment accepts http:// and private addresses (local testing). The page reads it from here, not from its own environment. */
  get allowPrivateUrls(): boolean {
    return this.allowPrivate;
  }

  async list(orgId: string): Promise<WebhookView[]> {
    const rows = await this.repository.listForOrg(orgId);
    const latest = await this.repository.latestDeliveries(
      orgId,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toView(row, latest.get(row.id) ?? null));
  }

  async get(orgId: string, id: string): Promise<WebhookView> {
    const row = await this.repository.findById(orgId, id);
    if (!row) {
      throw new NotFoundException(WEBHOOK_MESSAGES.NOT_FOUND);
    }
    const latest = await this.repository.latestDeliveries(orgId, [id]);
    return toView(row, latest.get(id) ?? null);
  }

  async create(orgId: string, input: CreateWebhookInput): Promise<{ webhook: WebhookView; secret: string }> {
    if ((await this.repository.countForOrg(orgId)) >= MAX_WEBHOOKS_PER_WORKSPACE) {
      throw new UnprocessableEntityException(WEBHOOK_MESSAGES.TOO_MANY);
    }

    const url = await this.requireSafeUrl(orgId, input.url);
    const channelIds = await this.requireOwnChannels(orgId, input.channelIds ?? []);

    const created = await this.repository.create(orgId, {
      name: input.name,
      url,
      events: input.events,
      channelIds,
    });

    return { webhook: toView(created.webhook, null), secret: created.secret };
  }

  async update(orgId: string, id: string, input: UpdateWebhookInput): Promise<WebhookView> {
    const url = input.url !== undefined ? await this.requireSafeUrl(orgId, input.url) : undefined;
    const channelIds =
      input.channelIds !== undefined
        ? await this.requireOwnChannels(orgId, input.channelIds)
        : undefined;

    const updated = await this.repository.update(orgId, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(input.events !== undefined ? { events: input.events } : {}),
      ...(channelIds !== undefined ? { channelIds } : {}),
      ...(input.disabled !== undefined ? { disabled: input.disabled } : {}),
    });

    if (!updated) {
      throw new NotFoundException(WEBHOOK_MESSAGES.NOT_FOUND);
    }

    const latest = await this.repository.latestDeliveries(orgId, [id]);
    return toView(updated, latest.get(id) ?? null);
  }

  async remove(orgId: string, id: string): Promise<WebhookView> {
    const removed = await this.repository.softDelete(orgId, id);
    if (!removed) {
      throw new NotFoundException(WEBHOOK_MESSAGES.NOT_FOUND);
    }
    return toView(removed, null);
  }

  async rotateSecret(orgId: string, id: string): Promise<{ webhook: WebhookView; secret: string }> {
    const rotated = await this.repository.rotateSecret(orgId, id);
    if (!rotated) {
      throw new NotFoundException(WEBHOOK_MESSAGES.NOT_FOUND);
    }
    return { webhook: toView(rotated.webhook, null), secret: rotated.secret };
  }

  async deliveries(orgId: string, id: string): Promise<DeliveryView[]> {
    const row = await this.repository.findById(orgId, id);
    if (!row) {
      throw new NotFoundException(WEBHOOK_MESSAGES.NOT_FOUND);
    }
    const rows = await this.repository.listDeliveries(orgId, id, DELIVERY_HISTORY_LIMIT);
    return rows.map(toDeliveryView);
  }

  /**
   * Queues a `webhook.test` delivery carrying a sample post, and starts its
   * workflow. Returns the row at once; the worker fills in the outcome, and
   * the deliveries list shows it.
   */
  async sendTest(orgId: string, id: string): Promise<{ delivery: DeliveryView; scheduled: boolean }> {
    const row = await this.repository.findById(orgId, id);
    if (!row) {
      throw new NotFoundException(WEBHOOK_MESSAGES.NOT_FOUND);
    }

    const delivery = await this.repository.createDelivery({
      orgId,
      webhookId: id,
      event: 'webhook.test',
      payload: (deliveryId) => ({
        id: deliveryId,
        event: 'webhook.test',
        createdAt: new Date().toISOString(),
        workspaceId: orgId,
        data: {
          post: {
            id: '00000000-0000-4000-8000-000000000000',
            rootId: 'sample-post',
            state: 'PUBLISHED',
            publishAt: new Date().toISOString(),
            url: 'https://example.com/posts/sample',
            preview: 'A sample post from PostGear to show what a delivery looks like.',
            channel: { id: 'sample-channel', name: 'Sample channel', provider: 'linkedin' },
          },
        },
      }),
    });

    const scheduled = await this.scheduling.startWebhookDelivery(delivery.id, orgId);

    return { delivery: toDeliveryView(delivery), scheduled };
  }

  private async requireSafeUrl(orgId: string, url: string): Promise<string> {
    const verdict = await judgeWebhookUrl(url, { allowPrivate: this.allowPrivate });
    if (!verdict.ok) {
      securityLogger.warn('webhook.unsafe_url', { orgId, reason: verdict.message });
      throw new UnprocessableEntityException(verdict.message);
    }
    return verdict.url;
  }

  private async requireOwnChannels(orgId: string, ids: string[]): Promise<string[]> {
    const live = await this.repository.liveChannelIds(orgId, ids);
    if (ids.some((id) => !live.has(id))) {
      throw new UnprocessableEntityException(WEBHOOK_MESSAGES.FOREIGN_CHANNEL);
    }
    return ids;
  }
}

function toView(row: WebhookRow, latest: DeliveryRow | null): WebhookView {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events as WebhookEvent[],
    channelIds: row.channelIds,
    disabled: row.disabled,
    createdAt: row.createdAt.toISOString(),
    lastDelivery: latest
      ? {
          status: latest.status,
          at: (latest.lastAttemptAt ?? latest.createdAt).toISOString(),
          statusCode: latest.lastStatusCode,
        }
      : null,
  };
}

function toDeliveryView(row: DeliveryRow): DeliveryView {
  return {
    id: row.id,
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
