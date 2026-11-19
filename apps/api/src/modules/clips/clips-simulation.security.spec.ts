/**
 * Security sweep, Simulation (Sprint 12, Module 20), the API's half.
 *
 * - `CLIPS_SIMULATION=true` stops the API at boot when NODE_ENV=production
 *   (the worker refuses it too: `apps/worker/src/clips/simulation.security.test.ts`).
 * - With simulation off, nothing is answered from the fixtures: the simulated
 *   channel goes to the real bindings (fakes here, nothing is fetched), and
 *   Try A Sample never offers the simulation's sample link
 *   (`videos/clip-videos.service.spec.ts`, "sampleLinkFor").
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { validateEnv } from '../../config/env';
import { RedisService } from '../redis/redis.service';
import type { SchedulingService } from '../scheduling/scheduling.service';
import { ChannelListerSelector } from './channels/channel-lister.selector';
import { createListerSets } from './channels/channel-listers.factory';
import type { ListerHttp } from './channels/listers/lister-http';
import { ClipPlatformBreaker } from './links/platform-breaker';
import { SIMULATION_SAMPLE_LINK, sampleLinkFor } from './videos/clip-sample';

const base = {
  DATABASE_URL: 'postgresql://localhost/db',
  JWT_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY_AES256: 'a'.repeat(64),
};
const REFUSAL = 'CLIPS_SIMULATION cannot be "true" when NODE_ENV=production';

function bootMessage(env: Record<string, string>): string {
  try {
    validateEnv({ ...base, ...env });
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

beforeAll(() => Logger.overrideLogger(false));

describe('CLIPS_SIMULATION at boot', () => {
  it('stops the API in production', () => {
    expect(bootMessage({ NODE_ENV: 'production', CLIPS_SIMULATION: 'true' })).toContain(REFUSAL);
  });

  it('says nothing about it when production has simulation off, or outside production', () => {
    expect(bootMessage({ NODE_ENV: 'production', CLIPS_SIMULATION: 'false' })).not.toContain(
      REFUSAL,
    );
    expect(bootMessage({ NODE_ENV: 'production' })).not.toContain(REFUSAL);
    expect(validateEnv({ ...base, CLIPS_SIMULATION: 'true' }).CLIPS_SIMULATION).toBe('true');
    // A blank value (how .env.example ships it) is off.
    expect(validateEnv({ ...base, CLIPS_SIMULATION: '' }).CLIPS_SIMULATION).toBe('false');
  });
});

describe('the simulated channel with simulation off', () => {
  function liveSets(values: Record<string, unknown>) {
    const config = { get: (key: string) => values[key] } as unknown as ConfigService;
    const redis = new RedisService({ get: () => undefined } as unknown as ConfigService);
    const http = jest.fn<ReturnType<ListerHttp>, Parameters<ListerHttp>>(async (request) => {
      const origin = new URL(request.url).origin;
      if (origin === 'https://id.twitch.tv') {
        return {
          status: 200,
          header: () => null,
          json: { access_token: 't'.repeat(30), expires_in: 9_999 },
        };
      }
      // The platform does not know the made-up channel.
      return { status: 200, header: () => null, json: { data: [], items: [] } };
    });
    const runClipQuery = jest.fn(async () => ({ outcome: 'unavailable' as const }));
    const sets = createListerSets({
      config: config as never,
      scheduling: { runClipQuery } as unknown as SchedulingService,
      redis,
      breaker: new ClipPlatformBreaker(redis),
      http,
    });
    return { selector: new ChannelListerSelector(sets), http, runClipQuery };
  }

  it('asks the real bindings, which do not know it, and never the fixtures', async () => {
    const { selector, http, runClipQuery } = liveSets({
      NODE_ENV: 'production',
      CLIPS_SIMULATION: 'false',
      TWITCH_CLIENT_ID: 'twitch-client-id-0001',
      TWITCH_CLIENT_SECRET: 'twitch-client-secret-0001',
      CLIPS_YOUTUBE_API_KEY: 'youtube-key-0001',
    });
    // Twitch and YouTube: the official APIs answer "no such channel".
    for (const [platform, handle] of [
      ['twitch', 'simstreamer'],
      ['youtube', '@simstreamer'],
    ] as const) {
      await expect(selector.resolve(platform, handle)).rejects.toMatchObject({
        code: 'channel_not_found',
      });
    }
    expect(http).toHaveBeenCalled();
    // Kick has only the worker's flat list, which is not running here.
    await expect(selector.resolve('kick', 'simstreamer')).rejects.toMatchObject({
      code: 'tools_offline',
    });
    expect(runClipQuery).toHaveBeenCalledTimes(1);
  });

  it('with no keys, every platform goes to the worker, never to the fixtures', async () => {
    const { selector, http, runClipQuery } = liveSets({ CLIPS_SIMULATION: 'false' });
    for (const platform of ['twitch', 'youtube', 'kick'] as const) {
      await expect(selector.resolve(platform, 'simstreamer')).rejects.toMatchObject({
        code: 'tools_offline',
      });
    }
    expect(http).not.toHaveBeenCalled();
    expect(runClipQuery).toHaveBeenCalledTimes(3);
  });
});

describe('Try A Sample with simulation off', () => {
  it('never offers the simulation sample, set or not', () => {
    const platforms = ['youtube', 'twitch', 'kick'] as const;
    expect(
      sampleLinkFor({ simulation: false, configured: undefined, platforms: [...platforms] }),
    ).toBeNull();
    expect(
      sampleLinkFor({
        simulation: false,
        configured: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        platforms: [...platforms],
      }),
    ).not.toBe(SIMULATION_SAMPLE_LINK);
  });
});
