'use client';

import { useEffect, useState } from 'react';
import { gsap, useGSAP } from './gsap';

/**
 * The hover fill for neutral buttons (2026-10-21), after gsap.com's own
 * buttons: a soft-edged circle of colour appears under the pointer, grows
 * until it covers the control, trails the pointer while it moves, and on
 * leaving drifts out through the edge the pointer left by as it shrinks.
 * While it is open the control carries `data-filled`, so its label can flip
 * colour; that flag drops only once the circle has fully gone, so a label
 * never matches the fill it still sits on.
 *
 * Only with a real mouse, and never under reduced motion. When the effect is
 * live the control carries `data-fill-hover`; style the plain CSS hover with
 * `not-data-fill-hover:hover:` so touch screens, reduced motion and links
 * styled as buttons still get an instant fill. The classes for the control
 * and the circle are in `fill-hover-classes.ts`.
 *
 * Elements come in through callback refs held in state, not `useRef`: a
 * control can remount under the same hook (TooltipHint wraps a disabled
 * trigger in a span), and the listeners must follow the new element.
 */

const LIVE = '(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)';
/** Slower than gsap.com's 0.4s / 0.3s, by request: a calm, even fill. */
const GROW = 0.7;
const FOLLOW = 0.5;
const SHRINK = 0.55;
const EASE = 'power2.out';
/** How far past an edge the circle leaves by, as a share of the control. */
const OVERSHOOT = 0.2;
/** Px beyond the edge's blur (0.5rem in fill-hover-classes.ts) to cover. */
const FEATHER = 16;

export function useFillHover({
  enabled = true,
  disabled = false,
}: {
  enabled?: boolean;
  disabled?: boolean;
} = {}) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [fill, setFill] = useState<HTMLElement | null>(null);

  useGSAP(
    () => {
      if (!enabled || !root || !fill) {
        return;
      }
      const mm = gsap.matchMedia();
      mm.add(LIVE, () => {
        root.dataset.fillHover = '';

        /** The pointer inside the control, clamped to its box. */
        const point = (event: PointerEvent) => {
          const box = root.getBoundingClientRect();
          return {
            x: gsap.utils.clamp(0, box.width, event.clientX - box.left),
            y: gsap.utils.clamp(0, box.height, event.clientY - box.top),
            width: box.width,
            height: box.height,
          };
        };

        const enter = (event: PointerEvent) => {
          const { x, y, width, height } = point(event);
          // Radius = the diagonal, so the circle covers the whole control
          // wherever it sits inside it, square icon buttons included, plus
          // room for the soft edge so no far corner is left half-filled.
          const size = 2 * (Math.hypot(width, height) + FEATHER);
          root.dataset.filled = '';
          gsap.killTweensOf(fill);
          gsap.set(fill, { width: size, height: size, x, y, xPercent: -50, yPercent: -50, scale: 0 });
          gsap.to(fill, { scale: 1, duration: GROW, ease: EASE });
        };

        const move = (event: PointerEvent) => {
          const { x, y } = point(event);
          gsap.to(fill, { x, y, duration: FOLLOW, ease: EASE, overwrite: 'auto' });
        };

        const leave = (event: PointerEvent) => {
          const { x, y, width, height } = point(event);
          // Near an edge, carry on past it, so the circle exits that way.
          const past = (at: number, span: number) =>
            at > span * 0.9 ? at + span * OVERSHOOT : at < span * 0.1 ? at - span * OVERSHOOT : at;
          gsap.killTweensOf(fill);
          gsap.to(fill, {
            x: past(x, width),
            y: past(y, height),
            scale: 0,
            duration: SHRINK,
            ease: EASE,
            onComplete: () => {
              delete root.dataset.filled;
            },
          });
        };

        root.addEventListener('pointerenter', enter);
        root.addEventListener('pointermove', move);
        root.addEventListener('pointerleave', leave);
        return () => {
          root.removeEventListener('pointerenter', enter);
          root.removeEventListener('pointermove', move);
          root.removeEventListener('pointerleave', leave);
          delete root.dataset.fillHover;
          delete root.dataset.filled;
          gsap.killTweensOf(fill);
          gsap.set(fill, { scale: 0 });
        };
      });
    },
    { dependencies: [enabled, root, fill], revertOnUpdate: true },
  );

  // A control that turns disabled under the pointer gets no pointerleave
  // (disabled controls take no pointer events), so close the fill here.
  useEffect(() => {
    if (!disabled || !root || !fill) {
      return;
    }
    delete root.dataset.filled;
    gsap.killTweensOf(fill);
    gsap.set(fill, { scale: 0 });
  }, [disabled, root, fill]);

  return { rootRef: enabled ? setRoot : undefined, fillRef: setFill };
}
