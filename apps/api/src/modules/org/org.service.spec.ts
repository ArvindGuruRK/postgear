/**
 * Creating a workspace starts its trial (Sprint 8), after the transaction,
 * and best-effort: a trial that cannot start never loses the workspace.
 */
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    $transaction: jest.fn(),
    organization: { create: jest.fn() },
    userOrganization: { create: jest.fn() },
  },
}));

import { prisma } from '@postgear/db';
import type { EntitlementsService } from '../billing/entitlements.service';
import type { MailService } from '../mail/mail.service';
import { OrgService } from './org.service';

type PrismaMock = {
  $transaction: jest.Mock;
  organization: { create: jest.Mock };
  userOrganization: { create: jest.Mock };
};

const prismaMock = prisma as unknown as PrismaMock;

describe('OrgService.create', () => {
  let entitlements: { startTrial: jest.Mock };
  let service: OrgService;

  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(prismaMock));
    prismaMock.organization.create.mockResolvedValue({ id: 'org_new', name: 'Acme', createdAt: new Date('2026-10-16') });
    prismaMock.userOrganization.create.mockResolvedValue({ id: 'm_1' });
    entitlements = { startTrial: jest.fn().mockResolvedValue({ tier: 'PRO', status: 'trialing' }) };
    service = new OrgService({} as MailService, entitlements as unknown as EntitlementsService);
  });

  it('creates the workspace and its admin membership, then starts the trial', async () => {
    const created = await service.create('user_1', 'Acme');

    expect(created).toMatchObject({ id: 'org_new', name: 'Acme', role: 'ADMIN' });
    expect(prismaMock.userOrganization.create).toHaveBeenCalledWith({
      data: { userId: 'user_1', organizationId: 'org_new', role: 'ADMIN' },
    });
    expect(entitlements.startTrial).toHaveBeenCalledWith('org_new');
  });

  it('keeps the workspace when the trial cannot be started', async () => {
    entitlements.startTrial.mockRejectedValue(new Error('billing down'));

    await expect(service.create('user_1', 'Acme')).resolves.toMatchObject({ id: 'org_new' });
  });

  it('does not start a trial for a workspace that was not created', async () => {
    prismaMock.$transaction.mockRejectedValue(new Error('db down'));

    await expect(service.create('user_1', 'Acme')).rejects.toThrow('db down');
    expect(entitlements.startTrial).not.toHaveBeenCalled();
  });
});
