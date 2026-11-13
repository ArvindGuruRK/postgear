/**
 * Instagram, connected on its own: Meta's "Instagram API with Instagram Login".
 *
 * ## No Facebook Page
 *
 * The person signs in with Instagram itself and the token belongs to the
 * Instagram account, so there is no Page to link and no "which account?" step:
 * one sign-in is one channel. The account must still be a **professional**
 * one (Business or Creator); Meta offers no publishing API for personal
 * accounts by any door.
 *
 * The older door, through a Facebook Page, is the `instagram` provider. Both
 * can be connected side by side.
 *
 * ## Publishing is two calls, not one
 *
 * Instagram wants a *media container* created, then published, and it fetches
 * the media from a public URL itself. A video container is processed first and
 * cannot be published until it is ready, hence the wait between the two steps.
 */
import { BadBodyError } from '../../abstract/errors';
import type {
  AuthenticateParams,
  AuthTokenDetails,
  ChannelContext,
  ChannelMetricPoint,
  MediaDescriptor,
  PostDetails,
  PostMetrics,
  PostResponse,
  SocialAnalytics,
  SocialProvider,
} from '../../abstract/social.provider.interface';
import { checkAgainstRules } from '../../abstract/validity';
import type { ProviderRules } from '../../composer/rules';
import { instagramChannelAnalytics, instagramPostAnalytics } from '../meta/instagram.insights';
import { type MetaLoginConfig, MetaLoginProvider } from '../meta/meta.login';

/** Pinned so a Graph API change is a deliberate edit rather than a silent shift. */
const GRAPH_HOST = 'https://graph.instagram.com';
const GRAPH_VERSION = 'v27.0';
const API_BASE = `${GRAPH_HOST}/${GRAPH_VERSION}`;

const MAX_LENGTH = 2_200;
/** A carousel holds up to twenty images and videos. */
const MAX_CAROUSEL_ITEMS = 20;

/**
 * What Instagram's content publishing accepts, from Meta's container reference:
 *
 * - **No text-only posts.** Every post needs an image or a video.
 * - **JPEG only**, at most 8 MB, between 4:5 and 1.91:1. Instagram fetches
 *   `image_url` itself and refuses PNG, GIF and WebP.
 * - **A single video is published as a Reel**, at most 300 MB.
 *
 * Carousels mix images and video freely. Later parts become comments, which
 * carry text only.
 */
export const INSTAGRAM_STANDALONE_RULES: ProviderRules = {
  maxLength: MAX_LENGTH,
  lengthMethod: 'utf16',
  thread: 'comments',
  followUpMedia: false,
  media: {
    required: true,
    maxItems: MAX_CAROUSEL_ITEMS,
    maxImages: MAX_CAROUSEL_ITEMS,
    maxVideos: MAX_CAROUSEL_ITEMS,
    allowMixed: true,
    imageMimeTypes: ['image/jpeg'],
    maxImageBytes: 8 * 1024 * 1024,
    maxVideoBytes: 300 * 1024 * 1024,
    imageAspectRatio: { min: 0.8, max: 1.91 },
  },
};

interface InstagramProfile {
  /** The professional account's id: what every publishing path is built from. */
  user_id?: string;
  /** The same account as this one app sees it. Only a fallback. */
  id?: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
}

export class InstagramStandaloneProvider
  extends MetaLoginProvider
  implements SocialProvider, SocialAnalytics
{
  readonly identifier = 'instagram-standalone';
  readonly name = 'Instagram';

  /**
   * Comments are how the later parts of a multi-part post go out; insights
   * are the Analytics page. Neither stops a channel from publishing.
   */
  readonly scopes = [
    'instagram_business_basic',
    'instagram_business_content_publish',
    'instagram_business_manage_comments',
    'instagram_business_manage_insights',
  ];

  protected readonly requiredScopes = [
    'instagram_business_basic',
    'instagram_business_content_publish',
  ];

  protected readonly login: MetaLoginConfig = {
    label: 'Instagram',
    authorizeUrl: 'https://www.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    graphHost: GRAPH_HOST,
    apiBase: API_BASE,
    exchangeGrant: 'ig_exchange_token',
    refreshGrant: 'ig_refresh_token',
    appIdEnv: 'INSTAGRAM_APP_ID',
    appSecretEnv: 'INSTAGRAM_APP_SECRET',
    containerStatusField: 'status_code',
    containerDetailField: 'status',
  };

  readonly rules = INSTAGRAM_STANDALONE_RULES;

  maxLength(): number {
    return MAX_LENGTH;
  }

  override async checkValidity(posts: PostDetails[]): Promise<string | true> {
    return checkAgainstRules(this, posts);
  }

  async authenticate(params: AuthenticateParams): Promise<AuthTokenDetails> {
    const token = await this.exchangeCode(params);

    const profile = await this.graphGet<InstagramProfile>(
      'me',
      { fields: 'user_id,username,name,profile_picture_url' },
      token.accessToken,
    );

    const id = profile.user_id ?? token.userId ?? profile.id;

    if (!id) {
      throw new BadBodyError('Instagram did not return an account profile.', this.identifier);
    }

    return {
      id: String(id),
      accessToken: token.accessToken,
      // The long-lived token renews itself: see `meta.login.ts`.
      refreshToken: token.accessToken,
      expiresIn: token.expiresIn,
      name: profile.name || profile.username || 'Instagram account',
      username: profile.username,
      picture: profile.profile_picture_url,
    };
  }

  async post(
    channel: ChannelContext,
    accessToken: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    const [first, ...rest] = posts;

    if (!first) {
      return [];
    }

    const published = await this.createPost(channel, accessToken, first);
    const results = [published];

    // One at a time, so a failure knows how many parts are already out.
    for (const part of rest) {
      try {
        results.push(...(await this.comment(channel, accessToken, published.postId, [part])));
      } catch (error) {
        throw this.partlyPublished(error, results.length);
      }
    }

    return results;
  }

  /** Later parts of a multi-part post: text comments under the post, in order. */
  async comment(
    _channel: ChannelContext,
    accessToken: string,
    parentPostId: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of posts) {
      const response = await this.graphPost<{ id?: string }>(
        `${encodeURIComponent(parentPostId)}/comments`,
        { message: post.message },
        accessToken,
      );

      results.push({ id: post.id, postId: response.id ?? '', releaseURL: '' });
    }

    return results;
  }

  /** The account's follower level, daily reach and recent interactions. */
  async channelAnalytics(
    channel: ChannelContext,
    accessToken: string,
    days: number,
  ): Promise<ChannelMetricPoint[]> {
    return instagramChannelAnalytics(
      (url) => this.fetchJson(url),
      API_BASE,
      channel.internalId,
      accessToken,
      days,
    );
  }

  /** One media item's lifetime insights. */
  async postAnalytics(
    _channel: ChannelContext,
    accessToken: string,
    platformPostId: string,
  ): Promise<PostMetrics | null> {
    return instagramPostAnalytics(
      (url) => this.fetchJson(url),
      API_BASE,
      platformPostId,
      accessToken,
    );
  }

  private async createPost(
    channel: ChannelContext,
    accessToken: string,
    post: PostDetails,
  ): Promise<PostResponse> {
    const media = post.media ?? [];

    if (media.length === 0) {
      throw new BadBodyError(
        'Instagram posts must include at least one image or video.',
        this.identifier,
      );
    }

    const account = encodeURIComponent(channel.internalId);
    const containerId =
      media.length === 1
        ? await this.createContainer(account, accessToken, {
            ...this.mediaFields(media[0], 'single'),
            caption: post.message,
          })
        : await this.createCarousel(account, accessToken, post.message, media);

    await this.waitForContainer(containerId, accessToken);

    const published = await this.graphPost<{ id?: string }>(
      `${account}/media_publish`,
      { creation_id: containerId },
      accessToken,
    );

    if (!published.id) {
      throw new BadBodyError(
        'Instagram accepted the media but returned no post id.',
        this.identifier,
      );
    }

    return {
      id: post.id,
      postId: published.id,
      releaseURL: await this.permalinkOf(published.id, accessToken, channel),
    };
  }

  /**
   * A carousel: one container per item, then one that names them in order.
   *
   * The items are created one at a time so their order is the order the person
   * arranged, and every video is waited for: a parent that names an unfinished
   * child is refused.
   */
  private async createCarousel(
    account: string,
    accessToken: string,
    caption: string,
    media: MediaDescriptor[],
  ): Promise<string> {
    const children: string[] = [];

    for (const item of media) {
      const child = await this.createContainer(account, accessToken, {
        ...this.mediaFields(item, 'carousel'),
        is_carousel_item: 'true',
      });

      if (item.type === 'video') {
        await this.waitForContainer(child, accessToken);
      }

      children.push(child);
    }

    // The caption belongs to the carousel, never to its items.
    return this.createContainer(account, accessToken, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption,
    });
  }

  private async createContainer(
    account: string,
    accessToken: string,
    fields: Record<string, string | undefined>,
  ): Promise<string> {
    const container = await this.graphPost<{ id?: string }>(
      `${account}/media`,
      fields,
      accessToken,
    );

    if (!container.id) {
      throw new BadBodyError('Instagram did not return a media container.', this.identifier);
    }

    return container.id;
  }

  /**
   * The fields that say what one item is. A video on its own is a Reel; inside
   * a carousel it is a plain video, because a Reel cannot be a carousel item.
   * Alt text is for images only.
   */
  private mediaFields(
    item: MediaDescriptor,
    placement: 'single' | 'carousel',
  ): Record<string, string | undefined> {
    if (item.type === 'video') {
      return { media_type: placement === 'single' ? 'REELS' : 'VIDEO', video_url: item.path };
    }

    return { image_url: item.path, alt_text: item.alt };
  }

  /**
   * The post's own link. Asking for it is a courtesy call after the post is
   * already live, so a failure here falls back to the profile rather than
   * failing a post that was published.
   */
  private async permalinkOf(
    mediaId: string,
    accessToken: string,
    channel: ChannelContext,
  ): Promise<string> {
    try {
      const media = await this.graphGet<{ permalink?: string }>(
        encodeURIComponent(mediaId),
        { fields: 'permalink' },
        accessToken,
      );

      if (media.permalink) {
        return media.permalink;
      }
    } catch {
      // Fall through to the profile.
    }

    return channel.profile
      ? `https://www.instagram.com/${channel.profile}/`
      : 'https://www.instagram.com/';
  }
}
