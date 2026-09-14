/**
 * `@postgear/social-core/composer` — the browser-safe half of the package.
 *
 * Everything the composer needs to agree with the publisher: the post document,
 * its rendering to platform text, length counting, declarative platform rules
 * and the validator. None of it touches the network, Node built-ins or a
 * provider class, which is what lets `apps/web` bundle it.
 *
 * The web app imports this entry point directly. Importing the package root
 * from the browser would pull in the providers, and with them `node:crypto`.
 */
export * from './document';
export * from './length';
export * from './render';
export * from './rules';
export * from './unicode';
export * from './validate';
