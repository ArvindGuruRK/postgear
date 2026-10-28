/**
 * The box a slide scrolls in, for drawing it just before it comes into view
 * (`slide-frame.tsx`).
 *
 * An IntersectionObserver's margin grows its root, and with no root that is
 * the viewport. A slide inside a box that scrolls (the app's main area, the
 * slide rail, the brand kit strip, a dialog) is clipped by that box first,
 * so a margin on the viewport never reaches it: such a slide would draw only
 * once it is actually in view. Watching the box itself puts the margin where
 * the slide scrolls.
 */

/** The overflow values that let a box scroll what is inside it. */
const SCROLLS = new Set(['auto', 'scroll', 'overlay']);

/**
 * The nearest box `element` scrolls in: an ancestor whose overflow on either
 * axis is auto, scroll or overlay. Null for the page itself, which scrolls in
 * the viewport, the observer's own root.
 */
export function scrollRootOf(element: Element): Element | null {
  const page = element.ownerDocument;
  const view = page.defaultView;
  if (!view) return null;

  for (let box = element.parentElement; box; box = box.parentElement) {
    if (box === page.body || box === page.documentElement) return null;

    const { overflowX, overflowY } = view.getComputedStyle(box);
    if (SCROLLS.has(overflowY) || SCROLLS.has(overflowX)) return box;
  }
  return null;
}
