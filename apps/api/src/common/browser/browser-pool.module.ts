/**
 * The one headless browser this process runs.
 *
 * Two features need Chromium: the SEO crawler (Sprint 7), which loads a page
 * when plain HTML turns out to be a JavaScript shell, and the Design Studio
 * exporter (Sprint 9), which paints a slide and screenshots it at the exact
 * export size. Each starting its own would double the memory of the heaviest
 * thing the API runs, and give two different answers to "is a browser
 * available here", so the pool is a provider and both are handed the same one.
 *
 * ## Lifetime
 *
 * Nothing is launched at boot. `createBrowserPool` launches lazily on the
 * first `acquire()` or `render()` and relaunches after a crash, so an API
 * that never audits a site and never exports a design never starts Chromium.
 * This module closes it on shutdown, because a headless browser left running
 * is a process that never exits; its consumers must not close it, which is
 * why `SeoModule` no longer closes the crawler.
 *
 * ## Configuration
 *
 * The pool's `userAgent` and `guard` only affect the crawl path: the render
 * path builds its own context with every network request blocked. The page
 * limit is shared, which is deliberate, since it is really a limit on how
 * many Chromium tabs this process will hold open at once.
 */
import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type BrowserPool, createBrowserPool } from '@postgear/seo-engine';
import type { Env } from '../../config/env';

export const BROWSER_POOL = Symbol('BROWSER_POOL');

/** Tabs this process will hold open at once, across crawling and exporting. */
export const BROWSER_MAX_PAGES = 2;

@Global()
@Module({
  providers: [
    {
      provide: BROWSER_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): BrowserPool => {
        const logger = new Logger('BrowserPool');

        return createBrowserPool({
          maxPages: BROWSER_MAX_PAGES,
          userAgent: config.get('SEO_USER_AGENT', { infer: true }),
          logger: {
            warn: (message, meta) =>
              logger.warn(meta ? `${message} ${JSON.stringify(meta)}` : message),
          },
        });
      },
    },
  ],
  exports: [BROWSER_POOL],
})
export class BrowserPoolModule implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolModule.name);

  constructor(@Inject(BROWSER_POOL) private readonly pool: BrowserPool) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.pool.close();
    } catch (error) {
      this.logger.warn(
        `Could not close the browser pool: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
