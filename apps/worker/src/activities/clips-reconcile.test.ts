import { runClipsReconcile, runClipsSweep } from './maintenance.activities';

const config = { apiUrl: 'http://api.test/', token: 'a'.repeat(64) };

describe('runClipsReconcile', () => {
  it('posts to the internal route with the token and reads the counts', async () => {
    const fetch = jest.fn(
      async () => new Response(JSON.stringify({ started: 2, failed: 1 }), { status: 200 }),
    );
    await expect(runClipsReconcile({ ...config, fetch })).resolves.toEqual({
      started: 2,
      failed: 1,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/internal/clips/reconcile');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-postgear-internal']).toBe(config.token);
  });

  it('never throws: a refusal or a dead API is a report', async () => {
    const refused = jest.fn(async () => new Response('{}', { status: 503 }));
    await expect(runClipsReconcile({ ...config, fetch: refused })).resolves.toEqual({
      failed: 'status 503',
    });
    const dead = jest.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(runClipsReconcile({ ...config, fetch: dead })).resolves.toEqual({
      failed: 'TypeError',
    });
  });
});

describe('runClipsSweep (Module 19)', () => {
  it('posts to the sweep route with the token and hands back the counts', async () => {
    const answer = {
      noticed: 1,
      expired: 0,
      downloads: 2,
      uploads: 0,
      segments: 0,
      library: 0,
      failedImports: 0,
      charges: 0,
      storageNotices: 0,
      orphans: null,
      overridesExpired: null,
      failedParts: [],
    };
    const fetch = jest.fn(async () => new Response(JSON.stringify(answer), { status: 200 }));
    await expect(runClipsSweep({ ...config, fetch })).resolves.toEqual(answer);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/internal/clips/sweep');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect((init.headers as Record<string, string>)['x-postgear-internal']).toBe(config.token);
  });

  it('never throws: a refusal, a dead API or a bad body is a report', async () => {
    const refused = jest.fn(async () => new Response('{}', { status: 401 }));
    await expect(runClipsSweep({ ...config, fetch: refused })).resolves.toEqual({
      failed: 'status 401',
    });
    const dead = jest.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(runClipsSweep({ ...config, fetch: dead })).resolves.toEqual({ failed: 'TypeError' });
    const garbled = jest.fn(async () => new Response('not json', { status: 200 }));
    await expect(runClipsSweep({ ...config, fetch: garbled })).resolves.toEqual({
      failed: 'SyntaxError',
    });
  });
});
