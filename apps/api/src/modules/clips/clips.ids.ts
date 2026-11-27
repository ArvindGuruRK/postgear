/** Row ids in Clips are UUIDs; anything else in a URL is a 404 before a query runs. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A Studio brand kit's id: a uuid for kits made in the app, a readable one
 * for kits seeded by hand (`seed-brand-kit-lotus`). Every read is still
 * scoped to the workspace; this only keeps free text out of a query.
 */
export function isBrandKitId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
