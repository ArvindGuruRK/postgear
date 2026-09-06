import type { Provider } from '@postgear/db';

/**
 * One social login provider.
 *
 * Two methods, matching the two halves of an OAuth 2 authorization-code
 * handshake: send the user somewhere, then trade the code they come back with
 * for a profile.
 *
 * The shape is deliberately the same idea as the provider/manager pattern used
 * for social *channels* in Sprint 3 — one interface, N implementations, one
 * registry that dispatches by name. Learning it once here pays off there.
 *
 * Note what the interface does **not** expose: no access token, no refresh
 * token, no scopes. Sign-in only needs a stable identifier and an email.
 * Channel publishing needs the tokens, and that is `Integration`'s job, with
 * its own encryption boundary. Keeping them apart means a login provider can
 * never accidentally persist a credential in plaintext.
 */
export interface OAuthProfile {
  /** The provider's own account id. Stable across email changes. */
  providerId: string;
  /** Verified primary address. Providers that can omit it are handled below. */
  email: string;
  name?: string;
}

export interface AuthProvider {
  /** Matches the `Provider` enum value stored on `User.providerName`. */
  readonly name: Provider;

  /** True when the client id and secret are actually configured. */
  isConfigured(): boolean;

  /**
   * The URL to redirect the browser to.
   *
   * `state` is generated and stored by the caller; the provider only has to
   * round-trip it. See `providers.manager.ts` for why it is mandatory.
   */
  getAuthUrl(state: string): string;

  /** Exchanges an authorization code for a profile. Throws on any failure. */
  handleCallback(code: string): Promise<OAuthProfile>;
}

/** Thrown for every OAuth failure, so the controller has one thing to catch. */
export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}
