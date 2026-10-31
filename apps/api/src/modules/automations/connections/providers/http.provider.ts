/**
 * Secret headers for the HTTP Request step (Module 13): `Authorization`,
 * `X-Api-Key` and the like. The step holds the URL; this holds only what
 * must stay out of the graph.
 */
import { z } from 'zod';
import { CONNECTION_MESSAGES } from '../connections.messages';
import type { ConnectionProvider, CredentialsVerdict } from './provider.types';

export const MAX_SECRET_HEADERS = 10;
const MAX_HEADER_NAME_LENGTH = 100;
const MAX_HEADER_VALUE_LENGTH = 4096;

/** RFC 9110 token characters. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Set by the HTTP client itself; a stored value would fight it. */
const RESERVED_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'te',
]);

export interface HttpCredentials {
  headers: { name: string; value: string }[];
}

export const httpCredentialsSchema = z
  .object({
    headers: z.array(z.object({ name: z.string(), value: z.string() }).strict()),
  })
  .strict();

function judgeHeaders(input: unknown): CredentialsVerdict<HttpCredentials> {
  const parsed = httpCredentialsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: CONNECTION_MESSAGES.HEADERS_INVALID };

  const { headers } = parsed.data;
  if (headers.length === 0) return { ok: false, message: CONNECTION_MESSAGES.HEADERS_NONE };
  if (headers.length > MAX_SECRET_HEADERS) {
    return { ok: false, message: CONNECTION_MESSAGES.HEADERS_TOO_MANY(MAX_SECRET_HEADERS) };
  }

  const seen = new Set<string>();
  const clean: HttpCredentials['headers'] = [];
  for (const header of headers) {
    const name = header.name.trim();
    if (!name || name.length > MAX_HEADER_NAME_LENGTH || !HEADER_NAME.test(name)) {
      return { ok: false, message: CONNECTION_MESSAGES.HEADER_NAME_INVALID };
    }
    const lower = name.toLowerCase();
    if (RESERVED_HEADERS.has(lower)) {
      return { ok: false, message: CONNECTION_MESSAGES.HEADER_RESERVED(name) };
    }
    if (seen.has(lower)) return { ok: false, message: CONNECTION_MESSAGES.HEADER_TWICE(name) };
    seen.add(lower);

    const value = header.value.trim();
    if (!value) return { ok: false, message: CONNECTION_MESSAGES.HEADER_VALUE_MISSING(name) };
    if (value.length > MAX_HEADER_VALUE_LENGTH || /[\r\n\0]/.test(value)) {
      return { ok: false, message: CONNECTION_MESSAGES.HEADER_VALUE_INVALID(name) };
    }
    clean.push({ name, value });
  }
  return { ok: true, credentials: { headers: clean } };
}

export const httpProvider: ConnectionProvider<HttpCredentials> = {
  kind: 'http',
  check: 'none',
  formEntry: true,
  helpLink: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Authorization',
  judge: async (input) => judgeHeaders(input),
  /**
   * Each header's name, the value's scheme word when it has one, and at most
   * its last 4 characters: "Authorization: Bearer ...9f2c, X-Api-Key: ...k999".
   */
  mask: ({ headers }) => headers.map(maskHeader).join(', '),
};

/** Values shorter than this show no characters at all: 4 would be too much of them. */
const MIN_LENGTH_FOR_LAST4 = 12;

export function maskHeader({ name, value }: { name: string; value: string }): string {
  const [first, ...rest] = value.trim().split(/\s+/);
  const scheme = rest.length > 0 && /^[A-Za-z][A-Za-z-]{1,15}$/.test(first) ? `${first} ` : '';
  const secret = scheme ? rest.join(' ') : value.trim();
  const tail = secret.length >= MIN_LENGTH_FOR_LAST4 ? secret.slice(-4) : '';
  return `${name}: ${scheme}...${tail}`;
}
