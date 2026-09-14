/**
 * LinkedIn — OAuth 2.0, REST posts API.
 *
 * ## Personal and page are two providers, not one flag
 *
 * Posting as yourself and posting as a company differ in the author URN
 * (`urn:li:person:` vs `urn:li:organization:`), the scopes consented to, and
 * whether a second selection step is needed. Modelling that as a boolean on one
 * provider would put a conditional in every method; modelling it as two
 * registry entries — `linkedin` and `linkedin-page` — keeps each one linear,
 * and lets a user connect their profile *and* two company pages as three
 * independent channels, which is what they actually want.
 *
 * `LinkedInPageProvider` therefore extends this class and overrides only what
 * genuinely differs.
 *
 * ## One OAuth grant, several channels
 *
 * A single LinkedIn authorization covers the member and every page they
 * administer. Those become separate `Integration` rows sharing a
 * `rootInternalId`, which is what lets the refresh path update all of them from
 * one new token — see the sibling fan-out in the channels repository.
 */
import { BadBodyError } from '../../abstract/errors';
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
  ProviderEntity,
  RedirectUri,
  SocialProvider,
  SupportsEntitySelection,
} from '../../abstract/social.provider.interface';

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const API_BASE = 'https://api.linkedin.com';

/**
 * LinkedIn versions its REST API by month and rejects requests without the
 * header. Pinning it means an upstream change is a deliberate edit here rather
 * than a silent behaviour shift.
 */
const LINKEDIN_VERSION = '202601';

const MAX_LENGTH = 3_000;

/** LinkedIn's multi-image post takes between two and twenty images. */
const MAX_IMAGES = 20;

/**
 * How long to let LinkedIn process uploaded images before referencing them.
 *
 * An image is accepted by the upload URL before it is usable, and a post that
 * references it too early is rejected. A member token (`w_member_social`) is
 * write-only for the Images API, so the status cannot be polled; a short fixed
 * wait is the documented workaround, and it is the same for page tokens so the
 * two providers share one path.
 */
const IMAGE_PROCESSING_DELAY_MS = 10_000;

/**
 * What this provider publishes (Sprint 4).
 *
 * Images: one, or a multi-image post of up to twenty. **No video** — LinkedIn
 * accepts it, but its Videos API is a chunked multipart upload with a finalize
 * step and an asynchronous processing poll that PostGear does not implement
 * yet, so the composer refuses video rather than letting it be dropped at
 * publish time. Later parts are comments, which carry text only.
 */
export const LINKEDIN_RULES: ProviderRules = {
  maxLength: MAX_LENGTH,
  lengthMethod: 'utf16',
  thread: 'comments',
  followUpMedia: false,
  media: {
    required: false,
    maxItems: MAX_IMAGES,
    maxImages: MAX_IMAGES,
    maxVideos: 0,
    allowMixed: false,
  },
};

interface LinkedInTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface LinkedInUserInfo {
  sub: string;
  name?: string;
  picture?: string;
}

export class LinkedInProvider extends SocialAbstract implements SocialProvider {
  readonly identifier: string = 'linkedin';
  readonly name: string = 'LinkedIn';
  readonly usesPkce = false;

  readonly scopes: string[] = ['openid', 'profile', 'w_member_social'];

  isConfigured(): boolean {
    return Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
  }

  maxLength(): number {
    return MAX_LENGTH;
  }

  readonly rules = LINKEDIN_RULES;

  /** Overridable so tests do not sit through LinkedIn's processing wait. */
  protected imageProcessingDelayMs = IMAGE_PROCESSING_DELAY_MS;

  override async checkValidity(posts: PostDetails[]): Promise<string | true> {
    return checkAgainstRules(this, posts);
  }

  protected override handleErrors(body: string): HandledError | undefined {
    if (body.includes('REVOKED_ACCESS_TOKEN') || body.includes('Invalid access token')) {
      return {
        type: 'refresh-token',
        value: 'Your LinkedIn connection has expired. Please reconnect the channel.',
      };
    }
    if (body.includes('Unable to obtain activity') || body.includes('resource is forbidden')) {
      // LinkedIn returns this transiently right after a token refresh — the new
      // token is briefly not yet usable.
      return { type: 'retry', value: 'LinkedIn is temporarily unavailable.' };
    }
    if (body.includes('DUPLICATE_POST')) {
      return {
        type: 'bad-body',
        value: 'LinkedIn rejected this as duplicate content. Change the text and try again.',
      };
    }
    return undefined;
  }

  async generateAuthUrl(redirectUri: RedirectUri): Promise<GeneratedAuthUrl> {
    const state = this.generateState();

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.LINKEDIN_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      state,
      scope: this.scopes.join(' '),
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

    const profile = await this.fetchUserInfo(token.access_token);

    return {
      id: profile.sub,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      name: profile.name ?? 'LinkedIn account',
      picture: profile.picture,
      requiresEntitySelection: false,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    // Refresh tokens are only issued to apps approved for LinkedIn's Marketing
    // Developer Platform. A standard app gets a 60-day access token and nothing
    // to refresh with, which is a reconnect rather than a failure.
    if (!refreshToken) {
      return this.cannotRefresh();
    }

    const token = await this.exchange({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const profile = await this.fetchUserInfo(token.access_token);

    return {
      id: profile.sub,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      expiresIn: token.expires_in,
      name: profile.name ?? 'LinkedIn account',
      picture: profile.picture,
    };
  }

  async post(
    channel: ChannelContext,
    accessToken: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];
    let previousUrn: string | undefined;

    for (const post of posts) {
      if (previousUrn) {
        // Follow-on items become comments on the first post; LinkedIn has no
        // native thread primitive.
        const [comment] = await this.comment(channel, accessToken, previousUrn, [post]);
        results.push(comment);
        continue;
      }

      const published = await this.createPost(channel, accessToken, post);
      results.push(published);
      previousUrn = published.postId;
    }

    return results;
  }

  async comment(
    channel: ChannelContext,
    accessToken: string,
    parentPostId: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of posts) {
      const response = await this.fetchJson<{ object?: string }>(
        `${API_BASE}/rest/socialActions/${encodeURIComponent(parentPostId)}/comments`,
        {
          method: 'POST',
          headers: this.restHeaders(accessToken),
          body: JSON.stringify({
            actor: this.authorUrn(channel.internalId),
            object: parentPostId,
            message: { text: this.escapeText(post.message) },
          }),
        },
      );

      results.push({
        id: post.id,
        postId: response.object ?? '',
        releaseURL: `https://www.linkedin.com/feed/update/${parentPostId}`,
      });
    }

    return results;
  }

  private async createPost(
    channel: ChannelContext,
    accessToken: string,
    post: PostDetails,
  ): Promise<PostResponse> {
    const images = await this.uploadImages(channel, accessToken, post);

    const payload = {
      author: this.authorUrn(channel.internalId),
      commentary: this.escapeText(post.message),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      ...this.contentFor(images),
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    const response = await this.fetch(`${API_BASE}/rest/posts`, {
      method: 'POST',
      headers: this.restHeaders(accessToken),
      body: JSON.stringify(payload),
    });

    // LinkedIn returns the new post's URN in a header, not the body.
    const postId = response.headers.get('x-restli-id');

    if (!postId) {
      throw new BadBodyError(
        'LinkedIn accepted the post but returned no id.',
        this.identifier,
        await response.text().catch(() => ''),
      );
    }

    return {
      id: post.id,
      postId,
      releaseURL: `https://www.linkedin.com/feed/update/${postId}`,
    };
  }

  /**
   * Uploads a post's images and returns their URNs with alt text.
   *
   * Sprint 3 shipped `createPost` sending commentary alone, so an attached image
   * was accepted by `checkValidity` and then silently dropped. The Images API
   * is three steps: initialize an upload owned by the author, PUT the bytes to
   * the URL it returns, then reference the returned `urn:li:image:` in the post.
   * The owner must be the same URN as the post's author, which is why this goes
   * through `authorUrn` and serves the page provider unchanged.
   */
  private async uploadImages(
    channel: ChannelContext,
    accessToken: string,
    post: PostDetails,
  ): Promise<{ id: string; altText?: string }[]> {
    const images = (post.media ?? []).filter((item) => item.type === 'image');
    const uploaded: { id: string; altText?: string }[] = [];

    for (const image of images) {
      const initialized = await this.fetchJson<{ value?: { uploadUrl?: string; image?: string } }>(
        `${API_BASE}/rest/images?action=initializeUpload`,
        {
          method: 'POST',
          headers: this.restHeaders(accessToken),
          body: JSON.stringify({
            initializeUploadRequest: { owner: this.authorUrn(channel.internalId) },
          }),
        },
      );

      const uploadUrl = initialized.value?.uploadUrl;
      const urn = initialized.value?.image;

      if (!uploadUrl || !urn) {
        throw new BadBodyError('LinkedIn did not return an image upload URL.', this.identifier);
      }

      const source = await this.fetch(image.path);

      await this.fetch(uploadUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: await source.arrayBuffer(),
      });

      uploaded.push(image.alt ? { id: urn, altText: image.alt } : { id: urn });
    }

    if (uploaded.length > 0 && this.imageProcessingDelayMs > 0) {
      await sleep(this.imageProcessingDelayMs);
    }

    return uploaded;
  }

  /** One image is `media`; two or more is `multiImage`. None adds nothing. */
  private contentFor(images: { id: string; altText?: string }[]): Record<string, unknown> {
    if (images.length === 0) {
      return {};
    }

    if (images.length === 1) {
      return { content: { media: images[0] } };
    }

    return { content: { multiImage: { images } } };
  }

  /** `urn:li:person:` here; the page provider overrides this. */
  protected authorUrn(internalId: string): string {
    return `urn:li:person:${internalId}`;
  }

  /**
   * LinkedIn's `commentary` field uses a "Little Text" markup where a set of
   * punctuation characters carry meaning. Unescaped, a post containing a
   * bracket or a hash is either mangled or rejected outright.
   */
  protected escapeText(text: string): string {
    return text.replace(/([\\<>#~_|[\]*(){}@])/g, '\\$1');
  }

  protected restHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': LINKEDIN_VERSION,
    };
  }

  protected async exchange(params: Record<string, string>): Promise<LinkedInTokenResponse> {
    return this.fetchJson<LinkedInTokenResponse>(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.LINKEDIN_CLIENT_ID ?? '',
        client_secret: process.env.LINKEDIN_CLIENT_SECRET ?? '',
        ...params,
      }).toString(),
    });
  }

  protected async fetchUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
    const info = await this.fetchJson<LinkedInUserInfo>(`${API_BASE}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!info.sub) {
      throw new BadBodyError('LinkedIn did not return an account profile.', this.identifier);
    }

    return info;
  }
}

/**
 * LinkedIn company pages.
 *
 * Same OAuth grant, different author URN and an extra step: the user picks
 * which of the organizations they administer this channel represents.
 */
export class LinkedInPageProvider
  extends LinkedInProvider
  implements SocialProvider, SupportsEntitySelection
{
  override readonly identifier = 'linkedin-page';
  override readonly name = 'LinkedIn Page';

  override readonly scopes = ['openid', 'profile', 'r_organization_admin', 'w_organization_social'];

  override async authenticate(params: AuthenticateParams): Promise<AuthTokenDetails> {
    const details = await super.authenticate(params);

    // The member is authenticated, but the channel has no target until an
    // organization is chosen. The row is persisted now — the authorization code
    // is single-use and the browser is about to navigate away — and parked in
    // `inBetweenSteps`.
    return { ...details, requiresEntitySelection: true };
  }

  async listEntities(accessToken: string): Promise<ProviderEntity[]> {
    const acls = await this.fetchJson<{
      elements?: { organization: string }[];
    }>(`${API_BASE}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, {
      headers: this.restHeaders(accessToken),
    });

    const organizationUrns = (acls.elements ?? []).map((element) => element.organization);

    const entities = await Promise.all(
      organizationUrns.map(async (urn) => {
        const id = urn.split(':').pop() ?? '';

        const organization = await this.fetchJson<{
          localizedName?: string;
          vanityName?: string;
        }>(`${API_BASE}/rest/organizations/${id}`, {
          headers: this.restHeaders(accessToken),
        });

        return {
          id,
          name: organization.localizedName ?? `Organization ${id}`,
          username: organization.vanityName,
        } satisfies ProviderEntity;
      }),
    );

    return entities;
  }

  async selectEntity(accessToken: string, entityId: string): Promise<ProviderEntity> {
    const entities = await this.listEntities(accessToken);
    const chosen = entities.find((entity) => entity.id === entityId);

    if (!chosen) {
      throw new BadBodyError(
        'That LinkedIn page is not one this account administers.',
        this.identifier,
      );
    }

    // LinkedIn issues no page-scoped token — the member token carries the
    // organization permissions — so the caller keeps the existing credential.
    return chosen;
  }

  protected override authorUrn(internalId: string): string {
    return `urn:li:organization:${internalId}`;
  }
}
