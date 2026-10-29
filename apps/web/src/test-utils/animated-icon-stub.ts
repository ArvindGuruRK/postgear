/**
 * Jest stand-in for `@animateicons/react/lucide/<name>-icon` (mapped in
 * `jest.config.js`). Those paths ship as ES modules only, which Jest's
 * CommonJS runtime cannot load. Any named icon becomes an empty `<svg>`
 * that takes a ref, as `MotionIcon` expects.
 */
import { createElement, forwardRef } from 'react';

const Icon = forwardRef<SVGSVGElement, Record<string, unknown>>(function Icon(_props, ref) {
  return createElement('svg', { ref, 'aria-hidden': 'true' });
});

module.exports = new Proxy(
  {},
  {
    get: (_target, name) => (name === '__esModule' ? true : Icon),
  },
);
