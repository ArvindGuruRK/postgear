import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Provider } from '@postgear/db';
import { type AuthProvider, OAuthError, type OAuthProfile } from './auth-provider.interface';

const AUTH_ENDPOINT = 'https://www.facebook.com/v21.0/dialog/oauth';
const TOKEN_ENDPOINT = 'https://graph.facebook.com/v21.0/oauth/access_token';
const USERINFO_ENDPOINT = 'https://graph.facebook.com/v21.0/me';

@Injectable()
export class FacebookAuthProvider implements AuthProvider {
  readonly name = Provider.FACEBOOK;

  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly redirectUri: string;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('FACEBOOK_CLIENT_ID');
    this.clientSecret = config.get<string>('FACEBOOK_CLIENT_SECRET');
    this.redirectUri = `${config.get<string>('API_URL')}/auth/oauth/facebook/callback`;
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId ?? '',
      redirect_uri: this.redirectUri,
      response_type: 'code',
      // `email` is the whole scope — a display name we can live without, at
      // the cost of a scarier consent screen. The user types their name
      // during onboarding anyway.
      scope: 'email',
      state,
    });

    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  async handleCallback(code: string): Promise<OAuthProfile> {
    // Facebook's token endpoint is a GET with the exchange in the query
    // string, unlike Google's and most other providers' POST body.
    const tokenParams = new URLSearchParams({
      code,
      client_id: this.clientId ?? '',
      client_secret: this.clientSecret ?? '',
      redirect_uri: this.redirectUri,
    });

    const tokenResponse = await fetch(`${TOKEN_ENDPOINT}?${tokenParams.toString()}`);

    if (!tokenResponse.ok) {
      // The provider's own error body is deliberately not forwarded — it can
      // contain the client secret back in an echoed request.
      throw new OAuthError(`Facebook token exchange failed with ${tokenResponse.status}`);
    }

    const { access_token: accessToken } = (await tokenResponse.json()) as {
      access_token?: string;
    };

    if (!accessToken) {
      throw new OAuthError('Facebook token response contained no access token');
    }

    const profileParams = new URLSearchParams({ fields: 'id,name,email' });
    const profileResponse = await fetch(`${USERINFO_ENDPOINT}?${profileParams.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileResponse.ok) {
      throw new OAuthError(`Facebook userinfo failed with ${profileResponse.status}`);
    }

    const profile = (await profileResponse.json()) as {
      id?: string;
      email?: string;
      name?: string;
    };

    if (!profile.id) {
      throw new OAuthError('Facebook profile was missing an id');
    }

    // Facebook does not return an unverified email under the `email` scope —
    // an address only comes back once it has been confirmed on the account —
    // so there is no separate verified check to make here, unlike Google.
    if (!profile.email) {
      throw new OAuthError('Facebook account has no email address');
    }

    return { providerId: profile.id, email: profile.email, name: profile.name };
  }
}
