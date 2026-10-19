'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import { createContext, forwardRef, useContext } from 'react';
import { cn } from '../lib/utils';

export const avatarVariants = cva(
  'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-outline bg-secondary',
  {
    variants: {
      // The initials scale with the circle (a little over a third of its
      // width), so two wide letters stay clear of the border at every size.
      size: {
        xs: 'h-6 w-6 text-[9px]',
        sm: 'h-8 w-8 text-xs',
        md: 'h-10 w-10 text-sm',
        lg: 'h-14 w-14 text-xl',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export type AvatarSize = NonNullable<VariantProps<typeof avatarVariants>['size']>;

/** Set by `AvatarGroup`: an avatar inside one takes the group's size unless it names its own. */
export const AvatarSizeContext = createContext<AvatarSize | undefined>(undefined);

/** Fill and text pairs, in palette order: see the avatar palette in colors.css. */
const AVATAR_COLORS = [
  'bg-avatar1 text-onAvatar1',
  'bg-avatar2 text-onAvatar2',
  'bg-avatar3 text-onAvatar3',
  'bg-avatar4 text-onAvatar4',
  'bg-avatar5 text-onAvatar5',
  'bg-avatar6 text-onAvatar6',
  'bg-avatar7 text-onAvatar7',
] as const;

/**
 * The initials colors for a name (or an id), or for a position when there is
 * nothing to name. A name is hashed, trimmed and lower-cased first, so one
 * person gets one color on every screen and in every list, whatever order
 * they appear in.
 */
export function avatarColor(seed: string | number): string {
  let index: number;
  if (typeof seed === 'number') {
    index = Math.abs(Math.trunc(seed));
  } else {
    let hash = 0;
    for (const char of seed.trim().toLowerCase()) {
      hash = (hash * 31 + (char.codePointAt(0) ?? 0)) | 0;
    }
    index = Math.abs(hash);
  }
  return AVATAR_COLORS[index % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

export interface AvatarProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {}

export const Avatar = forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ className, size, ...props }, ref) => {
    const groupSize = useContext(AvatarSizeContext);
    return (
      <AvatarPrimitive.Root
        ref={ref}
        className={cn(avatarVariants({ size: size ?? groupSize }), className)}
        {...props}
      />
    );
  },
);
Avatar.displayName = AvatarPrimitive.Root.displayName;

export const AvatarImage = forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn('h-full w-full object-cover', className)}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

export interface AvatarFallbackProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> {
  /**
   * Fills the initials with a palette color (`avatarColor`): the person's or
   * channel's name, or a stable id. Without it the fallback stays the plain
   * surface, as before.
   */
  colorSeed?: string | number;
}

export const AvatarFallback = forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  AvatarFallbackProps
>(({ className, colorSeed, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      'flex h-full w-full items-center justify-center type-ui',
      colorSeed === undefined ? 'bg-secondary text-ink' : avatarColor(colorSeed),
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;
