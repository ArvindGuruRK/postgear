'use client';

import { Avatar, AvatarFallback, AvatarImage, cn } from '@postgear/ui';

/**
 * A channel's picture with its initials behind it, the way the post
 * dialogs and the channel stack draw one: here so the table, the bar
 * list, the leaderboard and the post dialog all draw the same avatar.
 */
export function ChannelAvatar({
  name,
  picture,
  size = 'sm',
  className,
}: {
  name: string;
  picture: string | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <Avatar size={size} className={cn('shrink-0', className)}>
      {picture ? <AvatarImage src={picture} alt="" /> : null}
      <AvatarFallback className={size === 'sm' ? 'text-[10px]' : 'text-xs'}>
        {name.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
