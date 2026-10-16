/**
 * The client against a fake `fetch`: the header it sends, how it builds
 * URLs and bodies, how each kind of answer is surfaced, and the timeout.
 */
import { PostGear } from './client';
import { PostGearError, PostGearNetworkError } from './errors';

function fakeFetch(
  handler: (url: string, init: RequestInit) => { status: number; body?: unknown; headers?: Record<string, string> },
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = handler(url, init);
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json', ...(answer.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('PostGear client', () => {
  it('requires an api key', () => {
    expect(() => new PostGear({ apiKey: '' })).toThrow(TypeError);
  });

  it('sends the bearer key and reads the me() envelope', async () => {
    const { impl, calls } = fakeFetch(() => ({
      status: 200,
      body: { workspace: { id: 'org', name: 'Acme' }, key: { id: 'k', name: 'CI', prefix: 'pg_abc' }, plan: { tier: 'PRO' } },
    }));
    const client = new PostGear({ apiKey: 'pg_secret', baseUrl: 'https://api.example.com/', fetch: impl });

    const me = await client.me();

    expect(me.workspace.name).toBe('Acme');
    expect(calls[0].url).toBe('https://api.example.com/v1/me');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer pg_secret');
    expect(calls[0].init.method).toBe('GET');
  });

  it('builds query strings and unwraps list and detail envelopes', async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.includes('/v1/posts?')
        ? { status: 200, body: { posts: [], page: 2, pageCount: 2, total: 21 } }
        : url.endsWith('/v1/channels')
          ? { status: 200, body: { channels: [{ id: 'ch' }] } }
          : { status: 200, body: { post: { id: 'g1', parts: [] } } },
    );
    const client = new PostGear({ apiKey: 'pg_x', fetch: impl });

    expect((await client.posts.list({ page: 2, state: 'QUEUE' })).total).toBe(21);
    expect(calls[0].url).toBe('http://localhost:3001/v1/posts?page=2&state=QUEUE');
    expect((await client.channels.list())[0].id).toBe('ch');
    expect((await client.posts.get('g 1')).id).toBe('g1');
    expect(calls[2].url).toBe('http://localhost:3001/v1/posts/g%201');
  });

  it('POSTs a JSON body to create a post and DELETEs to remove one', async () => {
    const { impl, calls } = fakeFetch((_url, init) =>
      init.method === 'POST' ? { status: 201, body: { post: { id: 'new' } } } : { status: 200, body: { deleted: true } },
    );
    const client = new PostGear({ apiKey: 'pg_x', fetch: impl });

    const post = await client.posts.create({ text: 'Hi', channelIds: ['ch'], state: 'draft' });
    await client.posts.delete('new');

    expect(post.id).toBe('new');
    expect((calls[0].init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ text: 'Hi', channelIds: ['ch'], state: 'draft' });
    expect(calls[1].init.method).toBe('DELETE');
  });

  it('throws the API’s own message and status on an error answer', async () => {
    const { impl } = fakeFetch(() => ({ status: 401, body: { error: 'Invalid API key', statusCode: 401 } }));
    const client = new PostGear({ apiKey: 'pg_x', fetch: impl });

    const error = await client.me().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PostGearError);
    expect(error).toMatchObject({ message: 'Invalid API key', status: 401, isUnauthorized: true });
  });

  it('reads Retry-After on a 429', async () => {
    const { impl } = fakeFetch(() => ({ status: 429, body: { error: 'Rate limit exceeded', statusCode: 429 }, headers: { 'retry-after': '17' } }));
    const client = new PostGear({ apiKey: 'pg_x', fetch: impl });

    const error = (await client.me().catch((cause: unknown) => cause)) as PostGearError;

    expect(error.isRateLimited).toBe(true);
    expect(error.retryAfterSeconds).toBe(17);
  });

  it('copes with a non-JSON error body', async () => {
    const impl = jest.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })) as unknown as typeof fetch;
    const client = new PostGear({ apiKey: 'pg_x', fetch: impl });

    await expect(client.me()).rejects.toMatchObject({ status: 502, message: 'PostGear API answered 502' });
  });

  it('turns a hung request into a network error at the timeout', async () => {
    const impl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    const client = new PostGear({ apiKey: 'pg_x', fetch: impl, timeoutMs: 20 });

    await expect(client.me()).rejects.toBeInstanceOf(PostGearNetworkError);
  });
});
