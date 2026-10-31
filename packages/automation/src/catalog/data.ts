/**
 * Data steps: write to spreadsheets or call another app. Both leave
 * PostGear, so they run dry in tests unless switched on. Secret headers of
 * HTTP Request live in an `http` connection, never in the graph: a plain
 * header whose name looks secret (`Authorization`, `X-Api-Key`, `Token`)
 * is a config problem with the sentence the panel shows.
 *
 * Google Sheets uses the `drive.file` scope (Module 13): PostGear sees only
 * the spreadsheets someone picked with Google's file picker or that
 * PostGear created, so the form never offers a pasted link.
 */
import { z } from 'zod';
import { isSecretKey } from '../redact/patterns';
import { connectionIdField, count, OUT, templateField } from './fields';
import { defineNode } from './types';

/** Validation's words for a secret-looking plain header (Module 13). */
export const SECRET_HEADER_MESSAGE = 'Put this header in a connection so it stays secret.';

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
  form: {
    tabs: {
      setup: [
        { path: 'connectionId', kind: 'connection', label: 'Google account', required: true },
        {
          path: 'spreadsheet',
          kind: 'spreadsheet',
          label: 'Spreadsheet',
          help: 'Pick one with Google’s file picker, or create a new one.',
          required: true,
        },
        {
          path: 'sheet',
          kind: 'sheetTab',
          label: 'Tab',
          help: 'The tab in the spreadsheet that gets the new rows.',
          required: true,
        },
      ],
      configure: [
        {
          path: 'columns',
          kind: 'sheetColumns',
          label: 'Columns',
          help: 'One per heading in the first row of the tab. A column you leave empty gets an empty cell.',
          acceptsData: true,
          max: 50,
          required: true,
        },
      ],
    },
    notes: [
      'PostGear can only open spreadsheets you pick with Google’s file picker or that PostGear created. Pasting a link to a spreadsheet will not work.',
      'Each run adds one row at the bottom of the tab. Text is written exactly as it is, so nothing in it turns into a formula.',
    ],
  },
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

const httpConfigShape = z
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

/** A plain header whose name looks secret belongs in a connection. */
const httpConfig = httpConfigShape.superRefine((config, issue) => {
  config.headers.forEach((header, i) => {
    if (isSecretKey(header.name)) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['headers', i, 'name'],
        message: SECRET_HEADER_MESSAGE,
      });
    }
  });
});

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** The body field, once per body type, so each gets its own help (one shows at a time). */
const BODY_FIELDS = (
  [
    ['json', 'Data you insert is written safely inside the JSON, quotes and all.'],
    ['form', 'One field per line, like name=value.'],
    ['text', 'Sent exactly as written.'],
  ] as const
).map(([type, help]) => ({
  path: 'body',
  kind: 'longText' as const,
  label: 'Body',
  help,
  placeholder: 'Enter your request body',
  acceptsData: true,
  showIf: { path: 'bodyType', equals: type },
}));

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
  form: {
    tabs: {
      setup: [
        {
          path: 'method',
          kind: 'select',
          label: 'Method',
          options: HTTP_METHODS.map((method) => ({ value: method, label: method })),
          required: true,
        },
        {
          path: 'url',
          kind: 'text',
          label: 'Address',
          help: 'Must start with https://.',
          placeholder: 'Enter your address',
          acceptsData: true,
          required: true,
        },
        {
          path: 'secretHeadersConnectionId',
          kind: 'connection',
          label: 'Secret headers',
          help: 'Optional. Keys and passwords the other app needs, kept in a connection so they are never saved in the workflow.',
        },
      ],
      configure: [
        {
          path: 'headers',
          kind: 'keyValue',
          label: 'Headers',
          help: 'Never put a password or key here: use Secret headers.',
          acceptsData: true,
          max: 20,
          row: { key: 'name', value: 'value', keyLabel: 'Name', valueLabel: 'Value' },
        },
        {
          path: 'bodyType',
          kind: 'select',
          label: 'Body type',
          options: [
            { value: 'none', label: 'No body' },
            { value: 'json', label: 'JSON' },
            { value: 'form', label: 'Form fields' },
            { value: 'text', label: 'Plain text' },
          ],
        },
        ...BODY_FIELDS,
        {
          path: 'responseType',
          kind: 'select',
          label: 'Read the answer as',
          options: [
            { value: 'auto', label: 'Work it out from the answer' },
            { value: 'json', label: 'JSON' },
            { value: 'text', label: 'Text' },
          ],
        },
      ],
    },
    notes: [
      'PostGear never follows a redirect: the other app’s answer is what the next steps get.',
      'POST and PATCH requests carry an Idempotency-Key header, so an app that supports it never acts twice on a retry.',
    ],
  },
});

export const DATA_NODES = [googleSheetsAppendRow, excelAppendRow, httpRequest];
