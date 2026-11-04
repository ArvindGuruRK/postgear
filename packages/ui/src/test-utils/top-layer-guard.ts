/**
 * jsdom's selector engine (nwsapi) answers `:modal` and `:popover-open` through
 * `:fullscreen`, which asks `matches` again and never comes back. Floating UI asks
 * those as it places any popover, so a test that opens one would spin forever with
 * no output. Nothing in jsdom is ever in the top layer, so the answer is always no.
 */
const TOP_LAYER = new Set([':fullscreen', ':modal', ':popover-open']);
const { matches } = Element.prototype;

Element.prototype.matches = function guarded(this: Element, selector: string) {
  return TOP_LAYER.has(selector) ? false : matches.call(this, selector);
};

export {};
