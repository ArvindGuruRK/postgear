/**
 * Pinterest — OAuth 2.0, API v5.
 *
 * ## Why this has an entity-selection step even though OAuth already gave us a user
 *
 * A Pin cannot exist outside a Board. Unlike Facebook, where the Page also
 * carries the token, Pinterest's board choice is purely about *where* the
 * content lands — but it is equally required, and asking at connect time is far
 * better than failing at publish time. The selected board becomes the channel's
 * `internalId`.
 *
 * Pinterest also requires a media URL on every Pin: there is no text-only Pin.
 */
import { BadBodyError } from '../../abstract/errors';
import type { HandledError } from '../../abstract/social.abstract';
import { SocialAbstract } from '../../abstract/social.abstract';
import { checkAgainstRules } from '../../abstract/validity';
import type { ProviderRules } from '../../composer/rules';
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

const AUTHORIZE_URL = 'https://www.pinterest.com/oauth/';
const TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token';
const API_BASE = 'https://api.pinterest.com/v5';

/** Pin descriptions cap at 800; titles at 100. */
const MAX_LENGTH = 800;
const MAX_TITLE_LENGTH = 100;

/**
 * What this provider publishes: one image per Pin, no threads.
 *
 * Video is declared unsupported because `createPin` cannot publish it. A
 * Pinterest video Pin needs the bytes registered through the media upload API
 * first, which returns the `video_id` that `media_source` expects — passing a
 * URL where that id belongs is rejected. Until that flow exists, saying "no
 * video" in the composer is the honest answer.
 *
 * No `title` rule: the provider truncates an over-long first line to 100
 * characters rather than failing, and the preview shows the cut.
 */
export const PINTEREST_RULES: ProviderRules = {
  maxLength: MAX_LENGTH,
  lengthMethod: 'utf16',
  thread: 'none',
  followUpMedia: false,
  media: {
    required: true,
    maxItems: 1,
    maxImages: 1,
    maxVideos: 0,
    allowMixed: false,
  },
};

interface PinterestTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface PinterestBoard {
  id: string;
  name: string;
  description?: string;
  pin_count?: number;
  privacy?: string;
}

export class PinterestProvider
  extends SocialAbstract
  implements SocialProvider, SupportsEntitySelection
{
  readonly identifier = 'pinterest';
  readonly name = 'Pinterest';
  readonly usesPkce = false;

  readonly scopes = [
    'boards:read',
    'boards:write',
    'pins:read',
    'pins:write',
    'user_accounts:read',
  ];

  isConfigured(): boolean {
    return Boolean(process.env.PINTEREST_APP_ID && process.env.PINTEREST_APP_SECRET);
  }

  maxLength(): number {
    return MAX_LENGTH;
  }

  readonly rules = PINTEREST_RULES;

  override async checkValidity(posts: PostDetails[]): Promise<string | true> {
    return checkAgainstRules(this, posts);
  }

  protected override handleErrors(body: string): HandledError | undefined {
    if (body.includes('Authentication failed') || body.includes('invalid_token')) {
      return {
        type: 'refresh-token',
        value: 'Your Pinterest connection has expired. Please reconnect the channel.',
      };
    }
    if (body.includes('Board not found')) {
      return {
        type: 'bad-body',
        value: 'That Pinterest board no longer exists. Reconnect the channel and pick another.',
      };
    }
    if (body.includes('rate limit')) {
      return { type: 'retry', value: 'Pinterest is rate limiting this account.' };
    }
    return undefined;
  }

  async generateAuthUrl(redirectUri: RedirectUri): Promise<GeneratedAuthUrl> {
    const state = this.generateState();

    const params = new URLSearchParams({
      client_id: process.env.PINTEREST_APP_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.scopes.join(','),
      state,
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

    const account = await this.fetchAccount(token.access_token);

    return {
      id: account.username ?? '',
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      name: account.business_name ?? account.username ?? 'Pinterest account',
      username: account.username,
      picture: account.profile_image,
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

    const account = await this.fetchAccount(token.access_token);

    return {
      id: account.username ?? '',
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      expiresIn: token.expires_in,
      name: account.business_name ?? account.username ?? 'Pinterest account',
      username: account.username,
      picture: account.profile_image,
    };
  }

  async listEntities(accessToken: string): Promise<ProviderEntity[]> {
    const response = await this.fetchJson<{ items?: PinterestBoard[] }>(
      `${API_BASE}/boards?page_size=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    return (response.items ?? []).map((board) => ({
      id: board.id,
      name: board.name,
      detail: [
        board.pin_count === undefined ? undefined : `${board.pin_count.toLocaleString()} pins`,
        board.privacy && board.privacy !== 'PUBLIC' ? board.privacy.toLowerCase() : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    }));
  }

  async selectEntity(accessToken: string, entityId: string): Promise<ProviderEntity> {
    const boards = await this.listEntities(accessToken);
    const chosen = boards.find((board) => board.id === entityId);

    if (!chosen) {
      throw new BadBodyError('That Pinterest board is not one this account owns.', this.identifier);
    }

    return chosen;
  }

  async post(
    channel: ChannelContext,
    accessToken: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of posts) {
      results.push(await this.createPin(channel, accessToken, post));
    }

    return results;
  }

  private async createPin(
    channel: ChannelContext,
    accessToken: string,
    post: PostDetails,
  ): Promise<PostResponse> {
    const [item] = post.media ?? [];

    if (!item) {
      throw new BadBodyError('A Pinterest Pin must include an image or video.', this.identifier);
    }

    const [firstLine, ...rest] = post.message.split('\n');

    const response = await this.fetchJson<{ id?: string }>(`${API_BASE}/pins`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // The board chosen during connect is this channel's target.
        board_id: channel.internalId,
        title: (typeof post.settings?.title === 'string' ? post.settings.title : firstLine).slice(
          0,
          MAX_TITLE_LENGTH,
        ),
        description: (rest.length > 0 ? rest.join('\n') : post.message).slice(0, MAX_LENGTH),
        link: typeof post.settings?.link === 'string' ? post.settings.link : undefined,
        media_source: {
          source_type: item.type === 'video' ? 'video_id' : 'image_url',
          url: item.path,
        },
      }),
    });

    if (!response.id) {
      throw new BadBodyError('Pinterest accepted the Pin but returned no id.', this.identifier);
    }

    return {
      id: post.id,
      postId: response.id,
      releaseURL: `https://www.pinterest.com/pin/${response.id}/`,
    };
  }

  private async exchange(params: Record<string, string>): Promise<PinterestTokenResponse> {
    const credentials = `${process.env.PINTEREST_APP_ID ?? ''}:${process.env.PINTEREST_APP_SECRET ?? ''}`;

    return this.fetchJson<PinterestTokenResponse>(TOKEN_URL, {
      method: 'POST',
      headers: {
        // Pinterest takes the client credentials only as HTTP Basic; putting
        // them in the body is rejected.
        Authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });
  }

  private async fetchAccount(accessToken: string): Promise<{
    username?: string;
    business_name?: string;
    profile_image?: string;
  }> {
    return this.fetchJson(`${API_BASE}/user_account`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
}
