/**
 * The Design Studio (Sprint 9).
 *
 * Three modules are imported rather than reimplemented, and each for one
 * reason:
 *
 * - **`MediaModule`** owns the library. An exported slide and an uploaded
 *   logo are ordinary Media rows, written through `saveGenerated` so they go
 *   through the same sniff, the same metadata strip and the same storage keys
 *   as an upload. Studio has no storage of its own.
 * - **`PostsModule`** owns posting. Send To Composer creates an ordinary
 *   `DRAFT` post, the same door the AI copilot uses, so platform rules and
 *   scheduling stay in one place. Studio makes pictures; it does not schedule.
 * - **`ChannelsModule`** answers which channels are still connected, so a
 *   Send aimed at one that was disconnected meanwhile is refused with a
 *   sentence before anything is rendered.
 *
 * - **`BillingModule`** (Sprint 9b) answers whether the workspace is on a
 *   paid plan, which is what opens the premium looks. It imports no feature
 *   module, so importing it here makes no cycle.
 *
 * The headless browser comes from the process-wide `BrowserPoolModule`, which
 * is global, shared with the SEO crawler, and owns closing it. Redis (the
 * extraction limit) comes from the global `RedisModule`.
 *
 * `StudioService` is exported for the top bar's search, which asks it for
 * designs the way it asks the posts and media modules for theirs.
 */
import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ChannelsModule } from '../channels/channels.module';
import { MediaModule } from '../media/media.module';
import { PostsModule } from '../posts/posts.module';
import { BrandKitsService } from './brand-kits.service';
import { DesignSharesController } from './design-shares.controller';
import { StudioController } from './studio.controller';
import { StudioRepository } from './studio.repository';
import { StudioService } from './studio.service';
import { StudioFontsController } from './studio-fonts.controller';

@Module({
  imports: [BillingModule, ChannelsModule, MediaModule, PostsModule],
  controllers: [StudioController, DesignSharesController, StudioFontsController],
  providers: [StudioService, BrandKitsService, StudioRepository],
  exports: [StudioService],
})
export class StudioModule {}
