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
 * browser and a test hands it a fake. The module owns the crawler's
 * lifetime: a headless browser left running after shutdown is a process
 * that never exits, so it is closed on destroy.
 */
import { Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { AiModule } from '../ai/ai.module';
import { readSeoConfig, SEO_CONFIG, type SeoConfig } from './seo.config';
import { SeoController } from './seo.controller';
import { SEO_ENGINE, type SeoEngine } from './seo.engine';
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
      inject: [SEO_CONFIG],
      useFactory: (config: SeoConfig) => createSeoEngine(config, new Logger('SeoEngine')),
    },
  ],
})
export class SeoModule implements OnModuleDestroy {
  private readonly logger = new Logger(SeoModule.name);

  constructor(@Inject(SEO_ENGINE) private readonly engine: SeoEngine) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.engine.crawler.close();
    } catch (error) {
      this.logger.warn(
        `Could not close the SEO crawler: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
