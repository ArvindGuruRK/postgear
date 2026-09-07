/**
 * How a channel's state is shown, in one place.
 *
 * The important decision here is that `needs_setup` and `needs_reconnect` get
 * **different colours and different verbs**. Both mean "this channel cannot
 * publish", so it is tempting to give them one warning badge — the reference
 * implementation does exactly that, and the result is a user who can see
 * something is wrong but not what to do about it. One is "finish what you
 * started", the other is "your access expired". Different problems, different
 * fixes, different treatment.
 */
import type { BadgeProps } from '@postgear/ui';
import type { ChannelHealth } from '@/types/channel';

export interface HealthPresentation {
  label: string;
  variant: NonNullable<BadgeProps['variant']>;
  /** The action a user can take, if any. Null when nothing is wrong. */
  action: string | null;
  /** One line explaining what happened, shown on the card. */
  explanation: string | null;
}

export const CHANNEL_HEALTH: Record<ChannelHealth, HealthPresentation> = {
  connected: {
    label: 'Connected',
    variant: 'secondary',
    action: null,
    explanation: null,
  },
  needs_setup: {
    label: 'Finish setup',
    variant: 'accent',
    action: 'Finish setup',
    explanation: 'Choose which account or page this channel posts to.',
  },
  needs_reconnect: {
    label: 'Reconnect',
    variant: 'danger',
    action: 'Reconnect',
    explanation:
      'The connection expired or was revoked. Nothing can be published until it is renewed.',
  },
  expiring: {
    label: 'Expiring',
    variant: 'accent',
    action: 'Reconnect',
    explanation: 'This connection expires soon. Reconnect to avoid interrupted posting.',
  },
  disabled: {
    label: 'Disabled',
    variant: 'outline',
    action: null,
    explanation: 'This channel is turned off and will be skipped when publishing.',
  },
};

/** Health states that mean the channel cannot currently publish. */
export function isBroken(health: ChannelHealth): boolean {
  return health === 'needs_reconnect' || health === 'needs_setup';
}
