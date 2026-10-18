'use client';

import { type FocusEvent, type RefCallback, useCallback, useMemo, useRef } from 'react';
import type { IconAnimationHandle } from './icon-animation';

/**
 * Plays animated icons from the control they sit in (2026-10-19): hover
 * anywhere on the control, or reach it by keyboard, and the icon moves.
 *
 * The library animates on hovering the icon itself, a 16px target inside a
 * 36px button; holding a ref turns that off, and the control's own events
 * drive it instead. Focus from a click is not `:focus-visible`, so only the
 * keyboard plays it on focus. Under reduced motion the icon's own
 * `startAnimation` holds its resting pose, so nothing here checks for it.
 *
 * `ref` collects every icon given it, so one control can play several (the
 * theme toggle's sun and moon): spread `triggers` on the control and pass
 * `ref` to each icon.
 */
export function useIconAnimation() {
  const handles = useRef(new Set<IconAnimationHandle>());

  const ref = useCallback<RefCallback<IconAnimationHandle>>((handle) => {
    if (!handle) {
      return;
    }
    handles.current.add(handle);
    return () => {
      handles.current.delete(handle);
    };
  }, []);

  const play = useCallback(() => {
    for (const handle of handles.current) {
      handle.startAnimation();
    }
  }, []);

  const stop = useCallback(() => {
    for (const handle of handles.current) {
      handle.stopAnimation();
    }
  }, []);

  const triggers = useMemo(
    () => ({
      onMouseEnter: play,
      onMouseLeave: stop,
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if (event.currentTarget.matches(':focus-visible')) {
          play();
        }
      },
      onBlur: stop,
    }),
    [play, stop],
  );

  return { ref, play, stop, triggers };
}
