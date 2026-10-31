'use client';

/**
 * How far from the grid's bottom the Workflows page's left card is let go
 * (Workflows revamp, 2026-10-31).
 *
 * The card is `position: sticky` in a column as tall as the grid, so it stays
 * in view while the page scrolls and the browser does the moving (the first
 * version pinned it with GSAP's ScrollTrigger, which inside a scrolling
 * container moves the card by transform and judders). A sticky card only
 * stops at its column's bottom, and a card shorter than the window would then
 * stay fixed to the very end. So the column is cut short by one row of cards:
 * the card is released as the last row comes up and scrolls away with it.
 *
 * The distance is one row (a card and the grid's gap), but never more than
 * leaves the column as tall as the card, or a short list would grow a gap
 * under it. It is measured again whenever the grid or the card changes size.
 */
import { type RefObject, useEffect, useState } from 'react';

/** The grid's gap between rows, in px. */
const GRID_GAP = 16;

export function useReleaseDistance(
  results: RefObject<HTMLElement | null>,
  card: RefObject<HTMLElement | null>,
): number {
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const section = results.current;
    const element = card.current;
    if (!section || !element) return;

    function measure() {
      if (!section || !element) return;
      const row = section.querySelector('li');
      const lastRow = row ? row.offsetHeight + GRID_GAP : 0;
      const spare = section.offsetHeight - element.offsetHeight;
      setDistance(Math.max(0, Math.min(lastRow, spare)));
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(section);
    observer.observe(element);
    return () => observer.disconnect();
  }, [results, card]);

  return distance;
}
