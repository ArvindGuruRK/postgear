/**
 * The webhooks service against a fake repository and scheduler: the cap,
 * the URL policy, that only the workspace's own channels can be named, the
 * one-time secret on create and rotate, the view's last-delivery line, the
 * test send creating a `webhook.test` delivery and starting its workflow,
 * and 404s for a hook of another workspace.
 */
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { securityLogger } from '../../common/logging/security-logger';
import type { Env } from '../../config/env';
import type { SchedulingService } from '../scheduling/scheduling.service';
import { MAX_WEBHOOKS_PER_WORKSPACE } from './dto/webhooks.schema';
import { WEBHOOK_MESSAGES } from './webhooks.messages';
import type { DeliveryRow, WebhookRow, WebhooksRepository } from './webhooks.repository';
import { WebhooksService } from './webhooks.service';

jest.mock('./webhook-url', () => ({
  judgeWebhookUrl: jest.fn(async (url: string, options: { allowPrivate: boolean }) =>
    url.startsWith('https://') || (options.allowPrivate && url.startsWith('http://'))
      ? { ok: true, url }
      : { ok: false, message: 'Webhook URLs must start with https://' },
  ),
}));

const NOW = new Date('2026-10-16T10:00:00Z');

function row(overrides: Partial<WebhookRow> = {}): WebhookRow {
  return {
    id: 'hook-1',
    name: 'Zapier',
    url: 'https://hooks.example.com/in',
    events: ['post.published', 'post.failed'],
    channelIds: [],
    disabled: false,
    createdAt: NOW,
    ...overrides,
  };
}

function delivery(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: 'd-1',
    webhookId: 'hook-1',
    event: 'post.published',
    status: 'DELIVERED',
    attempts: 1,
    lastStatusCode: 200,
    lastError: null,
    lastAttemptAt: NOW,
    deliveredAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

describe('WebhooksService', () => {
  let repository: jest.Mocked<WebhooksRepository>;
  let scheduling: jest.Mocked<Pick<SchedulingService, 'startWebhookDelivery'>>;
  let service: WebhooksService;

  function build(allowPrivate = false) {
    const config = {
      get: jest.fn((key: string) => (key === 'WEBHOOK_ALLOW_PRIVATE_URLS' ? (allowPrivate ? 'true' : 'false') : undefined)),
    } as unknown as ConfigService<Env, true>;
    return new WebhooksService(repository, scheduling as unknown as SchedulingService, config);
  }

  beforeEach(() => {
    repository = {
      listForOrg: jest.fn().mockResolvedValue([row()]),
      countForOrg: jest.fn().mockResolvedValue(1),
      findById: jest.fn().mockResolvedValue(row()),
      liveChannelIds: jest.fn(async (_org: string, ids: string[]) => new Set(ids.filter((id) => id.startsWith('ch-')))),
      create: jest.fn(async (_org, input) => ({ webhook: row({ ...input, id: 'hook-new' }), secret: 'whsec_new' })),
      update: jest.fn(async (_org, id, input) => (id === 'hook-1' ? row({ ...input, channelIds: input.channelIds ?? [] }) : null)),
      rotateSecret: jest.fn(async (_org, id) => (id === 'hook-1' ? { webhook: row(), secret: 'whsec_rotated' } : null)),
      softDelete: jest.fn(async (_org, id) => (id === 'hook-1' ? row({ disabled: true }) : null)),
      latestDeliveries: jest.fn().mockResolvedValue(new Map([['hook-1', delivery()]])),
      listDeliveries: jest.fn().mockResolvedValue([delivery()]),
      createDelivery: jest.fn(async (params) => delivery({ id: 'd-test', event: params.event, status: 'PENDING', attempts: 0, lastStatusCode: null, lastAttemptAt: null, deliveredAt: null })),
    } as unknown as jest.Mocked<WebhooksRepository>;
    scheduling = { startWebhookDelivery: jest.fn().mockResolvedValue(true) };
    service = build();
    jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
  });

  it('lists hooks with their latest delivery', async () => {
    const [view] = await service.list('org-1');

    expect(view).toMatchObject({
      id: 'hook-1',
      events: ['post.published', 'post.failed'],
      createdAt: NOW.toISOString(),
      lastDelivery: { status: 'DELIVERED', at: NOW.toISOString(), statusCode: 200 },
    });
  });

  it('creates a hook and returns the secret exactly once', async () => {
    const result = await service.create('org-1', {
      name: 'Zapier',
      url: 'https://hooks.example.com/in',
      events: ['post.failed'],
      channelIds: ['ch-1'],
    });

    expect(result.secret).toBe('whsec_new');
    expect(result.webhook).toMatchObject({ id: 'hook-new', lastDelivery: null });
    expect(repository.create).toHaveBeenCalledWith('org-1', {
      name: 'Zapier',
      url: 'https://hooks.example.com/in',
      events: ['post.failed'],
      channelIds: ['ch-1'],
    });
    expect(JSON.stringify(result.webhook)).not.toContain('whsec');
  });

  it('refuses an unsafe URL with 422 and logs it, before any write', async () => {
    await expect(
      service.create('org-1', { name: 'x', url: 'http://hooks.example.com/in', events: ['post.failed'] }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(securityLogger.warn).toHaveBeenCalledWith('webhook.unsafe_url', expect.objectContaining({ orgId: 'org-1' }));
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('lets http through when private URLs are allowed', async () => {
    service = build(true);
    await expect(
      service.create('org-1', { name: 'x', url: 'http://localhost:4000/in', events: ['post.failed'] }),
    ).resolves.toMatchObject({ secret: 'whsec_new' });
  });

  it('refuses a channel that is not this workspace’s', async () => {
    await expect(
      service.create('org-1', {
        name: 'x',
        url: 'https://hooks.example.com/in',
        events: ['post.failed'],
        channelIds: ['ch-1', 'other-9'],
      }),
    ).rejects.toMatchObject({ message: WEBHOOK_MESSAGES.FOREIGN_CHANNEL });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('caps the number of hooks per workspace', async () => {
    repository.countForOrg.mockResolvedValue(MAX_WEBHOOKS_PER_WORKSPACE);
    await expect(
      service.create('org-1', { name: 'x', url: 'https://hooks.example.com/in', events: ['post.failed'] }),
    ).rejects.toMatchObject({ message: WEBHOOK_MESSAGES.TOO_MANY });
  });

  it('updates only what was sent, re-judging a new URL', async () => {
    const view = await service.update('org-1', 'hook-1', { disabled: true, channelIds: ['ch-2'] });

    expect(repository.update).toHaveBeenCalledWith('org-1', 'hook-1', { disabled: true, channelIds: ['ch-2'] });
    expect(view.channelIds).toEqual(['ch-2']);

    await expect(service.update('org-1', 'hook-1', { url: 'ftp://nope' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('answers 404 for a hook of another workspace, on every mutation', async () => {
    await expect(service.update('org-1', 'hook-9', { name: 'y' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('org-1', 'hook-9')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.rotateSecret('org-1', 'hook-9')).rejects.toBeInstanceOf(NotFoundException);
    repository.findById.mockResolvedValue(null);
    await expect(service.sendTest('org-1', 'hook-9')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deliveries('org-1', 'hook-9')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rotates the secret and returns the new one', async () => {
    await expect(service.rotateSecret('org-1', 'hook-1')).resolves.toMatchObject({ secret: 'whsec_rotated' });
  });

  it('queues a test delivery carrying a sample post and starts its workflow', async () => {
    const result = await service.sendTest('org-1', 'hook-1');

    expect(repository.createDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', webhookId: 'hook-1', event: 'webhook.test' }),
    );
    const payload = repository.createDelivery.mock.calls[0][0].payload('d-test') as {
      id: string;
      event: string;
      data: { post: { id: string } };
    };
    expect(payload.id).toBe('d-test');
    expect(payload.event).toBe('webhook.test');
    expect(payload.data.post.id).toBeDefined();
    expect(scheduling.startWebhookDelivery).toHaveBeenCalledWith('d-test', 'org-1');
    expect(result).toMatchObject({ scheduled: true, delivery: { id: 'd-test', status: 'PENDING' } });
  });

  it('reports when the scheduler could not be reached, without failing the request', async () => {
    scheduling.startWebhookDelivery.mockResolvedValue(false);
    await expect(service.sendTest('org-1', 'hook-1')).resolves.toMatchObject({ scheduled: false });
  });
});
