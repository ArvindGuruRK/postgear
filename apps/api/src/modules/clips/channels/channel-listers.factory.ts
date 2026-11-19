/**
 * Builds the bindings per platform from the environment, once at boot (one
 * factory that knows both worlds, the way `discover.engine.ts` does).
 *
 * - `CLIPS_SIMULATION=true`: the simulated lister for every platform, from
 *   `@postgear/media-tools/listing` (pure: no worker, no network). The
 *   official keys are ignored.
 * - Otherwise Twitch gets Helix when both Twitch values are set, YouTube the
 *   Data API when `CLIPS_YOUTUBE_API_KEY` is set (outside production
 *   `YOUTUBE_API_KEY` may stand in), and every platform the worker's flat
 *   list as the fallback (Kick has only that).
 *
 * Which bindings are live is logged once, by name only, never a value.
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createSimulatedChannelLister } from '@postgear/media-tools/listing';
import type { ClipPlatformId } from '@postgear/video-engine';
import type { Env } from '../../../config/env';
import type { RedisService } from '../../redis/redis.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipPlatformBreaker } from '../links/platform-breaker';
import type { ListerSet, ListerSets } from './channel-lister.selector';
import { createListerHttp, type ListerHttp } from './listers/lister-http';
import { withSimulationSwitches } from './listers/simulation-switches.lister';
import { TwitchHelixLister } from './listers/twitch-helix.lister';
import { WorkerFlatLister } from './listers/worker-flat.lister';
import { YouTubeDataLister } from './listers/youtube-data.lister';

export const LISTER_HTTP = Symbol('LISTER_HTTP');

export interface ListerFactoryDeps {
  config: ConfigService<Env, true>;
  scheduling: SchedulingService;
  redis: RedisService;
  breaker: ClipPlatformBreaker;
  http?: ListerHttp;
}

export function createListerSets(deps: ListerFactoryDeps): ListerSets {
  const logger = new Logger('ChannelListers');
  const { config } = deps;

  if (config.get('CLIPS_SIMULATION', { infer: true }) === 'true') {
    logger.log(JSON.stringify({ event: 'clips.channels.bindings', mode: 'simulation' }));
    // Module 20: the forcing channels (`simempty`, `simquota`, `simflaky`) sit in front.
    const simulated = (platform: ClipPlatformId): ListerSet => ({
      official: withSimulationSwitches(createSimulatedChannelLister(platform)),
      flat: null,
    });
    return Object.freeze({
      youtube: simulated('youtube'),
      twitch: simulated('twitch'),
      kick: simulated('kick'),
    });
  }

  const http = deps.http ?? createListerHttp();
  const flat = (platform: ClipPlatformId) =>
    new WorkerFlatLister(platform, {
      scheduling: deps.scheduling,
      breaker: deps.breaker,
      redis: deps.redis,
    });

  const clientId = config.get('TWITCH_CLIENT_ID', { infer: true });
  const clientSecret = config.get('TWITCH_CLIENT_SECRET', { infer: true });
  const twitch =
    clientId && clientSecret
      ? new TwitchHelixLister({ clientId, clientSecret, http, redis: deps.redis })
      : null;

  const production = config.get('NODE_ENV', { infer: true }) === 'production';
  const youtubeKey =
    config.get('CLIPS_YOUTUBE_API_KEY', { infer: true }) ??
    (production ? undefined : config.get('YOUTUBE_API_KEY', { infer: true }));
  const youtube = youtubeKey
    ? new YouTubeDataLister({ apiKey: youtubeKey, http, redis: deps.redis })
    : null;

  logger.log(
    JSON.stringify({
      event: 'clips.channels.bindings',
      mode: 'live',
      twitch: twitch ? 'helix' : 'flat',
      youtube: youtube ? 'data_api' : 'flat',
      kick: 'flat',
    }),
  );
  return Object.freeze({
    twitch: { official: twitch, flat: flat('twitch') },
    youtube: { official: youtube, flat: flat('youtube') },
    kick: { official: null, flat: flat('kick') },
  });
}
