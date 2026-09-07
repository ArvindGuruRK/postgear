/**
 * Facebook Pages — publishing via the Meta Graph API.
 *
 * A person is authenticated, but a *Page* is what gets posted to, so this is a
 * two-phase connect: OAuth first, then the user picks which Page. The Page also
 * carries its own access token, which replaces the user token once chosen —
 * page-scoped tokens are what the publishing endpoints actually accept, and
 * unlike the user token they do not expire on their own.
 */
import { BadBodyError } from '../../abstract/errors';
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

/** Facebook's own limit is far higher, but posts this long are already unreadable. */
const MAX_LENGTH = 63_206;

export class FacebookProvider
  extends MetaGraphProvider
  implements SocialProvider, SupportsEntitySelection
{
  readonly identifier = 'facebook';
  readonly name = 'Facebook';

  readonly scopes = [
    'pages_show_list',
    'pages_manage_posts',
    'pages_read_engagement',
    'business_management',
  ];

  maxLength(): number {
    return MAX_LENGTH;
  }

  override async checkValidity(posts: PostDetails[]): Promise<string | true> {
    for (const post of posts) {
      const media = post.media ?? [];
      if (media.filter((item) => item.type === 'video').length > 1) {
        return 'Facebook posts can have at most one video.';
      }
      if (!post.message.trim() && media.length === 0) {
        return 'A Facebook post needs text or an attachment.';
      }
    }
    return true;
  }

  async authenticate(params: AuthenticateParams): Promise<AuthTokenDetails> {
    const { accessToken, expiresIn, user } = await this.authenticateWithMeta(params);

    return {
      id: user.id,
      accessToken,
      expiresIn,
      name: user.name ?? 'Facebook account',
      // The user token is stored now because the authorization code is
      // single-use and about to be discarded, but this channel has no target
      // until a Page is chosen.
      requiresEntitySelection: true,
    };
  }

  async listEntities(accessToken: string): Promise<ProviderEntity[]> {
    const pages = await this.fetchPages(accessToken);
    return pages.map((page) => this.pageToEntity(page));
  }

  async selectEntity(accessToken: string, entityId: string): Promise<ProviderEntity> {
    const pages = await this.fetchPages(accessToken);
    const chosen = pages.find((page) => page.id === entityId);

    if (!chosen) {
      throw new BadBodyError(
        'That Facebook Page is not one this account manages.',
        this.identifier,
      );
    }

    return this.pageToEntity(chosen);
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

      results.push({
        id: post.id,
        postId: response.id ?? '',
        releaseURL: `https://www.facebook.com/${parentPostId}`,
      });
    }

    return results;
  }

  private async createPost(
    channel: ChannelContext,
    accessToken: string,
    post: PostDetails,
  ): Promise<PostResponse> {
    const media = post.media ?? [];
    const photos = media.filter((item) => item.type === 'image');
    const [video] = media.filter((item) => item.type === 'video');

    // Facebook has three different publishing edges depending on what is
    // attached, and using the wrong one silently drops the media.
    if (video) {
      const response = await this.fetchJson<{ id?: string; post_id?: string }>(
        `${GRAPH_BASE}/${channel.internalId}/videos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_url: video.path,
            description: post.message,
            access_token: accessToken,
          }),
        },
      );

      return this.toResponse(post.id, response.post_id ?? response.id);
    }

    if (photos.length === 1) {
      const response = await this.fetchJson<{ id?: string; post_id?: string }>(
        `${GRAPH_BASE}/${channel.internalId}/photos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: photos[0].path,
            caption: post.message,
            access_token: accessToken,
          }),
        },
      );

      return this.toResponse(post.id, response.post_id ?? response.id);
    }

    if (photos.length > 1) {
      // Multi-photo posts need each image uploaded unpublished first, then
      // attached to a single feed post.
      const attachedMedia = await Promise.all(
        photos.map(async (photo) => {
          const uploaded = await this.fetchJson<{ id?: string }>(
            `${GRAPH_BASE}/${channel.internalId}/photos`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: photo.path,
                published: false,
                access_token: accessToken,
              }),
            },
          );

          return { media_fbid: uploaded.id };
        }),
      );

      const response = await this.fetchJson<{ id?: string }>(
        `${GRAPH_BASE}/${channel.internalId}/feed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: post.message,
            attached_media: attachedMedia,
            access_token: accessToken,
          }),
        },
      );

      return this.toResponse(post.id, response.id);
    }

    const response = await this.fetchJson<{ id?: string }>(
      `${GRAPH_BASE}/${channel.internalId}/feed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: post.message, access_token: accessToken }),
      },
    );

    return this.toResponse(post.id, response.id);
  }

  private toResponse(postDetailsId: string, publishedId: string | undefined): PostResponse {
    if (!publishedId) {
      throw new BadBodyError('Facebook accepted the post but returned no id.', this.identifier);
    }

    return {
      id: postDetailsId,
      postId: publishedId,
      releaseURL: `https://www.facebook.com/${publishedId}`,
    };
  }
}
