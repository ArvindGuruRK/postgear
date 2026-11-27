/**
 * Which schedule source the API binds, decided once at boot (Sprint 13,
 * Module 14 section C3), the way the channel browser decides its listers:
 *
 * - `CLIPS_SIMULATION=true`: the fixtures. Any Twitch keys are ignored.
 * - Both Twitch values set: Helix, with the channel browser's app token.
 * - Neither, outside production: the fixtures too, so the Schedule Maker
 *   works on a laptop with no keys and never reaches Twitch.
 * - Neither, in production: none; every fetch says Twitch schedules are not
 *   set up, and the page's by-hand tab still works.
 *
 * Logged once, by name only: never a value.
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import { createListerHttp, type ListerHttp } from '../../clips/channels/listers/lister-http';
import { TwitchAppToken } from '../../clips/channels/listers/twitch-app-token';
import type { RedisService } from '../../redis/redis.service';
import type { ScheduleSource } from './schedule-source';
import { SimulatedScheduleSource } from './simulated-schedule.source';
import { TwitchScheduleClient } from './twitch-schedule.client';

export interface ScheduleSourceDeps {
  config: Pick<ConfigService<Env, true>, 'get'>;
  redis: Pick<RedisService, 'get' | 'set' | 'delete'>;
  http?: ListerHttp;
}

export function createScheduleSource(deps: ScheduleSourceDeps): ScheduleSource | null {
  const { config } = deps;
  const simulation = config.get('CLIPS_SIMULATION', { infer: true }) === 'true';
  const clientId = config.get('TWITCH_CLIENT_ID', { infer: true });
  const clientSecret = config.get('TWITCH_CLIENT_SECRET', { infer: true });
  const production = config.get('NODE_ENV', { infer: true }) === 'production';

  let source: ScheduleSource | null = null;
  if (simulation) {
    source = new SimulatedScheduleSource();
  } else if (clientId && clientSecret) {
    const http = deps.http ?? createListerHttp();
    source = new TwitchScheduleClient({
      token: new TwitchAppToken({ clientId, clientSecret, http, redis: deps.redis }),
      http,
    });
  } else if (!production) {
    source = new SimulatedScheduleSource();
  }

  new Logger('StudioSchedules').log(
    JSON.stringify({ event: 'studio.schedules.binding', mode: source?.mode ?? 'off' }),
  );
  return source;
}
