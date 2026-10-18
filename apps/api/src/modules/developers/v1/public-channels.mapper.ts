/**
 * `ChannelView` → the public channel (Sprint 8, contract §5.3).
 *
 * The internal view carries the platform account ids, posting times and
 * token expiry: none of which an integrator needs, and the first of which
 * they should not have. The public shape is what is needed to pick a
 * channel for a post and to know whether it will publish.
 */
import type { ChannelView } from '../../channels/channels.service';
import type { PublicChannel } from './v1.types';

export function toPublicChannel(channel: ChannelView): PublicChannel {
  return {
    id: channel.id,
    provider: channel.providerIdentifier,
    providerName: channel.providerName,
    name: channel.name,
    profile: channel.profile,
    picture: channel.picture,
    health: channel.health,
    disabled: channel.disabled,
  };
}
