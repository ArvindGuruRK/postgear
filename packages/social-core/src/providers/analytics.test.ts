/**
 * Provider analytics against a mocked `fetch` — no network.
 *
 * What is pinned is the mapping: that each platform's field names land on
 * PostGear's metric names, that per-post counters are summed into the day
 * each post went out, that a deleted post reads as null rather than as a
 * failure, and that a dead token and a missing permission surface as the
 * error classes the worker branches on. The endpoints themselves are
 * asserted by URL so a typo in a path is caught here, not in production.
 */
import {
  clampDays,
  dayKey,
  isNotFound,
  sumByDay,
  todayKey,
  windowStart,
} from '../abstract/analytics';
import { BadBodyError, NotEnoughScopesError, RefreshTokenError } from '../abstract/errors';
import { supportsAnalytics } from '../abstract/social.provider.interface';
import { IntegrationManager } from '../manager/integration.manager';
import { FacebookProvider } from './facebook';
import { InstagramProvider } from './instagram';
import { LinkedInPageProvider, LinkedInProvider } from './linkedin';
import { graphInsightDay } from './meta/meta.graph';
import { PinterestProvider } from './pinterest';
import { TikTokProvider } from './tiktok';
import { XProvider } from './twitter';
import { YouTubeProvider } from './youtube';

const channel = {
  id: 'ch-1',
  internalId: 'acct-1',
  rootInternalId: 'acct-1',
  providerIdentifier: 'x',
  name: 'Acme',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const calledUrl = (index: number): string => String(fetchMock.mock.calls[index][0]);
const calledInit = (index: number): RequestInit => fetchMock.mock.calls[index][1] as RequestInit;

describe('analytics helpers', () => {
  it('keys days in UTC and refuses nonsense', () => {
    expect(dayKey('2026-10-14T23:59:59Z')).toBe('2026-10-14');
    expect(dayKey(Date.UTC(2026, 9, 15, 0, 0, 1))).toBe('2026-10-15');
    expect(dayKey('not a date')).toBe('');
  });

  it('clamps the window and starts it days-1 UTC midnights ago', () => {
    expect(clampDays(0)).toBe(1);
    expect(clampDays(90.9)).toBe(90);
    expect(clampDays(Number.NaN)).toBe(1);
    expect(clampDays(1_000)).toBe(366);

    const now = Date.UTC(2026, 9, 15, 13, 30);
    expect(windowStart(1, now).toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(windowStart(7, now).toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });

  it('sums flows per day, keeps levels, and drops what it cannot place', () => {
    const points = sumByDay([
      { metric: 'likes', date: '2026-10-14', value: 2 },
      { metric: 'likes', date: '2026-10-14', value: 3 },
      { metric: 'likes', date: '2026-10-13', value: 1 },
      { metric: 'followers', date: '2026-10-14', value: 900 },
      { metric: 'likes', date: '', value: 7 },
      { metric: 'bogus' as never, date: '2026-10-14', value: 7 },
      { metric: 'likes', date: '2026-10-14', value: Number.NaN },
    ]);

    expect(points).toEqual([
      { metric: 'likes', date: '2026-10-13', value: 1 },
      { metric: 'followers', date: '2026-10-14', value: 900 },
      { metric: 'likes', date: '2026-10-14', value: 5 },
    ]);
  });

  it('places a Graph bucket closed at Pacific midnight on the day it covers', () => {
    expect(graphInsightDay('2026-10-14T07:00:00+0000')).toBe('2026-10-13');
    expect(graphInsightDay('2026-10-14T08:00:00+0000')).toBe('2026-10-13');
    expect(graphInsightDay('garbage')).toBe('');
  });
});

describe('which providers support analytics', () => {
  it('is every platform with metrics, and not the LinkedIn member provider', () => {
    expect(supportsAnalytics(new LinkedInProvider())).toBe(false);
    expect(supportsAnalytics(new LinkedInPageProvider())).toBe(true);
    expect(supportsAnalytics(new XProvider())).toBe(true);

    const flags = Object.fromEntries(
      new IntegrationManager().list().map((summary) => [summary.identifier, summary.analytics]),
    );

    expect(flags).toEqual({
      x: true,
      linkedin: false,
      'linkedin-page': true,
      facebook: true,
      instagram: true,
      youtube: true,
      tiktok: true,
      pinterest: true,
    });
  });
});

describe('X', () => {
  const provider = new XProvider();

  it('reads followers today and sums the timeline into publish days', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ data: { id: 'acct-1', public_metrics: { followers_count: 1234 } } }),
      )
      .mockResolvedValueOnce(
        json({
          data: [
            {
              id: 't1',
              created_at: '2026-10-14T09:00:00.000Z',
              public_metrics: {
                impression_count: 100,
                like_count: 5,
                reply_count: 1,
                retweet_count: 2,
                quote_count: 1,
                bookmark_count: 1,
              },
            },
            {
              id: 't2',
              created_at: '2026-10-14T18:00:00.000Z',
              public_metrics: { impression_count: 50, like_count: 1 },
            },
            {
              id: 't3',
              created_at: '2026-10-12T18:00:00.000Z',
              public_metrics: { impression_count: 10 },
            },
          ],
          meta: { result_count: 3 },
        }),
      );

    const points = await provider.channelAnalytics(channel, 'token', 30);

    expect(calledUrl(0)).toBe('https://api.x.com/2/users/me?user.fields=public_metrics');
    expect(calledUrl(1)).toContain('https://api.x.com/2/users/acct-1/tweets?max_results=100');
    expect(calledUrl(1)).toContain('tweet.fields=public_metrics%2Ccreated_at');
    expect((calledInit(1).headers as Record<string, string>).Authorization).toBe('Bearer token');

    expect(points).toContainEqual({ metric: 'followers', date: todayKey(), value: 1234 });
    expect(points).toContainEqual({ metric: 'impressions', date: '2026-10-14', value: 150 });
    expect(points).toContainEqual({ metric: 'likes', date: '2026-10-14', value: 6 });
    expect(points).toContainEqual({ metric: 'comments', date: '2026-10-14', value: 1 });
    expect(points).toContainEqual({ metric: 'shares', date: '2026-10-14', value: 3 });
    // likes 6 + replies 1 + reposts/quotes 3 + bookmarks 1
    expect(points).toContainEqual({ metric: 'engagements', date: '2026-10-14', value: 11 });
    expect(points).toContainEqual({ metric: 'impressions', date: '2026-10-12', value: 10 });
  });

  it('follows pagination tokens and stops when there are none', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: { id: 'acct-1', public_metrics: {} } }))
      .mockResolvedValueOnce(
        json({
          data: [
            { id: 'a', created_at: '2026-10-10T00:00:00Z', public_metrics: { like_count: 1 } },
          ],
          meta: { next_token: 'page-2' },
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: [
            { id: 'b', created_at: '2026-10-10T00:00:00Z', public_metrics: { like_count: 2 } },
          ],
          meta: {},
        }),
      );

    const points = await provider.channelAnalytics(channel, 'token', 30);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calledUrl(2)).toContain('pagination_token=page-2');
    expect(points).toContainEqual({ metric: 'likes', date: '2026-10-10', value: 3 });
    expect(points.find((point) => point.metric === 'followers')).toBeUndefined();
  });

  it('an empty timeline is an empty day, not an error', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: { id: 'acct-1' } }))
      .mockResolvedValueOnce(json({ meta: { result_count: 0 } }));

    await expect(provider.channelAnalytics(channel, 'token', 7)).resolves.toEqual([]);
  });

  it('maps a post’s public metrics, and a deleted post to null either way X says it', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: {
          id: 't1',
          public_metrics: {
            impression_count: 400,
            like_count: 12,
            reply_count: 3,
            retweet_count: 4,
            quote_count: 1,
            bookmark_count: 2,
          },
        },
      }),
    );

    await expect(provider.postAnalytics(channel, 'token', 't1')).resolves.toEqual({
      impressions: 400,
      likes: 12,
      comments: 3,
      shares: 5,
      saves: 2,
      clicks: 0,
      views: 0,
    });
    expect(calledUrl(0)).toBe('https://api.x.com/2/tweets/t1?tweet.fields=public_metrics');

    fetchMock.mockResolvedValueOnce(json({ errors: [{ title: 'Not Found Error' }] }));
    await expect(provider.postAnalytics(channel, 'token', 'gone')).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(json({ title: 'Not Found' }, 404));
    await expect(provider.postAnalytics(channel, 'token', 'gone')).resolves.toBeNull();
  });

  it('classifies a dead token and a missing permission', async () => {
    fetchMock.mockResolvedValueOnce(json({ title: 'Unauthorized' }, 401));
    await expect(provider.channelAnalytics(channel, 'token', 7)).rejects.toBeInstanceOf(
      RefreshTokenError,
    );

    fetchMock.mockResolvedValueOnce(json({ title: 'Forbidden' }, 403));
    await expect(provider.postAnalytics(channel, 'token', 't1')).rejects.toBeInstanceOf(
      NotEnoughScopesError,
    );

    const refused = new BadBodyError('no', 'x', '', 400);
    expect(isNotFound(refused)).toBe(false);
    expect(isNotFound(new BadBodyError('no', 'x', '', 404))).toBe(true);
  });
});

describe('LinkedIn page', () => {
  const provider = new LinkedInPageProvider();
  const page = { ...channel, providerIdentifier: 'linkedin-page', internalId: '777' };

  it('reads the follower level and the daily share statistics with the versioned headers', async () => {
    const day = Date.UTC(2026, 9, 13);
    fetchMock.mockResolvedValueOnce(json({ firstDegreeSize: 5120 })).mockResolvedValueOnce(
      json({
        elements: [
          {
            timeRange: { start: day, end: day + 86_400_000 },
            totalShareStatistics: {
              impressionCount: 900,
              uniqueImpressionsCount: 700,
              clickCount: 20,
              likeCount: 30,
              commentCount: 4,
              shareCount: 6,
              engagement: 0.066,
            },
          },
          { timeRange: { start: day + 86_400_000 } },
        ],
      }),
    );

    const points = await provider.channelAnalytics(page, 'token', 30);

    expect(calledUrl(0)).toBe(
      'https://api.linkedin.com/rest/networkSizes/urn%3Ali%3Aorganization%3A777?edgeType=CompanyFollowedByMember',
    );
    expect(calledUrl(1)).toContain(
      'https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A777&timeIntervals=(timeRange:(start:',
    );
    expect(calledUrl(1)).toContain('timeGranularityType:DAY)');

    const headers = calledInit(1).headers as Record<string, string>;
    expect(headers['LinkedIn-Version']).toBe('202601');
    expect(headers['X-Restli-Protocol-Version']).toBe('2.0.0');

    expect(points).toContainEqual({ metric: 'followers', date: todayKey(), value: 5120 });
    expect(points).toContainEqual({ metric: 'impressions', date: '2026-10-13', value: 900 });
    expect(points).toContainEqual({ metric: 'reach', date: '2026-10-13', value: 700 });
    expect(points).toContainEqual({ metric: 'clicks', date: '2026-10-13', value: 20 });
    expect(points).toContainEqual({ metric: 'likes', date: '2026-10-13', value: 30 });
    expect(points).toContainEqual({ metric: 'comments', date: '2026-10-13', value: 4 });
    expect(points).toContainEqual({ metric: 'shares', date: '2026-10-13', value: 6 });
    // The ratio LinkedIn calls `engagement` is not a count; the numerator is.
    expect(points).toContainEqual({ metric: 'engagements', date: '2026-10-13', value: 60 });
    expect(points.filter((point) => point.date === '2026-10-14')).toEqual([]);
  });

  it('reads a post’s social actions, encoding the URN, and maps a missing post to null', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        likesSummary: { totalLikes: 41 },
        commentsSummary: { totalFirstLevelComments: 3, aggregatedTotalComments: 5 },
      }),
    );

    await expect(provider.postAnalytics(page, 'token', 'urn:li:share:123')).resolves.toMatchObject({
      likes: 41,
      comments: 5,
      shares: 0,
    });
    expect(calledUrl(0)).toBe('https://api.linkedin.com/rest/socialActions/urn%3Ali%3Ashare%3A123');

    fetchMock.mockResolvedValueOnce(json({ message: 'Not found' }, 404));
    await expect(provider.postAnalytics(page, 'token', 'urn:li:share:0')).resolves.toBeNull();
  });

  it('turns a revoked token into RefreshTokenError', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ serviceErrorCode: 65601, message: 'REVOKED_ACCESS_TOKEN' }, 401),
    );
    await expect(provider.channelAnalytics(page, 'token', 7)).rejects.toBeInstanceOf(
      RefreshTokenError,
    );
  });
});

describe('Facebook', () => {
  const provider = new FacebookProvider();
  const fbPage = { ...channel, providerIdentifier: 'facebook', internalId: 'page-9' };

  it('reads page insights from Graph v23 and dates each bucket by the day it closed', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          {
            name: 'page_follows',
            period: 'day',
            values: [
              { value: 300, end_time: '2026-10-13T07:00:00+0000' },
              { value: 302, end_time: '2026-10-14T07:00:00+0000' },
            ],
          },
          {
            name: 'page_post_engagements',
            period: 'day',
            values: [{ value: 18, end_time: '2026-10-14T07:00:00+0000' }],
          },
          {
            name: 'page_total_media_view_unique',
            period: 'day',
            values: [{ value: 410, end_time: '2026-10-14T07:00:00+0000' }],
          },
          {
            name: 'page_media_view',
            period: 'day',
            values: [{ value: 560, end_time: '2026-10-14T07:00:00+0000' }],
          },
          {
            name: 'something_new',
            period: 'day',
            values: [{ value: 1, end_time: '2026-10-14T07:00:00+0000' }],
          },
        ],
      }),
    );

    const points = await provider.channelAnalytics(fbPage, 'page-token', 30);

    const url = new URL(calledUrl(0));
    expect(url.origin + url.pathname).toBe('https://graph.facebook.com/v23.0/page-9/insights');
    expect(url.searchParams.get('metric')).toBe(
      'page_follows,page_post_engagements,page_total_media_view_unique,page_media_view',
    );
    expect(url.searchParams.get('period')).toBe('day');
    expect(url.searchParams.get('access_token')).toBe('page-token');
    expect(Number(url.searchParams.get('since'))).toBeLessThan(
      Number(url.searchParams.get('until')),
    );

    expect(points).toEqual([
      { metric: 'followers', date: '2026-10-12', value: 300 },
      { metric: 'engagements', date: '2026-10-13', value: 18 },
      { metric: 'followers', date: '2026-10-13', value: 302 },
      { metric: 'impressions', date: '2026-10-13', value: 560 },
      { metric: 'reach', date: '2026-10-13', value: 410 },
    ]);
  });

  it('reads one post’s likes, comments, shares and impressions, and a removed post as null', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        id: 'page-9_1',
        likes: { data: [], summary: { total_count: 9 } },
        comments: { data: [], summary: { total_count: 2 } },
        shares: { count: 1 },
        insights: { data: [{ name: 'post_impressions', values: [{ value: 250 }] }] },
      }),
    );

    await expect(provider.postAnalytics(fbPage, 'page-token', 'page-9_1')).resolves.toEqual({
      likes: 9,
      comments: 2,
      shares: 1,
      impressions: 250,
      clicks: 0,
      saves: 0,
      views: 0,
    });
    const url = new URL(calledUrl(0));
    expect(url.pathname).toBe('/v23.0/page-9_1');
    expect(url.searchParams.get('fields')).toBe(
      'likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions)',
    );

    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: {
            message: 'Unsupported get request. Object with ID "x" does not exist',
            type: 'GraphMethodException',
            code: 100,
          },
        },
        400,
      ),
    );
    await expect(provider.postAnalytics(fbPage, 'page-token', 'x')).resolves.toBeNull();
  });

  it('maps an expired session to RefreshTokenError', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { message: 'Error validating access token: Session has expired' } }, 400),
    );
    await expect(provider.channelAnalytics(fbPage, 'page-token', 7)).rejects.toBeInstanceOf(
      RefreshTokenError,
    );
  });
});

describe('Instagram', () => {
  const provider = new InstagramProvider();
  const account = { ...channel, providerIdentifier: 'instagram', internalId: 'ig-5' };

  it('reads the level, daily reach, and the last three days’ interaction totals', async () => {
    const totals = (likes: number) =>
      json({
        data: [
          { name: 'likes', total_value: { value: likes } },
          { name: 'comments', total_value: { value: 2 } },
          { name: 'shares', total_value: { value: 1 } },
          { name: 'saves', total_value: { value: 4 } },
          { name: 'views', total_value: { value: 90 } },
        ],
      });

    fetchMock
      .mockResolvedValueOnce(json({ followers_count: 880 }))
      .mockResolvedValueOnce(
        json({
          data: [
            {
              name: 'reach',
              period: 'day',
              values: [{ value: 70, end_time: '2026-10-14T07:00:00+0000' }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(totals(10))
      .mockResolvedValueOnce(totals(20))
      .mockResolvedValueOnce(totals(30));

    const points = await provider.channelAnalytics(account, 'page-token', 30);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(new URL(calledUrl(0)).searchParams.get('fields')).toBe('followers_count');
    expect(new URL(calledUrl(1)).searchParams.get('metric')).toBe('reach');
    const totalsUrl = new URL(calledUrl(2));
    expect(totalsUrl.searchParams.get('metric_type')).toBe('total_value');
    expect(totalsUrl.searchParams.get('metric')).toBe('likes,comments,shares,saves,views');

    const today = todayKey();
    expect(points).toContainEqual({ metric: 'followers', date: today, value: 880 });
    expect(points).toContainEqual({ metric: 'reach', date: '2026-10-13', value: 70 });
    expect(points).toContainEqual({ metric: 'likes', date: today, value: 10 });
    expect(points).toContainEqual({ metric: 'views', date: today, value: 90 });
    // likes 10 + comments 2 + shares 1 + saves 4
    expect(points).toContainEqual({ metric: 'engagements', date: today, value: 17 });
    expect(points.filter((point) => point.metric === 'likes')).toHaveLength(3);
  });

  it('reads media insights with reach standing in for impressions', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          { name: 'likes', values: [{ value: 15 }] },
          { name: 'comments', values: [{ value: 3 }] },
          { name: 'shares', values: [{ value: 2 }] },
          { name: 'saved', values: [{ value: 6 }] },
          { name: 'views', values: [{ value: 300 }] },
          { name: 'reach', values: [{ value: 240 }] },
        ],
      }),
    );

    await expect(provider.postAnalytics(account, 'page-token', 'media-1')).resolves.toEqual({
      likes: 15,
      comments: 3,
      shares: 2,
      saves: 6,
      views: 300,
      impressions: 240,
      clicks: 0,
    });
    expect(new URL(calledUrl(0)).pathname).toBe('/v21.0/media-1/insights');
  });
});

describe('YouTube', () => {
  const provider = new YouTubeProvider();
  const yt = { ...channel, providerIdentifier: 'youtube', internalId: 'UC123' };

  it('reads subscribers and sums the window’s uploads by publish day, stopping at the window start', async () => {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const recentDay = recent.slice(0, 10);

    fetchMock
      .mockResolvedValueOnce(
        json({
          items: [
            {
              id: 'UC123',
              statistics: { subscriberCount: '4200', viewCount: '999999' },
              contentDetails: { relatedPlaylists: { uploads: 'UU123' } },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          items: [
            { contentDetails: { videoId: 'v1', videoPublishedAt: recent } },
            { contentDetails: { videoId: 'v2', videoPublishedAt: recent } },
            { contentDetails: { videoId: 'old', videoPublishedAt: '2020-01-01T00:00:00Z' } },
          ],
          nextPageToken: 'more',
        }),
      )
      .mockResolvedValueOnce(
        json({
          items: [
            {
              id: 'v1',
              snippet: { publishedAt: recent },
              statistics: { viewCount: '100', likeCount: '7', commentCount: '2' },
            },
            {
              id: 'v2',
              snippet: { publishedAt: recent },
              statistics: { viewCount: '50', likeCount: '3' },
            },
          ],
        }),
      );

    const points = await provider.channelAnalytics(yt, 'token', 30);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calledUrl(0)).toBe(
      'https://www.googleapis.com/youtube/v3/channels?part=statistics,contentDetails&id=UC123',
    );
    expect(calledUrl(1)).toContain(
      '/youtube/v3/playlistItems?part=contentDetails&playlistId=UU123',
    );
    expect(calledUrl(2)).toBe(
      'https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=v1,v2',
    );

    expect(points).toContainEqual({ metric: 'followers', date: todayKey(), value: 4200 });
    expect(points).toContainEqual({ metric: 'views', date: recentDay, value: 150 });
    expect(points).toContainEqual({ metric: 'likes', date: recentDay, value: 10 });
    expect(points).toContainEqual({ metric: 'comments', date: recentDay, value: 2 });
    expect(points).toContainEqual({ metric: 'engagements', date: recentDay, value: 12 });
  });

  it('reads a video’s statistics as numbers, and an unlisted id as null', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        items: [
          { id: 'v9', statistics: { viewCount: '1200', likeCount: '40', commentCount: '5' } },
        ],
      }),
    );
    await expect(provider.postAnalytics(yt, 'token', 'v9')).resolves.toMatchObject({
      views: 1200,
      likes: 40,
      comments: 5,
    });
    expect(calledUrl(0)).toBe('https://www.googleapis.com/youtube/v3/videos?part=statistics&id=v9');

    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    await expect(provider.postAnalytics(yt, 'token', 'gone')).resolves.toBeNull();
  });

  it('maps Google’s invalid credentials to RefreshTokenError', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 401, message: 'Invalid Credentials' } }, 401),
    );
    await expect(provider.channelAnalytics(yt, 'token', 7)).rejects.toBeInstanceOf(
      RefreshTokenError,
    );
  });
});

describe('Pinterest and TikTok', () => {
  it('Pinterest reads the account level and daily metrics, saves counting as shares', async () => {
    fetchMock.mockResolvedValueOnce(json({ follower_count: 150 })).mockResolvedValueOnce(
      json({
        all: {
          daily_metrics: [
            {
              date: '2026-10-13',
              data_status: 'READY',
              metrics: { IMPRESSION: 500, ENGAGEMENT: 25, PIN_CLICK: 10, SAVE: 4 },
            },
            { date: '2026-10-14', data_status: 'PROCESSING' },
          ],
        },
      }),
    );

    const points = await new PinterestProvider().channelAnalytics(channel, 'token', 30);

    expect(new URL(calledUrl(1)).searchParams.get('metric_types')).toBe(
      'IMPRESSION,ENGAGEMENT,PIN_CLICK,SAVE',
    );
    expect(points).toEqual([
      { metric: 'clicks', date: '2026-10-13', value: 10 },
      { metric: 'engagements', date: '2026-10-13', value: 25 },
      { metric: 'impressions', date: '2026-10-13', value: 500 },
      { metric: 'shares', date: '2026-10-13', value: 4 },
      { metric: 'followers', date: todayKey(), value: 150 },
    ]);
  });

  it('Pinterest reads a Pin’s lifetime metrics', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        all: { lifetime_metrics: { IMPRESSION: 80, PIN_CLICK: 3, OUTBOUND_CLICK: 2, SAVE: 5 } },
      }),
    );

    await expect(
      new PinterestProvider().postAnalytics(channel, 'token', 'pin-1'),
    ).resolves.toMatchObject({ impressions: 80, clicks: 5, saves: 5 });
    expect(new URL(calledUrl(0)).pathname).toBe('/v5/pins/pin-1/analytics');
  });

  it('TikTok records the follower level only, and reads a video by id', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ data: { user: { follower_count: 2000, likes_count: 99_999 } } }),
    );

    await expect(new TikTokProvider().channelAnalytics(channel, 'token', 30)).resolves.toEqual([
      { metric: 'followers', date: todayKey(), value: 2000 },
    ]);

    fetchMock.mockResolvedValueOnce(
      json({
        data: {
          videos: [
            { id: 'vid', like_count: 10, comment_count: 1, share_count: 2, view_count: 500 },
          ],
        },
      }),
    );
    await expect(
      new TikTokProvider().postAnalytics(channel, 'token', 'vid'),
    ).resolves.toMatchObject({
      likes: 10,
      comments: 1,
      shares: 2,
      views: 500,
    });
    expect(calledInit(1).method).toBe('POST');
    expect(JSON.parse(String(calledInit(1).body))).toEqual({ filters: { video_ids: ['vid'] } });

    fetchMock.mockResolvedValueOnce(json({ data: { videos: [] } }));
    await expect(new TikTokProvider().postAnalytics(channel, 'token', 'gone')).resolves.toBeNull();
  });
});
