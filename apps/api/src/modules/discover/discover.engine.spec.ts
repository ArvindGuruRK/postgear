/**
 * The two worlds, and the one door out of the process.
 *
 * The guarded fetch is mocked, so nothing here can open a socket: a real address
 * reaching it is exactly what these tests want to see, and a simulated one reaching
 * it is exactly what they must never see.
 */
import { buildLocality } from '@postgear/discover-engine';

jest.mock('@postgear/seo-engine', () => ({ fetchUrlSafely: jest.fn() }));

import { createDiscoverEngine, createSafeDiscoverFetch, type DiscoverEnv } from './discover.engine';

const { fetchUrlSafely } = jest.requireMock('@postgear/seo-engine') as {
  fetchUrlSafely: jest.Mock;
};

const USER_AGENT = 'PostGear/1.0 (+https://postgear.rkay.in)';
const TAMIL_NADU = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN' });
const EMPTY_RSS =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';

function env(overrides: Partial<DiscoverEnv> = {}): DiscoverEnv {
  return {
    DISCOVER_SIMULATION: 'false',
    DISCOVER_GEOCODER: 'nominatim',
    DISCOVER_GEOCODER_USER_AGENT: USER_AGENT,
    ...overrides,
  };
}

/** What the guarded fetch hands back, with only the fields the adapter reads. */
function answer(statusCode: number, body: string, finalUrl = 'https://example.test/final') {
  return { statusCode, body, finalUrl };
}

beforeEach(() => {
  fetchUrlSafely.mockReset();
});

describe('createSafeDiscoverFetch', () => {
  const init = { accept: 'application/rss+xml', maxBytes: 1024, signal: AbortSignal.timeout(1000) };

  it('goes through the guarded fetch, within limits, checking the certificate', async () => {
    fetchUrlSafely.mockResolvedValue(answer(200, '<rss/>'));

    const response = await createSafeDiscoverFetch(USER_AGENT)('https://example.test/feed', init);

    expect(response).toEqual({
      status: 200,
      body: '<rss/>',
      finalUrl: 'https://example.test/final',
    });
    expect(fetchUrlSafely).toHaveBeenCalledWith('https://example.test/feed', {
      signal: init.signal,
      timeoutMs: 8000,
      maxBytes: 1024,
      accept: 'application/rss+xml',
      userAgent: USER_AGENT,
      requireHtml: false,
      rejectBadStatus: false,
      verifyCertificate: true,
    });
  });

  it('hands a bad status back as an answer, since the sources tell them apart', async () => {
    fetchUrlSafely.mockResolvedValue(answer(429, 'slow down'));

    const response = await createSafeDiscoverFetch(USER_AGENT)('https://example.test/feed', init);

    expect(response.status).toBe(429);
  });

  it('lets a caller say who it is', async () => {
    fetchUrlSafely.mockResolvedValue(answer(200, ''));

    await createSafeDiscoverFetch(USER_AGENT)('https://example.test/feed', {
      ...init,
      userAgent: 'Someone/1.0',
    });

    expect(fetchUrlSafely.mock.calls[0][1].userAgent).toBe('Someone/1.0');
  });

  it('lets a refused address throw, which is what a source reads as trouble', async () => {
    fetchUrlSafely.mockRejectedValue(new Error('unsafe address'));

    await expect(
      createSafeDiscoverFetch(USER_AGENT)('http://169.254.169.254/', init),
    ).rejects.toThrow('unsafe address');
  });
});

describe('createDiscoverEngine', () => {
  it('reads recordings, and never the guarded fetch, under simulation', async () => {
    const engine = createDiscoverEngine(env({ DISCOVER_SIMULATION: 'true' }));

    const trends = await engine.trends.fetch({ locality: TAMIL_NADU, language: 'ta' });
    const place = await engine.geocoder?.reverse(13.08, 80.27);

    expect(engine.simulation).toBe(true);
    expect(trends.items).toHaveLength(10);
    expect(place?.regionCode).toBe('IN-TN');
    expect(fetchUrlSafely).not.toHaveBeenCalled();
  });

  it('reads the real feeds through the guarded fetch otherwise, saying who it is', async () => {
    fetchUrlSafely.mockResolvedValue(answer(200, EMPTY_RSS));
    const engine = createDiscoverEngine(env());

    await engine.trends.fetch({ locality: TAMIL_NADU, language: 'ta' });

    expect(engine.simulation).toBe(false);
    const [url, options] = fetchUrlSafely.mock.calls[0];
    expect(url).toContain('https://trends.google.com/');
    expect(options.userAgent).toBe(USER_AGENT);
    expect(options.verifyCertificate).toBe(true);
  });

  it('asks OpenStreetMap through the same door, in English', async () => {
    fetchUrlSafely.mockResolvedValue(
      answer(
        200,
        JSON.stringify({
          address: { country_code: 'in', state: 'Tamil Nadu', 'ISO3166-2-lvl4': 'IN-TN' },
        }),
      ),
    );
    const engine = createDiscoverEngine(env());

    const place = await engine.geocoder?.reverse(13.08, 80.27);

    expect(place?.regionCode).toBe('IN-TN');
    const [url, options] = fetchUrlSafely.mock.calls[0];
    expect(new URL(url).hostname).toBe('nominatim.openstreetmap.org');
    expect(new URL(url).searchParams.get('accept-language')).toBe('en');
    expect(options.userAgent).toBe(USER_AGENT);
  });

  it('turns finding places off in both worlds, and leaves the feeds on', () => {
    for (const DISCOVER_SIMULATION of ['true', 'false'] as const) {
      const engine = createDiscoverEngine(env({ DISCOVER_SIMULATION, DISCOVER_GEOCODER: 'off' }));
      expect(engine.geocoder).toBeNull();
      expect(engine.trends.id).toBe('google-trends');
      expect(engine.news.id).toBe('google-news');
    }
  });
});
