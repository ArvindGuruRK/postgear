import { createHeuristicAuthorityProvider } from './heuristic.provider';
import { AuthorityProviderError, createOpenPageRankProvider } from './open-pagerank.provider';
import { createSimulatedAuthorityProvider, simulatedAuthorityFor } from './simulated.provider';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createOpenPageRankProvider', () => {
  it('calls the endpoint with the key header and maps the decimal', async () => {
    const fetch = jest.fn(async () =>
      jsonResponse(200, {
        status_code: 200,
        response: [{ status_code: 200, domain: 'example.com', page_rank_decimal: 6.47 }],
      }),
    );
    const provider = createOpenPageRankProvider({ apiKey: 'opr-secret-key', fetch });
    const estimate = await provider.estimate('www.Example.com');
    expect(estimate).toEqual({ source: 'openpagerank', domainAuthority: 65, pageRank: 6.47 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openpagerank.com/api/v1.0/getPageRank?domains%5B%5D=example.com');
    expect((init.headers as Record<string, string>)['API-OPR']).toBe('opr-secret-key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null for an unknown domain', async () => {
    const fetch = jest.fn(async () =>
      jsonResponse(200, {
        status_code: 200,
        response: [{ status_code: 404, domain: 'nobody.example', page_rank_decimal: null }],
      }),
    );
    const provider = createOpenPageRankProvider({ apiKey: 'k', fetch });
    expect(await provider.estimate('nobody.example')).toBeNull();
  });

  it('retries once on 429 and then throws without the key in the message', async () => {
    const fetch = jest
      .fn<Promise<Response>, Parameters<typeof globalThis.fetch>>()
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(429, {}));
    const sleep = jest.fn(async () => undefined);
    const provider = createOpenPageRankProvider({ apiKey: 'opr-secret-key', fetch, sleep });
    await expect(provider.estimate('example.com')).rejects.toMatchObject({
      name: 'AuthorityProviderError',
      statusCode: 429,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    await expect(provider.estimate('example.com')).rejects.not.toThrow(/opr-secret-key/);
  });

  it('recovers when the retry succeeds', async () => {
    const fetch = jest
      .fn<Promise<Response>, Parameters<typeof globalThis.fetch>>()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          response: [{ status_code: 200, domain: 'example.com', page_rank_decimal: 3 }],
        }),
      );
    const provider = createOpenPageRankProvider({ apiKey: 'k', fetch, sleep: async () => {} });
    expect(await provider.estimate('example.com')).toMatchObject({ domainAuthority: 30 });
  });

  it('wraps a network failure', async () => {
    const provider = createOpenPageRankProvider({
      apiKey: 'k',
      fetch: async () => {
        throw new Error('socket hang up');
      },
    });
    await expect(provider.estimate('example.com')).rejects.toBeInstanceOf(AuthorityProviderError);
  });
});

describe('simulated and heuristic providers', () => {
  it('is deterministic and inside 20–85', async () => {
    const provider = createSimulatedAuthorityProvider();
    const a = await provider.estimate('example.com');
    const b = await provider.estimate('www.example.com');
    expect(a).toEqual(b);
    expect(a?.source).toBe('simulation');
    expect(a?.domainAuthority).toBeGreaterThanOrEqual(20);
    expect(a?.domainAuthority).toBeLessThanOrEqual(85);
    expect(a?.pageRank).toBe((a?.domainAuthority ?? 0) / 10);
    expect(simulatedAuthorityFor('other.example').domainAuthority).not.toBe(a?.domainAuthority);
  });

  it('the heuristic provider always answers null', async () => {
    const provider = createHeuristicAuthorityProvider();
    expect(provider.name).toBe('heuristic');
    expect(await provider.estimate('example.com')).toBeNull();
  });
});
