import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoverFetch, DiscoverFetchResponse } from '../../types';
import { WORLDWIDE } from '../locality';
import { createNominatimGeocoder, GeocoderError, placeFromNominatim } from './nominatim';
import { createSimulatedGeocoder } from './simulated';

/** The answer quoted in research 03, section 3. */
const CHENNAI_ANSWER = readFileSync(
  join(__dirname, '..', '..', '..', 'fixtures', 'nominatim', 'chennai-reverse.json'),
  'utf8',
);

const USER_AGENT = 'PostGear/1.0 (+https://postgear.rkay.in; contact: test)';

function geocoderAnswering(response: Partial<DiscoverFetchResponse> | Error) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    if (response instanceof Error) throw response;
    return { status: 200, body: '', finalUrl: url, ...response };
  });
  return {
    fetchMock,
    geocoder: createNominatimGeocoder({ fetch: fetchMock, userAgent: USER_AGENT }),
  };
}

describe('Nominatim reverse', () => {
  it('maps the recorded Chennai answer to IN-TN', async () => {
    const { geocoder } = geocoderAnswering({ body: CHENNAI_ANSWER });
    expect(await geocoder.reverse(13.08, 80.27)).toEqual({
      countryCode: 'IN',
      countryName: 'India',
      regionCode: 'IN-TN',
      regionName: 'Tamil Nadu',
      city: 'Chennai',
      timeZone: 'Asia/Kolkata',
      languages: ['ta', 'en'],
    });
  });

  it('asks for city level, in English, as the identifying application', async () => {
    const { fetchMock, geocoder } = geocoderAnswering({ body: CHENNAI_ANSWER });
    await geocoder.reverse(13.08, 80.27);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('https://nominatim.openstreetmap.org/reverse?');
    expect(url).toContain('format=jsonv2');
    expect(url).toContain('zoom=10');
    expect(url).toContain('addressdetails=1');
    expect(url).toContain('accept-language=en');
    expect(url).toContain('lat=13.08');
    expect(url).toContain('lon=80.27');
    expect(init.userAgent).toBe(USER_AGENT);
  });

  it('is Worldwide for the open sea', async () => {
    const { geocoder } = geocoderAnswering({ body: '{"error":"Unable to geocode"}' });
    expect(await geocoder.reverse(0, 0)).toEqual(WORLDWIDE);
  });

  it('asks a self-hosted instance when given one, and refuses an address that is not a web one', async () => {
    const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(
      async (url) => ({ status: 200, body: CHENNAI_ANSWER, finalUrl: url }),
    );
    const geocoder = createNominatimGeocoder({
      fetch: fetchMock,
      userAgent: USER_AGENT,
      baseUrl: 'https://geo.internal.example/nominatim/',
    });
    await geocoder.reverse(13.08, 80.27);
    await geocoder.search('Chennai');

    expect(fetchMock.mock.calls[0][0]).toMatch(
      /^https:\/\/geo\.internal\.example\/nominatim\/reverse\?/,
    );
    expect(fetchMock.mock.calls[1][0]).toMatch(
      /^https:\/\/geo\.internal\.example\/nominatim\/search\?/,
    );
    for (const baseUrl of ['file:///etc/passwd', 'not an address', 'https://geo.example/?q=1']) {
      expect(() =>
        createNominatimGeocoder({ fetch: fetchMock, userAgent: USER_AGENT, baseUrl }),
      ).toThrow();
    }
  });
});

describe('Nominatim search', () => {
  const answer = (city: string, code: string) => ({
    address: {
      city,
      state: 'State',
      'ISO3166-2-lvl4': code,
      country_code: code.slice(0, 2).toLowerCase(),
    },
  });

  it('asks for eight results and maps them', async () => {
    const { fetchMock, geocoder } = geocoderAnswering({
      body: JSON.stringify([answer('Paris', 'FR-IDF'), answer('Paris', 'US-TX')]),
    });
    const places = await geocoder.search('Paris');

    expect(places.map((place) => place.regionCode)).toEqual(['FR-IDF', 'US-TX']);
    expect(fetchMock.mock.calls[0][0]).toContain('limit=8');
    expect(fetchMock.mock.calls[0][0]).toContain('q=Paris');
  });

  it('shows one row for several matches that are the same place', async () => {
    const { geocoder } = geocoderAnswering({
      body: JSON.stringify([answer('Paris', 'FR-IDF'), answer('Paris', 'FR-IDF')]),
    });
    expect(await geocoder.search('Paris')).toHaveLength(1);
  });

  it('drops a match with no country, and is empty for an odd answer', async () => {
    const first = geocoderAnswering({ body: JSON.stringify([{ address: { city: 'Nowhere' } }]) });
    expect(await first.geocoder.search('Nowhere')).toEqual([]);

    const second = geocoderAnswering({ body: '{"unexpected":true}' });
    expect(await second.geocoder.search('Nowhere')).toEqual([]);
  });
});

describe('Nominatim failures', () => {
  it('tells rate limiting apart from an outage', async () => {
    await expect(geocoderAnswering({ status: 429 }).geocoder.reverse(1, 2)).rejects.toMatchObject({
      name: 'GeocoderError',
      kind: 'rate_limited',
    });
    await expect(geocoderAnswering({ status: 503 }).geocoder.reverse(1, 2)).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await expect(
      geocoderAnswering({ body: '<html>' }).geocoder.reverse(1, 2),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('never repeats a position or a typed query, even when the fetch quotes them', async () => {
    const leaky = new Error('GET https://nominatim.openstreetmap.org/reverse?lat=13.08&lon=80.27');
    const { geocoder } = geocoderAnswering(leaky);

    const failure = await geocoder.reverse(13.08, 80.27).catch((error: GeocoderError) => error);
    expect(failure).toBeInstanceOf(GeocoderError);
    expect(JSON.stringify(failure)).not.toContain('13.08');
    expect((failure as GeocoderError).message).not.toContain('13.08');
    expect((failure as GeocoderError).cause).toBeUndefined();

    const typed = geocoderAnswering({ status: 500 });
    const searched = await typed.geocoder
      .search('my secret village')
      .catch((error: GeocoderError) => error);
    expect((searched as GeocoderError).message).not.toContain('secret');
  });
});

describe('placeFromNominatim', () => {
  it('takes the city from the first field present, in order', () => {
    const address = { country_code: 'in', county: 'County', village: 'Village', town: 'Town' };
    expect(placeFromNominatim({ address })?.city).toBe('Town');
    expect(placeFromNominatim({ address: { ...address, town: undefined } })?.city).toBe('Village');
    expect(placeFromNominatim({ address: { country_code: 'in', county: 'County' } })?.city).toBe(
      'County',
    );
  });

  it('takes the region from level 4, then the other levels', () => {
    const lvl3 = { country_code: 'gb', 'ISO3166-2-lvl3': 'GB-WLS' };
    expect(placeFromNominatim({ address: lvl3 })?.regionCode).toBe('GB-WLS');
    expect(
      placeFromNominatim({ address: { ...lvl3, 'ISO3166-2-lvl4': 'GB-CRF' } })?.regionCode,
    ).toBe('GB-CRF');
  });

  it('ignores a region code that is not one', () => {
    const address = { country_code: 'in', 'ISO3166-2-lvl4': 'not a code' };
    expect(placeFromNominatim({ address })?.regionCode).toBeNull();
  });

  it('is null with no country', () => {
    expect(placeFromNominatim({ error: 'Unable to geocode' })).toBeNull();
    expect(placeFromNominatim({ address: { city: 'Somewhere' } })).toBeNull();
  });
});

describe('the simulated geocoder', () => {
  const geocoder = createSimulatedGeocoder();

  it.each([
    [13.08, 80.27, 'Chennai', 'IN-TN'],
    [13.2, 80.4, 'Chennai', 'IN-TN'],
    [37.77, -122.42, 'San Francisco', 'US-CA'],
    [48.86, 2.35, 'Paris', 'FR-IDF'],
  ])('answers %d, %d as %s', async (lat, lng, city, region) => {
    expect(await geocoder.reverse(lat, lng)).toMatchObject({ city, regionCode: region });
  });

  it('is Worldwide more than 50 km away', async () => {
    expect(await geocoder.reverse(13.08, 81.0)).toEqual(WORLDWIDE);
    expect(await geocoder.reverse(0, 0)).toEqual(WORLDWIDE);
  });

  it('searches the three names, whatever the case', async () => {
    expect((await geocoder.search('chENNai')).map((place) => place.city)).toEqual(['Chennai']);
    expect((await geocoder.search(' san ')).map((place) => place.city)).toEqual(['San Francisco']);
    expect(await geocoder.search('Mumbai')).toEqual([]);
    expect(await geocoder.search('  ')).toEqual([]);
  });

  it('reads the browser zone the same way the real one does', () => {
    expect(geocoder.fromTimeZone('Asia/Kolkata').countryCode).toBe('IN');
    expect(geocoder.fromTimeZone('Etc/UTC')).toEqual(WORLDWIDE);
  });

  it('hands out copies, so one caller cannot change what the next one gets', async () => {
    const first = await geocoder.reverse(13.08, 80.27);
    first.city = 'Changed';
    expect((await geocoder.reverse(13.08, 80.27)).city).toBe('Chennai');
  });
});
