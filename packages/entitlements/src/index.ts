/**
 * `@postgear/entitlements`: plans as data (Sprint 12, decision D12-07).
 *
 * The registry of limits, the seed per tier, validation, resolution, the
 * meter windows and units, and the refusal sentences. Pure, so the API, the
 * worker and the web app all import it; the database, the cache and the
 * usage ledger live in the API's `modules/entitlements`.
 */
export * from './capabilities';
export * from './cycle';
export * from './display';
export { formatNumber } from './format-number';
export * from './keys/clips';
export * from './keys/members';
export * from './messages';
export * from './registry';
export * from './resolve';
export * from './seed';
export * from './units';
export * from './validate';
