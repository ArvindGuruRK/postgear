/**
 * The credit rules as the service applies them, against a fake ledger:
 * allowance per tier (the trial included), the cycle anchor and its
 * month-end clamping, charging, the 402 at exhaustion, refunds as negative
 * rows, and the retry on a serialization failure.
 */
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@postgear/db';
import { AI_MESSAGES } from '../ai.messages';
import type { BillingContext, CreditsRepository } from './credits.repository';
import { CreditsService, PaymentRequiredException } from './credits.service';

const NOW = new Date('2026-10-20T12:00:00Z');

function billing(overrides: Partial<BillingContext> = {}): BillingContext {
  return {
    workspaceName: 'PostGear Demo Org',
    organizationCreatedAt: new Date('2026-01-05T08:00:00Z'),
    subscription: {
      subscriptionTier: 'STANDARD',
      createdAt: new Date('2026-03-13T15:42:00Z'),
      deletedAt: null,
    },
    ...overrides,
  };
}

function serializationFailure() {
  return new Prisma.PrismaClientKnownRequestError('could not serialize access', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('CreditsService', () => {
  let repository: jest.Mocked<
    Pick<CreditsRepository, 'findBillingContext' | 'sumUsed' | 'chargeOnce' | 'refund'>
  >;
  let service: CreditsService;

  beforeEach(() => {
    repository = {
      findBillingContext: jest.fn().mockResolvedValue(billing()),
      sumUsed: jest.fn().mockResolvedValue(23),
      chargeOnce: jest.fn().mockResolvedValue({ outcome: 'charged', used: 28 }),
      refund: jest.fn().mockResolvedValue(undefined),
    };
    service = new CreditsService(repository as unknown as CreditsRepository);
  });

  it('summarises the cycle from the subscription tier and anchor day', async () => {
    const credits = await service.summary('org_1', NOW);

    expect(repository.findBillingContext).toHaveBeenCalledWith('org_1');
    expect(repository.sumUsed).toHaveBeenCalledWith('org_1', new Date('2026-10-13T00:00:00Z'));
    expect(credits).toMatchObject({
      tier: 'STANDARD',
      allowance: 100,
      used: 23,
      remaining: 77,
      resetsAt: '2026-11-13T00:00:00.000Z',
      low: false,
    });
  });

  it.each([
    ['PRO', 500],
    ['TEAM', 2000],
    ['ULTIMATE', 10000],
  ] as const)('gives a %s workspace %i credits', async (tier, allowance) => {
    repository.findBillingContext.mockResolvedValue(
      billing({ subscription: { subscriptionTier: tier, createdAt: NOW, deletedAt: null } }),
    );

    expect((await service.summary('org_1', NOW)).allowance).toBe(allowance);
  });

  it('treats no subscription as the NONE trial, anchored on the workspace itself', async () => {
    repository.findBillingContext.mockResolvedValue(billing({ subscription: null }));
    repository.sumUsed.mockResolvedValue(21);

    const credits = await service.summary('org_1', NOW);

    expect(repository.sumUsed).toHaveBeenCalledWith('org_1', new Date('2026-10-05T00:00:00Z'));
    expect(credits).toMatchObject({
      tier: 'NONE',
      allowance: 25,
      remaining: 4,
      resetsAt: '2026-11-05T00:00:00.000Z',
      low: true,
    });
  });

  it('keeps a cancelled subscription as the anchor while dropping its tier', async () => {
    repository.findBillingContext.mockResolvedValue(
      billing({
        subscription: {
          subscriptionTier: 'PRO',
          createdAt: new Date('2026-03-13T15:42:00Z'),
          deletedAt: new Date('2026-09-01'),
        },
      }),
    );

    const credits = await service.summary('org_1', NOW);

    expect(credits.tier).toBe('NONE');
    expect(credits.resetsAt).toBe('2026-11-13T00:00:00.000Z');
  });

  it('clamps a day-31 anchor to the end of a shorter month', async () => {
    repository.findBillingContext.mockResolvedValue(
      billing({
        subscription: {
          subscriptionTier: 'STANDARD',
          createdAt: new Date('2026-01-31T10:00:00Z'),
          deletedAt: null,
        },
      }),
    );

    const credits = await service.summary('org_1', new Date('2026-02-10T00:00:00Z'));

    expect(repository.sumUsed).toHaveBeenCalledWith('org_1', new Date('2026-01-31T00:00:00Z'));
    expect(credits.resetsAt).toBe('2026-02-28T00:00:00.000Z');
  });

  it('404s a workspace that does not exist', async () => {
    repository.findBillingContext.mockResolvedValue(null);

    await expect(service.summary('org_x', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('charges the type’s cost inside the current cycle and returns the new balance', async () => {
    const credits = await service.charge('org_1', 'generate_post');

    expect(repository.chargeOnce).toHaveBeenCalledWith({
      orgId: 'org_1',
      type: 'generate_post',
      amount: 5,
      since: expect.any(Date),
      allowance: 100,
    });
    expect(credits.used).toBe(28);
    expect(credits.remaining).toBe(72);
  });

  it('charges a combined amount when asked, as one row', async () => {
    await service.charge('org_1', 'generate_post', 15);

    expect(repository.chargeOnce.mock.calls[0][0]).toMatchObject({
      type: 'generate_post',
      amount: 15,
    });
  });

  it('refuses with a 402 naming the reset date once the cycle is spent', async () => {
    repository.chargeOnce.mockResolvedValue({ outcome: 'exhausted', used: 98 });

    const attempt = service.charge(
      'org_1',
      'generate_post',
      5,
      await service.context('org_1', NOW),
    );

    await expect(attempt).rejects.toBeInstanceOf(PaymentRequiredException);
    await expect(attempt).rejects.toThrow(
      AI_MESSAGES.outOfCredits(new Date('2026-11-13T00:00:00Z')),
    );
    await expect(attempt).rejects.toThrow('They refresh on November 13.');
  });

  it('reports exhaustion without throwing for the copilot’s tools', async () => {
    repository.chargeOnce.mockResolvedValue({ outcome: 'exhausted', used: 98 });

    const result = await service.tryCharge('org_1', 'generate_image');

    expect(result.ok).toBe(false);
    expect(result.credits.remaining).toBe(2);
  });

  it('refunds as a negative row of the matching type, and ignores a zero', async () => {
    await service.refund('org_1', 'generate_image', 10);
    await service.refund('org_1', 'generate_post', 0);

    expect(repository.refund).toHaveBeenCalledTimes(1);
    expect(repository.refund).toHaveBeenCalledWith({
      orgId: 'org_1',
      type: 'generate_image',
      amount: 10,
    });
  });

  it('retries a charge that lost the serialization race, up to three attempts', async () => {
    repository.chargeOnce
      .mockRejectedValueOnce(serializationFailure())
      .mockRejectedValueOnce(serializationFailure())
      .mockResolvedValueOnce({ outcome: 'charged', used: 6 });

    const credits = await service.charge('org_1', 'copilot_message');

    expect(repository.chargeOnce).toHaveBeenCalledTimes(3);
    expect(credits.used).toBe(6);
  });

  it('gives up after the third serialization failure, and never retries other errors', async () => {
    repository.chargeOnce.mockRejectedValue(serializationFailure());
    await expect(service.charge('org_1', 'copilot_message')).rejects.toMatchObject({
      code: 'P2034',
    });
    expect(repository.chargeOnce).toHaveBeenCalledTimes(3);

    repository.chargeOnce.mockReset().mockRejectedValue(new Error('connection lost'));
    await expect(service.charge('org_1', 'copilot_message')).rejects.toThrow('connection lost');
    expect(repository.chargeOnce).toHaveBeenCalledTimes(1);
  });
});
