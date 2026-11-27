/**
 * Sprint 13 Module 13: the Made With AI label. Each provider says whether its
 * platform has a field for it, and the ones that do send it only when the
 * post is marked. `fetch` is mocked: no network. Every call after the
 * first request is refused with a 400 (no retry), since only the request
 * body is checked.
 */
import { FacebookProvider } from './facebook';
import { InstagramProvider } from './instagram';
import { InstagramStandaloneProvider } from './instagram-standalone';
import { LinkedInProvider } from './linkedin';
import { PinterestProvider } from './pinterest';
import { ThreadsProvider } from './threads';
import { TikTokProvider } from './tiktok';
import { XProvider } from './twitter';
import { YouTubeProvider } from './youtube';

let fetchMock: jest.Mock;

function refused(): Response {
  return new Response(JSON.stringify({ error: { message: 'stop here' } }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock = jest.fn().mockImplementation(async () => refused());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const channel = {
  id: 'ch',
  internalId: 'acct',
  rootInternalId: 'acct',
  providerIdentifier: 'p',
  name: 'Acme',
};

const video = { id: 'm1', type: 'video' as const, path: 'https://media.test/v.mp4' };

function post(madeWithAi: boolean) {
  return [{ id: 'row-1', message: 'Hello', media: [video], madeWithAi }];
}

/** Every request body sent, as text. */
function bodies(): string[] {
  return fetchMock.mock.calls.map(([, init]) => String((init as RequestInit | undefined)?.body));
}

describe('which platforms have an AI label', () => {
  it('YouTube and both Instagrams have one; the rest say none', () => {
    expect(new YouTubeProvider().rules.aiLabel).toBe('field');
    expect(new InstagramProvider().rules.aiLabel).toBe('field');
    expect(new InstagramStandaloneProvider().rules.aiLabel).toBe('field');
    for (const provider of [
      new FacebookProvider(),
      new XProvider(),
      new LinkedInProvider(),
      new ThreadsProvider(),
      new TikTokProvider(),
      new PinterestProvider(),
    ]) {
      expect(provider.rules.aiLabel).toBe('none');
    }
  });
});

describe('YouTube', () => {
  it('sends containsSyntheticMedia only when the post is marked', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockImplementationOnce(async () => refused());
    await new YouTubeProvider().post(channel, 't', post(true)).catch(() => undefined);
    const metadata = JSON.parse(bodies()[1] as string);
    expect(metadata.status.containsSyntheticMedia).toBe(true);

    fetchMock.mockClear();
    fetchMock
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockImplementationOnce(async () => refused());
    await new YouTubeProvider().post(channel, 't', post(false)).catch(() => undefined);
    expect(JSON.parse(bodies()[1] as string).status).not.toHaveProperty('containsSyntheticMedia');
  });
});

describe('Instagram', () => {
  it('Via Facebook Page puts is_ai_generated on the container only when marked', async () => {
    await new InstagramProvider().post(channel, 't', post(true)).catch(() => undefined);
    expect(JSON.parse(bodies()[0] as string).is_ai_generated).toBe(true);

    fetchMock.mockClear();
    await new InstagramProvider().post(channel, 't', post(false)).catch(() => undefined);
    expect(bodies()[0]).not.toContain('is_ai_generated');
  });

  it('on its own puts is_ai_generated on the container only when marked', async () => {
    await new InstagramStandaloneProvider().post(channel, 't', post(true)).catch(() => undefined);
    expect(bodies()[0]).toContain('is_ai_generated');

    fetchMock.mockClear();
    await new InstagramStandaloneProvider().post(channel, 't', post(false)).catch(() => undefined);
    expect(bodies()[0]).not.toContain('is_ai_generated');
  });
});
