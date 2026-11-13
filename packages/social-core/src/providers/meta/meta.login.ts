/**
 * Shared plumbing for Meta's two "login on its own" APIs: Instagram API with
 * Instagram Login, and the Threads API.
 *
 * Neither goes through Facebook. Each has its own app id and secret (shown in
 * the Meta dashboard under that product, not the Meta app's own id), its own
 * consent screen and its own Graph host. But the two were built from one
 * template, so everything below is identical apart from the hostnames and the
 * grant names:
 *
 * 1. The consent screen returns a code.
 * 2. The code buys a **short-lived** token (one hour), by form POST.
 * 3. That token is exchanged for a **long-lived** one (sixty days).
 * 4. Publishing is "create a container, wait for it, publish it".
 *
 * ## The access token is its own refresh token
 *
 * There is no refresh token. A long-lived token is renewed by presenting
 * *itself* to the refresh endpoint, any time after its first day and before it
 * expires, and comes back good for another sixty days. PostGear's refresh loop
 * is keyed on a stored refresh token, so `authenticate` stores the access token
 * in both places and `refreshToken` hands it to Meta. That is the whole trick,
 * and it is what keeps these channels alive without a reconnect every two
 * months (the Facebook-based providers in `meta.graph.ts` cannot do this).
 */
import { BadBodyError, ProviderError, RetryableError } from '../../abstract/errors';
import type { FetchOptions, HandledError } from '../../abstract/social.abstract';
import { SocialAbstract, sleep } from '../../abstract/social.abstract';
import type {
  AuthenticateParams,
  AuthTokenDetails,
  GeneratedAuthUrl,
  RedirectUri,
} from '../../abstract/social.provider.interface';

export interface MetaLoginConfig {
  /** The platform's name as a person reads it, for messages. */
  label: string;
  /** The consent screen. */
  authorizeUrl: string;
  /** Code for a short-lived token (form POST). */
  tokenUrl: string;
  /** The Graph host without a version: the long-lived exchange and refresh live here. */
  graphHost: string;
  /** The Graph host with its pinned version: every other call. */
  apiBase: string;
  /** `grant_type` of the long-lived exchange. */
  exchangeGrant: string;
  /** `grant_type` of the refresh. */
  refreshGrant: string;
  /** Names of the environment variables holding this product's app id and secret. */
  appIdEnv: string;
  appSecretEnv: string;
  /** The container field that says whether it is ready, and the one that says why not. */
  containerStatusField: string;
  containerDetailField: string;
}

/** The result of the two-step token exchange. */
export interface MetaLoginToken {
  accessToken: string;
  /** Seconds. Sixty days, as Meta reports it. */
  expiresIn?: number;
  /** The account id the short-lived response carried, when it carried one. */
  userId?: string;
}

interface ShortLivedToken {
  access_token?: string;
  user_id?: string | number;
  permissions?: string | string[];
}

interface LongLivedToken {
  access_token?: string;
  expires_in?: number;
}

/** What a Graph error body looks like on both hosts. */
interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    is_transient?: boolean;
    error_user_msg?: string;
  };
}

/** Meta's code for "this token is no longer valid". */
const INVALID_TOKEN_CODE = 190;

/** Application, user and custom rate limits, and the two "try again" service codes. */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 613]);

/** Meta's code for "permission denied"; 200 to 299 are the per-permission variants. */
const PERMISSION_DENIED_CODE = 10;

/** Media containers are processed asynchronously; these bound the wait. */
const CONTAINER_POLL_ATTEMPTS = 30;
const CONTAINER_POLL_INTERVAL_MS = 5_000;

/**
 * Meta writes account ids as bare numbers in some responses, and they are
 * longer than a JavaScript number can hold: `JSON.parse` would round
 * 17841405793187218 to a different account. Quoting them first keeps every
 * digit.
 */
export function parseKeepingIds<T>(text: string): T {
  return JSON.parse(text.replace(/("(?:user_id|id)"\s*:\s*)(\d{15,})/g, '$1"$2"')) as T;
}

export abstract class MetaLoginProvider extends SocialAbstract {
  readonly usesPkce = false;

  abstract readonly name: string;
  abstract readonly scopes: string[];

  /** The scopes a channel cannot work without; the rest only switch features on. */
  protected abstract readonly requiredScopes: string[];
  protected abstract readonly login: MetaLoginConfig;

  protected override get displayName(): string {
    return this.login.label;
  }

  isConfigured(): boolean {
    return Boolean(process.env[this.login.appIdEnv] && process.env[this.login.appSecretEnv]);
  }

  protected override handleErrors(body: string, status: number): HandledError | undefined {
    let error: GraphErrorBody['error'];

    try {
      error = (JSON.parse(body) as GraphErrorBody).error;
    } catch {
      return undefined;
    }

    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const { label } = this.login;
    const code = error.code ?? 0;

    if (code === INVALID_TOKEN_CODE) {
      return {
        type: 'refresh-token',
        value: `Your ${label} connection has expired. Please reconnect the channel.`,
      };
    }

    if (error.is_transient || RETRYABLE_CODES.has(code)) {
      return {
        type: 'retry',
        value: `${label} is busy or rate limiting this account. PostGear will retry shortly.`,
      };
    }

    if (code === PERMISSION_DENIED_CODE || (code >= 200 && code <= 299)) {
      return {
        type: 'bad-body',
        value: `${label} refused this for a missing permission. Reconnect the channel and approve every requested permission.`,
      };
    }

    // Meta's own sentence for the person, where it wrote one. Never on a 5xx:
    // that is the platform having a bad minute, and it should be retried.
    if (status < 500 && error.error_user_msg) {
      return { type: 'bad-body', value: error.error_user_msg };
    }

    return undefined;
  }

  async generateAuthUrl(redirectUri: RedirectUri): Promise<GeneratedAuthUrl> {
    const state = this.generateState();

    const params = new URLSearchParams({
      client_id: process.env[this.login.appIdEnv] ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.scopes.join(','),
      state,
    });

    return { url: `${this.login.authorizeUrl}?${params.toString()}`, state, codeVerifier: '' };
  }

  /**
   * Code to short-lived token to long-lived token.
   *
   * The upgrade is not optional: the short-lived token dies within the hour,
   * and only a long-lived one can ever be refreshed.
   */
  protected async exchangeCode(params: AuthenticateParams): Promise<MetaLoginToken> {
    const { label } = this.login;

    const answer = await this.fetchKeepingIds<ShortLivedToken & { data?: ShortLivedToken[] }>(
      this.login.tokenUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env[this.login.appIdEnv] ?? '',
          client_secret: process.env[this.login.appSecretEnv] ?? '',
          grant_type: 'authorization_code',
          redirect_uri: params.redirectUri,
          // Meta's redirect ends in `#_`. A browser never sends a fragment, but
          // a code pasted or proxied with it attached would be refused.
          code: params.code.replace(/#_$/, ''),
        }).toString(),
      },
    );

    // Documented as `{ data: [token] }`, answered in practice as the token itself.
    const shortLived = answer.data?.[0] ?? answer;

    if (!shortLived.access_token) {
      throw new BadBodyError(`${label} did not return an access token.`, this.identifier);
    }

    this.checkScopes(this.requiredScopes, shortLived.permissions);

    const longLived = await this.fetchJson<LongLivedToken>(
      `${this.login.graphHost}/access_token?${new URLSearchParams({
        grant_type: this.login.exchangeGrant,
        client_secret: process.env[this.login.appSecretEnv] ?? '',
        access_token: shortLived.access_token,
      }).toString()}`,
    );

    if (!longLived.access_token) {
      throw new BadBodyError(`${label} did not return a long-lived token.`, this.identifier);
    }

    return {
      accessToken: longLived.access_token,
      expiresIn: longLived.expires_in,
      userId: shortLived.user_id === undefined ? undefined : String(shortLived.user_id),
    };
  }

  /**
   * Renews a long-lived token with itself: see the file comment.
   *
   * Meta refuses a token younger than a day or already expired. The refresh
   * loop runs just before expiry, so the first never happens there; the second
   * surfaces as `RefreshTokenError` and the channel asks for a reconnect.
   */
  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    if (!refreshToken) {
      return this.cannotRefresh();
    }

    const refreshed = await this.fetchJson<LongLivedToken>(
      `${this.login.graphHost}/refresh_access_token?${new URLSearchParams({
        grant_type: this.login.refreshGrant,
        access_token: refreshToken,
      }).toString()}`,
    );

    if (!refreshed.access_token) {
      return this.cannotRefresh();
    }

    return {
      id: '',
      accessToken: refreshed.access_token,
      refreshToken: refreshed.access_token,
      expiresIn: refreshed.expires_in,
      name: '',
    };
  }

  /** A GET on the versioned Graph host. */
  protected graphGet<T>(
    path: string,
    params: Record<string, string>,
    accessToken: string,
  ): Promise<T> {
    const query = new URLSearchParams({ ...params, access_token: accessToken });
    return this.fetchKeepingIds<T>(`${this.login.apiBase}/${path}?${query.toString()}`);
  }

  /** A form POST on the versioned Graph host. Unset values are left out. */
  protected graphPost<T>(
    path: string,
    params: Record<string, string | undefined>,
    accessToken: string,
  ): Promise<T> {
    const body = new URLSearchParams({ access_token: accessToken });

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        body.set(key, value);
      }
    }

    return this.fetchKeepingIds<T>(`${this.login.apiBase}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  /**
   * Waits for a container to be ready to publish.
   *
   * Images are usually ready at once; video is transcoded first. Publishing a
   * container that is still in progress is refused, so the poll is required
   * rather than defensive.
   */
  protected async waitForContainer(containerId: string, accessToken: string): Promise<void> {
    const { label, containerStatusField, containerDetailField } = this.login;

    for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt += 1) {
      const container = await this.graphGet<Record<string, string | undefined>>(
        encodeURIComponent(containerId),
        { fields: `${containerStatusField},${containerDetailField}` },
        accessToken,
      );

      const status = container[containerStatusField];

      if (status === 'FINISHED' || status === 'PUBLISHED') {
        return;
      }

      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new BadBodyError(
          `${label} could not process the media: ${container[containerDetailField] ?? status}`,
          this.identifier,
        );
      }

      await sleep(CONTAINER_POLL_INTERVAL_MS);
    }

    throw new RetryableError(
      `${label} is still processing this media. PostGear will try again.`,
      this.identifier,
    );
  }

  /**
   * The failure of a later part of a multi-part post, once earlier parts are
   * already live.
   *
   * Whatever went wrong, it comes back as a `BadBodyError`, the one class the
   * worker never retries. A retry would run the whole post again from part
   * one, and the parts that are already out would be published a second time.
   * Failing once, with a message that says what did go out, is the lesser harm.
   */
  protected partlyPublished(error: unknown, published: number): BadBodyError {
    const reason = error instanceof Error ? error.message : 'It could not be published.';
    const live = published === 1 ? 'Part 1 is' : `Parts 1 to ${published} are`;

    return new BadBodyError(
      `${live} live on ${this.login.label}, but part ${published + 1} is not. ${reason}`,
      this.identifier,
      error instanceof ProviderError ? error.providerBody : '',
      error instanceof ProviderError ? error.status : undefined,
    );
  }

  /** `fetchJson`, but with long numeric ids kept whole. */
  private async fetchKeepingIds<T>(url: string, options: FetchOptions = {}): Promise<T> {
    const response = await this.fetch(url, options);
    const text = await response.text();

    if (!text) {
      return {} as T;
    }

    try {
      return parseKeepingIds<T>(text);
    } catch {
      throw new BadBodyError(
        `${this.login.label} returned a response PostGear could not read.`,
        this.identifier,
        text,
        response.status,
      );
    }
  }
}
