/**
 * Units Clips limits are written in. A gigabyte is 10^9 bytes, as storage
 * is sold (and as a plan card reads), not 2^30.
 */
export const BYTES_PER_GB = 1_000_000_000;

export function gigabytesToBytes(gb: number): number {
  return Math.floor(gb * BYTES_PER_GB);
}

export const MS_PER_MINUTE = 60_000;
