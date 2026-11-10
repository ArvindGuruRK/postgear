/**
 * Discover (Sprint 11): what is rising and what is news in a place.
 *
 * Owns no table: nothing from a feed is written to Postgres. Everything it keeps is
 * in Redis, for a limited time, and shared by everyone in that place.
 *
 * The engine sits behind a token, built once from the environment, so a service
 * never knows whether it is reading recorded feeds and a test hands it a fake. The
 * boot log says which world this process is in and who it says it is, because that
 * is the first thing to check when an outside service has a complaint.
 *
 * Exports `DiscoverService` for Create Post (Module 04).
 */
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { DiscoverCache } from './discover.cache';
import { DiscoverController } from './discover.controller';
import { createDiscoverEngine, DISCOVER_ENGINE } from './discover.engine';
import { DiscoverGate } from './discover.gate';
import { DiscoverService } from './discover.service';
import { LocalityService } from './locality.service';

const MAX_UPSTREAM_FETCHES = 4;
const GATE_WAIT_MS = 4_000;

@Module({
  controllers: [DiscoverController],
  providers: [
    {
      provide: DISCOVER_ENGINE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const engine = createDiscoverEngine({
          DISCOVER_SIMULATION: config.get('DISCOVER_SIMULATION', { infer: true }),
          DISCOVER_GEOCODER: config.get('DISCOVER_GEOCODER', { infer: true }),
          DISCOVER_GEOCODER_USER_AGENT: config.get('DISCOVER_GEOCODER_USER_AGENT', { infer: true }),
        });
        new Logger('Discover').log(
          JSON.stringify({
            event: 'discover.boot',
            simulation: engine.simulation,
            geocoder: engine.geocoder ? 'nominatim' : 'off',
            userAgent: engine.userAgent,
          }),
        );
        return engine;
      },
    },
    {
      provide: DiscoverGate,
      useFactory: () => new DiscoverGate(MAX_UPSTREAM_FETCHES, GATE_WAIT_MS),
    },
    DiscoverCache,
    DiscoverService,
    LocalityService,
  ],
  exports: [DiscoverService],
})
export class DiscoverModule {}
