/**
 * Google Sheets: Append Row (Sprint 10, Module 13).
 *
 * One row per run, appended under the last row of the picked tab:
 *
 *   POST https://sheets.googleapis.com/v4/spreadsheets/{id}/values/'{Tab}'!A1:append
 *        ?valueInputOption=RAW&insertDataOption=INSERT_ROWS
 *   { "values": [[...]] }
 *
 * - **RAW, never USER_ENTERED.** A post whose text starts with `=` (or `+`,
 *   `-`, `@`) stays text in the cell; nothing a post says can become a
 *   formula (formula injection).
 * - **Values are text, in the column order the step holds** (the header
 *   order the panel read from row 1). Lists are joined with ", ", missing
 *   data is an empty cell.
 * - **Failures**: 429 and 5xx are worth retrying; 403 PERMISSION_DENIED or
 *   404 means the file was un-picked or deleted ("PostGear can no longer
 *   open {name}. Pick it again in this step."); a token Google refuses is a
 *   reconnect (`google-auth.ts`).
 * - **Simulation**: a simulated connection, or `AUTOMATION_SIMULATION`,
 *   answers from a stand-in whose row number counts up per connection in
 *   memory (from row 2, under the header), and logs nothing but the dry-run
 *   sentence `providerExecutor` already logs.
 *
 * ## Idempotency: the accepted window
 *
 * Sheets has no idempotency key, so an append cannot be made exactly-once
 * on Google's side. What stops a second row is the run engine: a step whose
 * row is SUCCEEDED is never run again (Module 07's step-row check), and a
 * retried activity reads that row first. The window left open is narrow and
 * accepted: Google appended the row, then the worker died (or the reply was
 * lost) before the SUCCEEDED row was written. Temporal retries the attempt
 * and a second, identical row is appended. Making it exactly-once would
 * need a read-back of the tab before each append (a race of its own) or a
 * hidden marker column in the person's sheet; neither is worth it for a
 * report row.
 */
import { toText } from '@postgear/automation';
import {
  disconnected,
  GOOGLE_TIMEOUT_MS,
  GOOGLE_UNAVAILABLE_MESSAGE,
  type GoogleClient,
  type GoogleCredentials,
  googleAccessToken,
  isSimulatedGoogle,
  type ProviderFailure,
  type SafeHttp,
} from './google-auth';
import type {
  AutomationProvider,
  ProviderBuildContext,
  ProviderResult,
  ProviderSendOptions,
} from './types';

export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

/** The step's settings after data tokens are filled in. */
export interface SheetsConfig {
  connectionId: string;
  spreadsheet: { id: string; name: string } | null;
  sheet: { id: number; title: string } | null;
  columns: { header: string; value: unknown }[];
  createdByPostGear?: boolean;
}

export interface SheetsRequest {
  spreadsheet: { id: string; name: string };
  sheet: { id: number; title: string };
  headers: string[];
  /** One text per column, in header order. */
  values: string[];
  /** Whose stand-in counter a simulated row uses. */
  connectionId: string;
}

export interface SheetsOutput {
  rowNumber: number | null;
  spreadsheet: { id: string; name: string; url: string };
  sheet: string;
}

export interface SheetsDeps {
  http: SafeHttp;
  /** The OAuth client, read when a token needs refreshing. */
  client(): GoogleClient | null;
  now(): Date;
  /** Writes a refreshed token back to the step's connection. */
  saveCredentials(credentials: GoogleCredentials): Promise<void>;
}

export const sheetUnavailableMessage = (name: string) =>
  `PostGear can no longer open ${name}. Pick it again in this step.`;

/** A cell's text: lists joined with ", ", missing as empty, everything else as it reads. */
export function cellText(value: unknown): string {
  return toText(value);
}

/** `'Posts'!A1`, quoting the title as A1 notation asks (a quote is doubled). */
export function appendRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'!A1`;
}

/** The row number in `updatedRange` (`Posts!A42:F42` gives 42); null when it cannot be read. */
export function parseRowNumber(updatedRange: unknown): number | null {
  if (typeof updatedRange !== 'string') return null;
  const cells = updatedRange.slice(updatedRange.lastIndexOf('!') + 1);
  const match = /^\$?[A-Za-z]*\$?(\d+)/.exec(cells);
  return match ? Number(match[1]) : null;
}

export function spreadsheetUrl(id: string, sheetId: number): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit#gid=${sheetId}`;
}

function output(req: SheetsRequest, rowNumber: number | null): SheetsOutput {
  return {
    rowNumber,
    spreadsheet: {
      id: req.spreadsheet.id,
      name: req.spreadsheet.name,
      url: spreadsheetUrl(req.spreadsheet.id, req.sheet.id),
    },
    sheet: req.sheet.title,
  };
}

/** The stand-in's last row per connection; the header is row 1. */
const simulatedRows = new Map<string, number>();

export function simulateAppend(req: SheetsRequest): ProviderResult {
  const next = (simulatedRows.get(req.connectionId) ?? 1) + 1;
  simulatedRows.set(req.connectionId, next);
  return { ok: true, output: { ...output(req, next), simulated: true } };
}

/** For tests: start the stand-in's counters again. */
export function resetSimulatedRows(): void {
  simulatedRows.clear();
}

const SHOWN_COLUMNS = 3;
const SHOWN_VALUE_LENGTH = 60;

function shortValue(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > SHOWN_VALUE_LENGTH ? `${flat.slice(0, SHOWN_VALUE_LENGTH)}...` : flat;
}

/** "Would add a row to Social Report 2026, tab Posts: Date 2026-11-03, Channel Instagram, ..." */
export function describeAppend(req: SheetsRequest): string {
  const pairs = req.headers
    .map((header, i) => [header.trim(), shortValue(req.values[i] ?? '')] as const)
    .filter(([header, value]) => header !== '' && value !== '')
    .map(([header, value]) => `${header} ${value}`);
  const shown = pairs.slice(0, SHOWN_COLUMNS).join(', ');
  const more = pairs.length > SHOWN_COLUMNS ? ', ...' : '';
  const where = `Would add a row to ${req.spreadsheet.name}, tab ${req.sheet.title}`;
  return pairs.length === 0 ? `${where}, with every cell empty.` : `${where}: ${shown}${more}`;
}

function googleError(body: string | undefined): { status: string; message: string } {
  if (!body) return { status: '', message: '' };
  try {
    const parsed = JSON.parse(body) as { error?: { status?: unknown; message?: unknown } };
    return {
      status: typeof parsed.error?.status === 'string' ? parsed.error.status : '',
      message: typeof parsed.error?.message === 'string' ? parsed.error.message : '',
    };
  } catch {
    return { status: '', message: '' };
  }
}

export function sheetsProvider(deps: SheetsDeps): AutomationProvider<SheetsRequest, SheetsConfig> {
  return {
    kind: 'google',

    build(config: SheetsConfig, ctx: ProviderBuildContext): SheetsRequest {
      const columns = Array.isArray(config.columns) ? config.columns : [];
      return {
        spreadsheet: config.spreadsheet ?? { id: '', name: 'the spreadsheet' },
        sheet: config.sheet ?? { id: 0, title: 'Sheet1' },
        headers: columns.map((column) => String(column.header ?? '')),
        values: columns.map((column) => cellText(column.value)),
        connectionId: ctx.connection?.id ?? config.connectionId ?? '',
      };
    },

    describe: describeAppend,

    async simulate(req) {
      return simulateAppend(req);
    },

    async send(req, credentials, opts: ProviderSendOptions): Promise<ProviderResult> {
      if (isSimulatedGoogle(credentials)) return simulateAppend(req);

      const token = await googleAccessToken({
        credentials,
        client: deps.client(),
        now: deps.now(),
        http: deps.http,
        signal: opts.signal,
        save: deps.saveCredentials,
      });
      if (!token.ok) return token;

      const url =
        `${SHEETS_API}/${encodeURIComponent(req.spreadsheet.id)}/values/` +
        `${encodeURIComponent(appendRange(req.sheet.title))}:append` +
        '?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
      const outcome = await deps.http({
        method: 'POST',
        url,
        headers: {
          authorization: `Bearer ${token.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ values: [req.values] }),
        timeoutMs: GOOGLE_TIMEOUT_MS,
        keepBody: true,
        signal: opts.signal,
      });

      switch (outcome.outcome) {
        case 'ok': {
          let updatedRange: unknown;
          try {
            updatedRange = (
              JSON.parse(outcome.body ?? '{}') as { updates?: { updatedRange?: unknown } }
            ).updates?.updatedRange;
          } catch {
            updatedRange = undefined;
          }
          return { ok: true, output: output(req, parseRowNumber(updatedRange)) };
        }
        case 'retry':
          return {
            ok: false,
            retryable: true,
            code: outcome.statusCode === 429 ? 'rate_limited' : 'google_unavailable',
            message:
              outcome.statusCode === 429
                ? 'Google Sheets asked PostGear to slow down.'
                : GOOGLE_UNAVAILABLE_MESSAGE,
          };
        case 'rejected':
          return rejected(req, outcome.statusCode, outcome.body);
        case 'unsafe':
          return {
            ok: false,
            retryable: false,
            code: 'google_unavailable',
            message: GOOGLE_UNAVAILABLE_MESSAGE,
          };
      }
    },
  };
}

function rejected(req: SheetsRequest, status: number, body: string | undefined): ProviderFailure {
  const error = googleError(body);
  if (status === 401) return disconnected();
  if (status === 404 || (status === 403 && error.status !== 'RESOURCE_EXHAUSTED')) {
    return {
      ok: false,
      retryable: false,
      code: 'spreadsheet_unavailable',
      message: sheetUnavailableMessage(req.spreadsheet.name),
      details: { status, googleStatus: error.status || null },
    };
  }
  if (status === 400 && /unable to parse range/i.test(error.message)) {
    return {
      ok: false,
      retryable: false,
      code: 'tab_missing',
      message: `The tab ${req.sheet.title} is not in ${req.spreadsheet.name} any more. Pick a tab again in this step.`,
    };
  }
  const words = error.message.slice(0, 200);
  return {
    ok: false,
    retryable: false,
    code: 'rejected',
    message: words
      ? `Google Sheets refused this row: ${words}`
      : `Google Sheets refused this row (${status}).`,
    details: { status, googleStatus: error.status || null },
  };
}
