/**
 * Owner of the OAuth `state` for channel connections.
 *
 * ## Why this is not the auth module's `ProvidersManager`
 *
 * Sprint 2's login handshake stores one thing against a state value: the
 * provider name. A channel handshake has to carry more — which workspace the
 * channel belongs to, which user started it, the PKCE verifier, and whether this
 * is a reconnect of an existing channel. It is the same idea with a bigger
 * payload, under its own key prefix so the two can never be confused for each
 * other.
 *
 * ## Why the payload lives server-side rather than in the state parameter
 *
 * `state` is an opaque lookup key, and everything real sits in Redis behind it.
 * That keeps the workspace id out of a URL that round-trips through a third
 * party and a browser address bar, and it means a tampered state finds nothing
 * rather than yielding attacker-chosen values.
 *
 * The state is **consumed** on the way back, so a callback URL captured from
 * browser history or a referrer header cannot be replayed.
 */

import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * Long enough for a user to complete a consent screen — including reading a
 * Meta permission list — and short enough that a leaked URL goes stale.
 */
export const CHANNEL_OAUTH_STATE_TTL_SECONDS = 900;

export interface ChannelHandshake {
  provider: string;
  orgId: string;
  userId: string;
  /** Empty for providers that do not use PKCE. */
  codeVerifier: string;
  /** Set when reconnecting an existing channel. PostGear's own `Integration.id`. */
  reconnectChannelId?: string;
  /** Where to send the browser afterwards. */
  returnPath: string;
}

@Injectable()
export class ChannelOAuthService {
  constructor(private readonly redis: RedisService) {}

  /** Mints a state value and stores the handshake behind it. */
  async begin(handshake: ChannelHandshake): Promise<string> {
    const state = randomBytes(32).toString('base64url');

    await this.redis.set(
      this.key(state),
      JSON.stringify(handshake),
      CHANNEL_OAUTH_STATE_TTL_SECONDS,
    );

    return state;
  }

  /**
   * Validates and consumes a state value.
   *
   * Deleting before returning is what makes the handshake single-use. The
   * provider is compared too, closing a cross-provider mix-up where a state
   * minted for LinkedIn is presented to the Facebook callback.
   *
   * Returns `null` for anything unrecognised — the caller redirects to a generic
   * error, and the authorization code is never spent.
   */
  async consume(provider: string, state: string | undefined): Promise<ChannelHandshake | null> {
    if (!state) {
      return null;
    }

    const key = this.key(state);
    const stored = await this.redis.get(key);
    await this.redis.delete(key);

    if (!stored) {
      return null;
    }

    let handshake: ChannelHandshake;

    try {
      handshake = JSON.parse(stored) as ChannelHandshake;
    } catch {
      return null;
    }

    if (handshake.provider !== provider.toLowerCase()) {
      return null;
    }

    return handshake;
  }

  private key(state: string): string {
    return `channel:oauth:state:${state}`;
  }
}
