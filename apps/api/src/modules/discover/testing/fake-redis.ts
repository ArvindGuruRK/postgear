/**
 * Redis for the Discover specs: the same calls, with real expiry against
 * `Date.now()`, so fake timers can walk a key out of its window. `keys` and `read`
 * let a spec prove what was written, and what never was.
 */
import type { RedisService } from '../../redis/redis.service';

type DiscoverRedis = Pick<
  RedisService,
  'incrementWithTtl' | 'get' | 'set' | 'setIfAbsent' | 'delete'
>;

export class FakeRedis implements DiscoverRedis {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  /** The live keys, for proving what is and is not in them. */
  get keys(): string[] {
    return [...this.store.keys()].filter((key) => this.read(key) !== null);
  }

  asService(): RedisService {
    return this as unknown as RedisService;
  }

  read(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  write(key: string, value: string, ttlSeconds: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const existing = this.read(key);
    if (existing === null) {
      this.write(key, '1', ttlSeconds);
      return 1;
    }
    const count = Number(existing) + 1;
    this.store.set(key, { value: String(count), expiresAt: this.expiryOf(key) });
    return count;
  }

  async get(key: string): Promise<string | null> {
    return this.read(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.write(key, value, ttlSeconds);
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.read(key) !== null) return false;
    this.write(key, value, ttlSeconds);
    return true;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  private expiryOf(key: string): number {
    return this.store.get(key)?.expiresAt ?? 0;
  }
}
