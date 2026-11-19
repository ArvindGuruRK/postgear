/**
 * Keeps the worker's secrets out of its log lines (Sprint 12, Module 20).
 *
 * A tool's stderr and an error's message can repeat what the tool was given:
 * the yt-dlp proxy (which may carry a user name and a password), the path of
 * the operator's cookies file, the signing secret or a storage key. Text like
 * that goes through `scrubSecrets` before it is logged. It hides:
 *
 * - every value of `LOG_SECRET_NAMES` in the environment (and the parts of
 *   the proxy address: its host, user name and password);
 * - a user name and password inside any address (`scheme://user:pass@host`);
 * - the value after `--proxy`, `--cookies` and `-http_proxy` in a printed
 *   command line, and any path to a `cookies.txt` (each job's own copy).
 *
 * The values are read from the environment at each call, so nothing has to
 * be registered at boot and a test can set them like the worker does.
 */
import { basename } from 'node:path';

export const REDACTED = '[REDACTED]';

/** The variables whose values never appear in a log line. */
export const LOG_SECRET_NAMES = [
  'CLIPS_URL_SECRET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'YTDLP_PROXY',
  'YTDLP_COOKIES_FILE',
  'AUTOMATION_INTERNAL_TOKEN',
  'ENCRYPTION_KEY_AES256',
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'CLIPS_YOUTUBE_API_KEY',
] as const;

/** Shorter values are not hidden on their own: they would blank out ordinary words. */
const MIN_SECRET_LENGTH = 6;

const ADDRESS_WITH_LOGIN = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]*@/gi;
const FLAG_VALUES = /(--proxy|--cookies|-http_proxy)(\s+|=)("[^"]*"|'[^']*'|\S+)/g;
const COOKIES_PATH = /[^\s'"]*cookies\.txt/gi;

/** The parts of a proxy address worth hiding beside the whole address. */
function proxyParts(proxy: string): string[] {
  try {
    const url = new URL(proxy);
    const parts = [url.host];
    for (const part of [url.username, url.password]) {
      if (part) parts.push(part, decodeURIComponent(part));
    }
    return parts;
  } catch {
    return [];
  }
}

/** Every value to hide, longest first so a longer secret is never half replaced. */
export function logSecretsFrom(env: Record<string, string | undefined>): string[] {
  const values = new Set<string>();
  const add = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed && trimmed.length >= MIN_SECRET_LENGTH) values.add(trimmed);
  };
  for (const name of LOG_SECRET_NAMES) add(env[name]);
  const proxy = env.YTDLP_PROXY?.trim();
  if (proxy) for (const part of proxyParts(proxy)) add(part);
  const cookies = env.YTDLP_COOKIES_FILE?.trim();
  if (cookies) add(basename(cookies));
  return [...values].sort((a, b) => b.length - a.length);
}

/** `text` with every secret this worker knows replaced by `[REDACTED]`. */
export function scrubSecrets(
  text: string,
  env: Record<string, string | undefined> = process.env,
): string {
  let out = text;
  for (const value of logSecretsFrom(env)) {
    out = out.split(value).join(REDACTED);
  }
  return out
    .replace(ADDRESS_WITH_LOGIN, `$1${REDACTED}@`)
    .replace(FLAG_VALUES, `$1$2${REDACTED}`)
    .replace(COOKIES_PATH, REDACTED);
}
