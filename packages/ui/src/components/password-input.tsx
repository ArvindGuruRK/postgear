'use client';

import { Eye, EyeClosed } from 'lucide-react';
import { forwardRef, useState } from 'react';
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
 * design-system-rules.md 13 makes the default for icons next to text — this
 * one is a standalone control with its own hit area, not a glyph beside a
 * word, and at h-4 it sat small against the h-11 field it lives in.
 *
 * Structurally identical to SearchInput's trailing clear button (same
 * absolute placement, same focus ring) rather than a second way of hanging a
 * control off an Input — see design-system-rules.md §13, which allows an
 * absolutely positioned icon only when it decorates an input.
 *
 * The toggle is a real `<button type="button">` so it is reachable by
 * keyboard, but it is NOT a form control of its own: it carries no name and
 * flipping it only swaps `type` between `password` and `text`, which leaves
 * the typed value and the browser's autofill/manager behaviour untouched.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const label = visible ? 'Hide password' : 'Show password';
    // Icon reflects current state, not the click action: closed eye while
    // masked (the default), open eye once revealed.
    const ToggleIcon = visible ? Eye : EyeClosed;

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
          aria-label={label}
          title={label}
          className={cn(
            'absolute right-3 top-1/2 -translate-y-1/2 text-ink opacity-50 outline-none hover:opacity-100',
            'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
          )}
        >
          <ToggleIcon className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
