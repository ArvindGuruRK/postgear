/**
 * Security sweep, Sprint 13 Module 16: the Schedule Maker's fetch.
 *
 * What must hold, beyond `schedules.service.spec.ts` (which proves the throttle
 * per workspace, the 24-hour stale limit, a log spy that never sees the
 * secret, the token, the login or a title, and the request order):
 * - the login is checked before any call: anything that is not a Twitch
 *   login (a path, another host, a query, a new line) is refused by the body
 *   schema, and a login that passes is a plain name;
 * - whatever reaches the client, every request goes to Twitch's two fixed
 *   hosts, the login travelling only as the value of `login=`;
 * - the Twitch app token and the client secret never reach a response or an
 *   error, even when Twitch (or the network) answers with them in its text.
 */
import { HttpException, Logger } from '@nestjs/common';
import type { ListerHttp, ListerHttpRequest } from '../../clips/channels/listers/lister-http';
import { TwitchAppToken } from '../../clips/channels/listers/twitch-app-token';
import { FakeRedis } from '../../discover/testing/fake-redis';
import { fetchScheduleSchema } from './dto/schedules.schema';
import { fetchWindow, SchedulesService } from './schedules.service';
import { TwitchScheduleClient } from './twitch-schedule.client';

const ORG = 'org-1';
const SECRET = 'super-secret-client-value';
const CLIENT_ID = 'client-id-value';
const TOKEN = 'app-token-value-123';
const NOW = Date.parse('2026-11-26T12:00:00.000Z');
const WEEK = '2026-11-23';
const HOSTS = new Set(['https://api.twitch.tv', 'https://id.twitch.tv']);

type Reply = { status: number; json?: unknown } | Error;

function fakeTwitch(routes: Record<string, Reply>) {
  const requests: ListerHttpRequest[] = [];
  const http: ListerHttp = async (request) => {
    requests.push(request);
    const url = new URL(request.url);
    const key =
      url.origin === 'https://id.twitch.tv' ? 'token' : url.pathname.replace('/helix', '');
    const reply = routes[key] ?? { status: 404 };
    if (reply instanceof Error) throw reply;
    return { status: reply.status, json: reply.json ?? null, header: () => null };
  };
  return { http, requests };
}

function build(routes: Record<string, Reply>) {
  const twitch = fakeTwitch(routes);
  const redis = new FakeRedis();
  const token = new TwitchAppToken({
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    http: twitch.http,
    redis: redis.asService(),
  });
  const client = new TwitchScheduleClient({ token, http: twitch.http });
  const schedules = new SchedulesService(client, new FakeRedis().asService(), { now: () => NOW });
  return { ...twitch, client, schedules };
}

const TOKEN_REPLY = { status: 200, json: { access_token: TOKEN, expires_in: 5_000_000 } };
const USER_REPLY = {
  status: 200,
  json: { data: [{ id: '12345', login: 'realstreamer', display_name: 'RealStreamer' }] },
};

let logs: jest.SpyInstance[] = [];
beforeEach(() => {
  logs = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
  );
});
afterEach(() => {
  for (const spy of logs) spy.mockRestore();
});

describe('the login', () => {
  it.each([
    '../../users?id=1',
    'simstreamer/../../oauth2/token',
    'https://evil.example/simstreamer?x=1',
    'https://twitch.tv.evil.example/simstreamer/',
    'simstreamer@evil.example',
    'simstreamer?login=other',
    'simstreamer#fragment',
    'simstreamer&first=100',
    'sim%2fstreamer',
    'simstreamer\nHost: evil.example',
    'simstreamer\u0000',
    'http://localhost:6379/simstreamer',
    'https://api.twitch.tv/helix/users',
  ])('refuses %j before any call', (login) => {
    expect(fetchScheduleSchema.safeParse({ login, timeZone: 'UTC', weekStart: WEEK }).success).toBe(
      false,
    );
  });

  it('passes only plain names on, whatever was typed', () => {
    for (const login of [
      'SimStreamer',
      '@simstreamer',
      'https://www.twitch.tv/SimStreamer/videos',
    ]) {
      const parsed = fetchScheduleSchema.parse({ login, timeZone: 'UTC', weekStart: WEEK });
      expect(parsed.login).toBe('simstreamer');
    }
  });

  it("sends every request to Twitch's two hosts, the login only as the value of login=, even past the schema", async () => {
    const { client, requests } = build({ token: TOKEN_REPLY, '/users': USER_REPLY });
    for (const login of ['../../evil?x=1#y', 'a/b', 'realstreamer&first=100', 'x\r\nHost: evil']) {
      await client
        .fetch({ login, weekStart: WEEK, window: fetchWindow(WEEK) })
        .catch(() => undefined);
    }
    expect(requests.length).toBeGreaterThan(0);
    for (const entry of requests) {
      const url = new URL(entry.url);
      expect(HOSTS.has(url.origin)).toBe(true);
      expect(['/oauth2/token', '/helix/users', '/helix/schedule']).toContain(url.pathname);
      expect(url.hash).toBe('');
    }
    const users = requests.filter((entry) => new URL(entry.url).pathname === '/helix/users');
    expect(users.map((entry) => [...new URL(entry.url).searchParams.keys()])).toEqual(
      users.map(() => ['login']),
    );
    expect(users.map((entry) => new URL(entry.url).searchParams.get('login'))).toEqual([
      '../../evil?x=1#y',
      'a/b',
      'realstreamer&first=100',
      'x\r\nHost: evil',
    ]);
  });
});

describe('the secret and the token', () => {
  const failures: Array<[string, Record<string, Reply>]> = [
    [
      'Twitch refusing the keys with them in its text',
      { token: { status: 400, json: { message: `bad ${SECRET}` } } },
    ],
    [
      'a user lookup failing with the token in its text',
      { token: TOKEN_REPLY, '/users': { status: 500, json: { message: `Bearer ${TOKEN}` } } },
    ],
    [
      'the network failing with them in its message',
      {
        token: TOKEN_REPLY,
        '/users': new Error(
          `connect failed: Authorization: Bearer ${TOKEN} client_secret=${SECRET}`,
        ),
      },
    ],
    [
      'the token call failing on the network',
      { token: new Error(`POST client_secret=${SECRET} failed`) },
    ],
    [
      'a schedule of the wrong shape echoing the token',
      {
        token: TOKEN_REPLY,
        '/users': USER_REPLY,
        '/schedule': { status: 200, json: { data: TOKEN } },
      },
    ],
    [
      'a 429 with the token in its text',
      {
        token: TOKEN_REPLY,
        '/users': USER_REPLY,
        '/schedule': { status: 429, json: { message: TOKEN } },
      },
    ],
  ];

  it.each(failures)('never reach the answer when %s', async (_name, routes) => {
    const { schedules } = build(routes);
    const error = await schedules
      .fetch(
        ORG,
        fetchScheduleSchema.parse({ login: 'realstreamer', timeZone: 'UTC', weekStart: WEEK }),
      )
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );
    expect(error).toBeInstanceOf(HttpException);
    const http = error as HttpException;
    const seen = JSON.stringify({
      status: http.getStatus(),
      body: http.getResponse(),
      message: http.message,
    });
    expect(seen).not.toContain(SECRET);
    expect(seen).not.toContain(TOKEN);
    expect(http.getResponse()).toMatchObject({ code: 'schedule_fetch_failed' });
    const written = logs.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n');
    expect(written).not.toContain(SECRET);
    expect(written).not.toContain(TOKEN);
  });

  it('never reach a successful answer', async () => {
    const { schedules } = build({
      token: TOKEN_REPLY,
      '/users': USER_REPLY,
      '/schedule': {
        status: 200,
        json: {
          data: {
            segments: [
              {
                id: 'seg-1',
                start_time: '2026-11-23T13:30:00Z',
                end_time: '2026-11-23T16:30:00Z',
                title: 'Minecraft',
                canceled_until: null,
                category: { id: '1', name: 'Minecraft' },
                is_recurring: true,
              },
            ],
            vacation: null,
          },
        },
      },
    });
    const answer = await schedules.fetch(
      ORG,
      fetchScheduleSchema.parse({ login: 'realstreamer', timeZone: 'UTC', weekStart: WEEK }),
    );
    const text = JSON.stringify(answer);
    expect(answer.segments).toHaveLength(1);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(CLIENT_ID);
  });
});
