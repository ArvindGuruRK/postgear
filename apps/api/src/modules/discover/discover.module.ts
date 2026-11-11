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
 * The reader (Module 08) has no table at all: a page someone reads is kept in
 * Redis for a day and is never written to Postgres.
 *
 * The engine sits behind a token, built once from the environment, so a service
 * never knows whether it is reading recorded feeds and a test hands it a fake. The
 * boot log says which world this process is in and who it says it is, because that
 * is the first thing to check when an outside service has a complaint. It also says
 * whether videos are set up, and never the key that sets them up.
 *
 * Exports `DiscoverService` for Create Post (Module 04).
 */
import {
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
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
import { ReaderController } from './reader.controller';
import { createReaderEngine, READER_ENGINE, READER_GATE } from './reader.engine';
import {
  ARTICLE_EXTRACTOR,
  type ArticleExtractor,
  WorkerArticleExtractor,
} from './reader.extractor';
import { ReaderService } from './reader.service';
import { DiscoverSettingsRepository } from './settings.repository';
import { DiscoverSettingsService } from './settings.service';

const MAX_UPSTREAM_FETCHES = 4;
const MAX_COMPETITOR_FETCHES = 4;
const MAX_READER_FETCHES = 4;
const GATE_WAIT_MS = 4_000;

@Module({
  controllers: [DiscoverController, CompetitorsController, ReaderController],
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
      // The reader's own slots: a page someone named never makes a feed or a competitor wait.
      provide: READER_GATE,
      useFactory: () => new DiscoverGate(MAX_READER_FETCHES, GATE_WAIT_MS),
    },
    {
      // Finding the article in a page happens in a worker thread that is killed
      // when a page takes too long. Never on the thread that answers requests.
      provide: ARTICLE_EXTRACTOR,
      useFactory: () => new WorkerArticleExtractor(),
    },
    {
      // Module 08: what the reader reads with. Addresses a person pressed Read on
      // or pasted, so the same guard as the competitors.
      provide: READER_ENGINE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createReaderEngine({
          DISCOVER_SIMULATION: config.get('DISCOVER_SIMULATION', { infer: true }),
          DISCOVER_GEOCODER_USER_AGENT: config.get('DISCOVER_GEOCODER_USER_AGENT', { infer: true }),
          DISCOVER_LINK_DECODE: config.get('DISCOVER_LINK_DECODE', { infer: true }),
        }),
    },
    ReaderService,
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
export class DiscoverModule implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(@Inject(ARTICLE_EXTRACTOR) private readonly extractor: ArticleExtractor) {}

  /** Started once the app is up, so the first Read does not wait for it. */
  onApplicationBootstrap(): void {
    if (this.extractor instanceof WorkerArticleExtractor) this.extractor.warm();
  }

  /** The article worker is a thread of ours: it stops when the module does. */
  async onModuleDestroy(): Promise<void> {
    if (this.extractor instanceof WorkerArticleExtractor) await this.extractor.close();
  }
}
