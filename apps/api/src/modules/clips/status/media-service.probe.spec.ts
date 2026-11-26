import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import { MediaServiceProbe } from './media-service.probe';

function probe(values: Partial<Record<keyof Env, string>> = {}) {
  const config = {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
  const instance = new MediaServiceProbe(config);
  let clock = 1_000_000;
  instance.now = () => clock;
  return {
    instance,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('MediaServiceProbe', () => {
  it('asks /ready on MEDIA_URL with the internal token and reads ok', async () => {
    const { instance } = probe({
      MEDIA_URL: 'http://media.local:8100',
      MEDIA_INTERNAL_TOKEN: 't'.repeat(64),
    });
    const fetcher = jest.fn().mockResolvedValue({ ok: true });
    instance.fetcher = fetcher;
    await expect(instance.state()).resolves.toBe('ok');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('http://media.local:8100/ready');
    expect(init.headers).toEqual({ 'X-PostGear-Internal': 't'.repeat(64) });
    expect(init.redirect).toBe('error');
  });

  it('reads a 503 or a refused connection as off', async () => {
    const { instance, advance } = probe();
    instance.fetcher = jest.fn().mockResolvedValue({ ok: false });
    await expect(instance.state()).resolves.toBe('off');
    advance(6_000);
    instance.fetcher = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(instance.state()).resolves.toBe('off');
  });

  it('keeps an ok answer 10 seconds and an off one 5, so a stop shows within about 10 seconds', async () => {
    const { instance, advance } = probe();
    const fetcher = jest.fn().mockResolvedValue({ ok: true });
    instance.fetcher = fetcher;
    await instance.state();
    advance(9_000);
    await instance.state();
    expect(fetcher).toHaveBeenCalledTimes(1);
    advance(1_500);
    fetcher.mockResolvedValue({ ok: false });
    await expect(instance.state()).resolves.toBe('off');
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(4_000);
    await instance.state();
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(1_500);
    await instance.state();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('shares one request between concurrent pages', async () => {
    const { instance } = probe();
    let release: (value: { ok: boolean }) => void = () => {};
    const fetcher = jest.fn().mockReturnValue(new Promise((resolve) => (release = resolve)));
    instance.fetcher = fetcher;
    const answers = Promise.all([instance.state(), instance.state(), instance.state()]);
    release({ ok: true });
    await expect(answers).resolves.toEqual(['ok', 'ok', 'ok']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('sends no header when no token is set (local only)', async () => {
    const { instance } = probe();
    const fetcher = jest.fn().mockResolvedValue({ ok: true });
    instance.fetcher = fetcher;
    await instance.state();
    expect(fetcher.mock.calls[0][1].headers).toEqual({});
    expect(fetcher.mock.calls[0][0]).toBe('http://localhost:8100/ready');
  });
});
