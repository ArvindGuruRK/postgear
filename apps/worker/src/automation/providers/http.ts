/**
 * HTTP Request (Sprint 10, Module 13): call another app, give its answer to
 * the next steps.
 *
 * - **https only**, unless `WEBHOOK_ALLOW_PRIVATE_URLS=true` (local testing,
 *   refused in production), which also allows http and private hosts.
 * - **`safeHttpRequest`** does the rest: the public-address guard with the
 *   address pinned (no DNS rebinding), a 15 s timeout, the answer kept up to
 *   64 KB (cut with a note), and **no redirects**: a 3xx is the answer, so
 *   a redirect can never lead PostGear to a private address.
 * - **JSON bodies are built safely.** The body template is resolved in the
 *   resolver's JSON mode (data inside a JSON string is escaped, data outside
 *   one is written as a JSON value), then must parse as JSON. A post text
 *   with quotes in it cannot break, or add to, the body.
 * - **Secret headers** come from the step's `http` connection and are merged
 *   in at send time only; they never reach the step's input, output or
 *   dry-run line (the engine redacts with the connection's values too).
 * - **`Idempotency-Key: ${runId}:${nodeKey}`** on POST and PATCH, so an app
 *   that honours it never acts twice when Temporal retries the attempt.
 * - **Failures**: 408, 429, 5xx, a timeout or a network error are worth
 *   retrying; any other 4xx is permanent with "The other app answered 422:
 *   {its words}"; an address the guard refuses is "This address is not
 *   allowed."
 */

import type { IncomingHttpHeaders } from 'node:http';
import { type RunScope, resolveTemplate } from '@postgear/automation';
import type { UrlGuardOptions } from '@postgear/seo-engine';
import type { safeHttpRequest } from '../../lib/safe-http';
import { permanent } from '../failures';
import type {
  AutomationProvider,
  ProviderBuildContext,
  ProviderResult,
  ProviderSendOptions,
} from './types';

export const HTTP_STEP_TIMEOUT_MS = 15_000;
export const HTTP_STEP_MAX_RESPONSE_BYTES = 64 * 1024;
export const ADDRESS_NOT_ALLOWED = 'This address is not allowed.';
export const HTTPS_ONLY = 'Use an address that starts with https://.';
export const BODY_NOT_JSON = 'The body is not valid JSON. Check its brackets, commas and quotes.';
export const RESPONSE_CUT_NOTE =
  'The answer was longer than 64 KB, so only the first 64 KB is kept, as text.';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type BodyType = 'none' | 'json' | 'form' | 'text';

/** The step's settings after data tokens are filled in (text mode). */
export interface HttpConfig {
  method: Method;
  url: unknown;
  headers: { name: string; value: unknown }[];
  secretHeadersConnectionId?: string;
  bodyType: BodyType;
  body?: unknown;
  responseType: 'auto' | 'json' | 'text';
}

export interface HttpStepRequest {
  method: Method;
  url: string;
  /** Plain headers only: the secret ones join at send time. */
  headers: { name: string; value: string }[];
  bodyType: BodyType;
  /** What goes on the wire. */
  body?: string;
  /** What the dry run shows: the parsed JSON, the form fields, or the text. */
  preview?: unknown;
  contentType?: string;
  responseType: HttpConfig['responseType'];
  /** JSON keys or form fields, for "with 3 fields". */
  fieldCount: number;
}

export interface HttpStepOutput {
  status: number;
  ok: boolean;
  headers: { 'content-type'?: string; 'content-length'?: string; location?: string };
  body: unknown;
  note?: string;
}

export interface HttpDeps {
  http: typeof safeHttpRequest;
  /** WEBHOOK_ALLOW_PRIVATE_URLS: http and private hosts allowed (local testing). */
  allowPrivate: boolean;
  /** The body template as saved, so it is resolved in JSON mode. */
  rawBody: unknown;
  /** The guard's resolver (tests). */
  resolve?: UrlGuardOptions['resolve'];
}

/** Set by the HTTP client itself; a header of the same name is dropped. */
const RESERVED = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'te',
]);

/** A header value on one line: data with a line break cannot add a header. */
function oneLine(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\0]+/g, ' ')
    .trim();
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** `name=value` lines as form fields; blank lines are skipped. */
export function formFields(text: string): [string, string][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const at = line.indexOf('=');
      return at < 0 ? [line, ''] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    });
}

/** The body as it goes out, built from the saved template and the run's data. */
export function buildBody(
  bodyType: BodyType,
  rawBody: unknown,
  resolvedBody: unknown,
  scope: RunScope,
  timeZone: string,
): Pick<HttpStepRequest, 'body' | 'preview' | 'contentType' | 'fieldCount'> {
  switch (bodyType) {
    case 'none':
      return { fieldCount: 0 };
    case 'json': {
      const template = typeof rawBody === 'string' ? rawBody : '';
      if (template.trim() === '')
        return { body: '{}', preview: {}, contentType: 'application/json', fieldCount: 0 };
      const text = String(resolveTemplate(template, scope, { json: true, timeZone }).value);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw permanent(BODY_NOT_JSON, 'body_not_json');
      }
      const fieldCount = Array.isArray(parsed)
        ? parsed.length
        : typeof parsed === 'object' && parsed !== null
          ? Object.keys(parsed).length
          : 1;
      return {
        body: JSON.stringify(parsed),
        preview: parsed,
        contentType: 'application/json',
        fieldCount,
      };
    }
    case 'form': {
      const fields = formFields(asText(resolvedBody));
      return {
        body: new URLSearchParams(fields).toString(),
        preview: Object.fromEntries(fields),
        contentType: 'application/x-www-form-urlencoded',
        fieldCount: fields.length,
      };
    }
    case 'text': {
      const text = asText(resolvedBody);
      return { body: text, preview: text, contentType: 'text/plain; charset=utf-8', fieldCount: 0 };
    }
  }
}

/** The address, checked for its scheme; throws the step's permanent failure. */
export function checkAddress(raw: unknown, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw permanent('Enter a full address that starts with https://.', 'address_invalid');
  }
  if (url.username || url.password) throw permanent(ADDRESS_NOT_ALLOWED, 'address_not_allowed');
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && allowPrivate) return url;
  throw permanent(
    url.protocol === 'http:' ? HTTPS_ONLY : ADDRESS_NOT_ALLOWED,
    'address_not_allowed',
  );
}

/** "Would send POST to api.example.com/hooks/new-post with 3 fields." */
export function describeRequest(req: HttpStepRequest): string {
  let where = req.url;
  try {
    const url = new URL(req.url);
    where = `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    // Already checked in build; keep the text as it is.
  }
  const what =
    req.bodyType === 'json' || req.bodyType === 'form'
      ? ` with ${req.fieldCount} field${req.fieldCount === 1 ? '' : 's'}`
      : req.bodyType === 'text'
        ? ' with a text body'
        : '';
  return `Would send ${req.method} to ${where}${what}.`;
}

function firstHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The answer's body: JSON when it says so (or was asked for), else text. */
export function readBody(
  text: string,
  contentType: string | undefined,
  responseType: HttpConfig['responseType'],
): unknown {
  const wantsJson =
    responseType === 'json' || (responseType === 'auto' && /[/+]json\b/i.test(contentType ?? ''));
  if (!wantsJson || text.trim() === '') return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The app's own words from an error answer, first 200 characters. */
export function answerWords(body: string | undefined): string {
  if (!body) return '';
  let words = body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const candidate =
      parsed.message ??
      parsed.error_description ??
      (typeof parsed.error === 'object' && parsed.error !== null
        ? (parsed.error as Record<string, unknown>).message
        : parsed.error);
    if (typeof candidate === 'string' && candidate.trim()) words = candidate;
  } catch {
    // Not JSON: the text itself.
  }
  return words.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Secret headers stored in an `http` connection. */
function secretHeaders(credentials: unknown): { name: string; value: string }[] {
  if (typeof credentials !== 'object' || credentials === null) return [];
  const headers = (credentials as { headers?: unknown }).headers;
  if (!Array.isArray(headers)) return [];
  return headers.flatMap((header) =>
    typeof header === 'object' &&
    header !== null &&
    typeof (header as { name?: unknown }).name === 'string' &&
    typeof (header as { value?: unknown }).value === 'string'
      ? [{ name: (header as { name: string }).name, value: (header as { value: string }).value }]
      : [],
  );
}

export function httpProvider(deps: HttpDeps): AutomationProvider<HttpStepRequest, HttpConfig> {
  return {
    kind: 'http',

    build(config: HttpConfig, ctx: ProviderBuildContext): HttpStepRequest {
      const url = checkAddress(config.url, deps.allowPrivate);
      const headers = (Array.isArray(config.headers) ? config.headers : [])
        .map((header) => ({ name: String(header.name).trim(), value: oneLine(header.value) }))
        .filter((header) => header.name !== '' && !RESERVED.has(header.name.toLowerCase()));
      return {
        method: config.method,
        url: url.toString(),
        headers,
        bodyType: config.bodyType,
        responseType: config.responseType,
        ...buildBody(config.bodyType, deps.rawBody, config.body, ctx.scope, ctx.timeZone),
      };
    },

    describe: describeRequest,

    async simulate(req) {
      const output: HttpStepOutput & { simulated: true } = {
        status: 200,
        ok: true,
        headers: { 'content-type': 'application/json' },
        body: { received: true, method: req.method },
        simulated: true,
      };
      return { ok: true, output };
    },

    async send(req, credentials, opts: ProviderSendOptions): Promise<ProviderResult> {
      const headers: Record<string, string> = {};
      const set = (name: string, value: string) => {
        for (const existing of Object.keys(headers)) {
          if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing];
        }
        headers[name] = value;
      };
      const has = (name: string) =>
        Object.keys(headers).some((existing) => existing.toLowerCase() === name.toLowerCase());

      set('User-Agent', 'PostGear-Workflows/1.0');
      set('Accept', req.responseType === 'text' ? 'text/plain, */*' : 'application/json, */*');
      for (const header of req.headers) set(header.name, header.value);
      for (const header of secretHeaders(credentials)) {
        if (!RESERVED.has(header.name.toLowerCase())) set(header.name, oneLine(header.value));
      }
      if (req.body !== undefined && req.contentType && !has('content-type')) {
        set('Content-Type', req.contentType);
      }
      if ((req.method === 'POST' || req.method === 'PATCH') && !has('idempotency-key')) {
        set('Idempotency-Key', opts.idempotencyKey);
      }

      const outcome = await deps.http({
        method: req.method,
        url: req.url,
        headers,
        ...(req.body !== undefined ? { body: req.body } : {}),
        timeoutMs: HTTP_STEP_TIMEOUT_MS,
        maxResponseBytes: HTTP_STEP_MAX_RESPONSE_BYTES,
        keepBody: true,
        allowPrivate: deps.allowPrivate,
        ...(deps.resolve ? { resolve: deps.resolve } : {}),
        signal: opts.signal,
      });

      switch (outcome.outcome) {
        case 'ok': {
          const contentType = firstHeader(outcome.headers, 'content-type');
          const contentLength = firstHeader(outcome.headers, 'content-length');
          const location = firstHeader(outcome.headers, 'location');
          const text = outcome.body ?? '';
          const output: HttpStepOutput = {
            status: outcome.statusCode,
            ok: outcome.statusCode >= 200 && outcome.statusCode < 300,
            headers: {
              ...(contentType ? { 'content-type': contentType } : {}),
              ...(contentLength ? { 'content-length': contentLength } : {}),
              ...(location ? { location } : {}),
            },
            body: outcome.bodyTruncated ? text : readBody(text, contentType, req.responseType),
            ...(outcome.bodyTruncated ? { note: RESPONSE_CUT_NOTE } : {}),
          };
          return { ok: true, output };
        }
        case 'retry':
          return {
            ok: false,
            retryable: true,
            code:
              outcome.statusCode === 429
                ? 'rate_limited'
                : outcome.statusCode === null
                  ? 'no_answer'
                  : 'unavailable',
            message:
              outcome.statusCode === 429
                ? 'The other app asked PostGear to slow down.'
                : outcome.statusCode === null
                  ? `The other app did not answer (${outcome.error}).`
                  : `The other app is not answering right now (${outcome.statusCode}).`,
          };
        case 'rejected': {
          const words = answerWords(outcome.body);
          return {
            ok: false,
            retryable: false,
            code: 'rejected',
            message: words
              ? `The other app answered ${outcome.statusCode}: ${words}`
              : `The other app answered ${outcome.statusCode}.`,
            details: { status: outcome.statusCode },
          };
        }
        case 'unsafe':
          return {
            ok: false,
            retryable: false,
            code: 'address_not_allowed',
            message: ADDRESS_NOT_ALLOWED,
          };
      }
    },
  };
}
