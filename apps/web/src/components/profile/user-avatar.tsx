'use client';

import { Avatar, AvatarFallback, AvatarImage, cn } from '@postgear/ui';
import { avatarSrc, initialsOf } from '@/lib/avatars';
import type { SessionAvatar } from '@/lib/session';

/**
 * A person's avatar anywhere in the app: a preset (`/avatars/<id>.svg`), an
 * image on our storage (upload or re-hosted OAuth photo), or their initials.
 *
 * Built on `@postgear/ui`'s `Avatar`, so the circle, border and the initials'
 * `type-ui` treatment and palette color (seeded by the name) are the same ones
 * `UserMenu` draws. The image is a plain
 * `<img>` (Radix's `AvatarImage`), not `next/image`: stored avatars live on the
 * API's origin or a bucket, which `next.config` has no remote pattern for, and
 * they are already 256 px WebP, so there is nothing for the optimizer to do.
 * Radix only swaps the image in once it has loaded, so a broken URL degrades
 * to initials instead of a broken-image icon.
 *
 * `size` covers the three standard sizes; a larger one (the picker's preview)
 * passes its own `h-*`/`w-*` through `className`.
 */
export function UserAvatar({
  name,
  avatar,
  size,
  className,
  initialsClassName,
}: {
  /** Display name (or email): used for the initials and the alt text. */
  name: string;
  avatar: SessionAvatar | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** For a custom-sized avatar, the initials' text size (e.g. `text-3xl`). */
  initialsClassName?: string;
}) {
  const src = avatarSrc(avatar);

  return (
    <Avatar size={size} className={className}>
      {src ? <AvatarImage src={src} alt={name} /> : null}
      <AvatarFallback colorSeed={name} className={cn(initialsClassName)}>
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}
