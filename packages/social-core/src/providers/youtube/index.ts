/**
 * YouTube — Google OAuth 2.0, Data API v3.
 *
 * ## Two things about Google's OAuth that break integrations quietly
 *
 * `access_type=offline` is what makes Google issue a refresh token at all — and
 * it issues one **only on the first consent**. A user who reconnects gets an
 * access token and no refresh token, so the channel silently becomes
 * unrefreshable. `prompt=consent` forces the consent screen every time and with
 * it a fresh refresh token. Both are required together.
 *
 * ## Uploading without the SDK
 *
 * Resumable upload is two requests: a metadata POST that returns an upload URL
 * in a `Location` header, then a PUT of the bytes to that URL. That is the whole
 * protocol, which is why `googleapis` is not a dependency here.
 */
import { BadBodyError } from '../../abstract/errors';
import type { HandledError } from '../../abstract/social.abstract';
import { SocialAbstract } from '../../abstract/social.abstract';
import type {
  AuthenticateParams,
  AuthTokenDetails,
  ChannelContext,
  GeneratedAuthUrl,
  PostDetails,
  PostResponse,
  ProviderEntity,
  RedirectUri,
  SocialProvider,
  SupportsEntitySelection,
} from '../../abstract/social.provider.interface';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API_BASE = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';

/** YouTube's description limit. Titles are capped separately at 100. */
const MAX_LENGTH = 5_000;
const MAX_TITLE_LENGTH = 100;

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface YouTubeChannel {
  id: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: { default?: { url?: string } };
  };
  statistics?: { subscriberCount?: string };
}

export class YouTubeProvider
  extends SocialAbstract
  implements SocialProvider, SupportsEntitySelection
{
  readonly identifier = 'youtube';
  readonly name = 'YouTube';
  readonly usesPkce = false;

  readonly scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl',
  ];

  isConfigured(): boolean {
    return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
  }

  maxLength(): number {
    return MAX_LENGTH;
  }

  override async checkValidity(posts: PostDetails[]): Promise<string | true> {
    for (const post of posts) {
      const videos = (post.media ?? []).filter((item) => item.type === 'video');

      if (videos.length !== 1) {
        return 'A YouTube post must have exactly one video.';
      }

      const title = this.titleFor(post);

      if (title.length > MAX_TITLE_LENGTH) {
        return `YouTube titles are limited to ${MAX_TITLE_LENGTH} characters.`;
      }

      // YouTube rejects these outright in titles rather than escaping them.
      if (title.includes('<') || title.includes('>')) {
        return 'YouTube titles cannot contain < or > characters.';
      }
    }

    return true;
  }

  protected override handleErrors(body: string): HandledError | undefined {
    if (body.includes('invalid_grant') || body.includes('Invalid Credentials')) {
      return {
        type: 'refresh-token',
        value: 'Your YouTube connection has expired. Please reconnect the channel.',
      };
    }
    if (body.includes('quotaExceeded') || body.includes('dailyLimitExceeded')) {
      return {
        type: 'bad-body',
        value: 'This YouTube app has used its daily API quota. Posting resumes tomorrow.',
      };
    }
    if (body.includes('uploadLimitExceeded')) {
      return {
        type: 'bad-body',
        value: 'This YouTube channel has reached its upload limit for now.',
      };
    }
    if (body.includes('backendError') || body.includes('internalError')) {
      return { type: 'retry', value: 'YouTube is temporarily unavailable.' };
    }
    return undefined;
  }

  async generateAuthUrl(redirectUri: RedirectUri): Promise<GeneratedAuthUrl> {
    const state = this.generateState();

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      state,
      scope: this.scopes.join(' '),
      // See the class comment — these two together are what guarantee a
      // refresh token on every connect, including reconnects.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });

    return { url: `${AUTHORIZE_URL}?${params.toString()}`, state, codeVerifier: '' };
  }

  async authenticate(params: AuthenticateParams): Promise<AuthTokenDetails> {
    const token = await this.exchange({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
    });

    this.checkScopes(this.scopes, token.scope);

    const channel = await this.fetchPrimaryChannel(token.access_token);

    return {
      id: channel.id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      name: channel.snippet?.title ?? 'YouTube channel',
      username: channel.snippet?.customUrl,
      picture: channel.snippet?.thumbnails?.default?.url,
      // One Google account can own several channels (brand accounts), so the
      // user has to say which one this is.
      requiresEntitySelection: true,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    if (!refreshToken) {
      return this.cannotRefresh();
    }

    const token = await this.exchange({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const channel = await this.fetchPrimaryChannel(token.access_token);

    return {
      id: channel.id,
      accessToken: token.access_token,
      // Google does not re-issue a refresh token on refresh; keeping the
      // existing one is required, not a fallback.
      refreshToken,
      expiresIn: token.expires_in,
      name: channel.snippet?.title ?? 'YouTube channel',
      username: channel.snippet?.customUrl,
      picture: channel.snippet?.thumbnails?.default?.url,
    };
  }

  async revoke(accessToken: string): Promise<void> {
    await this.fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: accessToken }).toString(),
    });
  }

  async listEntities(accessToken: string): Promise<ProviderEntity[]> {
    const response = await this.fetchJson<{ items?: YouTubeChannel[] }>(
      `${API_BASE}/channels?part=snippet,statistics&mine=true&maxResults=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    return (response.items ?? []).map((channel) => ({
      id: channel.id,
      name: channel.snippet?.title ?? `Channel ${channel.id}`,
      username: channel.snippet?.customUrl,
      picture: channel.snippet?.thumbnails?.default?.url,
      detail: channel.statistics?.subscriberCount
        ? `${Number(channel.statistics.subscriberCount).toLocaleString()} subscribers`
        : undefined,
    }));
  }

  async selectEntity(accessToken: string, entityId: string): Promise<ProviderEntity> {
    const entities = await this.listEntities(accessToken);
    const chosen = entities.find((entity) => entity.id === entityId);

    if (!chosen) {
      throw new BadBodyError('That YouTube channel is not one this account owns.', this.identifier);
    }

    // Google tokens are account-scoped, not channel-scoped, so the existing
    // credential still applies.
    return chosen;
  }

  async post(
    _channel: ChannelContext,
    accessToken: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of posts) {
      results.push(await this.uploadVideo(accessToken, post));
    }

    return results;
  }

  private async uploadVideo(accessToken: string, post: PostDetails): Promise<PostResponse> {
    const [video] = (post.media ?? []).filter((item) => item.type === 'video');

    if (!video) {
      throw new BadBodyError('A YouTube post must include a video.', this.identifier);
    }

    const source = await this.fetch(video.path);
    const bytes = await source.arrayBuffer();

    const metadata = {
      snippet: {
        title: this.titleFor(post),
        description: post.message,
        categoryId: String(post.settings?.categoryId ?? '22'),
      },
      status: {
        privacyStatus: String(post.settings?.privacyStatus ?? 'public'),
        selfDeclaredMadeForKids: this.asBoolean(post.settings?.madeForKids),
      },
    };

    // Step one: announce the upload and receive a one-shot URL for the bytes.
    const initiate = await this.fetch(
      `${UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/*',
          'X-Upload-Content-Length': String(bytes.byteLength),
        },
        body: JSON.stringify(metadata),
      },
    );

    const uploadUrl = initiate.headers.get('location');

    if (!uploadUrl) {
      throw new BadBodyError(
        'YouTube did not return an upload URL.',
        this.identifier,
        await initiate.text().catch(() => ''),
      );
    }

    // Step two: the bytes. A long timeout because this is a video, not an API call.
    const uploaded = await this.fetchJson<{ id?: string }>(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'video/*',
      },
      body: bytes,
      timeoutMs: 10 * 60 * 1000,
    });

    if (!uploaded.id) {
      throw new BadBodyError('YouTube accepted the upload but returned no id.', this.identifier);
    }

    return {
      id: post.id,
      postId: uploaded.id,
      releaseURL: `https://www.youtube.com/watch?v=${uploaded.id}`,
    };
  }

  /**
   * YouTube needs a title, which the generic post model has no field for.
   *
   * An explicit `settings.title` wins; otherwise the first line of the message
   * becomes the title, which is how people naturally write these anyway.
   */
  private titleFor(post: PostDetails): string {
    const explicit = post.settings?.title;

    if (typeof explicit === 'string' && explicit.trim()) {
      return explicit.trim().slice(0, MAX_TITLE_LENGTH);
    }

    const firstLine = post.message.split('\n')[0]?.trim() ?? '';

    return (firstLine || 'Untitled').slice(0, MAX_TITLE_LENGTH);
  }

  private async exchange(params: Record<string, string>): Promise<GoogleTokenResponse> {
    return this.fetchJson<GoogleTokenResponse>(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
        client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
        ...params,
      }).toString(),
    });
  }

  private async fetchPrimaryChannel(accessToken: string): Promise<YouTubeChannel> {
    const response = await this.fetchJson<{ items?: YouTubeChannel[] }>(
      `${API_BASE}/channels?part=snippet,statistics&mine=true&maxResults=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    const channel = response.items?.[0];

    if (!channel?.id) {
      throw new BadBodyError(
        'This Google account has no YouTube channel. Create one and reconnect.',
        this.identifier,
      );
    }

    return channel;
  }
}
