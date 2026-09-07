/**
 * Shared Meta Graph API plumbing for the Facebook and Instagram providers.
 *
 * Both sit on one Meta app, one OAuth dialog, one token exchange, and the same
 * "which Page?" enumeration — Instagram Business accounts are reached *through*
 * a linked Facebook Page, so even the Instagram flow starts by listing pages.
 * Duplicating that in two providers would mean fixing every Meta quirk twice.
 *
 * ## Credentials are deliberately separate from social login
 *
 * Sprint 2 added Facebook *sign-in* under `FACEBOOK_CLIENT_ID` /
 * `FACEBOOK_CLIENT_SECRET`. This uses `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`
 * — a different Meta app. Publishing scopes (`pages_manage_posts`,
 * `instagram_content_publish`) require Meta's app review; basic login does not.
 * Sharing one app would put sign-in behind that review, so a rejection or a
 * lapse would take down authentication for everyone.
 *
 * ## On refreshing
 *
 * Meta issues no refresh token. A long-lived user token lasts ~60 days and can
 * only be extended while it is still valid, and page tokens derived from it do
 * not expire on their own. There is nothing to refresh from, so `refreshToken()`
 * reports "cannot refresh" and the channel surfaces as expiring, prompting a
 * reconnect. That is the honest behaviour rather than a refresh that silently
 * never works.
 */
import { BadBodyError } from '../../abstract/errors';
import type { HandledError } from '../../abstract/social.abstract';
import { SocialAbstract } from '../../abstract/social.abstract';
import type {
  AuthenticateParams,
  AuthTokenDetails,
  GeneratedAuthUrl,
  ProviderEntity,
  RedirectUri,
} from '../../abstract/social.provider.interface';

/** Pinned so a Graph API change is a deliberate edit rather than a silent shift. */
export const GRAPH_VERSION = 'v21.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DIALOG_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  fan_count?: number;
  picture?: { data?: { url?: string } };
}

export abstract class MetaGraphProvider extends SocialAbstract {
  readonly usesPkce = false;

  isConfigured(): boolean {
    return Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
  }

  protected override handleErrors(body: string): HandledError | undefined {
    if (
      body.includes('Error validating access token') ||
      body.includes('REVOKED_ACCESS_TOKEN') ||
      body.includes('Session has expired') ||
      body.includes('OAuthException')
    ) {
      return {
        type: 'refresh-token',
        value: 'Your Meta connection has expired. Please reconnect the channel.',
      };
    }
    if (body.includes('temporarily blocked') || body.includes('rate limit')) {
      return {
        type: 'retry',
        value: 'Meta is rate limiting this account. PostGear will retry shortly.',
      };
    }
    if (body.includes('permission')) {
      return {
        type: 'bad-body',
        value:
          'Meta refused this action for a missing permission. Reconnect the channel and approve every requested permission.',
      };
    }
    return undefined;
  }

  async generateAuthUrl(redirectUri: RedirectUri): Promise<GeneratedAuthUrl> {
    const state = this.generateState();

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.FACEBOOK_APP_ID ?? '',
      redirect_uri: redirectUri,
      state,
      scope: this.scopes.join(','),
    });

    return { url: `${DIALOG_URL}?${params.toString()}`, state, codeVerifier: '' };
  }

  abstract readonly scopes: string[];

  /**
   * Exchanges the code for a short-lived token, then immediately upgrades it to
   * a long-lived one.
   *
   * The upgrade is not optional: the short-lived token expires in about an hour,
   * so skipping it means every channel breaks the same afternoon it is
   * connected.
   */
  protected async authenticateWithMeta(params: AuthenticateParams): Promise<{
    accessToken: string;
    expiresIn?: number;
    user: { id: string; name?: string };
  }> {
    const shortLived = await this.fetchJson<{ access_token: string }>(
      `${GRAPH_BASE}/oauth/access_token?${new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID ?? '',
        client_secret: process.env.FACEBOOK_APP_SECRET ?? '',
        redirect_uri: params.redirectUri,
        code: params.code,
      }).toString()}`,
    );

    if (!shortLived.access_token) {
      throw new BadBodyError('Meta did not return an access token.', this.identifier);
    }

    const longLived = await this.fetchJson<{ access_token: string; expires_in?: number }>(
      `${GRAPH_BASE}/oauth/access_token?${new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: process.env.FACEBOOK_APP_ID ?? '',
        client_secret: process.env.FACEBOOK_APP_SECRET ?? '',
        fb_exchange_token: shortLived.access_token,
      }).toString()}`,
    );

    const accessToken = longLived.access_token || shortLived.access_token;

    const user = await this.fetchJson<{ id: string; name?: string }>(
      `${GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
    );

    if (!user.id) {
      throw new BadBodyError('Meta did not return an account profile.', this.identifier);
    }

    return { accessToken, expiresIn: longLived.expires_in, user };
  }

  /** See the class comment — Meta has no refresh grant. */
  async refreshToken(_refreshToken: string): Promise<AuthTokenDetails> {
    return this.cannotRefresh();
  }

  /**
   * Revokes the app's permissions for this user.
   *
   * Meta expresses revocation as deleting the permissions edge rather than a
   * dedicated revoke endpoint.
   */
  async revoke(accessToken: string): Promise<void> {
    await this.fetch(
      `${GRAPH_BASE}/me/permissions?access_token=${encodeURIComponent(accessToken)}`,
      { method: 'DELETE' },
    );
  }

  /** The Facebook Pages this user administers, with their page-scoped tokens. */
  protected async fetchPages(accessToken: string): Promise<MetaPage[]> {
    const response = await this.fetchJson<{ data?: MetaPage[] }>(
      `${GRAPH_BASE}/me/accounts?fields=id,name,access_token,fan_count,picture{url}&access_token=${encodeURIComponent(accessToken)}`,
    );

    return response.data ?? [];
  }

  protected pageToEntity(page: MetaPage): ProviderEntity {
    return {
      id: page.id,
      name: page.name,
      picture: page.picture?.data?.url,
      // Follower count is what makes five similarly-named pages
      // distinguishable — the whole point of showing a detail line.
      detail:
        page.fan_count === undefined ? undefined : `${page.fan_count.toLocaleString()} followers`,
      accessToken: page.access_token,
    };
  }
}
