/**
 * Fresh, stale, missing and the lock, on a fake clock. The behaviour that pays for
 * the module is in the stale tests: the person is answered at once, and however many
 * people ask, the source hears about it once.
 */
import { Logger } from '@nestjs/common';
import { DiscoverCache, LOCK_SECONDS, type LoadOptions } from './discover.cache';
import { FakeRedis } from './testing/fake-redis';

interface Entry {
  fetchedAt: string;
  value: string;
  retryAfterMs?: number;
}

const KEY = 'discover:feed:v1:test';
const FRESH_MS = 20 * 60_000;
const KEEP_SECONDS = 6 * 60 * 60;

function entryNow(value: string, extra: Partial<Entry> = {}): Entry {
  return { fetchedAt: new Date().toISOString(), value, ...extra };
}

function build() {
  const redis = new FakeRedis();
  const cache = new DiscoverCache(redis.asService());
  return { redis, cache };
}

function options(
  refresh: LoadOptions<Entry>['refresh'],
  extra: Partial<LoadOptions<Entry>> = {},
): LoadOptions<Entry> {
  return { freshMs: () => FRESH_MS, keepSeconds: KEEP_SECONDS, refresh, ...extra };
}

/** Lets a refresh that was started in the background finish. */
async function settle(): Promise<void> {
  await jest.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-05T06:00:00.000Z'));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('nothing cached', () => {
  it('fetches, keeps it and answers it', async () => {
    const { cache, redis } = build();
    const refresh = jest.fn(async () => entryNow('one'));

    const loaded = await cache.load<Entry>(KEY, options(refresh));

    expect(loaded.state).toBe('fresh');
    expect(loaded.entry?.value).toBe('one');
    expect(refresh).toHaveBeenCalledWith(null);
    expect(JSON.parse(redis.read(KEY) as string).value).toBe('one');
  });

  it('keeps it for the keep window and not a moment longer', async () => {
    const { cache, redis } = build();
    await cache.load<Entry>(
      KEY,
      options(async () => entryNow('one')),
    );

    await jest.advanceTimersByTimeAsync((KEEP_SECONDS - 1) * 1000);
    expect(redis.read(KEY)).not.toBeNull();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(redis.read(KEY)).toBeNull();
  });

  it('runs beforeMiss first, and only on a miss', async () => {
    const { cache } = build();
    const beforeMiss = jest.fn(async () => undefined);
    const load = () =>
      cache.load<Entry>(
        KEY,
        options(async () => entryNow('one'), { beforeMiss }),
      );

    await load();
    await load();

    expect(beforeMiss).toHaveBeenCalledTimes(1);
  });

  it('fetches nothing when beforeMiss refuses, and leaves no lock behind', async () => {
    const { cache, redis } = build();
    const refresh = jest.fn(async () => entryNow('one'));

    await expect(
      cache.load<Entry>(
        KEY,
        options(refresh, {
          beforeMiss: async () => {
            throw new Error('over the limit');
          },
        }),
      ),
    ).rejects.toThrow('over the limit');

    expect(refresh).not.toHaveBeenCalled();
    expect(redis.keys).toEqual([]);
  });
});

describe('someone else is already fetching', () => {
  it('waits, and answers what they bring back', async () => {
    const { cache, redis } = build();
    await redis.setIfAbsent(`discover:lock:${KEY}`, '1', LOCK_SECONDS);
    const refresh = jest.fn(async () => entryNow('mine'));

    const waiting = cache.load<Entry>(KEY, options(refresh));
    await jest.advanceTimersByTimeAsync(500);
    redis.write(KEY, JSON.stringify(entryNow('theirs')), KEEP_SECONDS);
    await jest.advanceTimersByTimeAsync(250);

    const loaded = await waiting;
    expect(loaded.entry?.value).toBe('theirs');
    expect(loaded.state).toBe('fresh');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('gives up after three seconds, without fetching', async () => {
    const { cache, redis } = build();
    await redis.setIfAbsent(`discover:lock:${KEY}`, '1', LOCK_SECONDS);
    const refresh = jest.fn(async () => entryNow('mine'));

    const waiting = cache.load<Entry>(KEY, options(refresh));
    await jest.advanceTimersByTimeAsync(3_000);

    await expect(waiting).resolves.toEqual({ entry: null, state: 'missing' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('sends two people asking at once to the source only once', async () => {
    const { cache } = build();
    let finish: (entry: Entry) => void = () => undefined;
    const refresh = jest.fn(
      () =>
        new Promise<Entry>((resolve) => {
          finish = resolve;
        }),
    );

    const first = cache.load<Entry>(KEY, options(refresh));
    const second = cache.load<Entry>(KEY, options(refresh));
    await jest.advanceTimersByTimeAsync(300);
    finish(entryNow('one'));
    await jest.advanceTimersByTimeAsync(250);

    expect((await first).entry?.value).toBe('one');
    expect((await second).entry?.value).toBe('one');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('a fresh copy', () => {
  it('is the answer, and costs nothing', async () => {
    const { cache } = build();
    await cache.load<Entry>(
      KEY,
      options(async () => entryNow('one')),
    );
    await jest.advanceTimersByTimeAsync(FRESH_MS - 1);
    const refresh = jest.fn(async () => entryNow('two'));

    const loaded = await cache.load<Entry>(KEY, options(refresh));

    expect(loaded).toMatchObject({ state: 'fresh', entry: { value: 'one' } });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('can say it is good for less time, which is how a failure gets retried', async () => {
    const { cache } = build();
    const freshMs = (entry: Entry) => entry.retryAfterMs ?? FRESH_MS;
    await cache.load<Entry>(
      KEY,
      options(async () => entryNow('one', { retryAfterMs: 60_000 }), { freshMs }),
    );

    await jest.advanceTimersByTimeAsync(59_000);
    const before = await cache.load<Entry>(
      KEY,
      options(async () => entryNow('x'), { freshMs }),
    );
    await jest.advanceTimersByTimeAsync(2_000);
    const after = await cache.load<Entry>(
      KEY,
      options(async () => entryNow('x'), { freshMs }),
    );

    expect(before.state).toBe('fresh');
    expect(after.state).toBe('stale');
  });
});

describe('a stale copy', () => {
  async function staleCache() {
    const built = build();
    await built.cache.load<Entry>(
      KEY,
      options(async () => entryNow('old')),
    );
    await jest.advanceTimersByTimeAsync(FRESH_MS);
    return built;
  }

  it('is answered at once, before the refresh has finished', async () => {
    const { cache } = await staleCache();
    const refresh = jest.fn(() => new Promise<Entry>(() => undefined));

    const loaded = await cache.load<Entry>(KEY, options(refresh));

    expect(loaded).toMatchObject({ state: 'stale', entry: { value: 'old' } });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('hands the old copy to the refresh', async () => {
    const { cache } = await staleCache();
    const refresh = jest.fn(async () => entryNow('new'));

    await cache.load<Entry>(KEY, options(refresh));

    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ value: 'old' }));
  });

  it('is refreshed once, however many people ask', async () => {
    const { cache } = await staleCache();
    const refresh = jest.fn(async () => entryNow('new'));

    await Promise.all([
      cache.load<Entry>(KEY, options(refresh)),
      cache.load<Entry>(KEY, options(refresh)),
      cache.load<Entry>(KEY, options(refresh)),
    ]);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('is replaced, so the next person gets the new one', async () => {
    const { cache } = await staleCache();

    await cache.load<Entry>(
      KEY,
      options(async () => entryNow('new')),
    );
    await settle();

    const next = await cache.load<Entry>(
      KEY,
      options(async () => entryNow('unused')),
    );
    expect(next).toMatchObject({ state: 'fresh', entry: { value: 'new' } });
  });

  it('runs no beforeMiss: asking about a place someone already asked about is not a miss', async () => {
    const { cache } = await staleCache();
    const beforeMiss = jest.fn(async () => undefined);

    await cache.load<Entry>(
      KEY,
      options(async () => entryNow('new'), { beforeMiss }),
    );

    expect(beforeMiss).not.toHaveBeenCalled();
  });

  it('survives a refresh that fails, says so, and tries again only after the lock', async () => {
    const { cache } = await staleCache();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const refresh = jest.fn(async (): Promise<Entry> => {
      throw new Error('upstream fell over');
    });

    const first = await cache.load<Entry>(KEY, options(refresh));
    await settle();
    expect(first.entry?.value).toBe('old');
    expect(warn.mock.calls[0][0]).toContain('discover.feed.refresh_failed');

    await cache.load<Entry>(KEY, options(refresh));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(LOCK_SECONDS * 1000);
    await cache.load<Entry>(KEY, options(refresh));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe('a copy that cannot be read', () => {
  it.each([
    ['is not JSON', 'not json'],
    ['has no date', JSON.stringify({ value: 'x' })],
    ['has a date that is not one', JSON.stringify({ fetchedAt: 'yesterday', value: 'x' })],
  ])('counts as nothing when it %s', async (_name, raw) => {
    const { cache, redis } = build();
    redis.write(KEY, raw, KEEP_SECONDS);

    const loaded = await cache.load<Entry>(
      KEY,
      options(async () => entryNow('new')),
    );

    expect(loaded).toMatchObject({ state: 'fresh', entry: { value: 'new' } });
    expect(JSON.parse(redis.read(KEY) as string).value).toBe('new');
  });
});
