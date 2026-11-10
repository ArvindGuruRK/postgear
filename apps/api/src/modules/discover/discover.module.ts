/**
 * Discover (Sprint 11): what is rising, what is news, what is being watched and
 * what is coming up in a place.
 *
 * Nothing from a feed is written to Postgres. Everything a feed keeps is in Redis,
 * for a limited time, and shared by everyone in that place.
 *
 * It owns two tables. `DiscoverSettings` (Module 06) is a workspace's own place,
 * languages, news topics and switched-off groups, a row per workspace at most,
 * and `DiscoverSettingsRepository` is the only thing that touches it.
 * `Competitor` (Module 07) is who a workspace follows, 20 at most, behind
 * `CompetitorsRepository`. What a competitor publishes is not in it: that is
 * read when someone looks and kept in Redis, like every other item here.
 *
 * The engine sits behind a token, built once from the environment, so a service
 * never knows whether it is reading recorded feeds and a test hands it a fake. The
 * boot log says which world this process is in and who it says it is, because that
 * is the first thing to check when an outside service has a complaint. It also says
 * whether videos are set up, and never the key that sets them up.
 *
 * Exports `DiscoverService` for Create Post (Module 04).
 */
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { CompetitorsController } from './competitors.controller';
import {
  COMPETITOR_ENGINE,
  COMPETITOR_GATE,
  createCompetitorEngine,
} from './competitors.engine';
import { CompetitorsRepository } from './competitors.repository';
import { CompetitorsService } from './competitors.service';
import { DiscoverCache } from './discover.cache';
import { DiscoverController } from './discover.controller';
import { createDiscoverEngine, DISCOVER_ENGINE, describeEngine } from './discover.engine';
import { DiscoverGate } from './discover.gate';
import { DiscoverService } from './discover.service';
import { LocalityService } from './locality.service';
import { DiscoverSettingsRepository } from './settings.repository';
import { DiscoverSettingsService } from './settings.service';

const MAX_UPSTREAM_FETCHES = 4;
const MAX_COMPETITOR_FETCHES = 4;
const GATE_WAIT_MS = 4_000;

@Module({
  controllers: [DiscoverController, CompetitorsController],
  providers: [
    {
      // Module 07: what reads a competitor's own places. Its own token, because
      // these are addresses a person typed, behind a guard nothing else here needs.
      provide: COMPETITOR_ENGINE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createCompetitorEngine({
          DISCOVER_SIMULATION: config.get('DISCOVER_SIMULATION', { infer: true }),
          DISCOVER_GEOCODER_USER_AGENT: config.get('DISCOVER_GEOCODER_USER_AGENT', { infer: true }),
        }),
    },
    {
      // Their own slots, so a slow host someone typed never makes a place feed wait.
      provide: COMPETITOR_GATE,
      useFactory: () => new DiscoverGate(MAX_COMPETITOR_FETCHES, GATE_WAIT_MS),
    },
    CompetitorsRepository,
    CompetitorsService,
    {
      provide: DISCOVER_ENGINE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const engine = createDiscoverEngine({
          DISCOVER_SIMULATION: config.get('DISCOVER_SIMULATION', { infer: true }),
          DISCOVER_GEOCODER: config.get('DISCOVER_GEOCODER', { infer: true }),
          DISCOVER_GEOCODER_USER_AGENT: config.get('DISCOVER_GEOCODER_USER_AGENT', { infer: true }),
          YOUTUBE_API_KEY: config.get('YOUTUBE_API_KEY', { infer: true }),
        });
        new Logger('Discover').log(JSON.stringify(describeEngine(engine)));
        return engine;
      },
    },
    {
      provide: DiscoverGate,
      useFactory: () => new DiscoverGate(MAX_UPSTREAM_FETCHES, GATE_WAIT_MS),
    },
    DiscoverCache,
    DiscoverService,
    DiscoverSettingsRepository,
    DiscoverSettingsService,
    LocalityService,
  ],
  exports: [DiscoverService],
})
export class DiscoverModule {}
