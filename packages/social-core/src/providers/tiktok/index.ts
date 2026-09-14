/**
 * TikTok — OAuth 2.0 with PKCE, Content Posting API v2.
 *
 * ## Two TikTok-specific traps
 *
 * The client credential is called `client_key`, not `client_id`, in every
 * TikTok request — using the conventional name fails with an unhelpful error.
 *
 * And unless the app has passed TikTok's content-posting audit, every video it
 * publishes is forced to `SELF_ONLY` (private) regardless of what is requested.
 * That is not a bug to debug later: an unaudited app appears to work perfectly
 * while nothing it posts is publicly visible.
 */
import { BadBodyError, RetryableError } from '../../abstract/errors';
import type { HandledError } from '../../abstract/social.abstract';
import { SocialAbstract, sleep } from '../../abstract/social.abstract';
import { checkAgainstRules } from '../../abstract/validity';
import type { ProviderRules } from '../../composer/rules';
import type {
  AuthenticateParams,
  AuthTokenDetails,
  ChannelContext,
  GeneratedAuthUrl,
  PostDetails,
  PostResponse,
  RedirectUri,
  SocialProvider,
} from '../../abstract/social.provider.interface';

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const API_BASE = 'https://open.tiktokapis.com/v2';

const MAX_LENGTH = 2_200;

/**
 * One video per post, no threads. TikTok's photo mode is a separate API this
 * provider does not call, so images are declared unsupported rather than
 * accepted and dropped.
 */
export const TIKTOK_RULES: ProviderRules = {
  maxLength: MAX_LENGTH,
  lengthMethod: 'utf16',
  thread: 'none',
  followUpMedia: false,
  media: {
    required: true,
    maxItems: 1,
    maxImages: 0,
    maxVideos: 1,
    allowMixed: false,
  },
};

const STATUS_POLL_ATTEMPTS = 30;
const STATUS_POLL_INTERVAL_MS = 5_000;

interface TikTokTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  open_id?: string;
  scope?: string;
}

export class TikTokProvider extends SocialAbstract implements SocialProvider {
  readonly identifier = 'tiktok';
  readonly name = 'TikTok';
  readonly usesPkce = true;

  readonly scopes = ['user.info.basic', 'video.publish', 'video.upload'];

  isConfigured(): boolean {
    return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
  }

  maxLength(): number {
    return MAX_LENGTH;
  }

  readonly rules = TIKTOK_RULES;

  override async checkValidity(posts: PostDetails[]): Promise<string | true> {
    return checkAgainstRules(this, posts);
  }

  protected override handleErrors(body: string): HandledError | undefined {
    if (body.includes('access_token_invalid') || body.includes('scope_not_authorized')) {
      return {
        type: 'refresh-token',
        value: 'Your TikTok connection has expired. Please reconnect the channel.',
      };
    }
    if (body.includes('spam_risk_too_many_posts')) {
      return {
        type: 'bad-body',
        value: 'TikTok has rate limited this account for posting too often.',
      };
    }
    if (body.includes('unaudited_client_can_only_post_to_private_accounts')) {
      return {
        type: 'bad-body',
        value:
          'This TikTok app has not passed content-posting review, so it can only post privately.',
      };
    }
    if (body.includes('rate_limit_exceeded') || body.includes('internal_error')) {
      return { type: 'retry', value: 'TikTok is temporarily unavailable.' };
    }
    return undefined;
  }

  async generateAuthUrl(redirectUri: RedirectUri): Promise<GeneratedAuthUrl> {
    const state = this.generateState();
    const { codeVerifier, codeChallenge } = this.generatePkcePair();

    const params = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
      response_type: 'code',
      scope: this.scopes.join(','),
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return { url: `${AUTHORIZE_URL}?${params.toString()}`, state, codeVerifier };
  }

  async authenticate(params: AuthenticateParams): Promise<AuthTokenDetails> {
    const token = await this.exchange({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    });

    this.checkScopes(this.scopes, token.scope);

    const user = await this.fetchUser(token.access_token);

    return {
      id: token.open_id ?? user.open_id ?? '',
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      name: user.display_name ?? 'TikTok account',
      username: user.username,
      picture: user.avatar_url,
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

    const user = await this.fetchUser(token.access_token);

    return {
      id: token.open_id ?? user.open_id ?? '',
      accessToken: token.access_token,
      // TikTok rotates refresh tokens on every use.
      refreshToken: token.refresh_token ?? refreshToken,
      expiresIn: token.expires_in,
      name: user.display_name ?? 'TikTok account',
      username: user.username,
      picture: user.avatar_url,
    };
  }

  async revoke(accessToken: string): Promise<void> {
    await this.fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
        token: accessToken,
      }).toString(),
    });
  }

  async post(
    channel: ChannelContext,
    accessToken: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of posts) {
      results.push(await this.publishVideo(channel, accessToken, post));
    }

    return results;
  }

  private async publishVideo(
    channel: ChannelContext,
    accessToken: string,
    post: PostDetails,
  ): Promise<PostResponse> {
    const [video] = (post.media ?? []).filter((item) => item.type === 'video');

    if (!video) {
      throw new BadBodyError('A TikTok post must include a video.', this.identifier);
    }

    const initiated = await this.fetchJson<{
      data?: { publish_id?: string };
      error?: { code?: string; message?: string };
    }>(`${API_BASE}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: post.message.slice(0, MAX_LENGTH),
          privacy_level: String(post.settings?.privacyLevel ?? 'PUBLIC_TO_EVERYONE'),
          disable_comment: this.asBoolean(post.settings?.disableComment),
          disable_duet: this.asBoolean(post.settings?.disableDuet),
          disable_stitch: this.asBoolean(post.settings?.disableStitch),
        },
        source_info: {
          // PULL_FROM_URL has TikTok fetch the file itself, which avoids
          // streaming the whole video through PostGear. It requires the domain
          // to be verified in the TikTok app settings.
          source: 'PULL_FROM_URL',
          video_url: video.path,
        },
      }),
    });

    const publishId = initiated.data?.publish_id;

    if (!publishId) {
      throw new BadBodyError(
        initiated.error?.message ?? 'TikTok did not return a publish id.',
        this.identifier,
        this.stringify(initiated),
      );
    }

    await this.waitForPublish(publishId, accessToken);

    const handle = channel.profile ?? channel.internalId;

    return {
      id: post.id,
      postId: publishId,
      releaseURL: `https://www.tiktok.com/@${handle}`,
    };
  }

  /** TikTok downloads and transcodes asynchronously; the id alone isn't success. */
  private async waitForPublish(publishId: string, accessToken: string): Promise<void> {
    for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt += 1) {
      const status = await this.fetchJson<{
        data?: { status?: string; fail_reason?: string };
      }>(`${API_BASE}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ publish_id: publishId }),
      });

      const state = status.data?.status;

      if (state === 'PUBLISH_COMPLETE') {
        return;
      }

      if (state === 'FAILED') {
        throw new BadBodyError(
          `TikTok could not publish the video: ${status.data?.fail_reason ?? 'unknown reason'}`,
          this.identifier,
        );
      }

      await sleep(STATUS_POLL_INTERVAL_MS);
    }

    throw new RetryableError(
      'TikTok is still processing this video. PostGear will check again.',
      this.identifier,
    );
  }

  private async exchange(params: Record<string, string>): Promise<TikTokTokenResponse> {
    return this.fetchJson<TikTokTokenResponse>(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
        ...params,
      }).toString(),
    });
  }

  private async fetchUser(accessToken: string): Promise<{
    open_id?: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
  }> {
    const response = await this.fetchJson<{
      data?: {
        user?: {
          open_id?: string;
          display_name?: string;
          username?: string;
          avatar_url?: string;
        };
      };
    }>(`${API_BASE}/user/info/?fields=open_id,display_name,username,avatar_url`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return response.data?.user ?? {};
  }
}
