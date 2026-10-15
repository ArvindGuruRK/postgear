/**
 * X (Twitter) — OAuth 2.0 with PKCE, API v2.
 *
 * ## Why PKCE and not OAuth 1.0a
 *
 * The reference implementation uses OAuth 1.0a, which means hand-rolled
 * HMAC-SHA1 request signing and a credential stored as `token:secret`. It works,
 * but its tokens never expire — which would leave `refreshToken()` a permanent
 * no-op for X and leave this sprint's whole token-refresh story untested on the
 * one platform most likely to exercise it.
 *
 * OAuth 2.0 with `offline.access` issues a real refresh token, needs no request
 * signing (so no `twitter-api-v2` dependency), and stores a single opaque
 * string like every other provider here.
 *
 * ## The rotation detail that will bite if forgotten
 *
 * X rotates refresh tokens: every refresh returns a *new* refresh token and
 * invalidates the old one. Persisting the new one is mandatory, not an
 * optimisation — miss it once and the channel is permanently disconnected.
 */

import {
  asCount,
  clampDays,
  dayKey,
  isNotFound,
  type MetricEntry,
  sumByDay,
  todayKey,
  windowStart,
} from '../../abstract/analytics';
import { BadBodyError } from '../../abstract/errors';
import type { HandledError } from '../../abstract/social.abstract';
import { SocialAbstract } from '../../abstract/social.abstract';
import {
  type AuthenticateParams,
  type AuthTokenDetails,
  type ChannelContext,
  type ChannelMetricPoint,
  EMPTY_POST_METRICS,
  type GeneratedAuthUrl,
  type PostDetails,
  type PostMetrics,
  type PostResponse,
  type RedirectUri,
  type SocialAnalytics,
  type SocialProvider,
} from '../../abstract/social.provider.interface';
import { checkAgainstRules } from '../../abstract/validity';
import type { ProviderRules } from '../../composer/rules';

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const REVOKE_URL = 'https://api.x.com/2/oauth2/revoke';
const API_BASE = 'https://api.x.com/2';
const UPLOAD_URL = 'https://api.x.com/2/media/upload';

const STANDARD_MAX_LENGTH = 280;
const PREMIUM_MAX_LENGTH = 25_000;

const MB = 1024 * 1024;

/**
 * What X accepts, per its media upload documentation: up to four images, or
 * one GIF, or one video — never a mix. Images up to 5 MB, animated GIFs up to
 * 15 MB, video up to 512 MB. Every part of a thread can carry its own media,
 * because each part is a real post replying to the one before.
 */
export const X_RULES: ProviderRules = {
  maxLength: STANDARD_MAX_LENGTH,
  lengthMethod: 'x-weighted',
  thread: 'replies',
  followUpMedia: true,
  media: {
    required: false,
    maxItems: 4,
    maxImages: 4,
    maxVideos: 1,
    allowMixed: false,
    gifCountsAsVideo: true,
    maxImageBytes: 5 * MB,
    maxGifBytes: 15 * MB,
    maxVideoBytes: 512 * MB,
  },
};

interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface XUser {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
}

/** The counters X attaches to a post under `tweet.fields=public_metrics`. */
interface XPublicMetrics {
  impression_count?: number;
  like_count?: number;
  reply_count?: number;
  retweet_count?: number;
  quote_count?: number;
  bookmark_count?: number;
}

interface XTweet {
  id: string;
  created_at?: string;
  public_metrics?: XPublicMetrics;
}

/**
 * Pages of the account's timeline read per sync. A hundred posts a page and
 * five pages covers a channel posting several times a day for the whole
 * ninety-day window; past that the oldest days are simply absent, which is
 * what the interface promises for days the platform did not report.
 */
const MAX_TIMELINE_PAGES = 5;

export class XProvider extends SocialAbstract implements SocialProvider, SocialAnalytics {
  readonly identifier = 'x';
  readonly name = 'X';
  readonly usesPkce = true;

  readonly scopes = [
    'tweet.read',
    'tweet.write',
    'users.read',
    'media.write',
    // Without this, X issues no refresh token at all and the channel silently
    // dies at the first token expiry.
    'offline.access',
  ];

  isConfigured(): boolean {
    return Boolean(process.env.X_TWITTER_CLIENT_ID && process.env.X_TWITTER_CLIENT_SECRET);
  }

  maxLength(settings?: Record<string, unknown>): number {
    return this.asBoolean(settings?.premium) ? PREMIUM_MAX_LENGTH : STANDARD_MAX_LENGTH;
  }

  readonly rules = X_RULES;

  override async checkValidity(posts: PostDetails[]): Promise<string | true> {
    return checkAgainstRules(this, posts);
  }

  /**
   * X returns HTTP 200 with an error body in several cases, so status alone
   * misclassifies them. These strings are the ones worth translating — each
   * maps to something the user can actually change.
   */
  protected override handleErrors(body: string): HandledError | undefined {
    if (body.includes('Unsupported Authentication') || body.includes('invalid_request')) {
      return {
        type: 'refresh-token',
        value: 'Your X connection has expired. Please reconnect the channel.',
      };
    }
    if (body.includes('duplicate') || body.includes('You are not allowed to create a Tweet')) {
      return {
        type: 'bad-body',
        value: 'X rejected this as duplicate content. Change the text and try again.',
      };
    }
    if (body.includes('usage-capped')) {
      return {
        type: 'bad-body',
        value: 'This X app has hit its monthly post cap. Posting will resume next cycle.',
      };
    }
    if (body.includes('user-suspended')) {
      return {
        type: 'bad-body',
        value: 'This X account is suspended. Reconnect with a different account.',
      };
    }
    if (body.includes('Service Unavailable') || body.includes('Over capacity')) {
      return { type: 'retry', value: 'X is temporarily unavailable.' };
    }
    return undefined;
  }

  async generateAuthUrl(redirectUri: RedirectUri): Promise<GeneratedAuthUrl> {
    const state = this.generateState();
    const { codeVerifier, codeChallenge } = this.generatePkcePair();

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.X_TWITTER_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      scope: this.scopes.join(' '),
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

    const user = await this.fetchMe(token.access_token);

    return {
      id: user.id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      name: user.name,
      username: user.username,
      picture: user.profile_image_url,
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

    const user = await this.fetchMe(token.access_token);

    return {
      id: user.id,
      accessToken: token.access_token,
      // X rotates refresh tokens. Falling back to the old one would persist a
      // token X has already invalidated.
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      name: user.name,
      username: user.username,
      picture: user.profile_image_url,
    };
  }

  async revoke(accessToken: string): Promise<void> {
    await this.fetch(REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: this.basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: accessToken,
        token_type_hint: 'access_token',
      }).toString(),
    });
  }

  async post(
    channel: ChannelContext,
    accessToken: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];
    // A thread is a chain of replies, so each item needs the id of the one
    // before it — this cannot be parallelised.
    let previousId: string | undefined;

    for (const post of posts) {
      const published = await this.publishOne(channel, accessToken, post, previousId);
      results.push(published);
      previousId = published.postId;
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
    let replyTo = parentPostId;

    for (const post of posts) {
      const published = await this.publishOne(channel, accessToken, post, replyTo);
      results.push(published);
      replyTo = published.postId;
    }

    return results;
  }

  private async publishOne(
    channel: ChannelContext,
    accessToken: string,
    post: PostDetails,
    replyToId?: string,
  ): Promise<PostResponse> {
    const mediaIds = await this.uploadMedia(accessToken, post);

    const body: Record<string, unknown> = { text: post.message };

    if (mediaIds.length > 0) {
      body.media = { media_ids: mediaIds };
    }
    if (replyToId) {
      body.reply = { in_reply_to_tweet_id: replyToId };
    }

    const response = await this.fetchJson<{ data?: { id: string } }>(`${API_BASE}/tweets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.data?.id) {
      throw new BadBodyError('X accepted the request but returned no post id.', this.identifier);
    }

    const handle = channel.profile ?? channel.internalId;

    return {
      id: post.id,
      postId: response.data.id,
      releaseURL: `https://x.com/${handle}/status/${response.data.id}`,
    };
  }

  /**
   * Uploads attachments and returns their media ids.
   *
   * Sprint 4 owns the media library, so `path` is a URL here. Until then this
   * runs only when a caller supplies media explicitly.
   */
  private async uploadMedia(accessToken: string, post: PostDetails): Promise<string[]> {
    const media = post.media ?? [];

    if (media.length === 0) {
      return [];
    }

    const ids: string[] = [];

    for (const item of media) {
      const source = await this.fetch(item.path);
      const blob = await source.blob();

      const form = new FormData();
      form.append('media', blob);
      form.append('media_category', item.type === 'video' ? 'tweet_video' : 'tweet_image');

      const uploaded = await this.fetchJson<{ data?: { id: string }; media_id_string?: string }>(
        UPLOAD_URL,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        },
      );

      const id = uploaded.data?.id ?? uploaded.media_id_string;

      if (!id) {
        throw new BadBodyError('X did not return a media id for an upload.', this.identifier);
      }

      ids.push(id);
    }

    return ids;
  }

  /**
   * Followers today, and the window's posts summed into the day each went
   * out — see `abstract/analytics.ts` for why that is the series X allows.
   * `impressions` is X's own impression count; `engagements` is every
   * interaction it counts: likes, replies, reposts, quotes and bookmarks.
   */
  async channelAnalytics(
    channel: ChannelContext,
    accessToken: string,
    days: number,
  ): Promise<ChannelMetricPoint[]> {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const entries: MetricEntry[] = [];

    const me = await this.fetchJson<{ data?: { public_metrics?: { followers_count?: number } } }>(
      `${API_BASE}/users/me?user.fields=public_metrics`,
      { headers },
    );

    if (me.data?.public_metrics?.followers_count !== undefined) {
      entries.push({
        metric: 'followers',
        date: todayKey(),
        value: asCount(me.data.public_metrics.followers_count),
      });
    }

    const startTime = windowStart(clampDays(days)).toISOString();
    let paginationToken: string | undefined;

    for (let page = 0; page < MAX_TIMELINE_PAGES; page += 1) {
      const params = new URLSearchParams({
        max_results: '100',
        start_time: startTime,
        'tweet.fields': 'public_metrics,created_at',
      });

      if (paginationToken) {
        params.set('pagination_token', paginationToken);
      }

      const timeline = await this.fetchJson<{ data?: XTweet[]; meta?: { next_token?: string } }>(
        `${API_BASE}/users/${encodeURIComponent(channel.internalId)}/tweets?${params.toString()}`,
        { headers },
      );

      for (const tweet of timeline.data ?? []) {
        const date = dayKey(tweet.created_at ?? '');

        if (!date) {
          continue;
        }

        const metrics = this.postMetricsOf(tweet.public_metrics ?? {});
        entries.push(
          { metric: 'impressions', date, value: metrics.impressions },
          { metric: 'likes', date, value: metrics.likes },
          { metric: 'comments', date, value: metrics.comments },
          { metric: 'shares', date, value: metrics.shares },
          {
            metric: 'engagements',
            date,
            value: metrics.likes + metrics.comments + metrics.shares + metrics.saves,
          },
        );
      }

      paginationToken = timeline.meta?.next_token;

      if (!paginationToken) {
        break;
      }
    }

    return sumByDay(entries);
  }

  /**
   * One post's lifetime counters. X answers a deleted post two ways — a 404,
   * or a 200 whose body has `errors` and no `data` — and both mean "gone".
   */
  async postAnalytics(
    _channel: ChannelContext,
    accessToken: string,
    platformPostId: string,
  ): Promise<PostMetrics | null> {
    let response: { data?: { public_metrics?: XPublicMetrics } };

    try {
      response = await this.fetchJson(
        `${API_BASE}/tweets/${encodeURIComponent(platformPostId)}?tweet.fields=public_metrics`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }

    if (!response.data) {
      return null;
    }

    return this.postMetricsOf(response.data.public_metrics ?? {});
  }

  private postMetricsOf(metrics: XPublicMetrics): PostMetrics {
    return {
      ...EMPTY_POST_METRICS,
      impressions: asCount(metrics.impression_count),
      likes: asCount(metrics.like_count),
      comments: asCount(metrics.reply_count),
      shares: asCount(metrics.retweet_count) + asCount(metrics.quote_count),
      saves: asCount(metrics.bookmark_count),
    };
  }

  private async exchange(params: Record<string, string>): Promise<XTokenResponse> {
    return this.fetchJson<XTokenResponse>(TOKEN_URL, {
      method: 'POST',
      headers: {
        // X requires HTTP Basic for confidential clients even though the token
        // request also carries a client_id — sending only one of the two fails
        // with an unhelpful invalid_request.
        Authorization: this.basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.X_TWITTER_CLIENT_ID ?? '',
        ...params,
      }).toString(),
    });
  }

  private async fetchMe(accessToken: string): Promise<XUser> {
    const response = await this.fetchJson<{ data?: XUser }>(
      `${API_BASE}/users/me?user.fields=profile_image_url,username,name`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.data?.id) {
      throw new BadBodyError('X did not return an account profile.', this.identifier);
    }

    return response.data;
  }

  private basicAuthHeader(): string {
    const credentials = `${process.env.X_TWITTER_CLIENT_ID ?? ''}:${process.env.X_TWITTER_CLIENT_SECRET ?? ''}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }
}
