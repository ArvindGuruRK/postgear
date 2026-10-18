'use client';

import { Avatar, AvatarFallback, AvatarImage, cn } from '@postgear/ui';
import { PlatformIcon } from '@/components/platforms/platform-icon';

/**
 * A channel as the reference draws it in lists: the account's picture as a
 * rounded square, with the platform's logo as a sticker on its bottom corner.
 * The picture answers "whose account", the sticker "on what".
 */
export function ChannelMark({
  name,
  picture,
  platform,
  platformName,
  size = 'md',
  className,
}: {
  name: string;
  picture: string | null;
  platform: string;
  /** Accessible name for the sticker; omit when the platform is written beside it. */
  platformName?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Avatar className={cn('rounded-lg', size === 'sm' ? 'h-8 w-8' : 'h-9 w-9')}>
        {picture ? <AvatarImage src={picture} alt="" /> : null}
        <AvatarFallback className="rounded-none text-[10px]">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="absolute -end-1.5 -bottom-1.5 rounded-md bg-secondary p-px">
        <PlatformIcon
          platform={platform}
          title={platformName}
          className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'}
        />
      </span>
    </span>
  );
}
