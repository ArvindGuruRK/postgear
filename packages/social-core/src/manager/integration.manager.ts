/**
 * The registry that maps a provider identifier to its implementation.
 *
 * ## Two things this deliberately is not
 *
 * **Not a Nest `@Injectable()`.** `@postgear/social-core` is imported by both
 * `apps/api` (Nest) and, from Sprint 5, `apps/worker` (a Temporal worker, not a
 * Nest app). Depending on `@nestjs/common` here would force the worker to carry
 * a DI framework it has no use for. The API wraps this in a thin Nest provider
 * instead — one file, in the layer that already knows about Nest.
 *
 * **Not the home of token cryptography**, despite the scaffolded TODO that said
 * so. Encryption belongs at the persistence boundary, where the plaintext stops
 * and the database begins — `apps/api/src/modules/channels/channels.repository.ts`
 * — not in a lookup table that never touches a database.
 *
 * The pattern mirrors `apps/api/src/modules/auth/providers/providers.manager.ts`
 * from Sprint 2 on purpose: one interface, N implementations, one registry that
 * dispatches by name. Adding a provider is one line here.
 */
import { ProviderError, ProviderNotConfiguredError } from '../abstract/errors';
import type { SocialProvider } from '../abstract/social.provider.interface';
import { FacebookProvider } from '../providers/facebook';
import { InstagramProvider } from '../providers/instagram';
import { LinkedInPageProvider, LinkedInProvider } from '../providers/linkedin';
import { PinterestProvider } from '../providers/pinterest';
import { TikTokProvider } from '../providers/tiktok';
import { XProvider } from '../providers/twitter';
import { YouTubeProvider } from '../providers/youtube';

/** What the connect UI needs to render one tile. */
export interface ProviderSummary {
  identifier: string;
  name: string;
  /**
   * False when the client id or secret is missing.
   *
   * Surfaced rather than filtered: a self-hoster who has not set
   * `TIKTOK_CLIENT_KEY` should see TikTok greyed out with a reason, not wonder
   * whether PostGear supports it at all.
   */
  configured: boolean;
  /** True when connecting takes a second step to choose a page/channel/board. */
  requiresEntitySelection: boolean;
}

export class IntegrationManager {
  private readonly providers: Map<string, SocialProvider>;

  constructor(providers?: SocialProvider[]) {
    const list = providers ?? [
      new XProvider(),
      new LinkedInProvider(),
      new LinkedInPageProvider(),
      new FacebookProvider(),
      new InstagramProvider(),
      new YouTubeProvider(),
      new TikTokProvider(),
      new PinterestProvider(),
    ];

    this.providers = new Map(list.map((provider) => [provider.identifier, provider]));
  }

  /**
   * Resolves an identifier to a provider, or throws.
   *
   * Unknown and unconfigured are distinguished so the log can say which, while
   * the user sees the same generic message either way — an unconfigured
   * provider is a deployment gap, and saying so to an end user helps nobody.
   */
  get(identifier: string): SocialProvider {
    const provider = this.providers.get(identifier.toLowerCase());

    if (!provider) {
      throw new ProviderError(`Unknown provider: ${identifier}`, identifier);
    }

    if (!provider.isConfigured()) {
      throw new ProviderNotConfiguredError(identifier);
    }

    return provider;
  }

  /** Looks up a provider without the configured check. For reads that must not throw. */
  find(identifier: string): SocialProvider | undefined {
    return this.providers.get(identifier.toLowerCase());
  }

  /** Every provider, configured or not, for the connect UI. */
  list(): ProviderSummary[] {
    return [...this.providers.values()].map((provider) => ({
      identifier: provider.identifier,
      name: provider.name,
      configured: provider.isConfigured(),
      requiresEntitySelection: 'listEntities' in provider,
    }));
  }

  /** Identifiers that could actually be connected right now. */
  configuredIdentifiers(): string[] {
    return [...this.providers.values()]
      .filter((provider) => provider.isConfigured())
      .map((provider) => provider.identifier);
  }
}
