/**
 * Google's sign-in for the Sheets connection (Module 13), plugged into
 * Module 04's framework (`CONNECTION_OAUTH_PLUGINS`): the framework owns
 * the single-use state, the `returnTo` check and the admin re-check; this
 * builds Google's consent link and swaps the code for tokens.
 *
 * - **Scope `drive.file openid email`.** `drive.file` is Google's
 *   non-sensitive, recommended scope: PostGear sees only the spreadsheets
 *   the person picks with Google's file picker or that PostGear created.
 *   `openid email` labels the connection with the account's address. Never
 *   `spreadsheets` (sensitive) or `drive` (restricted).
 * - **`access_type=offline` and `prompt=consent`**, so Google always returns
 *   a refresh token, which workflows need to run while nobody is signed in.
 *   A grant without one is refused ("Google did not grant offline access.
 *   Try again."), as is one where the person unticked file access.
 * - Registered only when a real client id and secret are configured
 *   (`googleReady`); without one, start lands back with `unavailable`.
 */
import type { OAuthConnectionPlugin } from '../connection-oauth.service';
import { CONNECTION_MESSAGES } from '../connections.messages';
import type { OAuthGrant } from '../connections.service';
import type { GoogleTokenCredentials } from '../providers/google.provider';
import type { GoogleClientConfig } from './google-config';
import type { GoogleHttp } from './google-http';
import { GOOGLE_TOKEN_URL } from './google-sheets.service';

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_SCOPES = `${GOOGLE_DRIVE_FILE_SCOPE} openid email`;
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** A grant Google gave but PostGear cannot use; the sentence says why. */
export class OAuthGrantRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthGrantRefused';
  }
}

/**
 * The `email` claim of the ID token Google returned from its token
 * endpoint. Read without checking the signature: it came straight from
 * Google over TLS in this request (OpenID Connect Core 3.1.3.7), and it only
 * labels the connection.
 */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: unknown;
    };
    return typeof claims.email === 'string' ? claims.email : null;
  } catch {
    return null;
  }
}

export class GoogleOAuthPlugin implements OAuthConnectionPlugin {
  readonly provider = 'google' as const;

  constructor(
    private readonly client: GoogleClientConfig,
    private readonly http: GoogleHttp,
    private readonly now: () => number = Date.now,
  ) {}

  authorizeUrl(state: string, redirectUri: string): string {
    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.searchParams.set('client_id', this.client.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_SCOPES);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchange(code: string, redirectUri: string): Promise<OAuthGrant> {
    const response = await this.http.request({
      method: 'POST',
      url: GOOGLE_TOKEN_URL,
      form: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.client.clientId,
        client_secret: this.client.clientSecret,
      },
    });
    const body = response.body;
    if (response.status !== 200 || typeof body.access_token !== 'string') {
      throw new Error(`Google refused the code exchange (${response.status})`);
    }
    if (typeof body.refresh_token !== 'string' || body.refresh_token === '') {
      throw new OAuthGrantRefused(CONNECTION_MESSAGES.GOOGLE_NO_OFFLINE);
    }
    const scope = typeof body.scope === 'string' ? body.scope : '';
    if (!scope.split(/\s+/).includes(GOOGLE_DRIVE_FILE_SCOPE)) {
      throw new OAuthGrantRefused(CONNECTION_MESSAGES.GOOGLE_NO_FILES);
    }

    const email = emailFromIdToken(body.id_token) ?? (await this.userinfoEmail(body.access_token));
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    const credentials: GoogleTokenCredentials = {
      refreshToken: body.refresh_token,
      accessToken: body.access_token,
      expiresAt: this.now() + expiresIn * 1000,
      scope,
      ...(email ? { email } : {}),
    };
    return {
      credentials,
      meta: email ? { email } : null,
      name: email ?? 'Google',
    };
  }

  private async userinfoEmail(accessToken: string): Promise<string | null> {
    const response = await this.http.request({
      method: 'GET',
      url: GOOGLE_USERINFO_URL,
      accessToken,
    });
    return response.status === 200 && typeof response.body.email === 'string'
      ? response.body.email
      : null;
  }
}
