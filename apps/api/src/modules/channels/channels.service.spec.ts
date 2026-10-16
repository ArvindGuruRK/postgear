/**
 * The plan's channel limit where it is enforced (Sprint 8): starting a
 * handshake is refused at the limit and allowed for a reconnect; completing
 * one re-checks, lets an account that already has a row through, and sends
 * a genuinely new one back with `channel_limit`.
 */
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    userOrganization: { findFirst: jest.fn() },
    integration: { findFirst: jest.fn() },
  },
}));

jest.mock('@postgear/social-core', () => ({
  ...jest.requireActual('@postgear/social-core'),
  IntegrationManager: jest.fn(() => ({
    get: () => fakeProvider,
    find: () => fakeProvider,
    list: () => [],
  })),
}));

import type { ConfigService } from '@nestjs/config';
import { prisma } from '@postgear/db';
import { ChannelLimitReachedError, type EntitlementsService } from '../billing/entitlements.service';
import type { SchedulingService } from '../scheduling/scheduling.service';
import type { ChannelOAuthService } from './channel-oauth.service';
import type { ChannelsRepository } from './channels.repository';
import { ChannelsService } from './channels.service';

const fakeProvider = {
  identifier: 'linkedin',
  name: 'LinkedIn',
  generateAuthUrl: jest.fn(async () => ({ url: 'https://linkedin.example/auth?state=theirs', codeVerifier: 'v' })),
  authenticate: jest.fn(async () => ({ id: 'acct_new', accessToken: 'tok', name: 'New Page' })),
};

type PrismaMock = {
  userOrganization: { findFirst: jest.Mock };
  integration: { findFirst: jest.Mock };
};

const prismaMock = prisma as unknown as PrismaMock;

const usage = { used: 5, limit: 5, tier: 'STANDARD' as const };

describe('ChannelsService — the channel limit', () => {
  let repository: { findById: jest.Mock; upsertFromAuth: jest.Mock; listForOrg: jest.Mock };
  let oauth: { begin: jest.Mock; consume: jest.Mock };
  let scheduling: { ensureTokenRefresh: jest.Mock };
  let entitlements: { assertCanConnect: jest.Mock; checkConnect: jest.Mock; channelUsage: jest.Mock };
  let service: ChannelsService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue({ id: 'ch_1', rootInternalId: 'acct_1' }),
      upsertFromAuth: jest.fn().mockResolvedValue({ id: 'ch_new', name: 'New Page', inBetweenSteps: false }),
      listForOrg: jest.fn().mockResolvedValue([]),
    };
    oauth = {
      begin: jest.fn().mockResolvedValue('state_1'),
      consume: jest.fn().mockResolvedValue({
        provider: 'linkedin',
        orgId: 'org_1',
        userId: 'user_1',
        codeVerifier: 'v',
        reconnectChannelId: undefined,
        returnPath: '/org_1/channels',
      }),
    };
    scheduling = { ensureTokenRefresh: jest.fn().mockResolvedValue(true) };
    entitlements = {
      assertCanConnect: jest.fn().mockResolvedValue(usage),
      checkConnect: jest.fn().mockResolvedValue({ allowed: true, usage }),
      channelUsage: jest.fn().mockResolvedValue({ used: 3, limit: 5, tier: 'STANDARD' }),
    };
    prismaMock.userOrganization.findFirst.mockResolvedValue({ id: 'm_1' });
    prismaMock.integration.findFirst.mockResolvedValue(null);

    service = new ChannelsService(
      repository as unknown as ChannelsRepository,
      oauth as unknown as ChannelOAuthService,
      { get: () => 'http://localhost:3001' } as unknown as ConfigService,
      scheduling as unknown as SchedulingService,
      entitlements as unknown as EntitlementsService,
    );
  });

  it('reports the limit beside the list', async () => {
    await expect(service.limit('org_1')).resolves.toEqual({ used: 3, max: 5, tier: 'STANDARD' });
  });

  it('refuses to start a new handshake at the limit, before any state is written', async () => {
    entitlements.assertCanConnect.mockRejectedValue(new ChannelLimitReachedError(usage));

    await expect(
      service.beginConnect({ provider: 'linkedin', orgId: 'org_1', userId: 'user_1' }),
    ).rejects.toBeInstanceOf(ChannelLimitReachedError);
    expect(oauth.begin).not.toHaveBeenCalled();
  });

  it('never checks the limit for a reconnect', async () => {
    entitlements.assertCanConnect.mockRejectedValue(new ChannelLimitReachedError(usage));

    const url = await service.beginConnect({
      provider: 'linkedin',
      orgId: 'org_1',
      userId: 'user_1',
      reconnectChannelId: 'ch_1',
    });

    expect(url).toContain('state=state_1');
    expect(entitlements.assertCanConnect).not.toHaveBeenCalled();
  });

  it('re-checks on the callback and sends a new account back with channel_limit', async () => {
    entitlements.checkConnect.mockResolvedValue({ allowed: false, usage });

    await expect(service.completeConnect({ provider: 'linkedin', code: 'c', state: 's' })).resolves.toEqual({
      path: '/org_1/channels?error=channel_limit',
    });
    expect(repository.upsertFromAuth).not.toHaveBeenCalled();
  });

  it('lets an account that already has a row through at the limit (a resurrect is not a new channel)', async () => {
    entitlements.checkConnect.mockResolvedValue({ allowed: false, usage });
    prismaMock.integration.findFirst.mockResolvedValue({ id: 'ch_old' });

    const result = await service.completeConnect({ provider: 'linkedin', code: 'c', state: 's' });

    expect(result.path).toBe('/org_1/channels?connected=New%20Page');
    expect(entitlements.checkConnect).not.toHaveBeenCalled();
    expect(repository.upsertFromAuth).toHaveBeenCalled();
  });

  it('creates the row below the limit', async () => {
    const result = await service.completeConnect({ provider: 'linkedin', code: 'c', state: 's' });

    expect(result.path).toBe('/org_1/channels?connected=New%20Page');
    expect(entitlements.checkConnect).toHaveBeenCalledWith('org_1');
    expect(repository.upsertFromAuth).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org_1', internalId: 'acct_new' }));
  });
});
