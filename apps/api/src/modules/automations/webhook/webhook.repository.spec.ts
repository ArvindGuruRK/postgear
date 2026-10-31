/**
 * The Webhook trigger's queries (Module 13): the hook reads only active
 * secrets of a workflow that is not deleted, the panel is scoped to the
 * workspace, a new secret revokes the old ones in the same transaction, and
 * a repeated event id finds the first run instead of adding one.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: {
      automation: { findFirst: jest.fn(), update: jest.fn() },
      automationRun: { create: jest.fn(), createMany: jest.fn(), findFirst: jest.fn() },
      automationWebhookSecret: { updateMany: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(),
    },
  };
});

import { prisma } from '@postgear/db';
import { WebhookRepository } from './webhook.repository';

const db = prisma as unknown as {
  automation: { findFirst: jest.Mock; update: jest.Mock };
  automationRun: { create: jest.Mock; createMany: jest.Mock; findFirst: jest.Mock };
  automationWebhookSecret: { updateMany: jest.Mock; create: jest.Mock };
  $transaction: jest.Mock;
};

const ORG = 'org-1';
const ID = '11111111-1111-4111-8111-111111111111';

describe('WebhookRepository', () => {
  let repository: WebhookRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(db));
    repository = new WebhookRepository();
  });

  it('reads only active secrets of a workflow that is not deleted', async () => {
    db.automation.findFirst.mockResolvedValue(null);
    await repository.findHookTarget(ID);
    const [query] = db.automation.findFirst.mock.calls[0];
    expect(query.where).toEqual({ id: ID, deletedAt: null });
    expect(query.select.webhookSecrets).toEqual({
      where: { revokedAt: null },
      select: { secretHash: true },
    });
  });

  it('scopes the panel to the workspace and never selects the hash', async () => {
    db.automation.findFirst.mockResolvedValue(null);
    await repository.findPanel(ORG, ID);
    const [query] = db.automation.findFirst.mock.calls[0];
    expect(query.where).toEqual({ id: ID, organizationId: ORG, deletedAt: null });
    expect(JSON.stringify(query.select)).not.toContain('secretHash');
  });

  it('revokes the old secrets and adds the new one in one transaction', async () => {
    const at = new Date('2026-11-02T09:30:00.000Z');
    db.automationWebhookSecret.create.mockResolvedValue({ last4: 'abcd', createdAt: at });
    await repository.replaceSecret(ORG, ID, { secretHash: 'hash', last4: 'abcd' }, at);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.automationWebhookSecret.updateMany).toHaveBeenCalledWith({
      where: { automationId: ID, organizationId: ORG, revokedAt: null },
      data: { revokedAt: at },
    });
    expect(db.automationWebhookSecret.create).toHaveBeenCalledWith({
      data: { automationId: ID, organizationId: ORG, secretHash: 'hash', last4: 'abcd' },
      select: { last4: true, createdAt: true },
    });
  });

  it('finds the first run for a repeated event id', async () => {
    db.automationRun.findFirst.mockResolvedValue({ id: 'run-first' });
    const result = await repository.createLiveRun({
      automationId: ID,
      organizationId: ORG,
      versionId: 'v1',
      triggerType: 'trigger.webhook',
      triggerPayload: { body: {} },
      triggerEventId: 'webhook:evt-1',
    });
    expect(result).toEqual({ runId: 'run-first', created: false });
    expect(db.automationRun.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(db.automationRun.findFirst).toHaveBeenCalledWith({
      where: { automationId: ID, triggerEventId: 'webhook:evt-1' },
      select: { id: true },
    });
  });

  it('creates a queued live run when the event id is new or absent', async () => {
    db.automationRun.findFirst.mockImplementation(async () => {
      const [{ data }] = db.automationRun.createMany.mock.calls[0];
      return { id: data[0].id };
    });
    const keyed = await repository.createLiveRun({
      automationId: ID,
      organizationId: ORG,
      versionId: 'v1',
      triggerType: 'trigger.webhook',
      triggerPayload: { body: {} },
      triggerEventId: 'webhook:evt-2',
    });
    expect(keyed.created).toBe(true);
    expect(db.automationRun.createMany.mock.calls[0][0].data[0]).toMatchObject({
      mode: 'LIVE',
      status: 'QUEUED',
      versionId: 'v1',
    });

    const plain = await repository.createLiveRun({
      automationId: ID,
      organizationId: ORG,
      versionId: 'v1',
      triggerType: 'trigger.webhook',
      triggerPayload: { body: {} },
      triggerEventId: null,
    });
    expect(plain.created).toBe(true);
    expect(db.automationRun.create).toHaveBeenCalledTimes(1);
  });
});
