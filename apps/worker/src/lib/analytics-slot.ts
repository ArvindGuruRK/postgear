/**
 * When a channel's next analytics sync is due.
 *
 * Pure on purpose: the workflow imports this, and the workflow sandbox
 * allows no Node built-ins and nothing that reaches outside, not even the
 * error classes in `@postgear/social-core`, whose base class pulls in
 * `node:crypto`. The activity side uses the same function so the two agree
 * on the slot to the millisecond.
 *
 * ## Why a per-channel minute
 *
 * Every channel syncs once a day, twenty-four hours after its last sync,
 * but if a fleet of channels were all connected during one onboarding
 * session they would all come due in the same minute, every day, and hit
 * the same platform's rate limit together. Hashing the integration id into
 * a minute of the hour spreads a thousand channels across sixty slots with
 * no coordination and no state.
 */

export const SYNC_INTERVAL_MS = 24 * 60 * 60_000;

/** The least time between two syncs of one channel, however often "sync now" is clicked. */
export const SYNC_NOW_MIN_GAP_MS = 2 * 60_000;

const HOUR_MS = 60 * 60_000;
const MINUTE_MS = 60_000;

/** FNV-1a, 32-bit. Stable across processes, which `Math.random` and object hashes are not. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

/** The minute of the hour this channel always syncs at: 0–59. */
export function minuteOffset(integrationId: string): number {
  return hashString(integrationId) % 60;
}

/**
 * The next slot after `lastSyncAt`: a day later, at the channel's minute of
 * that hour, and never in the past relative to `now`; a workflow that was
 * down for a week comes back and syncs once, not seven times.
 */
export function nextSyncSlot(
  lastSyncAt: number,
  integrationId: string,
  now: number = lastSyncAt,
): number {
  const target = lastSyncAt + SYNC_INTERVAL_MS;
  const hourStart = target - (target % HOUR_MS);
  let slot = hourStart + minuteOffset(integrationId) * MINUTE_MS;

  while (slot <= now) {
    slot += SYNC_INTERVAL_MS;
  }

  return slot;
}
