/**
 * Jest stand-in for `@animateicons/react/lucide/<name>-icon` (mapped in
 * `jest.config.js`). Those paths ship as ES modules only, which Jest's
 * CommonJS runtime cannot load. Any named icon becomes an empty `<svg>`
 * whose ref is the handle `MotionIcon` drives: `startAnimation` and
 * `stopAnimation`, which do nothing here. (A dialog that focuses a button
 * with an icon on open calls them, so the handle has to be there.)
 */
import { createElement, forwardRef, useImperativeHandle } from 'react';

const Icon = forwardRef<unknown, Record<string, unknown>>(function Icon(_props, ref) {
  useImperativeHandle(
    ref,
    () => ({ startAnimation: () => undefined, stopAnimation: () => undefined }),
    [],
  );
  return createElement('svg', { 'aria-hidden': 'true' });
});

module.exports = new Proxy(
  {},
  {
    get: (_target, name) => (name === '__esModule' ? true : Icon),
  },
);
