/**
 * Twitch's app token (client credentials from `id.twitch.tv`; no person logs
 * in and no scope is asked for), shared by everything that reads public
 * Twitch data with PostGear's own keys: the channel browser's Helix lister
 * (Module 03) and the Schedule Maker (Sprint 13, Module 14 section C3).
 *
 * - Kept in Redis until a day before it expires, under a key named after the
 *   client id (hashed), so both users share one token and new keys never use
 *   an old one.
 * - One fetch at a time per instance: callers that ask while a fetch is
 *   running wait for the same answer.
 * - `drop()` forgets it, for the caller that got a 401 and tries once more.
 * - Bad keys read as `lister_unconfigured`, a 429 as `platform_rate_limited`,
 *   anything else as `channel_listing_failed`.
 * - **Never logged**: the client secret or the token. Errors carry a code only.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RedisService } from '../../../redis/redis.service';
import type { ListerHttp } from './lister-http';
import { ListingFailure } from './listing-failure';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const DAY_SECONDS = 24 * 60 * 60;

const tokenSchema = z.object({
  access_token: z.string().min(1).max(512),
  expires_in: z.number().int().positive(),
});

export interface TwitchAppTokenOptions {
  clientId: string;
  clientSecret: string;
  http: ListerHttp;
  redis: Pick<RedisService, 'get' | 'set' | 'delete'>;
}

/** The Redis key the token lives under, named after the client id (hashed). */
export function twitchTokenKey(clientId: string): string {
  const id = createHash('sha256').update(clientId).digest('hex').slice(0, 12);
  return `clips:twitch:token:${id}`;
}

export class TwitchAppToken {
  readonly key: string;
  private flight: Promise<string> | null = null;

  constructor(private readonly options: TwitchAppTokenOptions) {
    this.key = twitchTokenKey(options.clientId);
  }

  get clientId(): string {
    return this.options.clientId;
  }

  /** The token from Redis, or a new one. `fresh` skips Redis (after a 401). */
  async get(fresh = false): Promise<string> {
    if (!fresh) {
      const cached = await this.options.redis.get(this.key);
      if (cached) return cached;
    }
    if (!this.flight) {
      this.flight = this.fetchToken().finally(() => {
        this.flight = null;
      });
    }
    return this.flight;
  }

  /** Forgets the token, so the next `get` fetches a new one. */
  async drop(): Promise<void> {
    await this.options.redis.delete(this.key);
  }

  private async fetchToken(): Promise<string> {
    const response = await this.options.http({
      url: TOKEN_URL,
      method: 'POST',
      form: {
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        grant_type: 'client_credentials',
      },
    });
    if (response.status === 429) throw new ListingFailure('platform_rate_limited');
    if (response.status >= 400 && response.status < 500) {
      throw new ListingFailure('lister_unconfigured');
    }
    const parsed = tokenSchema.safeParse(response.json);
    if (response.status !== 200 || !parsed.success) {
      throw new ListingFailure('channel_listing_failed');
    }

    const { access_token: token, expires_in: expiresIn } = parsed.data;
    // Kept until a day before it expires; a short-lived token is kept for half its life.
    const keep =
      expiresIn > 2 * DAY_SECONDS
        ? expiresIn - DAY_SECONDS
        : Math.max(60, Math.floor(expiresIn / 2));
    await this.options.redis.set(this.key, token, keep);
    return token;
  }
}
