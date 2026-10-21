/**
 * `ChannelsService.search`: every term must be in the name, handle or
 * platform; names that start with the search come first; a result carries what
 * a row shows and never a credential.
 */
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { integration: { findMany: jest.fn().mockResolvedValue([]) } },
}));

import type { ConfigService } from '@nestjs/config';
import type { EntitlementsService } from '../billing/entitlements.service';
import type { SchedulingService } from '../scheduling/scheduling.service';
import type { ChannelOAuthService } from './channel-oauth.service';
import type { ChannelsRepository, ChannelSummary } from './channels.repository';
import { ChannelsService } from './channels.service';

function summary(overrides: Partial<ChannelSummary>): ChannelSummary {
  return {
    id: 'ch_1',
    internalId: 'acct_1',
    rootInternalId: 'acct_1',
    providerIdentifier: 'linkedin',
    name: 'Acme Marketing',
    profile: null,
    picture: null,
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
    tokenExpiration: null,
    postingTimes: [{ time: 120 }],
    additionalSettings: {},
    createdAt: new Date('2026-10-01'),
    ...overrides,
  };
}

describe('ChannelsService.search', () => {
  let repository: { listForOrg: jest.Mock };
  let service: ChannelsService;

  beforeEach(() => {
    repository = { listForOrg: jest.fn() };
    service = new ChannelsService(
      repository as unknown as ChannelsRepository,
      {} as ChannelOAuthService,
      {} as ConfigService,
      {} as SchedulingService,
      {} as EntitlementsService,
    );
    jest.spyOn(service, 'colors').mockResolvedValue(new Map([['ch_2', 4]]));
  });

  it('finds a channel by name, ignoring case', async () => {
    repository.listForOrg.mockResolvedValue([
      summary({ id: 'ch_1', name: 'Acme Marketing' }),
      summary({ id: 'ch_2', name: 'Studio', providerIdentifier: 'instagram' }),
    ]);

    const result = await service.search('org_1', ['acme'], 4);

    expect(result.channels.map((channel) => channel.id)).toEqual(['ch_1']);
    expect(result.more).toBe(false);
  });

  it('matches the handle and the platform name too, and needs every term', async () => {
    repository.listForOrg.mockResolvedValue([
      summary({ id: 'ch_1', name: 'Acme', profile: 'acme_hq', providerIdentifier: 'x' }),
      summary({ id: 'ch_2', name: 'Studio', profile: null, providerIdentifier: 'x' }),
    ]);

    expect((await service.search('org_1', ['acme_hq'], 4)).channels).toHaveLength(1);
    expect((await service.search('org_1', ['acme', 'x'], 4)).channels).toHaveLength(1);
    expect((await service.search('org_1', ['acme', 'tiktok'], 4)).channels).toHaveLength(0);
  });

  it('puts names that start with the search first, keeping the workspace order otherwise', async () => {
    repository.listForOrg.mockResolvedValue([
      summary({ id: 'ch_a', name: 'The Acme Blog' }),
      summary({ id: 'ch_b', name: 'Acme Studio' }),
      summary({ id: 'ch_c', name: 'Old Acme' }),
    ]);

    const result = await service.search('org_1', ['acme'], 4);

    expect(result.channels.map((channel) => channel.id)).toEqual(['ch_b', 'ch_a', 'ch_c']);
  });

  it('stops at the limit and says there are more', async () => {
    repository.listForOrg.mockResolvedValue(
      ['a', 'b', 'c'].map((letter) => summary({ id: `ch_${letter}`, name: `Acme ${letter}` })),
    );

    const result = await service.search('org_1', ['acme'], 2);

    expect(result.channels).toHaveLength(2);
    expect(result.more).toBe(true);
  });

  it('returns what a row shows and no credentials or settings', async () => {
    repository.listForOrg.mockResolvedValue([
      summary({ id: 'ch_2', name: 'Acme', refreshNeeded: true, picture: 'https://img/x.png' }),
    ]);

    const [channel] = (await service.search('org_1', ['acme'], 4)).channels;

    expect(channel).toEqual({
      id: 'ch_2',
      name: 'Acme',
      profile: null,
      picture: 'https://img/x.png',
      providerIdentifier: 'linkedin',
      providerName: expect.any(String),
      color: 4,
      health: 'needs_reconnect',
    });
  });

  it('reads only the active workspace', async () => {
    repository.listForOrg.mockResolvedValue([]);

    await service.search('org_9', ['acme'], 4);

    expect(repository.listForOrg).toHaveBeenCalledWith('org_9');
  });
});
