/**
 * Per-platform post settings reach the platform (2026-10-19).
 *
 * `PROVIDER_SETTINGS` promises that every field it lists is one the
 * provider's `post()` honours; these pin the request each new field changes,
 * with `fetch` mocked. Unset values must leave the request exactly as it was
 * before the setting existed.
 */
import { PROVIDER_SETTINGS } from '../composer/settings';
import { FacebookProvider } from './facebook';
import { PinterestProvider } from './pinterest';
import { XProvider } from './twitter';
import { YouTubeProvider } from './youtube';

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

function bodyOf(index: number): Record<string, unknown> {
  return JSON.parse(String((fetchMock.mock.calls[index][1] as RequestInit).body));
}

const channel = (providerIdentifier: string) => ({
  id: 'ch_1',
  internalId: 'target-1',
  rootInternalId: 'account-1',
  providerIdentifier,
  name: 'Acme',
  profile: 'acme',
});

describe('X reply settings', () => {
  it('restricts who can reply on the first tweet only', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: { id: '1' } }))
      .mockResolvedValueOnce(json({ data: { id: '2' } }));

    await new XProvider().post(channel('x'), 'token', [
      { id: 'p1', message: 'first', settings: { replySettings: 'following' } },
      { id: 'p2', message: 'second', settings: { replySettings: 'following' } },
    ]);

    expect(bodyOf(0)).toEqual({ text: 'first', reply_settings: 'following' });
    expect(bodyOf(1)).toEqual({ text: 'second', reply: { in_reply_to_tweet_id: '1' } });
  });

  it('sends nothing for everyone, nothing set, or a value X does not know', async () => {
    for (const settings of [{ replySettings: 'everyone' }, {}, { replySettings: 'nobody' }]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(json({ data: { id: '1' } }));

      await new XProvider().post(channel('x'), 'token', [{ id: 'p1', message: 'hi', settings }]);

      expect(bodyOf(0)).toEqual({ text: 'hi' });
    }
  });

  it('offers exactly the values the provider can send, plus everyone', () => {
    const [field] = PROVIDER_SETTINGS.x;
    expect(field.kind === 'select' && field.options.map((option) => option.value)).toEqual([
      'everyone',
      'following',
      'mentionedUsers',
      'subscribers',
      'verified',
    ]);
  });
});

describe('YouTube settings', () => {
  function mockUpload() {
    fetchMock
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { location: 'https://upload.test/1' } }),
      )
      .mockResolvedValueOnce(json({ id: 'vid-1' }));
  }

  const video = [{ type: 'video' as const, path: 'https://media.test/v.mp4' }];

  it('sends the title, visibility, audience and tags it was given', async () => {
    mockUpload();

    await new YouTubeProvider().post(channel('youtube'), 'token', [
      {
        id: 'p1',
        message: 'First line\nMore',
        media: video,
        settings: {
          title: 'Launch day',
          privacyStatus: 'unlisted',
          madeForKids: true,
          tags: [' launch ', 'product news', ''],
        },
      },
    ]);

    expect(bodyOf(1)).toEqual({
      snippet: {
        title: 'Launch day',
        description: 'First line\nMore',
        categoryId: '22',
        tags: ['launch', 'product news'],
      },
      status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: true },
    });
  });

  it('falls back to the first line and public, and sends no tags field, when nothing is set', async () => {
    mockUpload();

    await new YouTubeProvider().post(channel('youtube'), 'token', [
      { id: 'p1', message: 'First line\nMore', media: video, settings: {} },
    ]);

    expect(bodyOf(1)).toEqual({
      snippet: { title: 'First line', description: 'First line\nMore', categoryId: '22' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    });
  });
});

describe('Facebook link', () => {
  it('attaches the link to a text-only post', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'page_1' }));

    await new FacebookProvider().post(channel('facebook'), 'token', [
      { id: 'p1', message: 'Read this', settings: { link: ' https://acme.test/blog ' } },
    ]);

    expect(bodyOf(0)).toEqual({
      message: 'Read this',
      link: 'https://acme.test/blog',
      access_token: 'token',
    });
  });

  it('leaves the link off a post with media, and refuses a link that is not a web link', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'photo_1', post_id: 'post_1' }));

    await new FacebookProvider().post(channel('facebook'), 'token', [
      {
        id: 'p1',
        message: 'A photo',
        media: [{ type: 'image', path: 'https://media.test/a.jpg' }],
        settings: { link: 'https://acme.test' },
      },
    ]);
    expect(bodyOf(0)).not.toHaveProperty('link');

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(json({ id: 'page_1' }));

    await new FacebookProvider().post(channel('facebook'), 'token', [
      { id: 'p1', message: 'Hi', settings: { link: 'javascript:alert(1)' } },
    ]);
    expect(bodyOf(0)).not.toHaveProperty('link');
  });
});

describe('Pinterest title and link', () => {
  const image = [{ type: 'image' as const, path: 'https://media.test/a.jpg' }];

  it('uses the Pin title and destination link it was given', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'pin-1' }));

    await new PinterestProvider().post(channel('pinterest'), 'token', [
      {
        id: 'p1',
        message: 'First line\nDescription',
        media: image,
        settings: { title: 'Spring sale', link: 'https://acme.test/sale' },
      },
    ]);

    // A title of its own leaves the whole post as the description: the first
    // line is not the title, so it must not be dropped.
    expect(bodyOf(0)).toMatchObject({
      board_id: 'target-1',
      title: 'Spring sale',
      description: 'First line\nDescription',
      link: 'https://acme.test/sale',
    });
  });

  it('treats a blank title as unset and drops a link that is not a web link', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'pin-1' }));

    await new PinterestProvider().post(channel('pinterest'), 'token', [
      {
        id: 'p1',
        message: 'First line\nDescription',
        media: image,
        settings: { title: '   ', link: 'ftp://acme.test' },
      },
    ]);

    // The first line stands in as the title, and the rest is the description.
    expect(bodyOf(0).title).toBe('First line');
    expect(bodyOf(0).description).toBe('Description');
    expect(bodyOf(0)).not.toHaveProperty('link');
  });
});
