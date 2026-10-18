'use client';

import { type CSSProperties, useEffect, useRef } from 'react';
import {
  ANIMATED_ICON_BOX,
  type AnimatedIcon,
  type IconAnimationHandle,
} from '../lib/icon-animation';
import { cn } from '../lib/utils';

/**
 * The controls an icon plays from: whatever the person hovers or tabs to.
 * A `label` covers a file input styled as a button; its input takes the
 * focus, which `focusin` sees from the label.
 */
const CONTROL = [
  'button',
  'a[href]',
  'label',
  'summary',
  '[role="button"]',
  '[role="combobox"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="switch"]',
].join(',');

export interface MotionIconProps {
  /** An `@animateicons/react` icon, imported from its own file. */
  icon: AnimatedIcon;
  /** The svg's size in px; match the `h-*`/`w-*` in `className`. */
  size?: number;
  /** The system's icons are 2.5; the rail uses 2.25, a dialog's close 3. */
  strokeWidth?: number;
  className?: string;
}

/**
 * An animated icon that plays from the control it sits in (2026-10-19): hover
 * anywhere on the button, link, menu item or tab around it, or reach it by
 * keyboard, and the icon moves. A drop-in for a lucide icon inside a control:
 * no hook, no ref, no handlers on the control, so it works in lists, in
 * design-system components and in server-rendered trees alike.
 *
 * It finds its control in the DOM after mount (`closest`), from a
 * `display: contents` span that takes no part in layout. With no control
 * around it, it plays when the icon itself is hovered. Focus from a click is
 * not `:focus-visible`, so only the keyboard plays it on focus, and under
 * reduced motion the icon holds its resting pose (the library's own check).
 *
 * For an icon that must also play on cue (the password eye after a toggle),
 * use `useIconAnimation` instead.
 */
export function MotionIcon({
  icon: Icon,
  size = 16,
  strokeWidth = 2.5,
  className,
}: MotionIconProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const handle = useRef<IconAnimationHandle>(null);

  useEffect(() => {
    const span = anchor.current;
    const host = span?.parentElement?.closest<HTMLElement>(CONTROL) ?? span?.firstElementChild;
    if (!(host instanceof HTMLElement)) {
      return;
    }

    const play = () => handle.current?.startAnimation();
    const stop = () => handle.current?.stopAnimation();
    const focusIn = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches(':focus-visible')) {
        play();
      }
    };

    host.addEventListener('mouseenter', play);
    host.addEventListener('mouseleave', stop);
    host.addEventListener('focusin', focusIn);
    host.addEventListener('focusout', stop);
    return () => {
      host.removeEventListener('mouseenter', play);
      host.removeEventListener('mouseleave', stop);
      host.removeEventListener('focusin', focusIn);
      host.removeEventListener('focusout', stop);
    };
  }, []);

  return (
    <span
      ref={anchor}
      className="contents"
      style={{ '--pg-icon-stroke': strokeWidth } as CSSProperties}
    >
      <Icon
        ref={handle}
        aria-hidden
        size={size}
        className={cn(
          ANIMATED_ICON_BOX,
          'shrink-0 [&_svg]:[stroke-width:var(--pg-icon-stroke)]',
          className,
        )}
      />
    </span>
  );
}
