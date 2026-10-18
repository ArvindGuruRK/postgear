'use client';

import { EyeClosedIcon } from '@animateicons/react/lucide/eye-closed-icon';
import { EyeIcon } from '@animateicons/react/lucide/eye-icon';
import { forwardRef, useEffect, useRef, useState } from 'react';
import { ANIMATED_ICON_CLASS } from '../lib/icon-animation';
import { useIconAnimation } from '../lib/use-icon-animation';
import { cn } from '../lib/utils';
import { Input, type InputProps } from './input';

export interface PasswordInputProps extends Omit<InputProps, 'type'> {}

/**
 * Password field with a reveal toggle.
 *
 * Eye / EyeClosed rather than Eye / EyeOff: the closed-lid glyph is the same
 * eye with the lid drawn down, so the pair reads as one thing changing state.
 * EyeOff is a struck-through eye, which in this system's vocabulary reads as
 * "disabled" rather than "hidden". The icon is h-5 rather than the h-4 that
 * design-system-rules.md 13 makes the default for icons next to text: this
 * one is a standalone control with its own hit area, not a glyph beside a
 * word, and at h-4 it sat small against the h-11 field it lives in.
 *
 * Structurally identical to SearchInput's trailing clear button (same
 * absolute placement, same focus ring) rather than a second way of hanging a
 * control off an Input: see design-system-rules.md §13, which allows an
 * absolutely positioned icon only when it decorates an input.
 *
 * The toggle is a real `<button type="button">` so it is reachable by
 * keyboard, but it is NOT a form control of its own: it carries no name and
 * flipping it only swaps `type` between `password` and `text`, which leaves
 * the typed value and the browser's autofill/manager behaviour untouched.
 *
 * The eyes are animated icons (`useIconAnimation`): they move on hover and
 * keyboard focus, and the eye that appears on a toggle plays once, so the
 * swap reads as the eye opening or closing rather than a glyph change.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const label = visible ? 'Hide password' : 'Show password';
    // Icon reflects current state, not the click action: closed eye while
    // masked (the default), open eye once revealed.
    const ToggleIcon = visible ? EyeIcon : EyeClosedIcon;
    const icon = useIconAnimation();
    const shown = useRef(visible);

    useEffect(() => {
      // Only a change plays the new eye: not the first render, nor
      // StrictMode's second run of this effect.
      if (shown.current !== visible) {
        shown.current = visible;
        icon.play();
      }
    }, [visible, icon.play]);

    return (
      <div className="relative w-full">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-11', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          {...icon.triggers}
          aria-label={label}
          title={label}
          className={cn(
            'absolute right-3 top-1/2 -translate-y-1/2 text-ink opacity-50 outline-none hover:opacity-100',
            'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
          )}
        >
          <ToggleIcon
            ref={icon.ref}
            aria-hidden
            size={20}
            className={cn('h-5 w-5', ANIMATED_ICON_CLASS)}
          />
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
