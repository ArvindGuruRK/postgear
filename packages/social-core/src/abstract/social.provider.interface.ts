/**
 * The contract every social platform implements.
 *
 * ## Why the split
 *
 * The interface is deliberately two halves — authenticating an account, and
 * posting to it — joined by `SocialProvider`. That separation is worth keeping
 * even though every current provider implements both: the auth half is what the
 * channels module and the Sprint 5 refresh workflow call, and the publishing
 * half is what the Sprint 5 publish activity calls. Two different consumers,
 * two different reasons to change.
 *
 * ## Why there is no Prisma type in this file
 *
 * The reference passes its `Integration` model straight into every provider,
 * which drags `@prisma/client` into the provider layer. PostGear defines
 * `ChannelContext` instead: a plain structural type the API maps onto at its
 * boundary. That keeps this package unit-testable without a database, and
 * importable from the worker without a Prisma dependency.
 *
 * ## What is deliberately absent
 *
 * No analytics methods (Sprint 7), no per-provider settings DTOs, no plug or
 * automation decorators. An optional method is cheap to add later; seven no-op
 * stubs are noise now.
 */

import type { ProviderRules } from '../composer/rules';

/** Where OAuth should send the browser back to. Built by the API, not the provider. */
export type RedirectUri = string;

/**
 * What a provider needs to know about the channel it is acting on.
 *
 * The plaintext token is passed separately rather than living here, so that a
 * `ChannelContext` can be logged without redacting anything.
 */
export interface ChannelContext {
  /** PostGear's own `Integration.id`. */
  id: string;
  /** The platform-side id of the thing being posted to — a page, channel, board, or the account itself. */
  internalId: string;
  /** The platform-side id of the account that granted access. Equal to `internalId` when there is no page indirection. */
  rootInternalId: string;
  /** Registry key: 'x', 'linkedin', 'linkedin-page', … */
  providerIdentifier: string;
  /** Display name. */
  name: string;
  /** The platform handle, e.g. '@postgear'. Stored in `Integration.profile`. */
  profile?: string | null;
  /** Provider-declared settings, already parsed. */
  additionalSettings?: Record<string, unknown>;
}

/** The redirect target plus the values the callback will need to verify it. */
export interface GeneratedAuthUrl {
  url: string;
  /** Opaque CSRF value. The caller stores it server-side; the provider only round-trips it. */
  state: string;
  /**
   * PKCE verifier, for providers with `usesPkce`. Stored server-side alongside
   * the state and handed back to `authenticate()`. Empty string when unused.
   */
  codeVerifier: string;
}

export interface AuthenticateParams {
  /** The authorization code the platform sent to the callback. */
  code: string;
  /** The PKCE verifier minted by `generateAuthUrl`, retrieved from server-side storage. */
  codeVerifier: string;
  /** Must match the value used in `generateAuthUrl` — most platforms verify it. */
  redirectUri: RedirectUri;
}

/** What a successful authentication or refresh yields. */
export interface AuthTokenDetails {
  /** The platform-side account id. Becomes `internalId` (and `rootInternalId` on first connect). */
  id: string;
  accessToken: string;
  refreshToken?: string;
  /** Seconds until `accessToken` expires. Omitted when the platform issues non-expiring tokens. */
  expiresIn?: number;
  name: string;
  /** The handle. Stored in `Integration.profile`. */
  username?: string;
  picture?: string;
  /**
   * True when this provider still needs the user to choose a page, organization,
   * channel or board before the channel can publish. Drives `inBetweenSteps`.
   */
  requiresEntitySelection?: boolean;
}

/** One selectable page / organization / channel / board. */
export interface ProviderEntity {
  id: string;
  name: string;
  picture?: string;
  /** Handle, where the platform has one. */
  username?: string;
  /**
   * A disambiguating detail — follower count, location, "Primary".
   *
   * Not decoration: when someone has five similarly-named Facebook pages, this
   * is what makes the choice possible.
   */
  detail?: string;
  /** The page-scoped token, where selecting the entity also yields one. */
  accessToken?: string;
}

export interface SocialAuthenticator {
  /** Builds the consent URL, and mints the state and PKCE verifier that go with it. */
  generateAuthUrl(redirectUri: RedirectUri): Promise<GeneratedAuthUrl>;

  /** Exchanges an authorization code for credentials. Throws on any failure. */
  authenticate(params: AuthenticateParams): Promise<AuthTokenDetails>;

  /**
   * Exchanges a refresh token for a new access token.
   *
   * Providers whose tokens never expire, or which have no refresh mechanism,
   * return an `AuthTokenDetails` with an **empty `accessToken`** rather than
   * throwing. That collapses "cannot refresh" and "refresh failed" into one
   * branch for the caller, which is the behaviour the refresh path expects.
   */
  refreshToken(refreshToken: string): Promise<AuthTokenDetails>;

  /**
   * Best-effort revocation at the platform, on disconnect.
   *
   * Optional because not every platform offers it. Callers must never block a
   * disconnect on this succeeding — a user asking to disconnect gets
   * disconnected regardless.
   */
  revoke?(accessToken: string): Promise<void>;
}

/** Implemented only by providers that require a second step after OAuth. */
export interface SupportsEntitySelection {
  /** The pages / organizations / channels / boards this account can post to. */
  listEntities(accessToken: string): Promise<ProviderEntity[]>;

  /**
   * Resolves the chosen entity into what should be persisted.
   *
   * Returns a page-scoped token where the platform issues one; the caller
   * writes it over the user-scoped token and flips `internalId` to the entity.
   */
  selectEntity(accessToken: string, entityId: string): Promise<ProviderEntity>;
}

export interface MediaDescriptor {
  type: 'image' | 'video';
  /**
   * A public URL the provider can fetch — and that the *platform* can fetch,
   * since Instagram, Facebook, Pinterest and TikTok pull media from it themselves.
   * Built from `Media.path` by the API's storage backend.
   */
  path: string;
  alt?: string;
  thumbnail?: string;
  /**
   * What the media library knows about the file (Sprint 4). Optional because a
   * caller may not have them; each one that is present lets `checkValidity`
   * enforce the matching rule before the platform refuses the upload.
   */
  mimeType?: string;
  bytes?: number;
  width?: number;
  height?: number;
}

export interface PostDetails {
  /** PostGear's `Post.id`, echoed back so the caller can correlate results. */
  id: string;
  message: string;
  media?: MediaDescriptor[];
  /** Provider-specific options, validated by the provider itself. */
  settings?: Record<string, unknown>;
}

export interface PostResponse {
  /** The `PostDetails.id` this result belongs to. */
  id: string;
  /** The platform's id for the published post. */
  postId: string;
  /** Permalink, where one can be constructed. */
  releaseURL: string;
}

export interface SocialPublisher {
  /** Publishes one post. Throws `BadBodyError` / `RefreshTokenError` / `RetryableError`. */
  post(channel: ChannelContext, accessToken: string, posts: PostDetails[]): Promise<PostResponse[]>;

  /** Replies to an existing post — threads on X, comments elsewhere. */
  comment?(
    channel: ChannelContext,
    accessToken: string,
    parentPostId: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]>;
}

export interface SocialProvider extends SocialAuthenticator, SocialPublisher {
  /** Registry key, and the value stored in `Integration.providerIdentifier`. */
  readonly identifier: string;
  /** Human-readable name for the connect UI. */
  readonly name: string;
  /** OAuth scopes requested at consent time. */
  readonly scopes: string[];
  /** Whether the authorization-code exchange uses PKCE. */
  readonly usesPkce: boolean;

  /** False when the client id or secret is missing, so the UI can say why. */
  isConfigured(): boolean;

  /**
   * Character limit for a single post.
   *
   * Kept alongside `rules.maxLength` because it can depend on the account: an X
   * Premium account is allowed far more than the 280 in its static rules.
   */
  maxLength(settings?: Record<string, unknown>): number;

  /**
   * What this provider can publish, as data (Sprint 4).
   *
   * Sent to the browser so the composer validates against exactly what the
   * provider will do — see `composer/rules.ts` for why this is declarative.
   */
  readonly rules: ProviderRules;

  /**
   * Platform rules a post must satisfy before it is worth attempting.
   *
   * Returns `true`, or a message explaining what is wrong. Catching this here
   * turns a remote rejection into a local, specific error. Every provider
   * implements it by running `rules` through the shared composer validator.
   */
  checkValidity(posts: PostDetails[]): Promise<string | true>;
}

/** Narrowing helper — providers needing a second step implement `listEntities`. */
export function supportsEntitySelection(
  provider: SocialProvider,
): provider is SocialProvider & SupportsEntitySelection {
  return typeof (provider as Partial<SupportsEntitySelection>).listEntities === 'function';
}
