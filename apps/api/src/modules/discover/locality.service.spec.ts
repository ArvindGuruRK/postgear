/**
 * Finding a place inside OpenStreetMap's rules: one request a second across the
 * deployment, answers kept, a limit on a person asking, and nothing about where
 * anyone is left behind in a key or a log line.
 */
import { HttpException, Logger } from '@nestjs/common';
import {
  CHENNAI,
  type Geocoder,
  GeocoderError,
  type Locality,
  PARIS,
} from '@postgear/discover-engine';
import { securityLogger } from '../../common/logging/security-logger';
import type { DiscoverEngine } from './discover.engine';
import { GEO_CACHE_SECONDS, LOCALITY_LIMIT_PER_MINUTE, LocalityService } from './locality.service';
import { FakeRedis } from './testing/fake-redis';

const ORG = 'org-1';

function fakeGeocoder(): jest.Mocked<Geocoder> {
  return {
    reverse: jest.fn().mockResolvedValue(CHENNAI),
    search: jest.fn().mockResolvedValue([PARIS]),
    fromTimeZone: jest.fn(),
  };
}

function build(options: { simulation?: boolean; geocoder?: Geocoder | null } = {}) {
  const redis = new FakeRedis();
  const geocoder = options.geocoder === undefined ? fakeGeocoder() : options.geocoder;
  const engine = { simulation: options.simulation ?? false, geocoder } as DiscoverEngine;
  const service = new LocalityService(engine, redis.asService());
  return { service, redis, geocoder: geocoder as jest.Mocked<Geocoder> };
}

async function refusal(work: Promise<unknown>): Promise<{ status: number; code: string }> {
  const error = await work.then(
    () => {
      throw new Error('Expected a refusal');
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpException);
  const { code } = (error as HttpException).getResponse() as { code: string };
  return { status: (error as HttpException).getStatus(), code };
}

let securityWarn: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  securityWarn = jest.spyOn(securityLogger, 'warn').mockImplementation();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Past the budget's one second, so the next upstream call does not have to wait. */
async function nextSecond(): Promise<void> {
  await jest.advanceTimersByTimeAsync(1_001);
}

describe('LocalityService.fromTimeZone', () => {
  it('answers at country level with no outside call and no count', () => {
    const { service, geocoder, redis } = build();

    const place = service.fromTimeZone('Asia/Kolkata');

    expect(place.countryCode).toBe('IN');
    expect(place.regionCode).toBeNull();
    expect(geocoder.reverse).not.toHaveBeenCalled();
    expect(redis.keys).toEqual([]);
  });

  it('is Worldwide for a zone it cannot place', () => {
    expect(build().service.fromTimeZone('Etc/UTC').countryCode).toBeNull();
  });

  it('keeps working with finding places turned off', () => {
    const { service } = build({ geocoder: null });

    expect(service.fromTimeZone('Europe/Paris').countryCode).toBe('FR');
  });
});

describe('LocalityService.reverse', () => {
  it('finds the place, and keeps the answer for 30 days', async () => {
    const { service, geocoder, redis } = build();

    await expect(service.reverse(ORG, 13.08, 80.27)).resolves.toEqual(CHENNAI);
    expect(geocoder.reverse).toHaveBeenCalledWith(13.08, 80.27);

    const key = redis.keys.find((name) => name.includes(':geo:rev:')) as string;
    await jest.advanceTimersByTimeAsync((GEO_CACHE_SECONDS - 1) * 1000);
    expect(redis.read(key)).not.toBeNull();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(redis.read(key)).toBeNull();
  });

  it('does not ask twice for the same position', async () => {
    const { service, geocoder } = build();

    await service.reverse(ORG, 13.08, 80.27);
    await nextSecond();
    await service.reverse('org-2', 13.08, 80.27);

    expect(geocoder.reverse).toHaveBeenCalledTimes(1);
  });

  it('asks again for another position', async () => {
    const { service, geocoder } = build();

    await service.reverse(ORG, 13.08, 80.27);
    await nextSecond();
    await service.reverse(ORG, 48.85, 2.35);

    expect(geocoder.reverse).toHaveBeenCalledTimes(2);
  });
});

describe('LocalityService.search', () => {
  it('asks with the text as typed, and shares the answer between spellings of case', async () => {
    const { service, geocoder } = build();

    await expect(service.search(ORG, 'Paris')).resolves.toEqual([PARIS]);
    await nextSecond();
    await service.search(ORG, 'PARIS');

    expect(geocoder.search).toHaveBeenCalledTimes(1);
    expect(geocoder.search).toHaveBeenCalledWith('Paris');
  });

  it('keeps an empty answer too, so a place that does not exist stops costing a call', async () => {
    const { service, geocoder } = build();
    geocoder.search.mockResolvedValue([]);

    await expect(service.search(ORG, 'Nowhere')).resolves.toEqual([]);
    await nextSecond();
    await expect(service.search(ORG, 'nowhere')).resolves.toEqual([]);

    expect(geocoder.search).toHaveBeenCalledTimes(1);
  });

  it('never mixes a search answer with a position answer', async () => {
    const { service } = build();

    const found: Locality[] = await service.search(ORG, 'Paris');
    await nextSecond();
    const place: Locality = await service.reverse(ORG, 13.08, 80.27);

    expect(found[0].city).toBe('Paris');
    expect(place.city).toBe('Chennai');
  });
});

describe('the limit on asking', () => {
  it('refuses the sixth call in a minute, even when the answer is cached', async () => {
    const { service, geocoder } = build();

    for (let call = 0; call < LOCALITY_LIMIT_PER_MINUTE; call += 1) {
      await service.reverse(ORG, 13.08, 80.27);
    }

    await expect(refusal(service.reverse(ORG, 13.08, 80.27))).resolves.toEqual({
      status: 429,
      code: 'locality_throttled',
    });
    expect(geocoder.reverse).toHaveBeenCalledTimes(1);
  });

  it('counts positions and searches together', async () => {
    const { service } = build();

    for (let call = 0; call < LOCALITY_LIMIT_PER_MINUTE; call += 1) {
      await service.search(ORG, 'Paris');
    }

    await expect(refusal(service.reverse(ORG, 13.08, 80.27))).resolves.toMatchObject({
      status: 429,
    });
  });

  it('says which workspace, and nothing else', async () => {
    const { service } = build();

    for (let call = 0; call < LOCALITY_LIMIT_PER_MINUTE; call += 1) {
      await service.reverse(ORG, 13.08, 80.27);
    }
    await refusal(service.reverse(ORG, 13.08, 80.27));

    expect(securityWarn).toHaveBeenCalledWith('discover.locality_throttled', { orgId: ORG });
  });

  it('is per workspace, and over after a minute', async () => {
    const { service } = build();

    for (let call = 0; call < LOCALITY_LIMIT_PER_MINUTE; call += 1) {
      await service.reverse(ORG, 13.08, 80.27);
    }
    await refusal(service.reverse(ORG, 13.08, 80.27));

    await expect(service.reverse('org-2', 13.08, 80.27)).resolves.toEqual(CHENNAI);

    await jest.advanceTimersByTimeAsync(60_000);
    await expect(service.reverse(ORG, 13.08, 80.27)).resolves.toEqual(CHENNAI);
  });
});

describe('one request a second', () => {
  it('makes the second caller wait for its turn, then asks', async () => {
    const { service, geocoder } = build();

    await service.reverse(ORG, 13.08, 80.27);
    const second = service.reverse('org-2', 48.85, 2.35);
    await jest.advanceTimersByTimeAsync(500);
    expect(geocoder.reverse).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(600);
    await second;
    expect(geocoder.reverse).toHaveBeenCalledTimes(2);
  });

  it('holds across workspaces, which is the whole reason it is in Redis', async () => {
    const { service, redis } = build();

    await service.reverse(ORG, 13.08, 80.27);

    expect(await redis.setIfAbsent('discover:budget:nominatim', '1', 1)).toBe(false);
    await expect(service.reverse('org-2', 13.08, 80.27)).resolves.toEqual(CHENNAI);
  });

  it('refuses when the wait runs out, without having asked', async () => {
    const { service, geocoder, redis } = build();
    jest.spyOn(redis, 'setIfAbsent').mockResolvedValue(false);

    const outcome = refusal(service.reverse(ORG, 13.08, 80.27));
    await jest.advanceTimersByTimeAsync(2_100);

    await expect(outcome).resolves.toEqual({ status: 429, code: 'locality_throttled' });
    expect(geocoder.reverse).not.toHaveBeenCalled();
  });

  it('spends nothing on a cached answer', async () => {
    const { service, redis } = build();

    await service.reverse(ORG, 13.08, 80.27);
    await nextSecond();
    const budget = jest.spyOn(redis, 'setIfAbsent');
    await service.reverse(ORG, 13.08, 80.27);

    expect(budget).not.toHaveBeenCalled();
  });

  it('has a waiter take the answer the one before it brought back', async () => {
    const { service, geocoder } = build();

    const first = service.reverse(ORG, 13.08, 80.27);
    const second = service.reverse('org-2', 13.08, 80.27);
    await first;
    await jest.advanceTimersByTimeAsync(1_100);

    await expect(second).resolves.toEqual(CHENNAI);
    expect(geocoder.reverse).toHaveBeenCalledTimes(1);
  });
});

describe('when OpenStreetMap cannot answer', () => {
  it('reads its 429 as ours, so the page says to try again', async () => {
    const { service, geocoder } = build();
    geocoder.reverse.mockRejectedValue(new GeocoderError('rate_limited', 'Nominatim said 429'));

    await expect(refusal(service.reverse(ORG, 13.08, 80.27))).resolves.toEqual({
      status: 429,
      code: 'locality_throttled',
    });
  });

  it('offers the search box when a position cannot be placed', async () => {
    const { service, geocoder } = build();
    geocoder.reverse.mockRejectedValue(new GeocoderError('unavailable', 'Nominatim said 500'));

    const error = await service.reverse(ORG, 13.08, 80.27).catch((caught: unknown) => caught);

    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'locality_unavailable',
      message: 'We could not find your location. Search for your city instead.',
    });
  });

  it('does not offer the search box when that is what failed', async () => {
    const { service, geocoder } = build();
    geocoder.search.mockRejectedValue(new GeocoderError('unavailable', 'Nominatim said 500'));

    const error = await service.search(ORG, 'Paris').catch((caught: unknown) => caught);

    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'locality_unavailable',
      message: 'We could not look up places just now. Try again in a moment.',
    });
  });

  it('keeps no failure, so the next person gets a real attempt', async () => {
    const { service, geocoder } = build();
    geocoder.reverse.mockRejectedValueOnce(new GeocoderError('unavailable', 'down'));

    await refusal(service.reverse(ORG, 13.08, 80.27));
    await nextSecond();

    await expect(service.reverse(ORG, 13.08, 80.27)).resolves.toEqual(CHENNAI);
  });

  it('lets anything unexpected through, for the filter to report', async () => {
    const { service, geocoder } = build();
    geocoder.reverse.mockRejectedValue(new TypeError('a bug'));

    await expect(service.reverse(ORG, 13.08, 80.27)).rejects.toThrow(TypeError);
  });
});

describe('with finding places turned off', () => {
  it('answers 503, and spends none of the limit on it', async () => {
    const { service, redis } = build({ geocoder: null });

    await expect(refusal(service.reverse(ORG, 13.08, 80.27))).resolves.toEqual({
      status: 503,
      code: 'geocoder_off',
    });
    await expect(refusal(service.search(ORG, 'Paris'))).resolves.toEqual({
      status: 503,
      code: 'geocoder_off',
    });
    expect(redis.keys).toEqual([]);
  });
});

describe('what is left behind', () => {
  it('leaves no position and no typed text in a key, a value or a log line', async () => {
    const { service, geocoder, redis } = build();
    const logs = [
      securityWarn,
      Logger.prototype.warn as jest.Mock,
      jest.spyOn(Logger.prototype, 'log').mockImplementation(),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(),
    ];

    await service.reverse(ORG, 13.08, 80.27);
    await nextSecond();
    await service.search(ORG, 'Mylapore');
    await nextSecond();
    geocoder.reverse.mockRejectedValueOnce(new GeocoderError('unavailable', 'down'));
    await refusal(service.reverse(ORG, 12.34, 56.78));
    await nextSecond();
    for (let call = 0; call < LOCALITY_LIMIT_PER_MINUTE; call += 1) {
      await service.reverse(ORG, 12.97, 77.59).catch(() => undefined);
      await nextSecond();
    }

    const everything = JSON.stringify([
      redis.keys,
      redis.keys.map((key) => redis.read(key)),
      logs.map((log) => log.mock.calls),
    ]);
    expect(everything).not.toMatch(/13\.08|80\.27|12\.34|56\.78|12\.97|77\.59|mylapore/i);
  });

  it('keeps simulated and real answers apart', async () => {
    const real = build();
    const simulated = build({ simulation: true });

    await real.service.reverse(ORG, 13.08, 80.27);
    await simulated.service.reverse(ORG, 13.08, 80.27);

    const placeKey = (redis: FakeRedis) =>
      redis.keys.find((key) => key.includes(':geo:rev:')) as string;
    expect(placeKey(real.redis)).toMatch(/^discover:geo:rev:[0-9a-f]{64}$/);
    expect(placeKey(simulated.redis)).toMatch(/^discover:sim:geo:rev:[0-9a-f]{64}$/);
  });
});
