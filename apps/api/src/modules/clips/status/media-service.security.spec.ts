/**
 * Security sweep, Secrets (Sprint 13, Module 16): the API's two callers of
 * the Python media service (`/ready` and `/voices`) send
 * `MEDIA_INTERNAL_TOKEN` in its header only, and never write it, the
 * service's address or what the service said to a log line, whatever the
 * failure repeats.
 *
 * Existing tests this builds on: media-service.probe.spec.ts, "asks /ready on
 * MEDIA_URL with the internal token and reads ok" and media-voices.client.spec.ts,
 * "asks /voices on MEDIA_URL with the internal token and reads the Kokoro
 * list" (the header is sent).
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import { MediaServiceProbe } from './media-service.probe';
import { MediaVoices } from './media-voices.client';

const TOKEN = 'media-internal-token-9f8e7d6c5b4a39281706f5e4d3c2b1a0';
const URL = 'http://media.internal.example:8100';
const VALUES: Partial<Record<keyof Env, string>> = { MEDIA_URL: URL, MEDIA_INTERNAL_TOKEN: TOKEN };
const settings = { get: (key: keyof Env) => VALUES[key] } as unknown as ConfigService<Env, true>;

let printed: string[] = [];
beforeEach(() => {
  printed = [];
  const keep = (...args: unknown[]) => {
    printed.push(
      args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '),
    );
  };
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(keep);
  }
  for (const level of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    jest.spyOn(console, level).mockImplementation(keep);
  }
});
afterEach(() => jest.restoreAllMocks());

/** The failures most likely to repeat what they were handed. */
const FAILURES: Array<[string, () => Promise<never>]> = [
  [
    'a refused connection naming the address and the header',
    async () => {
      throw new TypeError(`fetch failed: ${URL}/ready X-PostGear-Internal: ${TOKEN}`);
    },
  ],
  [
    'a reply whose body repeats the token',
    async () =>
      ({
        ok: false,
        status: 401,
        json: async () => ({ detail: `bad token ${TOKEN}` }),
      }) as never,
  ],
  [
    'a body that is not JSON',
    async () =>
      ({
        ok: true,
        json: async () => {
          throw new SyntaxError(`Unexpected token in "${TOKEN}"`);
        },
      }) as never,
  ],
];

function expectNothingPrinted(): void {
  const text = printed.join('\n');
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain('media.internal.example');
  expect(text).not.toContain('bad token');
}

describe('the media service callers never log the token', () => {
  it.each(FAILURES)('the probe, on %s', async (_label, failure) => {
    const probe = new MediaServiceProbe(settings);
    probe.fetcher = jest.fn(failure) as never;
    await expect(probe.state()).resolves.toMatch(/^(ok|off)$/);
    expectNothingPrinted();
  });

  it.each(FAILURES)('the voice list, on %s', async (_label, failure) => {
    const voices = new MediaVoices(settings);
    voices.fetcher = jest.fn(failure) as never;
    await expect(voices.list()).resolves.toMatchObject({ voices: [] });
    expectNothingPrinted();
  });

  it('sends the token in the header only, never in the address', async () => {
    const probe = new MediaServiceProbe(settings);
    const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    probe.fetcher = fetcher;
    await probe.state();
    const voices = new MediaVoices(settings);
    const voiceFetcher = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    voices.fetcher = voiceFetcher;
    await voices.list();
    for (const [url, init] of [...fetcher.mock.calls, ...voiceFetcher.mock.calls]) {
      expect(String(url)).not.toContain(TOKEN);
      expect(init.headers).toEqual({ 'X-PostGear-Internal': TOKEN });
      expect(init.redirect).toBe('error');
    }
    expectNothingPrinted();
  });
});
