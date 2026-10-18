import { forwardRef } from 'react';
import { cn } from '../lib/utils';

/**
 * "The model is typing" for the Sprint 6 copilot chat: three ink dots on a
 * staggered pulse. Reuses Tailwind's `animate-pulse` with per-dot
 * `animation-delay` instead of adding a keyframe: the system has one
 * entrance animation and no bounce (design-system-rules.md §16), and a
 * brightness pulse is the quietest way to say "working" without inventing
 * motion. Under `prefers-reduced-motion` the dots simply sit still; they
 * still read as "waiting" because they're there at all.
 *
 * `role="status"` plus a visually hidden label means screen readers hear
 * "Thinking…" once (polite live region) rather than three unlabeled dots.
 */
export interface TypingIndicatorProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Screen-reader text; the dots themselves are decorative. */
  label?: string;
}

/**
 * Delays on Tailwind's own duration steps (0 / 150 / 300 ms). `delay-*`
 * targets `transition-delay`, so the animation property is set directly.
 */
const DOT_DELAYS = ['', '[animation-delay:150ms]', '[animation-delay:300ms]'] as const;

export const TypingIndicator = forwardRef<HTMLSpanElement, TypingIndicatorProps>(
  ({ className, label = 'Thinking…', ...props }, ref) => (
    <span
      ref={ref}
      role="status"
      className={cn('inline-flex h-5 items-center gap-1', className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {DOT_DELAYS.map((delay) => (
        <span
          key={delay || 'first'}
          aria-hidden="true"
          className={cn(
            'h-2 w-2 rounded-full bg-ink animate-pulse motion-reduce:animate-none',
            delay,
          )}
        />
      ))}
    </span>
  ),
);
TypingIndicator.displayName = 'TypingIndicator';
