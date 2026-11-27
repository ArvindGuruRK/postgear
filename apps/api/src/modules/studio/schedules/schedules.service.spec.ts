/**
 * The Schedule Maker's fetch (Sprint 13, Module 14 section C3): the body,
 * the week, the throttle, the cache, the Twitch calls (mocked at the HTTP
 * layer, so nothing reaches the network), the simulation fixtures, and the
 * promise that no secret, token or schedule text reaches a log line.
 */
import { HttpException, Logger } from '@nestjs/common';
import {
  convertWeek,
  SAMPLE_WEEK,
  scheduleZoneLine,
  segmentsToRows,
} from '@postgear/design-engine';
import type { ListerHttp, ListerHttpRequest } from '../../clips/channels/listers/lister-http';
import { TwitchAppToken } from '../../clips/channels/listers/twitch-app-token';
import { FakeRedis } from '../../discover/testing/fake-redis';
import { fetchScheduleSchema } from './dto/schedules.schema';
import { SIMSTREAMER, SIMVACATION } from './fixtures';
import { FRESH_MS, ScheduleCache, scheduleCacheKey, STALE_LIMIT_MS } from './schedule.cache';
import { ScheduleFetchFailure, type ScheduleOutcome, type ScheduleSource } from './schedule-source';
import { createScheduleSource } from './schedule-source.factory';
import { SCHEDULE_MESSAGES } from './schedules.messages';
import {
  fetchWindow,
  SCHEDULE_FETCHES_PER_MINUTE,
  type ScheduleAnswer,
  SchedulesService,
} from './schedules.service';
import { outcomeOf, SimulatedScheduleSource } from './simulated-schedule.source';
import { TwitchScheduleClient } from './twitch-schedule.client';

const ORG = 'org-1';
const SECRET = 'super-secret-client-value';
const CLIENT_ID = 'client-id-value';
const TOKEN = 'app-token-value-123';
/** Thursday 26 November 2026, noon UTC: the current week starts Monday 23 November. */
const NOW = Date.parse('2026-11-26T12:00:00.000Z');
const WEEK = '2026-11-23';

const input = (overrides: Record<string, unknown> = {}) =>
  fetchScheduleSchema.parse({
    login: 'simstreamer',
    timeZone: 'Asia/Kolkata',
    weekStart: WEEK,
    ...overrides,
  });

async function refusal(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() };
    }
    throw error;
  }
  throw new Error('Expected a refusal.');
}

function service(source: ScheduleSource | null = new SimulatedScheduleSource(), now = () => NOW) {
  const redis = new FakeRedis();
  return { redis, schedules: new SchedulesService(source, redis.asService(), { now }) };
}

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

describe('the fetch body', () => {
  it('reduces a name, an @ name and a channel link to the login', () => {
    expect(input().login).toBe('simstreamer');
    expect(input({ login: '@SimStreamer' }).login).toBe('simstreamer');
    expect(input({ login: 'https://www.twitch.tv/SimStreamer/videos' }).login).toBe('simstreamer');
  });

  it('refuses a login Twitch could not have', () => {
    for (const login of ['abc', 'has space', 'a'.repeat(26), 'kick.com/simstreamer', '', 42]) {
      expect(
        fetchScheduleSchema.safeParse({ login, timeZone: 'UTC', weekStart: WEEK }).success,
      ).toBe(false);
    }
  });

  it('takes any zone Intl knows, including the ones its own list leaves out', () => {
    for (const timeZone of ['Asia/Kolkata', 'Asia/Calcutta', 'UTC', 'America/New_York']) {
      expect(input({ timeZone }).timeZone).toBe(timeZone);
    }
    for (const timeZone of ['Mars/Olympus', '../etc/passwd', '', 'x'.repeat(65)]) {
      expect(
        fetchScheduleSchema.safeParse({ login: 'simstreamer', timeZone, weekStart: WEEK }).success,
      ).toBe(false);
    }
  });

  it('refuses a date that is not one, and any field it does not know', () => {
    for (const weekStart of ['2026-02-30', '23/11/2026', 'next week', '']) {
      expect(
        fetchScheduleSchema.safeParse({ login: 'simstreamer', timeZone: 'UTC', weekStart }).success,
      ).toBe(false);
    }
    expect(
      fetchScheduleSchema.safeParse({
        login: 'simstreamer',
        timeZone: 'UTC',
        weekStart: WEEK,
        utcOffset: '+05:30',
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The week and the throttle
// ---------------------------------------------------------------------------

describe('the week', () => {
  it('moves any day to its Monday, and answers for that week', async () => {
    const { schedules } = service();
    const answer = await schedules.fetch(ORG, input({ weekStart: '2026-11-26' }));
    expect(answer.weekStart).toBe(WEEK);
  });

  it('takes this week and up to eight weeks ahead, and refuses the rest', async () => {
    const { schedules } = service();
    await expect(schedules.fetch(ORG, input({ weekStart: '2027-01-18' }))).resolves.toBeDefined();

    for (const weekStart of ['2026-11-16', '2027-01-25']) {
      expect(await refusal(schedules.fetch(ORG, input({ weekStart })))).toEqual({
        status: 400,
        body: { message: SCHEDULE_MESSAGES.WEEK_INVALID, code: 'schedule_week_invalid' },
      });
    }
  });

  it('reads this week in the asked zone', async () => {
    // Sunday 29 November, 20:00 UTC: still Sunday in New York, already Monday in Kolkata.
    const { schedules } = service(new SimulatedScheduleSource(), () =>
      Date.parse('2026-11-29T20:00:00.000Z'),
    );
    await expect(
      schedules.fetch(ORG, input({ weekStart: WEEK, timeZone: 'America/New_York' })),
    ).resolves.toBeDefined();
    expect(
      (await refusal(schedules.fetch(ORG, input({ weekStart: WEEK, timeZone: 'Asia/Kolkata' }))))
        .status,
    ).toBe(400);
  });
});

describe('the throttle', () => {
  it('allows ten fetches a minute per workspace, then answers 429', async () => {
    const { schedules } = service();
    for (let index = 0; index < SCHEDULE_FETCHES_PER_MINUTE; index++) {
      await schedules.fetch(ORG, input());
    }
    expect(await refusal(schedules.fetch(ORG, input()))).toEqual({
      status: 429,
      body: { message: SCHEDULE_MESSAGES.RATE_LIMITED, code: 'schedule_rate_limited' },
    });
    // Another workspace has its own ten.
    await expect(schedules.fetch('org-2', input())).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

describe('simulation', () => {
  it('answers simstreamer with a week that is the sample week in its home zone', async () => {
    const { schedules } = service();
    const answer = await schedules.fetch(ORG, input());

    expect(answer.broadcaster).toEqual({ login: 'simstreamer', displayName: 'SimStreamer' });
    expect(answer.noSchedule).toBeUndefined();
    // One cancelled stream, and a day with two.
    expect(answer.segments.filter((segment) => segment.canceledUntil)).toHaveLength(1);
    const rows = segmentsToRows(answer.segments, {
      timeZone: SIMSTREAMER.kind === 'found' ? SIMSTREAMER.homeZone : 'UTC',
      weekStart: answer.weekStart,
      hour12: true,
    });
    // Try A Sample fills the by-hand rows with SAMPLE_WEEK: this keeps the two the same week.
    expect(rows).toEqual(SAMPLE_WEEK);
  });

  it('moves the times with the zone, from the one answer', async () => {
    const { schedules } = service();
    const answer = await schedules.fetch(ORG, input());
    const inNewYork = segmentsToRows(answer.segments, {
      timeZone: 'America/New_York',
      weekStart: answer.weekStart,
      hour12: true,
    });
    // 7 PM Monday in Kolkata is 8:30 AM Monday in New York.
    expect(inNewYork[0]).toEqual({ day: 'Mon', time: '8:30 AM', title: 'Minecraft Hardcore' });
  });

  it('answers simvacation with a break the zone line reads', async () => {
    const { schedules } = service();
    const answer = await schedules.fetch(ORG, input({ login: 'simvacation' }));
    const week = convertWeek(answer.segments, {
      timeZone: 'Asia/Kolkata',
      weekStart: answer.weekStart,
      hour12: true,
      vacation: answer.vacation,
    });

    expect(week.vacationUntil).not.toBeNull();
    expect(scheduleZoneLine({ timeZone: 'Asia/Kolkata', vacationUntil: week.vacationUntil })).toBe(
      'On a break until Thu 26 Nov',
    );
    // The stream with no title is named by its category.
    expect(week.rows[4]).toEqual({ day: 'Fri', time: '8 PM', title: 'Minecraft' });
    expect(SIMVACATION.kind).toBe('found');
  });

  it('answers simnoschedule as no schedule, not an error, which the page turns into seven Off rows', async () => {
    const { schedules } = service();
    const answer = await schedules.fetch(ORG, input({ login: 'simnoschedule' }));

    expect(answer).toMatchObject({ segments: [], noSchedule: true, vacation: null });
    expect(
      segmentsToRows(answer.segments, { timeZone: 'UTC', weekStart: WEEK, hour12: true }).every(
        (row) => row.off,
      ),
    ).toBe(true);
  });

  it('answers simnouser as twitch_user_not_found', async () => {
    const { schedules } = service();
    expect(await refusal(schedules.fetch(ORG, input({ login: 'simnouser' })))).toEqual({
      status: 404,
      body: {
        message: 'We could not find that Twitch channel.',
        code: 'twitch_user_not_found',
      },
    });
  });

  it('reads any other name as the sample week under that name', () => {
    const outcome = outcomeOf(
      { ...SIMSTREAMER, login: 'anyname', displayName: 'anyname' } as never,
      WEEK,
    );
    expect(outcome.kind).toBe('found');
  });
});

// ---------------------------------------------------------------------------
// Which source is bound
// ---------------------------------------------------------------------------

describe('the source binding', () => {
  const config = (values: Record<string, string | undefined>) => ({
    get: (key: string) => values[key],
  });
  const redis = new FakeRedis().asService();
  const neverCalled: ListerHttp = jest.fn(async () => {
    throw new Error('No network in this spec.');
  });

  it('uses the fixtures in simulation, even with keys', () => {
    const source = createScheduleSource({
      config: config({
        CLIPS_SIMULATION: 'true',
        TWITCH_CLIENT_ID: CLIENT_ID,
        TWITCH_CLIENT_SECRET: SECRET,
        NODE_ENV: 'development',
      }) as never,
      redis,
      http: neverCalled,
    });
    expect(source?.mode).toBe('simulation');
  });

  it('uses Helix with both keys, the fixtures without keys in development, and nothing in production', () => {
    const helix = createScheduleSource({
      config: config({
        CLIPS_SIMULATION: 'false',
        TWITCH_CLIENT_ID: CLIENT_ID,
        TWITCH_CLIENT_SECRET: SECRET,
        NODE_ENV: 'development',
      }) as never,
      redis,
      http: neverCalled,
    });
    expect(helix?.mode).toBe('helix');

    const laptop = createScheduleSource({
      config: config({ CLIPS_SIMULATION: 'false', NODE_ENV: 'development' }) as never,
      redis,
    });
    expect(laptop?.mode).toBe('simulation');

    const production = createScheduleSource({
      config: config({ CLIPS_SIMULATION: 'false', NODE_ENV: 'production' }) as never,
      redis,
    });
    expect(production).toBeNull();
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it('answers with a sentence in production without keys', async () => {
    const { schedules } = service(null);
    expect(await refusal(schedules.fetch(ORG, input()))).toEqual({
      status: 503,
      body: { message: SCHEDULE_MESSAGES.UNCONFIGURED, code: 'schedule_fetch_failed' },
    });
  });
});

// ---------------------------------------------------------------------------
// Twitch, at the HTTP layer
// ---------------------------------------------------------------------------

interface Reply {
  status: number;
  json?: unknown;
}

/** A recorded Twitch: answers by path, records every request, never touches a network. */
function fakeTwitch(routes: Record<string, Reply | Reply[]>) {
  const requests: ListerHttpRequest[] = [];
  const http: ListerHttp = async (request) => {
    requests.push(request);
    const url = new URL(request.url);
    const key =
      url.origin === 'https://id.twitch.tv' ? 'token' : url.pathname.replace('/helix', '');
    const route = routes[key];
    if (!route) throw new Error(`No reply recorded for ${key}.`);
    const reply = Array.isArray(route) ? (route.shift() ?? { status: 500 }) : route;
    return { status: reply.status, json: reply.json ?? null, header: () => null };
  };
  return { http, requests };
}

const TOKEN_REPLY: Reply = { status: 200, json: { access_token: TOKEN, expires_in: 5_000_000 } };
const USER_REPLY: Reply = {
  status: 200,
  json: { data: [{ id: '12345', login: 'realstreamer', display_name: 'RealStreamer' }] },
};

function segment(start: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id: `seg-${start}`,
    start_time: start,
    end_time: new Date(Date.parse(start) + 3 * 3_600_000).toISOString(),
    title,
    canceled_until: null,
    category: { id: '1', name: 'Minecraft' },
    is_recurring: true,
    ...extra,
  };
}

function client(routes: Record<string, Reply | Reply[]>) {
  const twitch = fakeTwitch(routes);
  const redis = new FakeRedis();
  const token = new TwitchAppToken({
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    http: twitch.http,
    redis: redis.asService(),
  });
  return { ...twitch, redis, client: new TwitchScheduleClient({ token, http: twitch.http }) };
}

const request = (login = 'realstreamer') => ({
  login,
  weekStart: WEEK,
  window: fetchWindow(WEEK),
});

describe('the Twitch client', () => {
  it('asks for an app token, the user, then the schedule from the window start', async () => {
    const { client: twitch, requests } = client({
      token: TOKEN_REPLY,
      '/users': USER_REPLY,
      '/schedule': {
        status: 200,
        json: {
          data: {
            segments: [
              segment('2026-11-23T13:30:00Z', 'Minecraft'),
              segment('2026-11-24T13:30:00Z', 'Cancelled', {
                canceled_until: '2026-11-24T16:30:00Z',
              }),
              segment('2026-12-05T13:30:00Z', 'Next Week'),
            ],
            broadcaster_login: 'realstreamer',
            vacation: null,
          },
          pagination: {},
        },
      },
    });

    const outcome = await twitch.fetch(request());

    expect(requests.map((entry) => new URL(entry.url).pathname)).toEqual([
      '/oauth2/token',
      '/helix/users',
      '/helix/schedule',
    ]);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      form: { client_id: CLIENT_ID, client_secret: SECRET, grant_type: 'client_credentials' },
    });
    const scheduleUrl = new URL(requests[2].url);
    expect(scheduleUrl.searchParams.get('broadcaster_id')).toBe('12345');
    expect(scheduleUrl.searchParams.get('first')).toBe('25');
    expect(scheduleUrl.searchParams.get('start_time')).toBe('2026-11-22T00:00:00.000Z');
    expect(requests[2].headers).toMatchObject({
      'Client-Id': CLIENT_ID,
      Authorization: `Bearer ${TOKEN}`,
    });

    expect(outcome).toEqual({
      kind: 'found',
      broadcaster: { login: 'realstreamer', displayName: 'RealStreamer' },
      segments: [
        {
          start: '2026-11-23T13:30:00.000Z',
          end: '2026-11-23T16:30:00.000Z',
          title: 'Minecraft',
          category: 'Minecraft',
          canceledUntil: null,
          recurring: true,
        },
        expect.objectContaining({ title: 'Cancelled', canceledUntil: '2026-11-24T16:30:00.000Z' }),
      ],
      vacation: null,
    });
  });

  it('follows the cursor while streams start before the week ends, and stops there', async () => {
    const { client: twitch, requests } = client({
      token: TOKEN_REPLY,
      '/users': USER_REPLY,
      '/schedule': [
        {
          status: 200,
          json: {
            data: { segments: [segment('2026-11-23T13:30:00Z', 'One')], vacation: null },
            pagination: { cursor: 'page-2' },
          },
        },
        {
          status: 200,
          json: {
            data: { segments: [segment('2026-12-08T13:30:00Z', 'Far Away')], vacation: null },
            pagination: { cursor: 'page-3' },
          },
        },
      ],
    });

    const outcome = await twitch.fetch(request());
    const pages = requests.filter((entry) => entry.url.includes('/schedule'));
    expect(pages).toHaveLength(2);
    expect(new URL(pages[1].url).searchParams.get('after')).toBe('page-2');
    expect(outcome.kind === 'found' && outcome.segments.map((entry) => entry.title)).toEqual([
      'One',
    ]);
  });

  it('reads a 404 from the schedule as no schedule, and an empty user list as no user', async () => {
    const none = client({ token: TOKEN_REPLY, '/users': USER_REPLY, '/schedule': { status: 404 } });
    expect(await none.client.fetch(request())).toEqual({
      kind: 'no_schedule',
      broadcaster: { login: 'realstreamer', displayName: 'RealStreamer' },
    });

    const nobody = client({ token: TOKEN_REPLY, '/users': { status: 200, json: { data: [] } } });
    expect(await nobody.client.fetch(request('nobodyhere'))).toEqual({ kind: 'no_user' });
  });

  it('keeps the break Twitch sends', async () => {
    const { client: twitch } = client({
      token: TOKEN_REPLY,
      '/users': USER_REPLY,
      '/schedule': {
        status: 200,
        json: {
          data: {
            segments: null,
            vacation: { start_time: '2026-11-20T00:00:00Z', end_time: '2026-11-27T00:00:00Z' },
          },
        },
      },
    });
    expect(await twitch.fetch(request())).toMatchObject({
      kind: 'found',
      segments: [],
      vacation: { start: '2026-11-20T00:00:00Z', end: '2026-11-27T00:00:00Z' },
    });
  });

  it('drops the token on a 401 and tries once more with a new one', async () => {
    const { client: twitch, requests } = client({
      token: [
        TOKEN_REPLY,
        { status: 200, json: { access_token: 'second-token', expires_in: 9_000 } },
      ],
      '/users': [{ status: 401 }, USER_REPLY],
      '/schedule': { status: 404 },
    });
    await twitch.fetch(request());
    expect(requests.filter((entry) => entry.url.includes('id.twitch.tv'))).toHaveLength(2);
    expect(requests.at(-1)?.headers?.Authorization).toBe('Bearer second-token');
  });

  it('shares the channel browser token in Redis', async () => {
    const {
      client: twitch,
      redis,
      requests,
    } = client({
      token: TOKEN_REPLY,
      '/users': USER_REPLY,
      '/schedule': { status: 404 },
    });
    await twitch.fetch(request());
    await twitch.fetch(request());
    expect(redis.keys.some((key) => key.startsWith('clips:twitch:token:'))).toBe(true);
    expect(requests.filter((entry) => entry.url.includes('id.twitch.tv'))).toHaveLength(1);
  });

  it.each([
    ['a 429', { status: 429 }, 'rate_limited'],
    ['a 500', { status: 500 }, 'upstream_failed'],
    ['an answer of the wrong shape', { status: 200, json: { data: 'x' } }, 'platform_changed'],
  ])('turns %s into a failure code', async (_label, reply, code) => {
    const { client: twitch } = client({
      token: TOKEN_REPLY,
      '/users': USER_REPLY,
      '/schedule': reply,
    });
    await expect(twitch.fetch(request())).rejects.toMatchObject({ code });
  });

  it('reads keys Twitch refuses as unconfigured', async () => {
    const { client: twitch } = client({ token: { status: 400 } });
    await expect(twitch.fetch(request())).rejects.toMatchObject({ code: 'unconfigured' });
  });
});

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

/** A source that counts its calls and can be told to fail. */
function countingSource() {
  let fail = false;
  const calls: string[] = [];
  const source: ScheduleSource = {
    mode: 'helix',
    async fetch(request) {
      calls.push(request.login);
      if (fail) throw new ScheduleFetchFailure('upstream_failed');
      return outcomeOf(SIMSTREAMER, request.weekStart);
    },
  };
  return {
    source,
    calls,
    failFromNowOn: () => {
      fail = true;
    },
  };
}

describe('the cache', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick'],
    });
  });
  afterEach(() => jest.useRealTimers());

  it('keys a week by login and Monday, and answers a fresh copy without asking again', async () => {
    const counting = countingSource();
    const { schedules, redis } = service(counting.source, () => Date.now());

    const first = await schedules.fetch(ORG, input());
    jest.setSystemTime(NOW + FRESH_MS - 1_000);
    const second = await schedules.fetch(ORG, input());

    expect(counting.calls).toEqual(['simstreamer']);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(redis.keys).toContain(scheduleCacheKey('simstreamer', WEEK));
    expect(scheduleCacheKey('simstreamer', WEEK)).toBe('clipsched:twitch:simstreamer:2026-11-23');
  });

  it('asks again after ten minutes', async () => {
    const counting = countingSource();
    const { schedules } = service(counting.source, () => Date.now());

    await schedules.fetch(ORG, input());
    jest.setSystemTime(NOW + FRESH_MS + 1_000);
    await schedules.fetch(ORG, input());
    expect(counting.calls).toHaveLength(2);
  });

  it('serves the stale copy when Twitch fails, up to 24 hours, and an error after', async () => {
    const counting = countingSource();
    const { schedules, redis } = service(counting.source, () => Date.now());
    const first = await schedules.fetch(ORG, input());
    counting.failFromNowOn();

    jest.setSystemTime(NOW + 23 * 60 * 60 * 1000);
    await redis.delete(`${scheduleCacheKey('simstreamer', WEEK)}:lock`);
    const stale = await schedules.fetch('org-2', input());
    expect(stale.fetchedAt).toBe(first.fetchedAt);
    expect(stale.segments).toEqual(first.segments);

    jest.setSystemTime(NOW + STALE_LIMIT_MS + 1_000);
    expect(await refusal(schedules.fetch('org-3', input()))).toEqual({
      status: 502,
      body: { message: SCHEDULE_MESSAGES.FETCH_FAILED, code: 'schedule_fetch_failed' },
    });
  });

  it('never serves a copy older than 24 hours, even if Redis still holds it', async () => {
    const redis = new FakeRedis();
    const cache = new ScheduleCache(redis.asService(), () => NOW);
    const old = {
      fetchedAt: new Date(NOW - STALE_LIMIT_MS - 1).toISOString(),
      outcome: { kind: 'no_user' },
    };
    redis.write('clipsched:twitch:x:2026-11-23', JSON.stringify(old), 60);
    await expect(
      cache.load('clipsched:twitch:x:2026-11-23', async () => {
        throw new ScheduleFetchFailure('upstream_failed');
      }),
    ).rejects.toBeInstanceOf(ScheduleFetchFailure);
  });

  it('runs one call per key however many ask at once', async () => {
    let release: (outcome: ScheduleOutcome) => void = () => undefined;
    const fetch = jest.fn(
      () =>
        new Promise<ScheduleOutcome>((resolve) => {
          release = resolve;
        }),
    );
    const cache = new ScheduleCache(new FakeRedis().asService(), () => NOW);

    const asks = [1, 2, 3].map(() => cache.load('clipsched:twitch:a:2026-11-23', fetch));
    await new Promise((resolve) => setImmediate(resolve));
    release({ kind: 'no_user' });
    const answers = await Promise.all(asks);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new Set(answers.map((answer) => answer.entry.fetchedAt)).size).toBe(1);
  });

  it('answers the stale copy while another process holds the fetch', async () => {
    const redis = new FakeRedis();
    const key = 'clipsched:twitch:b:2026-11-23';
    redis.write(
      key,
      JSON.stringify({
        fetchedAt: new Date(NOW - FRESH_MS - 1).toISOString(),
        outcome: { kind: 'no_user' },
      }),
      600,
    );
    redis.write(`${key}:lock`, '1', 20);
    const fetch = jest.fn();
    const loaded = await new ScheduleCache(redis.asService(), () => NOW).load(key, fetch);
    expect(loaded.state).toBe('stale');
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

describe('logs', () => {
  it('never write the secret, the token, the login or a stream title', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(
        args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '),
      );
    };
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(capture),
    );
    const staticSpies = (['log', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(Logger, level).mockImplementation(capture),
    );

    try {
      // A successful fetch through Helix, a failing one, and the boot line.
      createScheduleSource({
        config: {
          get: (key: string) =>
            ({
              CLIPS_SIMULATION: 'false',
              TWITCH_CLIENT_ID: CLIENT_ID,
              TWITCH_CLIENT_SECRET: SECRET,
              NODE_ENV: 'development',
            })[key],
        } as never,
        redis: new FakeRedis().asService(),
        http: jest.fn(),
      });

      const good = client({
        token: TOKEN_REPLY,
        '/users': USER_REPLY,
        '/schedule': {
          status: 200,
          json: { data: { segments: [segment('2026-11-23T13:30:00Z', 'Secret Stream Title')] } },
        },
      });
      const ok = new SchedulesService(good.client, new FakeRedis().asService(), { now: () => NOW });
      const answer: ScheduleAnswer = await ok.fetch(ORG, input({ login: 'realstreamer' }));
      expect(answer.segments[0].title).toBe('Secret Stream Title');

      const bad = client({
        token: TOKEN_REPLY,
        '/users': USER_REPLY,
        '/schedule': { status: 500, json: { message: `boom ${TOKEN} ${SECRET}` } },
      });
      const failing = new SchedulesService(bad.client, new FakeRedis().asService(), {
        now: () => NOW,
      });
      expect((await refusal(failing.fetch(ORG, input({ login: 'realstreamer' })))).status).toBe(
        502,
      );
    } finally {
      for (const spy of [...spies, ...staticSpies]) spy.mockRestore();
    }

    const written = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(written).toContain('studio.schedule.fetch_failed');
    for (const secret of [SECRET, TOKEN, 'Secret Stream Title', 'realstreamer', 'boom']) {
      expect(written).not.toContain(secret);
    }
  });
});
