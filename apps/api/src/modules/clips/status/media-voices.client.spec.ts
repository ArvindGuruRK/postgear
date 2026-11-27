import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import { MediaVoices } from './media-voices.client';

const FIXTURES = path.join(__dirname, '../../../../../../packages/media-contract/fixtures/voices');
const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as unknown;

function client(values: Partial<Record<keyof Env, string>> = {}) {
  const config = { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
  const instance = new MediaVoices(config);
  let clock = 1_000_000;
  instance.now = () => clock;
  return {
    instance,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const answering = (body: unknown, ok = true) =>
  jest.fn().mockResolvedValue({ ok, json: async () => body });

describe('MediaVoices', () => {
  it('asks /voices on MEDIA_URL with the internal token and reads the Kokoro list', async () => {
    const { instance } = client({
      MEDIA_URL: 'http://media.local:8100',
      MEDIA_INTERNAL_TOKEN: 't'.repeat(64),
    });
    const fetcher = answering(fixture('kokoro.json'));
    instance.fetcher = fetcher;
    const list = await instance.list();
    expect(list.speaker).toBe('kokoro');
    expect(list.voices.map((voice) => voice.id)).toContain('kokoro-heart');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('http://media.local:8100/voices');
    expect(init.headers).toEqual({ 'X-PostGear-Internal': 't'.repeat(64) });
    expect(init.redirect).toBe('error');
  });

  it('reads the simulated list, and an off speaker as no voices', async () => {
    const first = client();
    first.instance.fetcher = answering(fixture('simulated.json'));
    expect((await first.instance.list()).voices).toHaveLength(3);
    const off = client();
    // Even a voice listed beside an `off` speaker is not offered.
    off.instance.fetcher = answering({
      speaker: { state: 'off', name: 'kokoro' },
      voices: [{ id: 'kokoro-heart', name: 'Heart', languages: ['en'] }],
    });
    expect(await off.instance.list()).toEqual({ speaker: 'kokoro', voices: [] });
  });

  it('reads a 404, a refused connection or a list that is not the contract as no voices', async () => {
    for (const fetcher of [
      answering({}, false),
      jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      answering({ voices: [{ id: '../x', name: 'X', languages: ['en'] }] }),
    ]) {
      const { instance } = client();
      instance.fetcher = fetcher;
      expect(await instance.list()).toEqual({ speaker: null, voices: [] });
    }
  });

  it('keeps a list 30 seconds and no voices 5, sharing one request', async () => {
    const { instance, advance } = client();
    const fetcher = answering(fixture('kokoro.json'));
    instance.fetcher = fetcher;
    await Promise.all([instance.list(), instance.list()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    advance(29_000);
    await instance.list();
    expect(fetcher).toHaveBeenCalledTimes(1);
    advance(2_000);
    await instance.list();
    expect(fetcher).toHaveBeenCalledTimes(2);

    const empty = client();
    const silent = answering({}, false);
    empty.instance.fetcher = silent;
    await empty.instance.list();
    empty.advance(6_000);
    await empty.instance.list();
    expect(silent).toHaveBeenCalledTimes(2);
  });
});
