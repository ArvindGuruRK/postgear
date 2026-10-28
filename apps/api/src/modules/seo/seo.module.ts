/**
 * The SEO analyzer (Sprint 7).
 *
 * Depends on the AI module for two things it must not duplicate: the
 * credit ledger (advice is charged through the same `CreditsService`, so
 * one meter counts everything) and the engine behind `AI_ENGINE` (one
 * model client per process, not one per feature). `AiModule` exports both.
 *
 * The engine is a provider behind a token, built once from the environment
 * by `seo.engine.factory.ts`, so the service never knows whether it has a
 * browser and a test hands it a fake.
 *
 * The headless browser is **not** this module's any more (Sprint 9): it is
 * the process-wide pool in `common/browser/browser-pool.module.ts`, shared
 * with the Design Studio exporter, which also owns closing it. Two Chromiums
 * for two features would double the heaviest thing the API runs and give two
 * answers to "is a browser available".
 */
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BrowserPool } from '@postgear/seo-engine';
import { BROWSER_POOL } from '../../common/browser/browser-pool.module';
import type { Env } from '../../config/env';
import { AiModule } from '../ai/ai.module';
import { readSeoConfig, SEO_CONFIG, type SeoConfig } from './seo.config';
import { SeoController } from './seo.controller';
import { SEO_ENGINE } from './seo.engine';
import { createSeoEngine } from './seo.engine.factory';
import { SeoGate } from './seo.gate';
import { SeoRepository } from './seo.repository';
import { SeoService } from './seo.service';

@Module({
  imports: [AiModule],
  controllers: [SeoController],
  providers: [
    SeoService,
    SeoRepository,
    {
      provide: SEO_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => readSeoConfig(config),
    },
    {
      provide: SeoGate,
      inject: [SEO_CONFIG],
      useFactory: (config: SeoConfig) => new SeoGate(config.maxConcurrent),
    },
    {
      provide: SEO_ENGINE,
      inject: [SEO_CONFIG, BROWSER_POOL],
      useFactory: (config: SeoConfig, pool: BrowserPool) =>
        createSeoEngine(config, new Logger('SeoEngine'), pool),
    },
  ],
})
export class SeoModule {}
