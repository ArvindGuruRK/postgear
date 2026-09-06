import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Provider } from '@postgear/db';
import { type AuthProvider, OAuthError, type OAuthProfile } from './auth-provider.interface';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

@Injectable()
export class GoogleAuthProvider implements AuthProvider {
  readonly name = Provider.GOOGLE;

  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly redirectUri: string;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('GOOGLE_CLIENT_ID');
    this.clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET');
    this.redirectUri = `${config.get<string>('API_URL')}/auth/oauth/google/callback`;
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId ?? '',
      redirect_uri: this.redirectUri,
      response_type: 'code',
      // `openid email` is the whole scope. Asking for `profile` too would gain
      // a display name we can live without, at the cost of a scarier consent
      // screen. The user types their name during onboarding anyway.
      scope: 'openid email',
      state,
      // Sign-in only, so no refresh token is requested: we never call Google
      // again on the user's behalf, and an unused refresh token is a stored
      // credential with no purpose.
      prompt: 'select_account',
    });

    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  async handleCallback(code: string): Promise<OAuthProfile> {
    const tokenResponse = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId ?? '',
        client_secret: this.clientSecret ?? '',
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      // The provider's own error body is deliberately not forwarded — it can
      // contain the client secret back in an echoed request.
      throw new OAuthError(`Google token exchange failed with ${tokenResponse.status}`);
    }

    const { access_token: accessToken } = (await tokenResponse.json()) as {
      access_token?: string;
    };

    if (!accessToken) {
      throw new OAuthError('Google token response contained no access token');
    }

    const profileResponse = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileResponse.ok) {
      throw new OAuthError(`Google userinfo failed with ${profileResponse.status}`);
    }

    const profile = (await profileResponse.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    if (!profile.sub || !profile.email) {
      throw new OAuthError('Google profile was missing sub or email');
    }

    // An unverified address must not be trusted: account linking matches on
    // email, so accepting one would let anyone claim an existing PostGear
    // account by registering that address at Google without proving it.
    if (profile.email_verified === false) {
      throw new OAuthError('Google email address is not verified');
    }

    return { providerId: profile.sub, email: profile.email, name: profile.name };
  }
}
