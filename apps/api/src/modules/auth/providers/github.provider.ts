import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Provider } from '@postgear/db';
import { type AuthProvider, OAuthError, type OAuthProfile } from './auth-provider.interface';

const AUTH_ENDPOINT = 'https://github.com/login/oauth/authorize';
const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
const USER_ENDPOINT = 'https://api.github.com/user';
const EMAILS_ENDPOINT = 'https://api.github.com/user/emails';

@Injectable()
export class GithubAuthProvider implements AuthProvider {
  readonly name = Provider.GITHUB;

  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly redirectUri: string;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('GITHUB_CLIENT_ID');
    this.clientSecret = config.get<string>('GITHUB_CLIENT_SECRET');
    this.redirectUri = `${config.get<string>('API_URL')}/auth/oauth/github/callback`;
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId ?? '',
      redirect_uri: this.redirectUri,
      // `user:email` rather than `user`: the narrower scope reads addresses
      // without granting access to the profile, repositories or anything else.
      scope: 'user:email',
      state,
    });

    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  async handleCallback(code: string): Promise<OAuthProfile> {
    const tokenResponse = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        // Without this header GitHub answers with a URL-encoded body rather
        // than JSON — a long-standing quirk of this endpoint.
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: this.clientId ?? '',
        client_secret: this.clientSecret ?? '',
        redirect_uri: this.redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      throw new OAuthError(`GitHub token exchange failed with ${tokenResponse.status}`);
    }

    const tokenBody = (await tokenResponse.json()) as { access_token?: string; error?: string };

    // GitHub returns HTTP 200 with an `error` field on failure, so a status
    // check alone is not enough.
    if (tokenBody.error || !tokenBody.access_token) {
      throw new OAuthError('GitHub token response contained no access token');
    }

    const headers = {
      Authorization: `Bearer ${tokenBody.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'PostGear',
    };

    const userResponse = await fetch(USER_ENDPOINT, { headers });

    if (!userResponse.ok) {
      throw new OAuthError(`GitHub user lookup failed with ${userResponse.status}`);
    }

    const user = (await userResponse.json()) as { id?: number; name?: string; login?: string };

    if (!user.id) {
      throw new OAuthError('GitHub profile was missing an id');
    }

    return {
      providerId: String(user.id),
      email: await this.primaryVerifiedEmail(headers),
      name: user.name ?? user.login,
    };
  }

  /**
   * Resolves the account's primary, verified address.
   *
   * `/user` returns `email: null` whenever the user has marked their address
   * private, which is the default for a lot of accounts — so the separate
   * `/user/emails` call is not an optimisation, it is the only reliable path.
   *
   * Only a **verified** address is accepted. Account linking matches on email,
   * so trusting an unverified one would let anyone take over an existing
   * PostGear account by adding that address to their GitHub profile.
   */
  private async primaryVerifiedEmail(headers: Record<string, string>): Promise<string> {
    const response = await fetch(EMAILS_ENDPOINT, { headers });

    if (!response.ok) {
      throw new OAuthError(`GitHub email lookup failed with ${response.status}`);
    }

    const emails = (await response.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;

    const primary = emails.find((entry) => entry.primary && entry.verified);
    const anyVerified = emails.find((entry) => entry.verified);
    const chosen = primary ?? anyVerified;

    if (!chosen) {
      throw new OAuthError('GitHub account has no verified email address');
    }

    return chosen.email;
  }
}
