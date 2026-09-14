/**
 * Instagram Business — publishing via the Meta Graph API.
 *
 * ## Instagram is reached through Facebook
 *
 * There is no standalone Instagram publishing API for business accounts. An IG
 * Business account must be linked to a Facebook Page, and it is that Page's
 * token which authorises publishing. So the entity list here is "the Instagram
 * accounts behind the Pages you administer" — pages without a linked IG account
 * simply do not appear, which is the single most common reason a user sees an
 * empty picker.
 *
 * ## Publishing is two calls, not one
 *
 * Instagram requires creating a *media container* and then publishing it, and
 * for video the container is processed asynchronously — publishing too early is
 * rejected. Hence the poll between the two steps.
 */
import { BadBodyError, RetryableError } from '../../abstract/errors';
import { sleep } from '../../abstract/social.abstract';
import { checkAgainstRules } from '../../abstract/validity';
import type { ProviderRules } from '../../composer/rules';
import type {
  AuthenticateParams,
  AuthTokenDetails,
  ChannelContext,
  PostDetails,
  PostResponse,
  ProviderEntity,
  SocialProvider,
  SupportsEntitySelection,
} from '../../abstract/social.provider.interface';
import { GRAPH_BASE, MetaGraphProvider } from '../meta/meta.graph';

const MAX_LENGTH = 2_200;
const MAX_CAROUSEL_ITEMS = 10;

/**
 * What Instagram's Content Publishing API accepts.
 *
 * Three rules here are the classic silent failures, each taken from Meta's
 * container documentation rather than guessed:
 *
 * - **No text-only posts.** Every post needs an image or a video.
 * - **JPEG only.** The API fetches `image_url` itself and refuses PNG, GIF and
 *   WebP. PostGear's media pipeline stores photos as JPEG, so this only bites on
 *   an image that kept transparency and was therefore stored as PNG.
 * - **Aspect ratio 4:5 to 1.91:1**, and at most 8 MB. A tall phone screenshot
 *   is outside that range and is rejected when the container is created.
 *
 * Carousels mix images and video freely. Later parts become comments, which
 * carry text only.
 */
export const INSTAGRAM_RULES: ProviderRules = {
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
    imageAspectRatio: { min: 0.8, max: 1.91 },
  },
};

/** Video containers are processed asynchronously; these bound the wait. */
const CONTAINER_POLL_ATTEMPTS = 30;
const CONTAINER_POLL_INTERVAL_MS = 5_000;

interface InstagramAccount {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
}

export class InstagramProvider
  extends MetaGraphProvider
  implements SocialProvider, SupportsEntitySelection
{
  readonly identifier = 'instagram';
  readonly name = 'Instagram';

  readonly scopes = [
    'instagram_basic',
    'instagram_content_publish',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
  ];

  maxLength(): number {
    return MAX_LENGTH;
  }

  readonly rules = INSTAGRAM_RULES;

  override async checkValidity(posts: PostDetails[]): Promise<string | true> {
    return checkAgainstRules(this, posts);
  }

  async authenticate(params: AuthenticateParams): Promise<AuthTokenDetails> {
    const { accessToken, expiresIn, user } = await this.authenticateWithMeta(params);

    return {
      id: user.id,
      accessToken,
      expiresIn,
      name: user.name ?? 'Instagram account',
      requiresEntitySelection: true,
    };
  }

  async listEntities(accessToken: string): Promise<ProviderEntity[]> {
    const pages = await this.fetchPages(accessToken);

    const accounts = await Promise.all(
      pages.map(async (page): Promise<ProviderEntity | null> => {
        const linked = await this.fetchJson<{
          instagram_business_account?: InstagramAccount;
        }>(
          `${GRAPH_BASE}/${page.id}?fields=instagram_business_account{id,username,name,profile_picture_url,followers_count}&access_token=${encodeURIComponent(page.access_token)}`,
        );

        const account = linked.instagram_business_account;

        if (!account?.id) {
          return null;
        }

        return {
          id: account.id,
          name: account.name ?? account.username ?? `Instagram ${account.id}`,
          username: account.username,
          picture: account.profile_picture_url,
          detail:
            account.followers_count === undefined
              ? `via ${page.name}`
              : `${account.followers_count.toLocaleString()} followers · via ${page.name}`,
          // Publishing authorises against the *Page's* token, not the user's.
          accessToken: page.access_token,
        };
      }),
    );

    return accounts.filter((account): account is ProviderEntity => account !== null);
  }

  async selectEntity(accessToken: string, entityId: string): Promise<ProviderEntity> {
    const entities = await this.listEntities(accessToken);
    const chosen = entities.find((entity) => entity.id === entityId);

    if (!chosen) {
      throw new BadBodyError(
        'That Instagram account is not linked to a Page this user manages.',
        this.identifier,
      );
    }

    return chosen;
  }

  async post(
    channel: ChannelContext,
    accessToken: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];
    let parentId: string | undefined;

    for (const post of posts) {
      if (parentId) {
        const [comment] = await this.comment(channel, accessToken, parentId, [post]);
        results.push(comment);
        continue;
      }

      const published = await this.createPost(channel, accessToken, post);
      results.push(published);
      parentId = published.postId;
    }

    return results;
  }

  async comment(
    _channel: ChannelContext,
    accessToken: string,
    parentPostId: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of posts) {
      const response = await this.fetchJson<{ id?: string }>(
        `${GRAPH_BASE}/${parentPostId}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: post.message, access_token: accessToken }),
        },
      );

      results.push({ id: post.id, postId: response.id ?? '', releaseURL: '' });
    }

    return results;
  }

  private async createPost(
    channel: ChannelContext,
    accessToken: string,
    post: PostDetails,
  ): Promise<PostResponse> {
    const media = post.media ?? [];
    const containerId =
      media.length > 1
        ? await this.createCarouselContainer(channel, accessToken, post)
        : await this.createSingleContainer(channel, accessToken, post);

    await this.waitForContainer(containerId, accessToken);

    const published = await this.fetchJson<{ id?: string }>(
      `${GRAPH_BASE}/${channel.internalId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
      },
    );

    if (!published.id) {
      throw new BadBodyError(
        'Instagram accepted the media but returned no post id.',
        this.identifier,
      );
    }

    const handle = channel.profile ?? '';

    return {
      id: post.id,
      postId: published.id,
      releaseURL: handle ? `https://www.instagram.com/${handle}/` : `https://www.instagram.com/`,
    };
  }

  private async createSingleContainer(
    channel: ChannelContext,
    accessToken: string,
    post: PostDetails,
  ): Promise<string> {
    const [item] = post.media ?? [];

    if (!item) {
      throw new BadBodyError(
        'Instagram posts must include at least one image or video.',
        this.identifier,
      );
    }

    const body: Record<string, unknown> = {
      caption: post.message,
      access_token: accessToken,
    };

    if (item.type === 'video') {
      body.media_type = 'REELS';
      body.video_url = item.path;
    } else {
      body.image_url = item.path;
    }

    const container = await this.fetchJson<{ id?: string }>(
      `${GRAPH_BASE}/${channel.internalId}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!container.id) {
      throw new BadBodyError('Instagram did not return a media container.', this.identifier);
    }

    return container.id;
  }

  private async createCarouselContainer(
    channel: ChannelContext,
    accessToken: string,
    post: PostDetails,
  ): Promise<string> {
    const children = await Promise.all(
      (post.media ?? []).map(async (item) => {
        const body: Record<string, unknown> = {
          is_carousel_item: true,
          access_token: accessToken,
        };

        if (item.type === 'video') {
          body.media_type = 'VIDEO';
          body.video_url = item.path;
        } else {
          body.image_url = item.path;
        }

        const child = await this.fetchJson<{ id?: string }>(
          `${GRAPH_BASE}/${channel.internalId}/media`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );

        if (!child.id) {
          throw new BadBodyError(
            'Instagram did not return a carousel item container.',
            this.identifier,
          );
        }

        return child.id;
      }),
    );

    const container = await this.fetchJson<{ id?: string }>(
      `${GRAPH_BASE}/${channel.internalId}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'CAROUSEL',
          children,
          caption: post.message,
          access_token: accessToken,
        }),
      },
    );

    if (!container.id) {
      throw new BadBodyError('Instagram did not return a carousel container.', this.identifier);
    }

    return container.id;
  }

  /**
   * Waits for a container to reach `FINISHED`.
   *
   * Images are usually ready immediately; video transcoding takes real time.
   * Publishing an `IN_PROGRESS` container fails, so the poll is required rather
   * than defensive.
   */
  private async waitForContainer(containerId: string, accessToken: string): Promise<void> {
    for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt += 1) {
      const status = await this.fetchJson<{
        status_code?: string;
        status?: string;
      }>(
        `${GRAPH_BASE}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`,
      );

      if (status.status_code === 'FINISHED') {
        return;
      }

      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
        throw new BadBodyError(
          `Instagram could not process the media: ${status.status ?? status.status_code}`,
          this.identifier,
        );
      }

      await sleep(CONTAINER_POLL_INTERVAL_MS);
    }

    throw new RetryableError(
      'Instagram is still processing this media. PostGear will try again.',
      this.identifier,
    );
  }
}
