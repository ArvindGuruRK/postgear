/**
 * Threads: Meta's Threads API.
 *
 * ## Its own login, its own keys
 *
 * Threads signs people in on threads.com with a Threads app id and secret
 * (shown under the Threads use case in the Meta dashboard, not the Meta app's
 * own id). One sign-in is one channel: there is no page to pick.
 *
 * ## Publishing is two calls, not one
 *
 * Like Instagram, a post is a *container* that is created, then published, and
 * Threads fetches any image or video from a public URL itself. Unlike
 * Instagram, a post can be text alone.
 *
 * ## A multi-part post is a real thread
 *
 * Each later part is published as a reply to the part before it
 * (`reply_to_id`), which is exactly what Threads draws as a thread. Every part
 * is a post of its own, so every part can carry its own media.
 */
import {
  asCount,
  clampDays,
  DAY_MS,
  dayKey,
  type MetricEntry,
  sumByDay,
  todayKey,
  utcMidnight,
  windowStart,
} from '../../abstract/analytics';
import { BadBodyError } from '../../abstract/errors';
import type { HandledError } from '../../abstract/social.abstract';
import {
  type AuthenticateParams,
  type AuthTokenDetails,
  type ChannelContext,
  type ChannelMetricPoint,
  EMPTY_POST_METRICS,
  type MediaDescriptor,
  type PostDetails,
  type PostMetrics,
  type PostResponse,
  type SocialAnalytics,
  type SocialProvider,
} from '../../abstract/social.provider.interface';
import { checkAgainstRules } from '../../abstract/validity';
import type { ProviderRules } from '../../composer/rules';
import { type GraphInsight, graphInsightEntries, isGraphMissingObject } from '../meta/meta.graph';
import { type MetaLoginConfig, MetaLoginProvider } from '../meta/meta.login';

/** Pinned so an API change is a deliberate edit rather than a silent shift. */
const GRAPH_HOST = 'https://graph.threads.com';
const GRAPH_VERSION = 'v1.0';
const API_BASE = `${GRAPH_HOST}/${GRAPH_VERSION}`;

const MAX_LENGTH = 500;
/** A carousel holds two to twenty images and videos. */
const MAX_CAROUSEL_ITEMS = 20;

/** Threads keeps no insights from before this moment (13 April 2024) and refuses an earlier `since`. */
const EARLIEST_INSIGHTS_SECONDS = 1_712_991_600;

/**
 * Likes, replies, reposts and quotes come as one total over the asked span,
 * never per day, so a daily series takes one call per day. Each sync reads
 * today and the two days before it and the daily cadence fills the window
 * over time, the same trade the Instagram insights make.
 */
const TOTAL_VALUE_BACKFILL_DAYS = 3;

/**
 * What the Threads API accepts, from Meta's Threads overview:
 *
 * - **500 characters**, with an emoji counted as its UTF-8 bytes (the
 *   `threads` length method).
 * - **Text alone is fine.** Media is optional.
 * - **Images are JPEG or PNG**, at most 8 MB, no narrower or wider than 10:1.
 * - **Video** is MP4 or MOV, at most 1 GB and five minutes.
 * - **Up to twenty items**, images and video mixed freely.
 */
export const THREADS_RULES: ProviderRules = {
  maxLength: MAX_LENGTH,
  lengthMethod: 'threads',
  thread: 'replies',
  followUpMedia: true,
  media: {
    required: false,
    maxItems: MAX_CAROUSEL_ITEMS,
    maxImages: MAX_CAROUSEL_ITEMS,
    maxVideos: MAX_CAROUSEL_ITEMS,
    allowMixed: true,
    imageMimeTypes: ['image/jpeg', 'image/png'],
    maxImageBytes: 8 * 1024 * 1024,
    maxVideoBytes: 1024 * 1024 * 1024,
    imageAspectRatio: { min: 0.1, max: 10 },
  },
};

interface ThreadsProfile {
  id?: string;
  username?: string;
  name?: string;
  threads_profile_picture_url?: string;
}

export class ThreadsProvider extends MetaLoginProvider implements SocialProvider, SocialAnalytics {
  readonly identifier = 'threads';
  readonly name = 'Threads';

  /**
   * `threads_manage_replies` is what lets a later part reply to the one before
   * it; `threads_manage_insights` is the Analytics page. A channel can still
   * publish single posts without either.
   */
  readonly scopes = [
    'threads_basic',
    'threads_content_publish',
    'threads_manage_replies',
    'threads_manage_insights',
  ];

  protected readonly requiredScopes = ['threads_basic', 'threads_content_publish'];

  protected readonly login: MetaLoginConfig = {
    label: 'Threads',
    authorizeUrl: 'https://threads.com/oauth/authorize',
    tokenUrl: `${GRAPH_HOST}/oauth/access_token`,
    graphHost: GRAPH_HOST,
    apiBase: API_BASE,
    exchangeGrant: 'th_exchange_token',
    refreshGrant: 'th_refresh_token',
    appIdEnv: 'THREADS_APP_ID',
    appSecretEnv: 'THREADS_APP_SECRET',
    containerStatusField: 'status',
    containerDetailField: 'error_message',
  };

  readonly rules = THREADS_RULES;

  maxLength(): number {
    return MAX_LENGTH;
  }

  override async checkValidity(posts: PostDetails[]): Promise<string | true> {
    return checkAgainstRules(this, posts);
  }

  protected override handleErrors(body: string, status: number): HandledError | undefined {
    if (body.includes('LINK_LIMIT_EXCEEDED')) {
      return {
        type: 'bad-body',
        value: 'Threads allows at most 5 different links in one post. Remove some and try again.',
      };
    }

    return super.handleErrors(body, status);
  }

  async authenticate(params: AuthenticateParams): Promise<AuthTokenDetails> {
    const token = await this.exchangeCode(params);

    const profile = await this.graphGet<ThreadsProfile>(
      'me',
      { fields: 'id,username,name,threads_profile_picture_url' },
      token.accessToken,
    );

    const id = profile.id ?? token.userId;

    if (!id) {
      throw new BadBodyError('Threads did not return an account profile.', this.identifier);
    }

    return {
      id: String(id),
      accessToken: token.accessToken,
      // The long-lived token renews itself: see `meta.login.ts`.
      refreshToken: token.accessToken,
      expiresIn: token.expiresIn,
      name: profile.name || profile.username || 'Threads account',
      username: profile.username,
      picture: profile.threads_profile_picture_url,
    };
  }

  async post(
    channel: ChannelContext,
    accessToken: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    return this.publishChain(channel, accessToken, posts);
  }

  /** Continues a thread under a post that is already out. */
  async comment(
    channel: ChannelContext,
    accessToken: string,
    parentPostId: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    return this.publishChain(channel, accessToken, posts, parentPostId);
  }

  /**
   * The account's follower level, its daily views, and its interactions for
   * the last few days: see `TOTAL_VALUE_BACKFILL_DAYS` for why only a few.
   *
   * A reply is Threads' comment. A repost and a quote both put the post in
   * front of someone else's followers, so both count as shares.
   */
  async channelAnalytics(
    channel: ChannelContext,
    accessToken: string,
    days: number,
  ): Promise<ChannelMetricPoint[]> {
    const path = `${encodeURIComponent(channel.internalId)}/threads_insights`;
    const window = clampDays(days);
    const now = Date.now();
    const entries: MetricEntry[] = [];
    const seconds = (time: number) =>
      String(Math.max(EARLIEST_INSIGHTS_SECONDS, Math.floor(time / 1_000)));

    // Asked on its own: the follower count takes no date range.
    const followers = await this.graphGet<{ data?: GraphInsight[] }>(
      path,
      { metric: 'followers_count' },
      accessToken,
    );
    const level = followers.data?.find((insight) => insight.name === 'followers_count');

    if (level) {
      entries.push({
        metric: 'followers',
        date: todayKey(now),
        value: asCount(level.total_value?.value ?? level.values?.[0]?.value),
      });
    }

    const views = await this.graphGet<{ data?: GraphInsight[] }>(
      path,
      {
        metric: 'views',
        since: seconds(windowStart(window, now).getTime()),
        until: seconds(now),
      },
      accessToken,
    );

    entries.push(...graphInsightEntries(views.data ?? [], { views: 'views' }));

    for (let back = 0; back < Math.min(window, TOTAL_VALUE_BACKFILL_DAYS); back += 1) {
      const dayStart = utcMidnight(now - back * DAY_MS).getTime();
      const dayEnd = Math.min(dayStart + DAY_MS - 1_000, now);

      const totals = await this.graphGet<{ data?: GraphInsight[] }>(
        path,
        {
          metric: 'likes,replies,reposts,quotes',
          since: seconds(dayStart),
          until: seconds(dayEnd),
        },
        accessToken,
      );

      entries.push(...this.totalEntries(totals.data ?? [], dayKey(dayStart)));
    }

    return sumByDay(entries);
  }

  /** One post's lifetime insights, or null once Threads no longer has it. */
  async postAnalytics(
    _channel: ChannelContext,
    accessToken: string,
    platformPostId: string,
  ): Promise<PostMetrics | null> {
    try {
      const response = await this.graphGet<{ data?: GraphInsight[] }>(
        `${encodeURIComponent(platformPostId)}/insights`,
        { metric: 'views,likes,replies,reposts,quotes,shares' },
        accessToken,
      );

      const metrics: PostMetrics = { ...EMPTY_POST_METRICS };

      for (const insight of response.data ?? []) {
        const value = asCount(insight.values?.[0]?.value ?? insight.total_value?.value);

        switch (insight.name) {
          case 'views':
            metrics.views = value;
            break;
          case 'likes':
            metrics.likes = value;
            break;
          case 'replies':
            metrics.comments = value;
            break;
          case 'reposts':
          case 'quotes':
          case 'shares':
            metrics.shares += value;
            break;
        }
      }

      return metrics;
    } catch (error) {
      if (isGraphMissingObject(error)) {
        return null;
      }
      throw error;
    }
  }

  /** One day's interaction totals as entries, with their sum as engagements. */
  private totalEntries(insights: GraphInsight[], date: string): MetricEntry[] {
    const entries: MetricEntry[] = [];
    let engagements = 0;

    for (const insight of insights) {
      const value = asCount(insight.total_value?.value ?? insight.values?.[0]?.value);

      switch (insight.name) {
        case 'likes':
          entries.push({ metric: 'likes', date, value });
          engagements += value;
          break;
        case 'replies':
          entries.push({ metric: 'comments', date, value });
          engagements += value;
          break;
        case 'reposts':
        case 'quotes':
          entries.push({ metric: 'shares', date, value });
          engagements += value;
          break;
      }
    }

    if (entries.length > 0) {
      entries.push({ metric: 'engagements', date, value: engagements });
    }

    return entries;
  }

  /** Publishes the parts in order, each as a reply to the one before. */
  private async publishChain(
    channel: ChannelContext,
    accessToken: string,
    posts: PostDetails[],
    replyToId?: string,
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];
    let previousId = replyToId;

    for (const post of posts) {
      let published: PostResponse;

      try {
        published = await this.publishOne(channel, accessToken, post, previousId);
      } catch (error) {
        // Nothing of this call is out yet: fail as it is, retries and all.
        if (results.length === 0) {
          throw error;
        }
        throw this.partlyPublished(error, results.length);
      }

      results.push(published);
      previousId = published.postId;
    }

    return results;
  }

  private async publishOne(
    channel: ChannelContext,
    accessToken: string,
    post: PostDetails,
    replyToId?: string,
  ): Promise<PostResponse> {
    const media = post.media ?? [];

    if (media.length === 0 && !post.message.trim()) {
      throw new BadBodyError(
        'A Threads post needs some text, an image or a video.',
        this.identifier,
      );
    }

    const account = encodeURIComponent(channel.internalId);
    // The text and the reply target belong to the post itself: for a carousel
    // that is the parent container, never one of its items.
    const own = { text: post.message, reply_to_id: replyToId };

    let containerId: string;

    if (media.length === 0) {
      containerId = await this.createContainer(account, accessToken, {
        media_type: 'TEXT',
        ...own,
      });
    } else if (media.length === 1) {
      containerId = await this.createContainer(account, accessToken, {
        ...this.mediaFields(media[0]),
        ...own,
      });
    } else {
      containerId = await this.createContainer(account, accessToken, {
        media_type: 'CAROUSEL',
        children: (await this.createCarouselItems(account, accessToken, media)).join(','),
        ...own,
      });
    }

    await this.waitForContainer(containerId, accessToken);

    const published = await this.graphPost<{ id?: string }>(
      `${account}/threads_publish`,
      { creation_id: containerId },
      accessToken,
    );

    if (!published.id) {
      throw new BadBodyError('Threads accepted the post but returned no post id.', this.identifier);
    }

    return {
      id: post.id,
      postId: published.id,
      releaseURL: await this.permalinkOf(published.id, accessToken, channel),
    };
  }

  /**
   * One container per carousel item, created in the order the person arranged
   * them and each waited for: a parent that names an unfinished item is refused.
   */
  private async createCarouselItems(
    account: string,
    accessToken: string,
    media: MediaDescriptor[],
  ): Promise<string[]> {
    const children: string[] = [];

    for (const item of media) {
      const child = await this.createContainer(account, accessToken, {
        ...this.mediaFields(item),
        is_carousel_item: 'true',
      });

      await this.waitForContainer(child, accessToken);
      children.push(child);
    }

    return children;
  }

  private async createContainer(
    account: string,
    accessToken: string,
    fields: Record<string, string | undefined>,
  ): Promise<string> {
    const container = await this.graphPost<{ id?: string }>(
      `${account}/threads`,
      fields,
      accessToken,
    );

    if (!container.id) {
      throw new BadBodyError('Threads did not return a post container.', this.identifier);
    }

    return container.id;
  }

  private mediaFields(item: MediaDescriptor): Record<string, string | undefined> {
    return item.type === 'video'
      ? { media_type: 'VIDEO', video_url: item.path, alt_text: item.alt }
      : { media_type: 'IMAGE', image_url: item.path, alt_text: item.alt };
  }

  /**
   * The post's own link. Asking for it is a courtesy call after the post is
   * already live, so a failure here falls back to the profile rather than
   * failing a post that was published.
   */
  private async permalinkOf(
    postId: string,
    accessToken: string,
    channel: ChannelContext,
  ): Promise<string> {
    try {
      const media = await this.graphGet<{ permalink?: string }>(
        encodeURIComponent(postId),
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
      ? `https://www.threads.com/@${channel.profile}`
      : 'https://www.threads.com/';
  }
}
