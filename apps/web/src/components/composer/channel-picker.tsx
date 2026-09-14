'use client';

import { Avatar, AvatarFallback, AvatarImage, Badge, cn, EmptyState, Text } from '@postgear/ui';
import { Check, Radio } from 'lucide-react';
import Link from 'next/link';
import type { Channel } from '@/types/channel';

/**
 * Which connected channels a post goes to.
 *
 * Toggle buttons rather than a dropdown multi-select: with a handful of
 * channels, seeing every account at once — avatar, name, platform — is the
 * choice, and a closed dropdown hides it.
 *
 * Health is shown here, where the choice is made. A channel still being set up
 * cannot be picked at all (there is nowhere to post yet); one needing
 * reconnection can, with a warning, because it can be fixed before the post is
 * due — the same line the API draws when queueing.
 */
export function ChannelPicker({
  orgId,
  channels,
  selected,
  onToggle,
}: {
  orgId: string;
  channels: Channel[];
  selected: string[];
  onToggle: (channelId: string) => void;
}) {
  if (channels.length === 0) {
    return (
      <div className="flex flex-col items-center">
        <EmptyState
          icon={Radio}
          title="No channels to post to"
          description="Connect a social account first, then come back to write for it."
          className="p-6"
        />
        <Link
          href={`/${orgId}/channels`}
          className="font-sans text-sm font-bold text-ink underline"
        >
          Go to Channels
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">Channels</legend>
        {channels.map((channel) => {
          const isSelected = selected.includes(channel.id);
          const unavailable = channel.health === 'needs_setup' || channel.health === 'disabled';
          const reason =
            channel.health === 'needs_setup'
              ? 'Finish setting up this channel on the Channels page first'
              : channel.health === 'disabled'
                ? 'This channel is disabled'
                : undefined;

          return (
            <button
              key={channel.id}
              type="button"
              aria-pressed={isSelected}
              disabled={unavailable && !isSelected}
              title={reason}
              onClick={() => onToggle(channel.id)}
              className={cn(
                'flex items-center gap-2 rounded-full border-2 border-outline py-1 pe-3 ps-1 font-sans text-sm font-bold text-ink',
                'outline-none transition-[transform,box-shadow] duration-100',
                'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                'disabled:cursor-not-allowed disabled:opacity-50',
                isSelected
                  ? 'bg-actionPrimary text-onActionPrimary shadow-brutalPressed'
                  : 'bg-secondary shadow-brutalSm hover:bg-actionPrimary/10',
              )}
            >
              <span className="relative">
                <Avatar size="sm">
                  {channel.picture ? <AvatarImage src={channel.picture} alt="" /> : null}
                  <AvatarFallback>{channel.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                {isSelected ? (
                  <span className="absolute -end-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-outline bg-actionSuccess text-onActionLight">
                    <Check className="h-2.5 w-2.5" strokeWidth={4} />
                  </span>
                ) : null}
              </span>
              <span className="max-w-[10rem] truncate">{channel.name}</span>
              <span className={cn('text-xs font-medium', isSelected ? 'opacity-80' : 'opacity-60')}>
                {channel.providerName}
              </span>
              {channel.health === 'needs_reconnect' ? (
                <Badge variant="danger">Reconnect</Badge>
              ) : null}
              {channel.health === 'needs_setup' ? <Badge variant="accent">Setup</Badge> : null}
            </button>
          );
        })}
      </fieldset>

      {channels.some(
        (channel) => selected.includes(channel.id) && channel.health === 'needs_reconnect',
      ) ? (
        <Text size="xs" muted>
          A selected channel needs reconnecting. You can still write and queue for it, but nothing
          will publish until it is{' '}
          <Link href={`/${orgId}/channels`} className="font-bold underline">
            reconnected
          </Link>
          .
        </Text>
      ) : null}
    </div>
  );
}
