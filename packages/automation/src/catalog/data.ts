/**
 * Data steps: write to spreadsheets or call another app. Both leave
 * PostGear, so they run dry in tests unless switched on. Secret headers of
 * HTTP Request live in an `http` connection, never in the graph.
 */
import { z } from 'zod';
import { connectionIdField, count, OUT, templateField } from './fields';
import { defineNode } from './types';

const DATA_BASICS = {
  typeVersion: 1,
  category: 'data',
  family: 'orange',
  inputs: ['in'],
  outputs: OUT,
  sideEffect: 'external',
  retry: 'transient',
  timeoutClass: 'fast',
  canDisable: true,
  canHandleErrors: true,
} as const;

const columnsField = z
  .array(z.object({ header: z.string().max(200), value: templateField(2_000) }).strict())
  .max(50);

const sheetsConfig = z
  .object({
    connectionId: connectionIdField,
    spreadsheet: z
      .object({ id: z.string().min(1).max(200), name: z.string().max(200) })
      .strict()
      .nullable(),
    /** The tab: Google's numeric sheet id plus its title. */
    sheet: z
      .object({ id: z.number().int().min(0), title: z.string().min(1).max(200) })
      .strict()
      .nullable(),
    columns: columnsField,
    createdByPostGear: z.boolean().optional(),
  })
  .strict();

export const googleSheetsAppendRow = defineNode({
  ...DATA_BASICS,
  type: 'data.googleSheetsAppendRow',
  title: 'Google Sheets: Append Row',
  description: 'Adds a row to a Google Sheets spreadsheet.',
  keywords: ['google', 'sheets', 'spreadsheet', 'excel', 'row', 'log', 'report', 'table'],
  icon: 'google-sheets',
  status: 'ready',
  priority: 'P1',
  configSchema: sheetsConfig,
  defaultConfig: { connectionId: '', spreadsheet: null, sheet: null, columns: [] },
  required: [
    { path: 'spreadsheet', message: 'Pick a spreadsheet.' },
    { path: 'sheet', message: 'Pick a tab in the spreadsheet.' },
    { path: 'columns', message: 'Fill in at least one column.' },
  ],
  outputShape: [
    { path: 'rowNumber', label: 'Row Number', type: 'number', sample: 42 },
    { path: 'spreadsheet', label: 'Spreadsheet', type: 'object' },
    { path: 'spreadsheet.name', label: 'Spreadsheet Name', type: 'text', sample: 'Social Report' },
    {
      path: 'spreadsheet.url',
      label: 'Spreadsheet Link',
      type: 'text',
      sample: 'https://docs.google.com/spreadsheets/d/1abc',
    },
    { path: 'sheet', label: 'Tab', type: 'text', sample: 'Posts' },
  ],
  connection: { kind: 'google', field: 'connectionId' },
  summary: (config) =>
    config.spreadsheet ? `Adds a row to ${config.spreadsheet.name}` : 'Pick a spreadsheet',
});

export const excelAppendRow = defineNode({
  ...DATA_BASICS,
  type: 'data.excelAppendRow',
  title: 'Excel: Append Row',
  description: 'Adds a row to an Excel workbook in OneDrive.',
  keywords: ['excel', 'microsoft', 'spreadsheet', 'onedrive', 'row', 'table'],
  icon: 'excel',
  status: 'comingSoon',
  comingSoonReason: 'Excel is coming soon.',
  priority: 'P2',
  configSchema: z.object({ columns: columnsField }).strict(),
  defaultConfig: { columns: [] },
  outputShape: [{ path: 'rowNumber', label: 'Row Number', type: 'number', sample: 42 }],
  summary: () => 'Coming soon',
});

const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;

const httpConfig = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    /** A template that must resolve to an https address. */
    url: templateField(2_048),
    /** Plain headers only; secret ones go in the connection below. */
    headers: z
      .array(
        z
          .object({
            name: z.string().regex(HEADER_NAME, 'Use letters, numbers and - only.'),
            value: templateField(2_000),
          })
          .strict(),
      )
      .max(20),
    secretHeadersConnectionId: connectionIdField.optional(),
    bodyType: z.enum(['none', 'json', 'form', 'text']),
    body: templateField(20_000).optional(),
    responseType: z.enum(['auto', 'json', 'text']),
  })
  .strict();

/** "api.example.com" from a typed address; nothing when the host is data from a step. */
function hostOf(url: string): string | undefined {
  const match = /^https?:\/\/([^/?#\s{}]+)/i.exec(url.trim());
  return match?.[1];
}

export const httpRequest = defineNode({
  ...DATA_BASICS,
  type: 'data.httpRequest',
  title: 'HTTP Request',
  description: 'Sends a request to another app and gives its answer to the next steps.',
  keywords: ['http', 'api', 'request', 'rest', 'call', 'url', 'fetch', 'post'],
  icon: 'http',
  status: 'ready',
  priority: 'P1',
  configSchema: httpConfig,
  defaultConfig: {
    method: 'POST',
    url: '',
    headers: [],
    bodyType: 'json',
    body: '',
    responseType: 'auto',
  },
  required: [{ path: 'url', message: 'Enter the address to send the request to.' }],
  outputShape: [
    { path: 'status', label: 'Status Code', type: 'number', sample: 200 },
    { path: 'ok', label: 'Succeeded', type: 'boolean', sample: true },
    { path: 'headers', label: 'Response Headers', type: 'object' },
    { path: 'body', label: 'Response', type: 'object', sample: { id: 'abc123' } },
  ],
  connection: { kind: 'http', field: 'secretHeadersConnectionId', optional: true },
  summary: (config) => {
    const host = hostOf(config.url);
    const headers = config.headers.length ? `, ${count(config.headers.length, 'header')}` : '';
    return host ? `${config.method} to ${host}${headers}` : `${config.method} request${headers}`;
  },
});

export const DATA_NODES = [googleSheetsAppendRow, excelAppendRow, httpRequest];
