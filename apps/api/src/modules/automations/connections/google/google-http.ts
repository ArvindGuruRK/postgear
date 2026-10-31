/**
 * The one way the API talks to Google (Module 13): the OAuth code exchange,
 * token refreshes, and the Sheets helpers the step panel uses.
 *
 * The hosts are fixed (`oauth2.googleapis.com`, `www.googleapis.com`,
 * `sheets.googleapis.com`), so the address guard the worker needs for
 * user-typed links has nothing to add here; what this keeps is one path:
 * https only, one of those hosts or a refusal, no redirects followed, a
 * 15 s timeout, and the answer read as JSON. Specs replace this class, so no
 * test ever reaches Google.
 */
import { Injectable } from '@nestjs/common';

export const GOOGLE_HOSTS: ReadonlySet<string> = new Set([
  'oauth2.googleapis.com',
  'www.googleapis.com',
  'sheets.googleapis.com',
]);

export const GOOGLE_API_TIMEOUT_MS = 15_000;

export interface GoogleRequest {
  method: 'GET' | 'POST';
  url: string;
  /** Sent as `Authorization: Bearer ...`. */
  accessToken?: string;
  /** Sent as a form (the OAuth token endpoint). */
  form?: Record<string, string>;
  /** Sent as JSON (the Sheets API). */
  json?: unknown;
}

/** `status` 0 means Google never answered (network, timeout). */
export interface GoogleResponse {
  status: number;
  body: Record<string, unknown>;
}

@Injectable()
export class GoogleHttp {
  async request(input: GoogleRequest): Promise<GoogleResponse> {
    const url = new URL(input.url);
    if (url.protocol !== 'https:' || !GOOGLE_HOSTS.has(url.hostname)) {
      throw new Error(`Refusing a Google call to ${url.host}`);
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    let body: string | undefined;
    if (input.accessToken) headers.authorization = `Bearer ${input.accessToken}`;
    if (input.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(input.form).toString();
    } else if (input.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(input.json);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: input.method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
      });
    } catch {
      return { status: 0, body: {} };
    }

    const text = await response.text().catch(() => '');
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    return {
      status: response.status,
      body:
        typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {},
    };
  }
}
