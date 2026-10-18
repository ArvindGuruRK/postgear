'use client';

import { Avatar, AvatarFallback, AvatarImage, cn } from '@postgear/ui';
import { Check } from 'lucide-react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import { useCalendar } from './calendar-context';

/**
 * Which channels' posts are shown. Nothing selected means everything.
 *
 * The same pill toggles as the composer's channel picker, so a channel looks
 * the same wherever it is chosen.
 */
export function ChannelFilter() {
  const { channels, channelFilter, toggleChannel, clearChannelFilter } = useCalendar();

  return (
    <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">Show channels</legend>
      <button
        type="button"
        aria-pressed={channelFilter.length === 0}
        onClick={clearChannelFilter}
        className={cn(
          'rounded-full border-2 border-outline px-3 py-1 font-sans text-xs font-bold',
          'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
          channelFilter.length === 0
            ? 'bg-actionPrimary text-onActionPrimary shadow-brutalPressed'
            : 'bg-secondary text-ink shadow-brutalSm hover:bg-actionPrimary/10',
        )}
      >
        All channels
      </button>
      {channels.map((channel) => {
        const selected = channelFilter.includes(channel.id);
        return (
          <button
            key={channel.id}
            type="button"
            aria-pressed={selected}
            onClick={() => toggleChannel(channel.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border-2 border-outline py-0.5 pe-3 ps-0.5 font-sans text-xs font-bold',
              'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
              selected
                ? 'bg-actionPrimary text-onActionPrimary shadow-brutalPressed'
                : 'bg-secondary text-ink shadow-brutalSm hover:bg-actionPrimary/10',
            )}
          >
            <span className="relative">
              <Avatar size="sm" className="h-6 w-6">
                {channel.picture ? <AvatarImage src={channel.picture} alt="" /> : null}
                <AvatarFallback className="text-[9px]">
                  {channel.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {selected ? (
                <span className="absolute -end-1 -bottom-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-outline bg-actionSuccess text-onActionLight">
                  <Check className="h-2 w-2" strokeWidth={4} />
                </span>
              ) : null}
            </span>
            <span className="max-w-[9rem] truncate">{channel.name}</span>
            <PlatformIcon
              platform={channel.providerIdentifier}
              title={channel.providerName}
              className="h-4 w-4"
            />
          </button>
        );
      })}
    </fieldset>
  );
}
