/**
 * Google from the API side (Module 13): what the Sheets step panel needs
 * before a run ever starts.
 *
 * - **Picker token** (`GET /automation-connections/:id/picker-token`, members):
 *   a short-lived access token plus the Picker's browser key and project
 *   number. Never the refresh token. Picking only grants PostGear access to
 *   the picked file (`drive.file`), so members may do it.
 * - **Tabs, header row, new spreadsheet**: three small Sheets calls through
 *   `GoogleHttp`, the one path every Google call takes.
 * - **Tokens are refreshed the way the worker does it** (`google-auth.ts`):
 *   when less than 60 s is left, written back encrypted; `invalid_grant`
 *   marks the connection Needs Reconnect and answers 422
 *   `google_disconnected`.
 * - **Simulated connections** (`AUTOMATION_SIMULATION=true`) answer with
 *   made-up data: a spreadsheet "Social Report" with a tab "Posts" whose
 *   header is Date, Channel, Text, Link; a created one keeps its name and
 *   headers for the rest of the process.
 *
 * Errors: 422 `google_disconnected`, 422 `spreadsheet_unavailable`, 502
 * `google_unavailable`, 422 `google_not_configured`, 422
 * `simulated_connection` (the Picker needs a real account).
 */
import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decrypt, encrypt } from '@postgear/db';
import type { Env } from '../../../../config/env';
import { CONNECTION_MESSAGES } from '../connections.messages';
import { ConnectionsRepository } from '../connections.repository';
import {
  type GoogleTokenCredentials,
  googleTokenCredentialsSchema,
  isSimulatedGoogle,
} from '../providers/google.provider';
import { type GoogleClientConfig, googleClientFromConfig } from './google-config';
import { GoogleHttp, type GoogleRequest, type GoogleResponse } from './google-http';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const REFRESH_MARGIN_MS = 60_000;

export interface SpreadsheetRef {
  id: string;
  name: string;
  url: string;
}

export interface SpreadsheetDetails {
  spreadsheet: SpreadsheetRef;
  tabs: { id: number; title: string }[];
}

export interface CreatedSpreadsheet {
  spreadsheet: SpreadsheetRef;
  sheet: { id: number; title: string };
}

export interface PickerToken {
  accessToken: string;
  /** ISO time the access token stops working. */
  expiresAt: string;
  apiKey: string;
  appId: string;
}

type AccessToken =
  | { simulated: true }
  | { simulated: false; accessToken: string; expiresAt: number };

const SIMULATED_SHEET = { name: 'Social Report', tab: 'Posts' };
export const SIMULATED_HEADERS = ['Date', 'Channel', 'Text', 'Link'];

export function spreadsheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}`;
}

/** `'Posts'!1:1`, quoting the title as A1 notation asks. */
export function headerRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'!1:1`;
}

const disconnected = () =>
  new UnprocessableEntityException({
    message: CONNECTION_MESSAGES.GOOGLE_DISCONNECTED,
    code: 'google_disconnected',
  });
const unavailable = () =>
  new BadGatewayException({
    message: CONNECTION_MESSAGES.GOOGLE_UNAVAILABLE,
    code: 'google_unavailable',
  });
const notConfigured = () =>
  new UnprocessableEntityException({
    message: CONNECTION_MESSAGES.GOOGLE_NOT_SET_UP,
    code: 'google_not_configured',
  });
const sheetUnavailable = (name: string) =>
  new UnprocessableEntityException({
    message: CONNECTION_MESSAGES.SPREADSHEET_UNAVAILABLE(name),
    code: 'spreadsheet_unavailable',
  });

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Injectable()
export class GoogleSheetsService {
  /** Spreadsheets a simulated connection "created", so their name and header read back. */
  private readonly simulatedSheets = new Map<string, { name: string; headers: string[] }>();

  constructor(
    private readonly repository: ConnectionsRepository,
    private readonly http: GoogleHttp,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private client(): GoogleClientConfig | null {
    return googleClientFromConfig(this.config);
  }

  /**
   * A usable access token for a Google connection of this workspace,
   * refreshed and saved when it expires within 60 s (or always, `force`).
   */
  async accessToken(orgId: string, connectionId: string, force = false): Promise<AccessToken> {
    const row = await this.repository.findWithCredentials(orgId, connectionId);
    if (row?.provider !== 'google') {
      throw new NotFoundException(CONNECTION_MESSAGES.NOT_FOUND);
    }
    let stored: unknown;
    try {
      stored = JSON.parse(decrypt(row.credentials));
    } catch {
      throw disconnected();
    }
    if (isSimulatedGoogle(stored)) return { simulated: true };
    if (row.status === 'NEEDS_RECONNECT') throw disconnected();

    const parsed = googleTokenCredentialsSchema.safeParse(stored);
    if (!parsed.success) throw disconnected();
    const credentials = parsed.data;
    if (!force && credentials.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
      return {
        simulated: false,
        accessToken: credentials.accessToken,
        expiresAt: credentials.expiresAt,
      };
    }

    const client = this.client();
    if (!client) throw notConfigured();
    const response = await this.http.request({
      method: 'POST',
      url: GOOGLE_TOKEN_URL,
      form: {
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
        client_id: client.clientId,
        client_secret: client.clientSecret,
      },
    });

    if (response.status === 200 && typeof response.body.access_token === 'string') {
      const expiresIn =
        typeof response.body.expires_in === 'number' ? response.body.expires_in : 3600;
      const refreshed: GoogleTokenCredentials = {
        ...credentials,
        accessToken: response.body.access_token,
        expiresAt: Date.now() + expiresIn * 1000,
        scope: typeof response.body.scope === 'string' ? response.body.scope : credentials.scope,
        refreshToken:
          typeof response.body.refresh_token === 'string' && response.body.refresh_token
            ? response.body.refresh_token
            : credentials.refreshToken,
      };
      await this.repository.update(orgId, connectionId, null, {
        credentials: encrypt(JSON.stringify(refreshed)),
      });
      return {
        simulated: false,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      };
    }
    if (response.body.error === 'invalid_grant') {
      await this.repository.markConnectionBroken(
        connectionId,
        CONNECTION_MESSAGES.GOOGLE_DISCONNECTED,
      );
      throw disconnected();
    }
    if (response.status >= 400 && response.status < 500) throw notConfigured();
    throw unavailable();
  }

  async pickerToken(orgId: string, connectionId: string): Promise<PickerToken> {
    const apiKey = this.config.get('GOOGLE_PICKER_API_KEY', { infer: true });
    const appId = this.config.get('GOOGLE_CLOUD_APP_ID', { infer: true });
    const token = await this.accessToken(orgId, connectionId);
    if (token.simulated) {
      throw new UnprocessableEntityException({
        message: CONNECTION_MESSAGES.PICKER_SIMULATED,
        code: 'simulated_connection',
      });
    }
    if (!apiKey || !appId) throw notConfigured();
    return {
      accessToken: token.accessToken,
      expiresAt: new Date(token.expiresAt).toISOString(),
      apiKey,
      appId,
    };
  }

  async spreadsheet(
    orgId: string,
    connectionId: string,
    spreadsheetId: string,
  ): Promise<SpreadsheetDetails> {
    const token = await this.accessToken(orgId, connectionId);
    if (token.simulated) {
      const made = this.simulatedSheets.get(spreadsheetId);
      return {
        spreadsheet: {
          id: spreadsheetId,
          name: made?.name ?? SIMULATED_SHEET.name,
          url: spreadsheetUrl(spreadsheetId),
        },
        tabs: [{ id: 0, title: SIMULATED_SHEET.tab }],
      };
    }
    const body = await this.call(connectionId, token.accessToken, 'this spreadsheet', {
      method: 'GET',
      url: `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(
        'spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)',
      )}`,
    });
    const sheets = Array.isArray(body.sheets) ? body.sheets : [];
    return {
      spreadsheet: {
        id: typeof body.spreadsheetId === 'string' ? body.spreadsheetId : spreadsheetId,
        name: String(record(body.properties).title ?? ''),
        url:
          typeof body.spreadsheetUrl === 'string'
            ? body.spreadsheetUrl
            : spreadsheetUrl(spreadsheetId),
      },
      tabs: sheets.flatMap((sheet) => {
        const properties = record(record(sheet).properties);
        return typeof properties.sheetId === 'number' && typeof properties.title === 'string'
          ? [{ id: properties.sheetId, title: properties.title }]
          : [];
      }),
    };
  }

  async header(
    orgId: string,
    connectionId: string,
    spreadsheetId: string,
    sheet: string,
  ): Promise<{ headers: string[] }> {
    const token = await this.accessToken(orgId, connectionId);
    if (token.simulated) {
      return {
        headers: [...(this.simulatedSheets.get(spreadsheetId)?.headers ?? SIMULATED_HEADERS)],
      };
    }
    const body = await this.call(connectionId, token.accessToken, 'this spreadsheet', {
      method: 'GET',
      url: `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
        headerRange(sheet),
      )}?majorDimension=ROWS`,
    });
    const rows = Array.isArray(body.values) ? body.values : [];
    const first = Array.isArray(rows[0]) ? rows[0] : [];
    return {
      headers: first.map((cell) => (cell === null || cell === undefined ? '' : String(cell))),
    };
  }

  async create(
    orgId: string,
    connectionId: string,
    input: { name: string; headers: string[] },
  ): Promise<CreatedSpreadsheet> {
    const token = await this.accessToken(orgId, connectionId);
    if (token.simulated) {
      const id = `simulated-${randomUUID()}`;
      this.simulatedSheets.set(id, { name: input.name, headers: [...input.headers] });
      return {
        spreadsheet: { id, name: input.name, url: spreadsheetUrl(id) },
        sheet: { id: 0, title: SIMULATED_SHEET.tab },
      };
    }
    const body = await this.call(connectionId, token.accessToken, input.name, {
      method: 'POST',
      url: SHEETS_API,
      json: {
        properties: { title: input.name },
        sheets: [
          input.headers.length > 0
            ? {
                properties: { gridProperties: { frozenRowCount: 1 } },
                data: [
                  {
                    startRow: 0,
                    startColumn: 0,
                    rowData: [
                      {
                        values: input.headers.map((header) => ({
                          userEnteredValue: { stringValue: header },
                        })),
                      },
                    ],
                  },
                ],
              }
            : { properties: {} },
        ],
      },
    });
    const id = typeof body.spreadsheetId === 'string' ? body.spreadsheetId : '';
    if (!id) throw unavailable();
    const first = record(record(Array.isArray(body.sheets) ? body.sheets[0] : null).properties);
    return {
      spreadsheet: {
        id,
        name: String(record(body.properties).title ?? input.name),
        url: typeof body.spreadsheetUrl === 'string' ? body.spreadsheetUrl : spreadsheetUrl(id),
      },
      sheet: {
        id: typeof first.sheetId === 'number' ? first.sheetId : 0,
        title: typeof first.title === 'string' ? first.title : 'Sheet1',
      },
    };
  }

  /** One Sheets call with Google's answer turned into the contract's errors. */
  private async call(
    connectionId: string,
    accessToken: string,
    name: string,
    request: Omit<GoogleRequest, 'accessToken'>,
  ): Promise<Record<string, unknown>> {
    let response: GoogleResponse;
    try {
      response = await this.http.request({ ...request, accessToken });
    } catch {
      throw unavailable();
    }
    if (response.status >= 200 && response.status < 300) return response.body;
    if (response.status === 401) {
      await this.repository.markConnectionBroken(
        connectionId,
        CONNECTION_MESSAGES.GOOGLE_DISCONNECTED,
      );
      throw disconnected();
    }
    if (response.status === 403 || response.status === 404) throw sheetUnavailable(name);
    if (response.status === 400) {
      const message = String(record(response.body.error).message ?? '');
      if (/unable to parse range/i.test(message)) throw sheetUnavailable(name);
    }
    throw unavailable();
  }
}
