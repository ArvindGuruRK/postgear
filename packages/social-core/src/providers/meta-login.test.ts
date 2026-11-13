/**
 * Instagram on its own and Threads, with `fetch` mocked: no network.
 *
 * Both sit on `meta/meta.login.ts`, so the parts they share (the two-step
 * token exchange, the token that renews itself, the container wait, the error
 * classes) are pinned once per provider here, next to what is each one's own:
 * what a container is made of, how a multi-part post goes out, and which
 * insight lands on which PostGear metric.
 */
import {
  BadBodyError,
  NotEnoughScopesError,
  RefreshTokenError,
  RetryableError,
} from '../abstract/errors';
import type { ChannelContext, PostDetails } from '../abstract/social.provider.interface';
import { validatePost } from '../composer/validate';
import { IntegrationManager } from '../manager/integration.manager';
import { InstagramProvider } from './instagram';
import { InstagramStandaloneProvider } from './instagram-standalone';
import { parseKeepingIds } from './meta/meta.login';
import { ThreadsProvider } from './threads';

const REDIRECT = 'https://tunnel.example/channels/connect/threads/callback';

function json(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Call {
  method: string;
  url: URL;
  /** The form body of a POST; empty for a GET. */
  form: URLSearchParams;
}

let calls: Call[];
let fetchMock: jest.Mock;

/**
 * Answers each request with whatever `respond` returns for it, and records
 * the request. A fresh Response per call, because a body can be read once.
 */
function answer(respond: (call: Call) => unknown): void {
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: new URL(input),
      form: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    };
    calls.push(call);

    const body = respond(call);
    return body instanceof Response ? body : json(body);
  });
}

const posts = (method: string) => calls.filter((call) => call.method === method);
const pathOf = (call: Call) => call.url.pathname;

beforeEach(() => {
  calls = [];
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  process.env.FACEBOOK_APP_ID = 'fb-id';
  process.env.FACEBOOK_APP_SECRET = 'fb-secret';
  process.env.INSTAGRAM_APP_ID = 'ig-id';
  process.env.INSTAGRAM_APP_SECRET = 'ig-secret';
  process.env.THREADS_APP_ID = 'th-id';
  process.env.THREADS_APP_SECRET = 'th-secret';
});

const instagramChannel: ChannelContext = {
  id: 'ch-ig',
  internalId: '17841405793187218',
  rootInternalId: '17841405793187218',
  providerIdentifier: 'instagram-standalone',
  name: 'Bloom Bakery',
  profile: 'bloombakery',
};

const threadsChannel: ChannelContext = {
  id: 'ch-th',
  internalId: '2468',
  rootInternalId: '2468',
  providerIdentifier: 'threads',
  name: 'Bloom Bakery',
  profile: 'bloombakery',
};

const image = (path: string, alt?: string) => ({ type: 'image' as const, path, alt });
const video = (path: string) => ({ type: 'video' as const, path });

describe('registration', () => {
  it('lists Instagram on its own, Instagram through a Page, and Threads as three tiles', () => {
    const names = Object.fromEntries(
      new IntegrationManager().list().map((summary) => [summary.identifier, summary.name]),
    );

    expect(names['instagram-standalone']).toBe('Instagram');
    expect(names.instagram).toBe('Instagram Via Facebook Page');
    expect(names.threads).toBe('Threads');
  });

  it('keeps the Page-based provider on the id its connected channels are stored under', () => {
    expect(new InstagramProvider().identifier).toBe('instagram');
  });

  it('connects both new providers in one hop, with metrics', () => {
    const summaries = new IntegrationManager().list();

    for (const identifier of ['instagram-standalone', 'threads']) {
      const summary = summaries.find((entry) => entry.identifier === identifier);

      expect(summary?.requiresEntitySelection).toBe(false);
      expect(summary?.analytics).toBe(true);
      expect(summary?.configured).toBe(true);
    }
  });

  it('reads each product’s own keys, not the Facebook app’s', () => {
    process.env.INSTAGRAM_APP_ID = '';
    process.env.THREADS_APP_SECRET = '';

    expect(new InstagramStandaloneProvider().isConfigured()).toBe(false);
    expect(new ThreadsProvider().isConfigured()).toBe(false);
    expect(new InstagramProvider().isConfigured()).toBe(true);
  });
});

describe('authorization URLs', () => {
  it('Instagram signs in on instagram.com with the business scopes', async () => {
    const { url, state, codeVerifier } = await new InstagramStandaloneProvider().generateAuthUrl(
      REDIRECT,
    );
    const parsed = new URL(url);

    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://www.instagram.com/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('ig-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toBe(state);
    expect(parsed.searchParams.get('scope')?.split(',')).toEqual([
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_comments',
      'instagram_business_manage_insights',
    ]);
    expect(codeVerifier).toBe('');
  });

  it('Threads signs in on threads.com and asks to reply, which is what a thread is made of', async () => {
    const { url } = await new ThreadsProvider().generateAuthUrl(REDIRECT);
    const parsed = new URL(url);

    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://threads.com/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('th-id');
    expect(parsed.searchParams.get('scope')?.split(',')).toEqual([
      'threads_basic',
      'threads_content_publish',
      'threads_manage_replies',
      'threads_manage_insights',
    ]);
  });
});

describe('token exchange', () => {
  it('keeps every digit of an account id too long for a JavaScript number', () => {
    expect(parseKeepingIds<{ user_id: string }>('{"user_id": 17841405793187218}').user_id).toBe(
      '17841405793187218',
    );
    expect(parseKeepingIds<{ id: string }>('{"id":"17841405793187218"}').id).toBe(
      '17841405793187218',
    );
    expect(parseKeepingIds<{ count: number }>('{"count": 12}').count).toBe(12);
  });

  it('Instagram upgrades the one-hour token and stores it as its own refresh token', async () => {
    answer((call) => {
      if (call.url.host === 'api.instagram.com') {
        // Raw text: the id is a bare number, as Meta sends it.
        return json(
          '{"access_token":"short","user_id":17841405793187218,"permissions":"instagram_business_basic,instagram_business_content_publish"}',
        );
      }
      if (pathOf(call) === '/access_token') {
        return { access_token: 'long', token_type: 'bearer', expires_in: 5_183_944 };
      }
      return {
        user_id: '17841405793187218',
        username: 'bloombakery',
        name: 'Bloom Bakery',
        profile_picture_url: 'https://cdn.example/p.jpg',
      };
    });

    const details = await new InstagramStandaloneProvider().authenticate({
      code: 'code-1#_',
      codeVerifier: '',
      redirectUri: REDIRECT,
    });

    const [exchange, upgrade, profile] = calls;

    expect(exchange.method).toBe('POST');
    expect(exchange.url.href).toBe('https://api.instagram.com/oauth/access_token');
    expect(Object.fromEntries(exchange.form)).toEqual({
      client_id: 'ig-id',
      client_secret: 'ig-secret',
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT,
      // Meta's trailing `#_` is not part of the code.
      code: 'code-1',
    });

    expect(upgrade.url.origin).toBe('https://graph.instagram.com');
    expect(upgrade.url.searchParams.get('grant_type')).toBe('ig_exchange_token');
    expect(upgrade.url.searchParams.get('client_secret')).toBe('ig-secret');
    expect(upgrade.url.searchParams.get('access_token')).toBe('short');

    expect(pathOf(profile)).toBe('/v27.0/me');
    expect(profile.url.searchParams.get('access_token')).toBe('long');

    expect(details).toEqual({
      id: '17841405793187218',
      accessToken: 'long',
      refreshToken: 'long',
      expiresIn: 5_183_944,
      name: 'Bloom Bakery',
      username: 'bloombakery',
      picture: 'https://cdn.example/p.jpg',
    });
  });

  it('Instagram also reads the token from the documented `data` wrapper', async () => {
    answer((call) => {
      if (call.url.host === 'api.instagram.com') {
        return {
          data: [
            {
              access_token: 'short',
              user_id: '99',
              permissions: ['instagram_business_basic', 'instagram_business_content_publish'],
            },
          ],
        };
      }
      if (pathOf(call) === '/access_token') {
        return { access_token: 'long', expires_in: 100 };
      }
      return { user_id: '99', username: 'bloom' };
    });

    const details = await new InstagramStandaloneProvider().authenticate({
      code: 'c',
      codeVerifier: '',
      redirectUri: REDIRECT,
    });

    expect(details).toMatchObject({ id: '99', accessToken: 'long', name: 'bloom' });
  });

  it('Threads exchanges on graph.threads.com and reads the profile', async () => {
    answer((call) => {
      if (pathOf(call) === '/oauth/access_token') {
        return { access_token: 'short', token_type: 'bearer', user_id: 2468 };
      }
      if (pathOf(call) === '/access_token') {
        return { access_token: 'long', token_type: 'bearer', expires_in: 5_183_944 };
      }
      return {
        id: '2468',
        username: 'bloombakery',
        name: 'Bloom Bakery',
        threads_profile_picture_url: 'https://cdn.example/t.jpg',
      };
    });

    const details = await new ThreadsProvider().authenticate({
      code: 'code-2',
      codeVerifier: '',
      redirectUri: REDIRECT,
    });

    const [exchange, upgrade, profile] = calls;

    expect(exchange.url.href).toBe('https://graph.threads.com/oauth/access_token');
    expect(exchange.form.get('client_id')).toBe('th-id');
    expect(exchange.form.get('client_secret')).toBe('th-secret');
    expect(upgrade.url.searchParams.get('grant_type')).toBe('th_exchange_token');
    expect(pathOf(profile)).toBe('/v1.0/me');

    expect(details).toEqual({
      id: '2468',
      accessToken: 'long',
      refreshToken: 'long',
      expiresIn: 5_183_944,
      name: 'Bloom Bakery',
      username: 'bloombakery',
      picture: 'https://cdn.example/t.jpg',
    });
  });

  it('refuses a sign-in where publishing was unticked on the consent screen', async () => {
    answer(() => ({
      access_token: 'short',
      user_id: '1',
      permissions: ['instagram_business_basic'],
    }));

    await expect(
      new InstagramStandaloneProvider().authenticate({
        code: 'c',
        codeVerifier: '',
        redirectUri: REDIRECT,
      }),
    ).rejects.toBeInstanceOf(NotEnoughScopesError);
    // Stopped before the upgrade: nothing worth storing.
    expect(calls).toHaveLength(1);
  });

  it('never stores the one-hour token when the upgrade comes back empty', async () => {
    answer((call) => (pathOf(call) === '/oauth/access_token' ? { access_token: 'short' } : {}));

    await expect(
      new ThreadsProvider().authenticate({ code: 'c', codeVerifier: '', redirectUri: REDIRECT }),
    ).rejects.toBeInstanceOf(BadBodyError);
  });
});

describe('token refresh', () => {
  it('Instagram renews the long-lived token with itself', async () => {
    answer(() => ({ access_token: 'renewed', token_type: 'bearer', expires_in: 5_184_000 }));

    const refreshed = await new InstagramStandaloneProvider().refreshToken('long');

    expect(calls[0].url.origin).toBe('https://graph.instagram.com');
    expect(pathOf(calls[0])).toBe('/refresh_access_token');
    expect(calls[0].url.searchParams.get('grant_type')).toBe('ig_refresh_token');
    expect(calls[0].url.searchParams.get('access_token')).toBe('long');
    // The new token is the next refresh's credential too.
    expect(refreshed).toMatchObject({
      accessToken: 'renewed',
      refreshToken: 'renewed',
      expiresIn: 5_184_000,
    });
  });

  it('Threads renews the long-lived token with itself', async () => {
    answer(() => ({ access_token: 'renewed', expires_in: 5_184_000 }));

    const refreshed = await new ThreadsProvider().refreshToken('long');

    expect(calls[0].url.origin).toBe('https://graph.threads.com');
    expect(calls[0].url.searchParams.get('grant_type')).toBe('th_refresh_token');
    expect(refreshed).toMatchObject({ accessToken: 'renewed', refreshToken: 'renewed' });
  });

  it('reports "cannot refresh" with an empty token when there is nothing to renew', async () => {
    const refreshed = await new ThreadsProvider().refreshToken('');

    expect(refreshed.accessToken).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('raises RefreshTokenError when Meta says the token is already dead', async () => {
    answer(() =>
      json({ error: { message: 'Session has expired', type: 'OAuthException', code: 190 } }, 400),
    );

    await expect(new InstagramStandaloneProvider().refreshToken('dead')).rejects.toBeInstanceOf(
      RefreshTokenError,
    );
  });
});

describe('validation', () => {
  const check = (provider: InstagramStandaloneProvider | ThreadsProvider, list: PostDetails[]) =>
    provider.checkValidity(list);

  it('Instagram refuses a text-only post and a PNG', async () => {
    const instagram = new InstagramStandaloneProvider();

    expect(await check(instagram, [{ id: '1', message: 'Hello' }])).not.toBe(true);
    expect(
      await check(instagram, [
        {
          id: '1',
          message: 'Hello',
          media: [{ type: 'image', path: 'https://m/x.png', mimeType: 'image/png' }],
        },
      ]),
    ).not.toBe(true);
    expect(
      await check(instagram, [
        {
          id: '1',
          message: 'Hello',
          media: [{ type: 'image', path: 'https://m/x.jpg', mimeType: 'image/jpeg' }],
        },
      ]),
    ).toBe(true);
  });

  it('Threads allows text alone, and media on every part of a thread', async () => {
    const threads = new ThreadsProvider();

    expect(await check(threads, [{ id: '1', message: 'Hello' }])).toBe(true);
    expect(
      await check(threads, [
        { id: '1', message: 'One', media: [image('https://m/a.jpg')] },
        { id: '2', message: 'Two', media: [image('https://m/b.jpg')] },
      ]),
    ).toBe(true);
  });

  it('Threads holds a post to 500, counting an emoji as its bytes', async () => {
    const threads = new ThreadsProvider();

    expect(await check(threads, [{ id: '1', message: 'a'.repeat(500) }])).toBe(true);
    expect(await check(threads, [{ id: '1', message: 'a'.repeat(501) }])).not.toBe(true);
    // 497 letters and one emoji is 498 characters to the eye, 501 to Threads.
    expect(await check(threads, [{ id: '1', message: `${'a'.repeat(497)}😀` }])).not.toBe(true);
  });

  it('says the same thing in the composer as at publish time', async () => {
    for (const provider of [new InstagramStandaloneProvider(), new ThreadsProvider()]) {
      const tooLong = 'a'.repeat(provider.rules.maxLength + 1);
      const [issue] = validatePost(provider.rules, [{ text: tooLong, media: [] }], {
        providerName: provider.name,
      });

      expect(await provider.checkValidity([{ id: '1', message: tooLong }])).toBe(issue.message);
    }
  });
});

describe('Instagram publishing', () => {
  const provider = new InstagramStandaloneProvider();

  /** Containers get ids c1, c2, ...; everything is ready at once. */
  function instagramApi(): void {
    let containers = 0;

    answer((call) => {
      if (call.method === 'POST' && pathOf(call).endsWith('/media')) {
        containers += 1;
        return { id: `c${containers}` };
      }
      if (call.method === 'POST' && pathOf(call).endsWith('/media_publish')) {
        return { id: 'media-1' };
      }
      if (call.method === 'POST' && pathOf(call).endsWith('/comments')) {
        return { id: `comment-${posts('POST').length}` };
      }
      if (call.url.searchParams.get('fields') === 'permalink') {
        return { permalink: 'https://www.instagram.com/p/Cx1/' };
      }
      return { status_code: 'FINISHED' };
    });
  }

  it('publishes one image: container, wait, publish, permalink', async () => {
    instagramApi();

    const [result] = await provider.post(instagramChannel, 'token', [
      { id: 'p1', message: 'Fresh bread', media: [image('https://m/a.jpg', 'A loaf')] },
    ]);

    const [container, status, publish, permalink] = calls;

    expect(container.url.href).toBe('https://graph.instagram.com/v27.0/17841405793187218/media');
    expect(Object.fromEntries(container.form)).toEqual({
      access_token: 'token',
      image_url: 'https://m/a.jpg',
      alt_text: 'A loaf',
      caption: 'Fresh bread',
    });
    expect(pathOf(status)).toBe('/v27.0/c1');
    expect(pathOf(publish)).toBe('/v27.0/17841405793187218/media_publish');
    expect(publish.form.get('creation_id')).toBe('c1');
    expect(pathOf(permalink)).toBe('/v27.0/media-1');

    expect(result).toEqual({
      id: 'p1',
      postId: 'media-1',
      releaseURL: 'https://www.instagram.com/p/Cx1/',
    });
  });

  it('publishes one video as a Reel', async () => {
    instagramApi();

    await provider.post(instagramChannel, 'token', [
      { id: 'p1', message: 'Kneading', media: [video('https://m/a.mp4')] },
    ]);

    expect(Object.fromEntries(calls[0].form)).toEqual({
      access_token: 'token',
      media_type: 'REELS',
      video_url: 'https://m/a.mp4',
      caption: 'Kneading',
    });
  });

  it('publishes a carousel in the order given, with the caption on the parent only', async () => {
    instagramApi();

    await provider.post(instagramChannel, 'token', [
      {
        id: 'p1',
        message: 'Three things',
        media: [image('https://m/a.jpg'), video('https://m/b.mp4'), image('https://m/c.jpg')],
      },
    ]);

    const containers = posts('POST').filter((call) => pathOf(call).endsWith('/media'));
    const [first, second, third, parent] = containers;

    expect(first.form.get('image_url')).toBe('https://m/a.jpg');
    expect(first.form.get('is_carousel_item')).toBe('true');
    expect(first.form.get('caption')).toBeNull();
    // A Reel cannot be a carousel item: inside one, a video is a plain video.
    expect(second.form.get('media_type')).toBe('VIDEO');
    expect(second.form.get('video_url')).toBe('https://m/b.mp4');
    expect(third.form.get('image_url')).toBe('https://m/c.jpg');

    expect(parent.form.get('media_type')).toBe('CAROUSEL');
    expect(parent.form.get('children')).toBe('c1,c2,c3');
    expect(parent.form.get('caption')).toBe('Three things');

    // The video item was waited for before the parent named it.
    const order = calls.map((call) => `${call.method} ${pathOf(call)}`);
    expect(order.indexOf('GET /v27.0/c2')).toBeGreaterThan(-1);
    expect(order.indexOf('GET /v27.0/c2')).toBeLessThan(calls.indexOf(parent));
    expect(posts('POST').at(-1)?.form.get('creation_id')).toBe('c4');
  });

  it('fails once, naming what is live, when a comment fails after the post is out', async () => {
    answer((call) => {
      if (call.method === 'POST' && pathOf(call).endsWith('/comments')) {
        return json(
          { error: { message: 'x', code: 100, error_user_msg: 'Comments are off.' } },
          400,
        );
      }
      if (call.method === 'POST') {
        return { id: pathOf(call).endsWith('/media') ? 'c1' : 'media-1' };
      }
      if (call.url.searchParams.get('fields') === 'permalink') {
        return { permalink: 'https://www.instagram.com/p/Cx1/' };
      }
      return { status_code: 'FINISHED' };
    });

    const attempt = provider.post(instagramChannel, 'token', [
      { id: 'p1', message: 'Post', media: [image('https://m/a.jpg')] },
      { id: 'p2', message: 'First comment' },
    ]);

    await expect(attempt).rejects.toBeInstanceOf(BadBodyError);
    await expect(attempt).rejects.toThrow(
      'Part 1 is live on Instagram, but part 2 is not. Comments are off.',
    );
  });

  it('posts later parts as comments under the post, in order', async () => {
    instagramApi();

    const results = await provider.post(instagramChannel, 'token', [
      { id: 'p1', message: 'Post', media: [image('https://m/a.jpg')] },
      { id: 'p2', message: 'First comment' },
      { id: 'p3', message: 'Second comment' },
    ]);

    const comments = posts('POST').filter((call) => pathOf(call).endsWith('/comments'));

    expect(comments.map(pathOf)).toEqual(['/v27.0/media-1/comments', '/v27.0/media-1/comments']);
    expect(comments.map((call) => call.form.get('message'))).toEqual([
      'First comment',
      'Second comment',
    ]);
    expect(results.map((result) => result.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('refuses a post with no media before calling Instagram', async () => {
    await expect(
      provider.post(instagramChannel, 'token', [{ id: 'p1', message: 'Only words' }]),
    ).rejects.toBeInstanceOf(BadBodyError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails the post, without retrying, when Instagram cannot process the media', async () => {
    answer((call) =>
      call.method === 'POST'
        ? { id: 'c1' }
        : { status_code: 'ERROR', status: 'Error: unsupported video format' },
    );

    await expect(
      provider.post(instagramChannel, 'token', [
        { id: 'p1', message: 'x', media: [video('https://m/a.mp4')] },
      ]),
    ).rejects.toThrow(/unsupported video format/);
    expect(posts('POST')).toHaveLength(1);
  });

  it('still reports a published post when the permalink lookup fails', async () => {
    answer((call) => {
      if (call.method === 'POST') {
        return { id: pathOf(call).endsWith('/media') ? 'c1' : 'media-1' };
      }
      if (call.url.searchParams.get('fields') === 'permalink') {
        return json({ error: { message: 'Unsupported get request', code: 100 } }, 400);
      }
      return { status_code: 'FINISHED' };
    });

    const [result] = await provider.post(instagramChannel, 'token', [
      { id: 'p1', message: 'x', media: [image('https://m/a.jpg')] },
    ]);

    expect(result).toMatchObject({
      postId: 'media-1',
      releaseURL: 'https://www.instagram.com/bloombakery/',
    });
  });
});

describe('Threads publishing', () => {
  const provider = new ThreadsProvider();

  /** Containers get ids c1, c2, ...; published posts t1, t2, ...; all ready at once. */
  function threadsApi(): void {
    let containers = 0;
    let published = 0;

    answer((call) => {
      if (call.method === 'POST' && pathOf(call).endsWith('/threads')) {
        containers += 1;
        return { id: `c${containers}` };
      }
      if (call.method === 'POST' && pathOf(call).endsWith('/threads_publish')) {
        published += 1;
        return { id: `t${published}` };
      }
      if (call.url.searchParams.get('fields') === 'permalink') {
        return { permalink: `https://www.threads.com/@bloombakery/post${pathOf(call)}` };
      }
      return { status: 'FINISHED' };
    });
  }

  const containerCalls = () => posts('POST').filter((call) => pathOf(call).endsWith('/threads'));

  it('publishes text alone', async () => {
    threadsApi();

    const [result] = await provider.post(threadsChannel, 'token', [
      { id: 'p1', message: 'Hello, Threads' },
    ]);

    const [container, status, publish] = calls;

    expect(container.url.href).toBe('https://graph.threads.com/v1.0/2468/threads');
    expect(Object.fromEntries(container.form)).toEqual({
      access_token: 'token',
      media_type: 'TEXT',
      text: 'Hello, Threads',
    });
    expect(status.url.searchParams.get('fields')).toBe('status,error_message');
    expect(pathOf(publish)).toBe('/v1.0/2468/threads_publish');
    expect(publish.form.get('creation_id')).toBe('c1');

    expect(result).toEqual({
      id: 'p1',
      postId: 't1',
      releaseURL: 'https://www.threads.com/@bloombakery/post/v1.0/t1',
    });
  });

  it('publishes one image with its alt text, and one video', async () => {
    threadsApi();

    await provider.post(threadsChannel, 'token', [
      { id: 'p1', message: 'Loaf', media: [image('https://m/a.jpg', 'A loaf')] },
    ]);
    await provider.post(threadsChannel, 'token', [
      { id: 'p2', message: 'Kneading', media: [video('https://m/a.mp4')] },
    ]);

    const [imagePost, videoPost] = containerCalls();

    expect(Object.fromEntries(imagePost.form)).toEqual({
      access_token: 'token',
      media_type: 'IMAGE',
      image_url: 'https://m/a.jpg',
      alt_text: 'A loaf',
      text: 'Loaf',
    });
    expect(Object.fromEntries(videoPost.form)).toEqual({
      access_token: 'token',
      media_type: 'VIDEO',
      video_url: 'https://m/a.mp4',
      text: 'Kneading',
    });
  });

  it('publishes a carousel, with the text on the parent only', async () => {
    threadsApi();

    await provider.post(threadsChannel, 'token', [
      {
        id: 'p1',
        message: 'Two things',
        media: [image('https://m/a.jpg'), video('https://m/b.mp4')],
      },
    ]);

    const [first, second, parent] = containerCalls();

    expect(first.form.get('is_carousel_item')).toBe('true');
    expect(first.form.get('media_type')).toBe('IMAGE');
    expect(first.form.get('text')).toBeNull();
    expect(second.form.get('media_type')).toBe('VIDEO');
    expect(Object.fromEntries(parent.form)).toEqual({
      access_token: 'token',
      media_type: 'CAROUSEL',
      children: 'c1,c2',
      text: 'Two things',
    });
    expect(posts('POST').at(-1)?.form.get('creation_id')).toBe('c3');
  });

  it('publishes a multi-part post as a thread, each part replying to the one before', async () => {
    threadsApi();

    const results = await provider.post(threadsChannel, 'token', [
      { id: 'p1', message: 'One' },
      { id: 'p2', message: 'Two', media: [image('https://m/b.jpg')] },
      { id: 'p3', message: 'Three' },
    ]);

    const [one, two, three] = containerCalls();

    expect(one.form.get('reply_to_id')).toBeNull();
    expect(two.form.get('reply_to_id')).toBe('t1');
    expect(two.form.get('media_type')).toBe('IMAGE');
    expect(three.form.get('reply_to_id')).toBe('t2');
    expect(results.map((result) => result.postId)).toEqual(['t1', 't2', 't3']);
  });

  it('continues a thread under a post that is already out', async () => {
    threadsApi();

    await provider.comment(threadsChannel, 'token', 'existing', [
      { id: 'p2', message: 'Two' },
      { id: 'p3', message: 'Three' },
    ]);

    const [two, three] = containerCalls();

    expect(two.form.get('reply_to_id')).toBe('existing');
    expect(three.form.get('reply_to_id')).toBe('t1');
  });

  it('refuses an empty post before calling Threads', async () => {
    await expect(
      provider.post(threadsChannel, 'token', [{ id: 'p1', message: '   ' }]),
    ).rejects.toBeInstanceOf(BadBodyError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails once, without a retry, when a later part fails after the first is live', async () => {
    let containers = 0;

    answer((call) => {
      if (call.method === 'POST' && pathOf(call).endsWith('/threads')) {
        containers += 1;
        // The second part hits a rate limit, which on its own would be retried.
        return containers === 1
          ? { id: 'c1' }
          : json({ error: { message: 'Application request limit reached', code: 4 } }, 400);
      }
      if (call.method === 'POST') {
        return { id: 't1' };
      }
      if (call.url.searchParams.get('fields') === 'permalink') {
        return { permalink: 'https://www.threads.com/@bloombakery/post/t1' };
      }
      return { status: 'FINISHED' };
    });

    jest.useFakeTimers();

    try {
      const pending = provider.post(threadsChannel, 'token', [
        { id: 'p1', message: 'One' },
        { id: 'p2', message: 'Two' },
      ]);
      const settled = pending.then(
        () => null,
        (error: unknown) => error,
      );

      await jest.advanceTimersByTimeAsync(10_000);
      const error = await settled;

      // Not retryable: a retry would publish part 1 a second time.
      expect(error).toBeInstanceOf(BadBodyError);
      expect((error as Error).message).toMatch(/^Part 1 is live on Threads, but part 2 is not\./);
      expect(
        posts('POST').filter((call) => pathOf(call).endsWith('/threads_publish')),
      ).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves a failure on the very first part as it is, so it can be retried', async () => {
    jest.useFakeTimers();

    try {
      answer(() => json({ error: { message: 'Application request limit reached', code: 4 } }, 400));

      const pending = provider.post(threadsChannel, 'token', [
        { id: 'p1', message: 'One' },
        { id: 'p2', message: 'Two' },
      ]);
      const settled = expect(pending).rejects.toBeInstanceOf(RetryableError);

      await jest.advanceTimersByTimeAsync(10_000);
      await settled;
    } finally {
      jest.useRealTimers();
    }
  });

  it('names the platform, not its internal id, in a fallback message', async () => {
    answer(() => json({ error: { message: 'Invalid parameter', code: 100 } }, 400));

    await expect(
      provider.post(threadsChannel, 'token', [{ id: 'p1', message: 'x' }]),
    ).rejects.toThrow('Threads rejected the request.');
    await expect(
      new InstagramStandaloneProvider().post(instagramChannel, 'token', [
        { id: 'p1', message: 'x', media: [image('https://m/a.jpg')] },
      ]),
    ).rejects.toThrow('Instagram rejected the request.');
  });

  it('explains the five-link limit in plain words', async () => {
    answer(() =>
      json({ error: { message: 'THREADS_API__LINK_LIMIT_EXCEEDED', type: 'THApiException' } }, 400),
    );

    await expect(
      provider.post(threadsChannel, 'token', [{ id: 'p1', message: 'links' }]),
    ).rejects.toThrow(/at most 5 different links/);
  });

  it('waits for a container that is still being processed', async () => {
    jest.useFakeTimers();

    try {
      let polls = 0;

      answer((call) => {
        if (call.method === 'POST') {
          return { id: pathOf(call).endsWith('/threads') ? 'c1' : 't1' };
        }
        if (call.url.searchParams.get('fields') === 'permalink') {
          return { permalink: 'https://www.threads.com/@bloombakery/post/t1' };
        }
        polls += 1;
        return { status: polls < 3 ? 'IN_PROGRESS' : 'FINISHED' };
      });

      const pending = provider.post(threadsChannel, 'token', [
        { id: 'p1', message: 'Clip', media: [video('https://m/a.mp4')] },
      ]);

      await jest.advanceTimersByTimeAsync(15_000);
      const [result] = await pending;

      expect(polls).toBe(3);
      expect(result.postId).toBe('t1');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('errors', () => {
  const provider = new ThreadsProvider();
  const failing = (error: Record<string, unknown>, status = 400) =>
    answer(() => json({ error }, status));
  const attempt = () => provider.post(threadsChannel, 'token', [{ id: 'p1', message: 'x' }]);

  it('a dead token asks for a reconnect', async () => {
    failing({ message: 'Error validating access token', type: 'OAuthException', code: 190 });

    await expect(attempt()).rejects.toBeInstanceOf(RefreshTokenError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an OAuthException that is not about the token is not mistaken for one', async () => {
    failing({ message: 'Invalid parameter', type: 'OAuthException', code: 100 });

    await expect(attempt()).rejects.toBeInstanceOf(BadBodyError);
  });

  it('a missing permission says to reconnect and approve everything', async () => {
    failing({ message: 'Application does not have permission', code: 10 }, 403);

    await expect(attempt()).rejects.toThrow(/missing permission/);
  });

  it('shows Meta’s own sentence for the person when it wrote one', async () => {
    failing({ message: 'x', code: 100, error_user_msg: 'The image is too small.' });

    await expect(attempt()).rejects.toThrow('The image is too small.');
  });

  it('a rate limit is retried, then surfaces as retryable', async () => {
    jest.useFakeTimers();

    try {
      failing({ message: 'Application request limit reached', code: 4 });

      const pending = attempt();
      const settled = expect(pending).rejects.toBeInstanceOf(RetryableError);

      await jest.advanceTimersByTimeAsync(10_000);
      await settled;

      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('analytics', () => {
  const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'nextTick', 'setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Instagram reads followers, daily reach and each recent day’s interactions', async () => {
    answer((call) => {
      const query = call.url.searchParams;

      if (query.get('fields') === 'followers_count') {
        return { followers_count: 1200 };
      }
      if (query.get('metric') === 'reach') {
        return {
          data: [
            {
              name: 'reach',
              period: 'day',
              values: [{ value: 40, end_time: '2026-10-15T07:00:00+0000' }],
            },
          ],
        };
      }
      // Only today has interactions.
      return Number(query.get('since')) * 1_000 === Date.UTC(2026, 9, 15)
        ? {
            data: [
              { name: 'likes', total_value: { value: 5 } },
              { name: 'comments', total_value: { value: 2 } },
              { name: 'shares', total_value: { value: 1 } },
              { name: 'saves', total_value: { value: 3 } },
              { name: 'views', total_value: { value: 90 } },
            ],
          }
        : { data: [] };
    });

    const points = await new InstagramStandaloneProvider().channelAnalytics(
      instagramChannel,
      'token',
      30,
    );

    expect(calls.every((call) => call.url.origin === 'https://graph.instagram.com')).toBe(true);
    expect(pathOf(calls[1])).toBe('/v27.0/17841405793187218/insights');
    // Followers, reach, then one total-value call per backfilled day.
    expect(calls).toHaveLength(5);

    expect(points).toEqual(
      expect.arrayContaining([
        { metric: 'followers', date: '2026-10-15', value: 1200 },
        { metric: 'reach', date: '2026-10-14', value: 40 },
        { metric: 'likes', date: '2026-10-15', value: 5 },
        { metric: 'comments', date: '2026-10-15', value: 2 },
        { metric: 'shares', date: '2026-10-15', value: 1 },
        { metric: 'views', date: '2026-10-15', value: 90 },
        // Saves have no metric of their own but count as engagement.
        { metric: 'engagements', date: '2026-10-15', value: 11 },
      ]),
    );
  });

  it('Instagram maps a post’s insights, and reads a deleted post as null', async () => {
    const provider = new InstagramStandaloneProvider();

    answer(() => ({
      data: [
        { name: 'likes', values: [{ value: 7 }] },
        { name: 'comments', values: [{ value: 2 }] },
        { name: 'shares', values: [{ value: 1 }] },
        { name: 'saved', values: [{ value: 4 }] },
        { name: 'views', values: [{ value: 300 }] },
        { name: 'reach', values: [{ value: 250 }] },
      ],
    }));

    expect(await provider.postAnalytics(instagramChannel, 'token', 'media-1')).toEqual({
      likes: 7,
      comments: 2,
      shares: 1,
      saves: 4,
      views: 300,
      impressions: 250,
      clicks: 0,
    });
    expect(pathOf(calls[0])).toBe('/v27.0/media-1/insights');

    answer(() =>
      json(
        {
          error: {
            message: 'Object with ID media-1 does not exist',
            type: 'GraphMethodException',
            code: 100,
          },
        },
        400,
      ),
    );

    expect(await provider.postAnalytics(instagramChannel, 'token', 'media-1')).toBeNull();
  });

  it('Threads reads followers, daily views and each recent day’s interactions', async () => {
    answer((call) => {
      const query = call.url.searchParams;

      if (query.get('metric') === 'followers_count') {
        return { data: [{ name: 'followers_count', total_value: { value: 640 } }] };
      }
      if (query.get('metric') === 'views') {
        return {
          data: [
            {
              name: 'views',
              period: 'day',
              values: [
                { value: 12, end_time: '2026-10-14T07:00:00+0000' },
                { value: 30, end_time: '2026-10-15T07:00:00+0000' },
              ],
            },
          ],
        };
      }
      return Number(query.get('since')) * 1_000 === Date.UTC(2026, 9, 15)
        ? {
            data: [
              { name: 'likes', total_value: { value: 9 } },
              { name: 'replies', total_value: { value: 4 } },
              { name: 'reposts', total_value: { value: 2 } },
              { name: 'quotes', total_value: { value: 1 } },
            ],
          }
        : { data: [] };
    });

    const points = await new ThreadsProvider().channelAnalytics(threadsChannel, 'token', 30);

    const [followers, views, today] = calls;

    expect(pathOf(followers)).toBe('/v1.0/2468/threads_insights');
    // The follower count takes no date range.
    expect(followers.url.searchParams.get('since')).toBeNull();
    expect(Number(views.url.searchParams.get('since')) * 1_000).toBe(Date.UTC(2026, 8, 16));
    expect(today.url.searchParams.get('metric')).toBe('likes,replies,reposts,quotes');

    expect(points).toEqual(
      expect.arrayContaining([
        { metric: 'followers', date: '2026-10-15', value: 640 },
        { metric: 'views', date: '2026-10-13', value: 12 },
        { metric: 'views', date: '2026-10-14', value: 30 },
        { metric: 'likes', date: '2026-10-15', value: 9 },
        // A reply is Threads' comment.
        { metric: 'comments', date: '2026-10-15', value: 4 },
        // Reposts and quotes are both shares.
        { metric: 'shares', date: '2026-10-15', value: 3 },
        { metric: 'engagements', date: '2026-10-15', value: 16 },
      ]),
    );
  });

  it('Threads never asks for insights from before Threads kept any', async () => {
    answer(() => ({ data: [] }));

    await new ThreadsProvider().channelAnalytics(threadsChannel, 'token', 366);

    for (const call of calls.slice(1)) {
      expect(Number(call.url.searchParams.get('since'))).toBeGreaterThanOrEqual(1_712_991_600);
    }
  });

  it('Threads maps a post’s insights, and reads a deleted post as null', async () => {
    const provider = new ThreadsProvider();

    answer(() => ({
      data: [
        { name: 'views', values: [{ value: 500 }] },
        { name: 'likes', values: [{ value: 20 }] },
        { name: 'replies', values: [{ value: 6 }] },
        { name: 'reposts', values: [{ value: 3 }] },
        { name: 'quotes', values: [{ value: 2 }] },
        { name: 'shares', values: [{ value: 1 }] },
      ],
    }));

    expect(await provider.postAnalytics(threadsChannel, 'token', 't1')).toEqual({
      views: 500,
      likes: 20,
      comments: 6,
      shares: 6,
      clicks: 0,
      impressions: 0,
      saves: 0,
    });
    expect(pathOf(calls[0])).toBe('/v1.0/t1/insights');

    answer(() => json({ error: { message: 'Object with ID t1 does not exist', code: 100 } }, 400));

    expect(await provider.postAnalytics(threadsChannel, 'token', 't1')).toBeNull();
  });

  it('a dead token in analytics raises the class the worker branches on', async () => {
    answer(() => json({ error: { message: 'expired', type: 'OAuthException', code: 190 } }, 400));

    await expect(
      new ThreadsProvider().channelAnalytics(threadsChannel, 'token', 7),
    ).rejects.toBeInstanceOf(RefreshTokenError);
  });
});
