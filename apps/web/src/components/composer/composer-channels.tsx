'use client';

/**
 * Which channels a post goes to, as the reference's composer picks them (UI
 * revamp, 2026-10-19): every connected account as a round picture with its
 * platform's sticker, in one row along the top. A selected one stands out
 * with the primary ring; the rest sit dimmed until hovered, so the row reads
 * as "these are going out" at a glance.
 *
 * Toggle buttons, so each says pressed or not to assistive technology, and
 * each names its account and platform. Health shows where the choice is
 * made: a channel still being set up cannot be picked (there is nowhere to
 * post yet); one needing reconnection can, with a red mark and a note below,
 * because it can be fixed before the post is due: the line the API draws
 * when queueing.
 */
import { Avatar, AvatarFallback, AvatarImage, cn, TooltipHint } from '@postgear/ui';
import { Radio } from 'lucide-react';
import Link from 'next/link';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import type { Channel } from '@/types/channel';

export function ComposerChannels({
  orgId,
  channels,
  selected,
  onToggle,
  disabled = false,
}: {
  orgId: string;
  channels: Channel[];
  selected: string[];
  onToggle: (channelId: string) => void;
  /** A published post: the picture still shows where it went, nothing changes. */
  disabled?: boolean;
}) {
  if (channels.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border-2 border-dashed border-ink/30 p-4">
        <Radio className="h-5 w-5 shrink-0 text-ink opacity-60" strokeWidth={2.25} />
        <p className="m-0 font-sans text-sm text-ink">
          No channels to post to yet.{' '}
          <Link href={`/${orgId}/channels`} className="type-ui underline underline-offset-2">
            Connect a channel
          </Link>{' '}
          first, then come back to write for it.
        </p>
      </div>
    );
  }

  const reconnecting = channels.filter(
    (channel) => selected.includes(channel.id) && channel.health === 'needs_reconnect',
  );

  return (
    <div className="flex flex-col gap-2">
      <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-3 border-0 p-0">
        <legend className="sr-only">Channels</legend>
        {channels.map((channel) => {
          const isSelected = selected.includes(channel.id);
          const unavailable = channel.health === 'needs_setup' || channel.health === 'disabled';
          const note =
            channel.health === 'needs_setup'
              ? 'Finish setting this channel up first'
              : channel.health === 'disabled'
                ? 'This channel is disabled'
                : channel.health === 'needs_reconnect'
                  ? 'Needs reconnecting before it can publish'
                  : null;

          return (
            <TooltipHint
              key={channel.id}
              label={
                note ? `${channel.name}: ${note}` : `${channel.name} · ${channel.providerName}`
              }
              side="bottom"
              disabled={(unavailable && !isSelected) || disabled}
            >
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={`${channel.name}, ${channel.providerName}`}
                disabled={(unavailable && !isSelected) || disabled}
                onClick={() => onToggle(channel.id)}
                className={cn(
                  'group/channel relative rounded-full outline-none',
                  'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-focusRing',
                  'disabled:cursor-not-allowed',
                )}
              >
                <Avatar
                  className={cn(
                    'h-11 w-11 transition-[opacity,filter,box-shadow] duration-150',
                    isSelected
                      ? 'ring-[3px] ring-actionPrimary ring-offset-2 ring-offset-secondary'
                      : 'opacity-45 grayscale group-hover/channel:opacity-100 group-hover/channel:grayscale-0 group-disabled/channel:opacity-30',
                  )}
                >
                  {channel.picture ? <AvatarImage src={channel.picture} alt="" /> : null}
                  <AvatarFallback colorSeed={channel.color ?? channel.id} className="text-[11px]">
                    {channel.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    'absolute -end-1 -bottom-1 rounded-md bg-secondary p-px transition-opacity',
                    !isSelected && 'opacity-60 group-hover/channel:opacity-100',
                  )}
                >
                  <PlatformIcon platform={channel.providerIdentifier} className="h-4 w-4" />
                </span>
                {channel.health === 'needs_reconnect' ? (
                  // On the avatar's rim, not the corner of its box: a 44px
                  // circle's edge is about 6px in from that corner, so at 0
                  // the badge's centre sits just inside the rim, laid on the
                  // picture the way the bell's count sits on the bell.
                  <span
                    aria-hidden="true"
                    className="absolute start-0 top-0 z-10 flex h-4 w-4 items-center justify-center rounded-full border-2 border-outline bg-actionDanger font-sans text-[10px] font-bold leading-none text-onActionLight"
                  >
                    !
                  </span>
                ) : null}
              </button>
            </TooltipHint>
          );
        })}
      </fieldset>

      {reconnecting.length > 0 ? (
        <p className="m-0 font-sans text-xs text-ink opacity-80">
          {reconnecting.map((channel) => channel.name).join(', ')}{' '}
          {reconnecting.length === 1 ? 'needs' : 'need'} reconnecting. You can still write and
          queue, but nothing will publish until it is{' '}
          <Link href={`/${orgId}/channels`} className="type-ui underline underline-offset-2">
            reconnected
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
