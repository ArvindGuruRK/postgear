/**
 * Google for the Sheets step (Module 13), with `GoogleHttp` replaced so no
 * test reaches Google: the consent link, a grant without a refresh token or
 * without file access refused, the email label, the refresh written back
 * encrypted, `invalid_grant` marking the connection Needs Reconnect, the
 * Sheets errors, the simulated answers, the picker token, and the config
 * reading that treats the `.env.example` placeholders as not set.
 */
import { decrypt, encrypt } from '@postgear/db';
import { CONNECTION_MESSAGES } from '../connections.messages';
import type { ConnectionsRepository } from '../connections.repository';
import { googleClientFrom, googleReadyFrom } from './google-config';
import type { GoogleHttp, GoogleRequest, GoogleResponse } from './google-http';
import {
  emailFromIdToken,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_SCOPES,
  GoogleOAuthPlugin,
} from './google-oauth.plugin';
import { GOOGLE_TOKEN_URL, GoogleSheetsService, SIMULATED_HEADERS } from './google-sheets.service';

const ORG = 'org-1';
const CONN = 'conn-1';
const REFRESH = 'refresh-token-very-secret-1234';
const CLIENT = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'shh-client-secret',
};
const REDIRECT = 'http://localhost:3001/automation-connections/oauth/google/callback';

type Answer = GoogleResponse | ((request: GoogleRequest) => GoogleResponse);

function fakeHttp(...answers: Answer[]) {
  const calls: GoogleRequest[] = [];
  const http = {
    request: jest.fn(async (request: GoogleRequest) => {
      calls.push(request);
      const next = answers.shift();
      if (!next) throw new Error(`No answer for ${request.url}`);
      return typeof next === 'function' ? next(request) : next;
    }),
  };
  return { http: http as unknown as GoogleHttp, calls, mock: http.request };
}

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.signature`;
}

beforeAll(() => {
  process.env.ENCRYPTION_KEY_AES256 = 'c'.repeat(64);
});

describe('Google config', () => {
  it('prefers the automation client, falls back to sign-in, and ignores placeholders', () => {
    expect(
      googleClientFrom({
        GOOGLE_AUTOMATION_CLIENT_ID: 'a-id',
        GOOGLE_AUTOMATION_CLIENT_SECRET: 'a-secret',
        GOOGLE_CLIENT_ID: 's-id',
        GOOGLE_CLIENT_SECRET: 's-secret',
      }),
    ).toEqual({ clientId: 'a-id', clientSecret: 'a-secret' });
    expect(
      googleClientFrom({ GOOGLE_CLIENT_ID: 's-id', GOOGLE_CLIENT_SECRET: 's-secret' }),
    ).toEqual({
      clientId: 's-id',
      clientSecret: 's-secret',
    });
    expect(
      googleReadyFrom({
        GOOGLE_CLIENT_ID: 'google-client-id',
        GOOGLE_CLIENT_SECRET: 'google-client-secret',
      }),
    ).toBe(false);
    expect(googleReadyFrom({})).toBe(false);
  });
});

describe('GoogleOAuthPlugin', () => {
  const NOW = 1_800_000_000_000;

  it('asks for drive.file, openid and email, offline, with consent every time', () => {
    const { http } = fakeHttp();
    const url = new URL(new GoogleOAuthPlugin(CLIENT, http).authorizeUrl('state-abc', REDIRECT));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT.clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: 'state-abc',
    });
    expect(GOOGLE_SCOPES).toBe(`${GOOGLE_DRIVE_FILE_SCOPE} openid email`);
    expect(GOOGLE_SCOPES).not.toMatch(/auth\/spreadsheets|auth\/drive(\s|$)/);
  });

  it('swaps the code for tokens and labels the connection with the email', async () => {
    const { http, calls } = fakeHttp({
      status: 200,
      body: {
        access_token: 'access-1',
        refresh_token: REFRESH,
        expires_in: 3599,
        scope: `openid ${GOOGLE_DRIVE_FILE_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
        id_token: idToken({ email: 'kim@gmail.com' }),
      },
    });
    const grant = await new GoogleOAuthPlugin(CLIENT, http, () => NOW).exchange('code-1', REDIRECT);

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: GOOGLE_TOKEN_URL,
      form: {
        grant_type: 'authorization_code',
        code: 'code-1',
        redirect_uri: REDIRECT,
        client_id: CLIENT.clientId,
        client_secret: CLIENT.clientSecret,
      },
    });
    expect(grant).toEqual({
      credentials: {
        refreshToken: REFRESH,
        accessToken: 'access-1',
        expiresAt: NOW + 3_599_000,
        scope: expect.stringContaining(GOOGLE_DRIVE_FILE_SCOPE),
        email: 'kim@gmail.com',
      },
      meta: { email: 'kim@gmail.com' },
      name: 'kim@gmail.com',
    });
  });

  it('reads the email from userinfo when there is no ID token', async () => {
    const { http, calls } = fakeHttp(
      {
        status: 200,
        body: { access_token: 'access-1', refresh_token: REFRESH, scope: GOOGLE_DRIVE_FILE_SCOPE },
      },
      { status: 200, body: { email: 'sam@example.com' } },
    );
    const grant = await new GoogleOAuthPlugin(CLIENT, http).exchange('code-1', REDIRECT);
    expect(calls[1]).toMatchObject({ method: 'GET', accessToken: 'access-1' });
    expect(grant.name).toBe('sam@example.com');
  });

  it('refuses a grant without a refresh token with its sentence', async () => {
    const { http } = fakeHttp({
      status: 200,
      body: { access_token: 'access-1', scope: GOOGLE_DRIVE_FILE_SCOPE },
    });
    await expect(
      new GoogleOAuthPlugin(CLIENT, http).exchange('code-1', REDIRECT),
    ).rejects.toMatchObject({
      name: 'OAuthGrantRefused',
      message: 'Google did not grant offline access. Try again.',
    });
  });

  it('refuses a grant where file access was unticked', async () => {
    const { http } = fakeHttp({
      status: 200,
      body: { access_token: 'access-1', refresh_token: REFRESH, scope: 'openid email' },
    });
    await expect(
      new GoogleOAuthPlugin(CLIENT, http).exchange('code-1', REDIRECT),
    ).rejects.toMatchObject({
      name: 'OAuthGrantRefused',
      message: CONNECTION_MESSAGES.GOOGLE_NO_FILES,
    });
  });

  it('reads no email from a malformed ID token', () => {
    expect(emailFromIdToken('not-a-token')).toBeNull();
    expect(emailFromIdToken(undefined)).toBeNull();
  });
});

describe('GoogleSheetsService', () => {
  interface Row {
    id: string;
    provider: string;
    status: string;
    credentials: string;
  }

  function setup(options: {
    credentials: unknown;
    status?: string;
    answers?: Answer[];
    env?: Record<string, string | undefined>;
  }) {
    const row: Row = {
      id: CONN,
      provider: 'google',
      status: options.status ?? 'CONNECTED',
      credentials: encrypt(JSON.stringify(options.credentials)),
    };
    const repository = {
      findWithCredentials: jest.fn(async (org: string, id: string) =>
        org === ORG && id === CONN ? row : null,
      ),
      update: jest.fn(
        async (_org: string, _id: string, _user: null, data: { credentials: string }) => {
          row.credentials = data.credentials;
          return row;
        },
      ),
      markConnectionBroken: jest.fn(async () => {
        row.status = 'NEEDS_RECONNECT';
      }),
    };
    const env: Record<string, string | undefined> = {
      AUTOMATION_SIMULATION: 'true',
      GOOGLE_CLIENT_ID: CLIENT.clientId,
      GOOGLE_CLIENT_SECRET: CLIENT.clientSecret,
      GOOGLE_PICKER_API_KEY: 'picker-key',
      GOOGLE_CLOUD_APP_ID: '123456789',
      ...options.env,
    };
    const config = { get: (key: string) => env[key] };
    const fake = fakeHttp(...(options.answers ?? []));
    const service = new GoogleSheetsService(
      repository as unknown as ConnectionsRepository,
      fake.http,
      config as never,
    );
    return { service, repository, row, ...fake };
  }

  const fresh = () => ({
    accessToken: 'access-old',
    refreshToken: REFRESH,
    expiresAt: Date.now() + 30 * 60_000,
    scope: GOOGLE_DRIVE_FILE_SCOPE,
    email: 'kim@gmail.com',
  });
  const expiring = () => ({ ...fresh(), expiresAt: Date.now() + 30_000 });

  it('uses a token with more than a minute left without refreshing', async () => {
    const { service, mock, repository } = setup({ credentials: fresh() });
    await expect(service.accessToken(ORG, CONN)).resolves.toMatchObject({
      accessToken: 'access-old',
    });
    expect(mock).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('refreshes within a minute of expiry and writes the new token back encrypted', async () => {
    const { service, row, calls } = setup({
      credentials: expiring(),
      answers: [{ status: 200, body: { access_token: 'access-new', expires_in: 3600 } }],
    });
    const token = await service.accessToken(ORG, CONN);

    expect(token).toMatchObject({ simulated: false, accessToken: 'access-new' });
    expect(calls[0]).toMatchObject({
      url: GOOGLE_TOKEN_URL,
      form: { grant_type: 'refresh_token', refresh_token: REFRESH },
    });
    expect(row.credentials).not.toContain('access-new');
    expect(row.credentials).not.toContain(REFRESH);
    expect(JSON.parse(decrypt(row.credentials))).toMatchObject({
      accessToken: 'access-new',
      refreshToken: REFRESH,
      email: 'kim@gmail.com',
    });
  });

  it('marks the connection Needs Reconnect on invalid_grant and answers 422', async () => {
    const { service, repository } = setup({
      credentials: expiring(),
      answers: [{ status: 400, body: { error: 'invalid_grant' } }],
    });
    await expect(service.accessToken(ORG, CONN)).rejects.toMatchObject({
      status: 422,
      response: { code: 'google_disconnected', message: CONNECTION_MESSAGES.GOOGLE_DISCONNECTED },
    });
    expect(repository.markConnectionBroken).toHaveBeenCalledWith(
      CONN,
      CONNECTION_MESSAGES.GOOGLE_DISCONNECTED,
    );
  });

  it('answers 502 when Google does not answer', async () => {
    const { service } = setup({ credentials: expiring(), answers: [{ status: 0, body: {} }] });
    await expect(service.accessToken(ORG, CONN)).rejects.toMatchObject({
      status: 502,
      response: { code: 'google_unavailable' },
    });
  });

  it('gives the picker a short-lived token, never the refresh token', async () => {
    const { service } = setup({ credentials: fresh() });
    const picker = await service.pickerToken(ORG, CONN);
    expect(picker).toEqual({
      accessToken: 'access-old',
      expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      apiKey: 'picker-key',
      appId: '123456789',
    });
    expect(JSON.stringify(picker)).not.toContain(REFRESH);
  });

  it('refuses the picker for a simulated account', async () => {
    const { service } = setup({ credentials: { simulated: true } });
    await expect(service.pickerToken(ORG, CONN)).rejects.toMatchObject({
      status: 422,
      response: { code: 'simulated_connection' },
    });
  });

  it('reads the tabs and the header row', async () => {
    const { service, calls } = setup({
      credentials: fresh(),
      answers: [
        {
          status: 200,
          body: {
            spreadsheetId: 'sheet-1',
            spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
            properties: { title: 'Q4 Posts' },
            sheets: [
              { properties: { sheetId: 0, title: 'Posts' } },
              { properties: { sheetId: 77, title: "Kim's Tab" } },
            ],
          },
        },
        { status: 200, body: { values: [['Date', 'Channel', null, 'Link']] } },
      ],
    });

    await expect(service.spreadsheet(ORG, CONN, 'sheet-1')).resolves.toEqual({
      spreadsheet: {
        id: 'sheet-1',
        name: 'Q4 Posts',
        url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
      },
      tabs: [
        { id: 0, title: 'Posts' },
        { id: 77, title: "Kim's Tab" },
      ],
    });
    await expect(service.header(ORG, CONN, 'sheet-1', "Kim's Tab")).resolves.toEqual({
      headers: ['Date', 'Channel', '', 'Link'],
    });
    expect(calls[0].accessToken).toBe('access-old');
    expect(decodeURIComponent(calls[1].url)).toContain("'Kim''s Tab'!1:1");
  });

  it.each([403, 404])('answers spreadsheet_unavailable when Google says %i', async (status) => {
    const { service } = setup({
      credentials: fresh(),
      answers: [{ status, body: { error: { status: 'PERMISSION_DENIED' } } }],
    });
    await expect(service.spreadsheet(ORG, CONN, 'sheet-1')).rejects.toMatchObject({
      status: 422,
      response: { code: 'spreadsheet_unavailable' },
    });
  });

  it('creates a spreadsheet with the header row', async () => {
    const { service, calls } = setup({
      credentials: fresh(),
      answers: [
        {
          status: 200,
          body: {
            spreadsheetId: 'new-1',
            properties: { title: 'Social Report' },
            sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
          },
        },
      ],
    });
    const created = await service.create(ORG, CONN, {
      name: 'Social Report',
      headers: ['Date', 'Text'],
    });
    expect(created).toEqual({
      spreadsheet: {
        id: 'new-1',
        name: 'Social Report',
        url: 'https://docs.google.com/spreadsheets/d/new-1',
      },
      sheet: { id: 0, title: 'Sheet1' },
    });
    expect(JSON.stringify(calls[0].json)).toContain('"stringValue":"Date"');
  });

  it('answers a simulated account with made-up data and no Google call', async () => {
    const { service, mock } = setup({ credentials: { simulated: true } });
    await expect(service.spreadsheet(ORG, CONN, 'abc')).resolves.toMatchObject({
      spreadsheet: { name: 'Social Report' },
      tabs: [{ id: 0, title: 'Posts' }],
    });
    await expect(service.header(ORG, CONN, 'abc', 'Posts')).resolves.toEqual({
      headers: SIMULATED_HEADERS,
    });
    expect(SIMULATED_HEADERS).toEqual(['Date', 'Channel', 'Text', 'Link']);

    const made = await service.create(ORG, CONN, { name: 'Launch Log', headers: ['When', 'What'] });
    await expect(service.spreadsheet(ORG, CONN, made.spreadsheet.id)).resolves.toMatchObject({
      spreadsheet: { name: 'Launch Log' },
    });
    await expect(service.header(ORG, CONN, made.spreadsheet.id, 'Posts')).resolves.toEqual({
      headers: ['When', 'What'],
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it('answers google_disconnected for a connection already marked Needs Reconnect', async () => {
    const { service, mock } = setup({ credentials: fresh(), status: 'NEEDS_RECONNECT' });
    await expect(service.spreadsheet(ORG, CONN, 'sheet-1')).rejects.toMatchObject({
      status: 422,
      response: { code: 'google_disconnected' },
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it('does not open another workspace connection', async () => {
    const { service } = setup({ credentials: fresh() });
    await expect(service.accessToken('org-2', CONN)).rejects.toMatchObject({ status: 404 });
  });
});
