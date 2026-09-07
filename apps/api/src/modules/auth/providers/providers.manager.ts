import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Provider } from '@postgear/db';
import { RedisService } from '../../redis/redis.service';
import { OAUTH_STATE_TTL_SECONDS } from '../token.service';
import { type AuthProvider, OAuthError } from './auth-provider.interface';
import { FacebookAuthProvider } from './facebook.provider';
import { GoogleAuthProvider } from './google.provider';

/**
 * The registry that dispatches by provider name, and the owner of the OAuth
 * `state` parameter.
 *
 * Adding a provider means implementing `AuthProvider` and adding one line to
 * the constructor — no controller changes, no new routes.
 *
 * ## Why state lives here and not in the provider
 *
 * `state` is CSRF protection for the handshake, and the requirement is
 * identical for every provider, so implementing it per-provider would be three
 * copies of the same security-critical code. It works by minting a random
 * value, storing it server-side before the redirect, and requiring it back —
 * and, crucially, **consuming it**, so a captured callback URL cannot be
 * replayed.
 *
 * Redis rather than a signed cookie because consumption has to be
 * server-authoritative: a cookie can be presented twice, and detecting that
 * needs server state anyway. A ten-minute TTL is long enough for a consent
 * screen and short enough that a leaked URL goes stale quickly. Losing these
 * on a Redis restart merely fails an in-flight sign-in, which the user retries.
 */
@Injectable()
export class ProvidersManager {
  private readonly providers: Map<string, AuthProvider>;

  constructor(
    google: GoogleAuthProvider,
    facebook: FacebookAuthProvider,
    private readonly redis: RedisService,
  ) {
    this.providers = new Map<string, AuthProvider>([
      ['google', google],
      ['facebook', facebook],
    ]);
  }

  /** Resolves a URL segment to a provider, or throws. */
  get(name: string): AuthProvider {
    const provider = this.providers.get(name.toLowerCase());

    if (!provider) {
      throw new OAuthError(`Unknown provider: ${name}`);
    }

    if (!provider.isConfigured()) {
      // A provider with no client id is a deployment gap, not a user error —
      // the button should not have been rendered. Distinguishing it in the log
      // is worth it; the user still sees the generic OAUTH_FAILED.
      throw new OAuthError(`Provider ${name} is not configured`);
    }

    return provider;
  }

  /** Which providers the frontend should render buttons for. */
  configuredNames(): Provider[] {
    return [...this.providers.values()].filter((p) => p.isConfigured()).map((p) => p.name);
  }

  /** Mints and stores a state value, returning the redirect URL. */
  async beginHandshake(name: string): Promise<string> {
    const provider = this.get(name);
    const state = randomBytes(32).toString('base64url');

    await this.redis.set(this.stateKey(state), name.toLowerCase(), OAUTH_STATE_TTL_SECONDS);

    return provider.getAuthUrl(state);
  }

  /**
   * Validates and consumes a state value.
   *
   * Deleting it before returning is what makes the handshake single-use: an
   * attacker who captures a callback URL from a browser history or a referrer
   * header cannot replay it, because the second attempt finds nothing stored.
   *
   * It also checks that the state was issued for *this* provider, which closes
   * a cross-provider mix-up where a state minted for Facebook is presented to
   * the Google callback.
   */
  async consumeState(name: string, state: string | undefined): Promise<boolean> {
    if (!state) {
      return false;
    }

    const key = this.stateKey(state);
    const stored = await this.redis.get(key);
    await this.redis.delete(key);

    return stored === name.toLowerCase();
  }

  private stateKey(state: string): string {
    return `oauth:state:${state}`;
  }
}
