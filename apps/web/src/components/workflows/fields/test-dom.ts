/**
 * What jsdom lacks for the field kit's tests: `matchMedia` (the animated
 * buttons ask it about reduced motion), layout boxes (ProseMirror measures
 * the caret) and `ResizeObserver` (Radix popovers watch their size). Call it
 * in a `beforeAll`.
 */
export function stubBrowserLayout(): void {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;

  const empty = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  });
  const noRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator],
    }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty as never;
  Range.prototype.getClientRects = noRects;
  document.elementFromPoint = (() => null) as never;

  if (!('ResizeObserver' in window)) {
    class NoResize {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: typeof NoResize }).ResizeObserver = NoResize;
    (globalThis as unknown as { ResizeObserver: typeof NoResize }).ResizeObserver = NoResize;
  }
  // This jsdom's selector engine answers `:modal` and friends by calling
  // `matches` again until the stack overflows, which takes tens of seconds
  // per Radix popover. Nothing in jsdom is ever in the top layer.
  const STATE_ONLY = /^:(modal|fullscreen|popover-open|open|closed|picture-in-picture)$/;
  const matches = Element.prototype.matches;
  if (!(matches as { pgStub?: boolean }).pgStub) {
    const stubbed = function (this: Element, selector: string) {
      if (STATE_ONLY.test(selector.trim())) return false;
      return matches.call(this, selector);
    };
    (stubbed as { pgStub?: boolean }).pgStub = true;
    Element.prototype.matches = stubbed;
  }

  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture)
    Element.prototype.releasePointerCapture = () => undefined;
}
