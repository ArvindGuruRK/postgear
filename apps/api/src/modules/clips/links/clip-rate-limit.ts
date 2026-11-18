/**
 * A fixed-window counter in Redis for the Clips throttles (ten probes a
 * minute, thirty list calls a minute, six adds a minute).
 *
 * `incrementWithTtl` sets the window's expiry on the first hit only, so a
 * workspace that keeps calling cannot hold its own window open for ever. With
 * Redis down the service falls back to a per-process counter: a throttle
 * that is per instance for a while is better than one that refuses everyone.
 */
import type { RedisService } from '../../redis/redis.service';

/** True while the caller is within `limit` hits of the window that `key` names. */
export async function withinRate(
  redis: Pick<RedisService, 'incrementWithTtl'>,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const count = await redis.incrementWithTtl(key, windowSeconds);
  return count <= limit;
}
