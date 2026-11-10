import type { DiscoverFetch } from '../types';
import { FeedParseError, itemSource, parseFeed, readFeed } from './feed-parser';

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>A feed</title>
<item><title>One</title><link>https://a.example/1</link><source url="https://paper.example">The Paper</source></item>
<item><title>Two</title></item>
</channel></rss>`;

const answering =
  (status: number, body = ''): DiscoverFetch =>
  async (url) => ({ status, body, finalUrl: url });

describe('parseFeed', () => {
  it('reads RSS', async () => {
    const feed = await parseFeed(RSS);
    expect(feed.items.map((item) => item.title)).toEqual(['One', 'Two']);
  });

  it('reads Atom', async () => {
    const feed = await parseFeed(
      '<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><entry><title>One</title></entry></feed>',
    );
    expect(feed.items[0].title).toBe('One');
  });

  it.each(['<html><body>Before you continue</body></html>', 'not xml at all', ''])(
    'throws a typed error for %j',
    async (body) => {
      await expect(parseFeed(body)).rejects.toBeInstanceOf(FeedParseError);
    },
  );

  it('does not repeat the document in its error', async () => {
    const failure = await parseFeed('<rss version="2.0"><secret').catch((error: Error) => error);
    expect((failure as Error).message).not.toContain('secret');
  });

  it('still reads after a document it could not', async () => {
    await parseFeed('not xml').catch(() => null);
    expect((await parseFeed(RSS)).items).toHaveLength(2);
  });

  it('reads a run of feeds at once without mixing them up', async () => {
    const feeds = await Promise.all(
      ['First', 'Second', 'Third'].map((title) =>
        parseFeed(
          `<rss version="2.0"><channel><item><title>${title}</title></item></channel></rss>`,
        ),
      ),
    );
    expect(feeds.map((feed) => feed.items[0].title)).toEqual(['First', 'Second', 'Third']);
  });
});

describe('itemSource', () => {
  it('keeps both the name and the address', async () => {
    const feed = await parseFeed(RSS);
    expect(itemSource(feed.items[0])).toEqual({ name: 'The Paper', url: 'https://paper.example' });
  });

  it('is null when the item names no publisher', async () => {
    const feed = await parseFeed(RSS);
    expect(itemSource(feed.items[1])).toBeNull();
  });
});

describe('readFeed', () => {
  it('hands back a parsed feed', async () => {
    const answer = await readFeed(answering(200, RSS), 'https://a.example/rss');
    expect(answer.ok && answer.feed.items).toHaveLength(2);
  });

  it.each([429, 500, 502, 503])('calls HTTP %d the service being in trouble', async (status) => {
    expect(await readFeed(answering(status), 'https://a.example/rss')).toEqual({
      ok: false,
      failure: 'upstream',
      status,
    });
  });

  it.each([400, 403, 404, 410])('calls HTTP %d nothing at that address', async (status) => {
    expect(await readFeed(answering(status), 'https://a.example/rss')).toEqual({
      ok: false,
      failure: 'not_found',
      status,
    });
  });

  it('calls a consent page with a 200 the service being in trouble', async () => {
    const answer = await readFeed(answering(200, '<html>Consent</html>'), 'https://a.example/rss');
    expect(answer).toEqual({ ok: false, failure: 'upstream' });
  });

  it('never throws when the request itself fails', async () => {
    const broken: DiscoverFetch = async () => {
      throw new Error('socket hang up');
    };
    expect(await readFeed(broken, 'https://a.example/rss')).toEqual({
      ok: false,
      failure: 'upstream',
    });
  });

  it("uses the caller's deadline, and has its own without one", async () => {
    const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(
      answering(200, RSS),
    );
    const deadline = new AbortController();

    await readFeed(fetchMock, 'https://a.example/rss', deadline.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBe(deadline.signal);

    await readFeed(fetchMock, 'https://a.example/rss');
    expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1][1].maxBytes).toBeGreaterThan(0);
  });
});
