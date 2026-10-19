'use client';

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupItem,
  AvatarImage,
  cn,
} from '@postgear/ui';
import type { PostSummaryChannel } from '@/types/post';
import { describeChannel, type PostTone } from './post-status';

/** The dot on each avatar: the channel's own standing, in the system's action colors. */
const DOT: Record<PostTone, string> = {
  draft: 'bg-ink/30',
  scheduled: 'bg-actionPrimary',
  publishing: 'bg-actionAccent',
  retrying: 'bg-actionAccent',
  published: 'bg-actionSuccess',
  failed: 'bg-actionDanger',
};

/**
 * For the row or card a stack sits on, when it tints on hover
 * (`hover:bg-actionPrimary/10` on the surface): the avatars' rings follow the
 * tint, so they keep reading as gaps rather than pale halos.
 */
export const CHANNEL_STACK_HOVER_RING =
  'hover:[--pg-avatar-ring:color-mix(in_srgb,var(--color-actionPrimary)_10%,var(--color-secondary))]';

/**
 * A post's channels as an avatar group, each with a status dot.
 *
 * A post to three channels is one card on the calendar, so the per-channel
 * outcome has to fit in the corner of it: the dot is enough to see that two
 * went out and one did not, the hover tooltip names the channel and its
 * state, and the detail dialog says the rest.
 *
 * The stack always sits inside the card's own link or button, so its avatars
 * are not focusable (`focusable={false}`) and it stays hidden from assistive
 * tech, as before: the card's label is what is announced, and the queue row
 * lists the channels by name beside the stack.
 */
export function ChannelStack({
  channels,
  publishDate,
  now,
  size = 'sm',
  max = 4,
  className,
}: {
  channels: PostSummaryChannel[];
  publishDate: string;
  now: Date;
  size?: 'sm' | 'md';
  max?: number;
  className?: string;
}) {
  return (
    <AvatarGroup
      max={max}
      size={size === 'sm' ? 'xs' : 'sm'}
      focusable={false}
      aria-hidden="true"
      className={className}
    >
      {channels.map((channel) => {
        const shown = describeChannel(channel, publishDate, now);

        return (
          <AvatarGroupItem
            key={channel.channelId}
            name={channel.name}
            label={`${channel.name} - ${shown.label}`}
          >
            <Avatar>
              {channel.picture ? <AvatarImage src={channel.picture} alt="" /> : null}
              <AvatarFallback colorSeed={channel.color ?? channel.channelId}>
                {channel.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span
              className={cn(
                'absolute -end-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border border-outline',
                DOT[shown.tone],
                channel.disconnected && 'opacity-40',
              )}
            />
          </AvatarGroupItem>
        );
      })}
    </AvatarGroup>
  );
}
