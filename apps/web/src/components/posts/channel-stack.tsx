'use client';

import { Avatar, AvatarFallback, AvatarImage, cn } from '@postgear/ui';
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
 * A post's channels as overlapping avatars, each with a status dot.
 *
 * A post to three channels is one card on the calendar, so the per-channel
 * outcome has to fit in the corner of it: the dot is enough to see that two
 * went out and one did not, and the detail dialog says the rest.
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
  const shown = channels.slice(0, max);
  const hidden = channels.length - shown.length;
  const dimension = size === 'sm' ? 'h-6 w-6' : 'h-8 w-8';

  return (
    <span className={cn('flex items-center', className)} aria-hidden="true">
      {shown.map((channel, index) => {
        const tone = describeChannel(channel, publishDate, now).tone;

        return (
          <span
            key={channel.channelId}
            className={cn('relative', index > 0 && '-ms-2')}
            title={`${channel.name} · ${describeChannel(channel, publishDate, now).label}`}
          >
            <Avatar size="sm" className={cn(dimension, 'border-2')}>
              {channel.picture ? <AvatarImage src={channel.picture} alt="" /> : null}
              <AvatarFallback className={size === 'sm' ? 'text-[9px]' : 'text-[11px]'}>
                {channel.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span
              className={cn(
                'absolute -end-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border border-outline',
                DOT[tone],
                channel.disconnected && 'opacity-40',
              )}
            />
          </span>
        );
      })}
      {hidden > 0 ? (
        <span
          className={cn(
            '-ms-2 flex items-center justify-center rounded-full border-2 border-outline bg-secondary font-sans font-bold text-ink',
            dimension,
            size === 'sm' ? 'text-[9px]' : 'text-[11px]',
          )}
        >
          +{hidden}
        </span>
      ) : null}
    </span>
  );
}
