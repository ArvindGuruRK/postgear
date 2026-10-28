'use client';

/**
 * A slide drawn by the real renderer at whatever width its box has.
 *
 * Every picture of a slide in Studio is this: a recent design's card, the
 * gallery's templates, the slide rail, the preview frames and the share
 * page. The box holds the format's shape before anything is measured, so
 * nothing jumps when the slide appears, and a `lazy` one is drawn only once
 * it comes near the screen: a gallery of a hundred templates draws the dozen
 * in view (DS-3.2).
 */
import { type DesignDocument, FORMATS, ScaledSlide, type SlotId } from '@postgear/design-engine';
import { cn } from '@postgear/ui';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { scrollRootOf } from './scroll-root';

/** The box's width in CSS pixels, kept current as the layout changes. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(([entry]) => {
      // Rounded, so a sub-pixel reflow does not redraw every slide.
      setWidth(Math.round(entry?.contentRect.width ?? element.clientWidth));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

/**
 * True once the box has come within a screen's reach of the box it scrolls
 * in (`scrollRootOf`: the viewport for a page that scrolls itself); it then
 * stays drawn.
 */
function useNearScreen(ref: RefObject<HTMLElement | null>, lazy: boolean): boolean {
  const [near, setNear] = useState(!lazy);

  useEffect(() => {
    if (near) return;

    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { root: scrollRootOf(element), rootMargin: '400px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, ref]);

  return near;
}

export function SlideFrame({
  design,
  index = 0,
  resolveMedia,
  lazy = false,
  label,
  onFit,
  className,
}: {
  design: DesignDocument;
  /** Zero-based. */
  index?: number;
  resolveMedia?: (mediaId: string) => string | null;
  /** Draw only once near the screen: for long grids. */
  lazy?: boolean;
  /**
   * What a screen reader hears for the slide. Without one it is hidden from
   * them, which suits a thumbnail inside a button that already has a name.
   */
  label?: string;
  /** The slots still too long at their smallest size, as the slide rail marks them. */
  onFit?: (overflowing: SlotId[]) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const near = useNearScreen(box, lazy);
  const spec = FORMATS[design.format];
  // A named picture, or nothing at all to a screen reader.
  const meaning = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);

  return (
    <div
      ref={box}
      {...meaning}
      className={cn('relative w-full overflow-hidden', className)}
      style={{ aspectRatio: `${spec.width} / ${spec.height}` }}
    >
      {near && width > 0 ? (
        <ScaledSlide
          design={design}
          index={index}
          width={width}
          mode="preview"
          resolveMedia={resolveMedia}
          onFit={onFit}
        />
      ) : null}
    </div>
  );
}
