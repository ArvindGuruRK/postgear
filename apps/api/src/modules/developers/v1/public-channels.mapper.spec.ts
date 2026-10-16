import type { ChannelView } from '../../channels/channels.service';
import { toPublicChannel } from './public-channels.mapper';

describe('toPublicChannel', () => {
  it('exposes the public fields and nothing platform-internal', () => {
    const view: ChannelView = {
      id: 'ch_li',
      internalId: 'urn:li:person:123',
      rootInternalId: 'urn:li:person:123',
      providerIdentifier: 'linkedin',
      name: 'Acme Marketing',
      profile: 'acme-marketing',
      picture: null,
      disabled: false,
      refreshNeeded: false,
      inBetweenSteps: false,
      tokenExpiration: new Date(),
      postingTimes: [{ time: 120 }],
      additionalSettings: {},
      createdAt: new Date(),
      health: 'connected',
      providerName: 'LinkedIn',
    };

    expect(toPublicChannel(view)).toEqual({
      id: 'ch_li',
      provider: 'linkedin',
      providerName: 'LinkedIn',
      name: 'Acme Marketing',
      profile: 'acme-marketing',
      picture: null,
      health: 'connected',
      disabled: false,
    });
  });
});
