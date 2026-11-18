/**
 * Links (Module 03): recognise, probe through the worker, and the thumbnail
 * route. Exports `CLIP_LINK_PROBER` for the video import, which probes again
 * on the server and never trusts a probe answer sent by the browser, and the
 * platform breaker, which the channel lists' flat fallback shares.
 *
 * Redis and config are global; scheduling (the worker's probe) and
 * entitlements (the plan's gate and longest video) are imported.
 */
import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../../entitlements/entitlements.module';
import { SchedulingModule } from '../../scheduling/scheduling.module';
import { ClipLinksController } from './clip-links.controller';
import { ClipLinksRepository } from './clip-links.repository';
import { ClipLinksService } from './clip-links.service';
import { CLIP_LINK_PROBER } from './clip-links.types';
import { ClipThumbnailsService } from './clip-thumbnails.service';
import { ClipPlatformBreaker } from './platform-breaker';

@Module({
  imports: [SchedulingModule, EntitlementsModule],
  controllers: [ClipLinksController],
  providers: [
    ClipLinksRepository,
    ClipLinksService,
    ClipThumbnailsService,
    ClipPlatformBreaker,
    { provide: CLIP_LINK_PROBER, useExisting: ClipLinksService },
  ],
  exports: [ClipLinksService, CLIP_LINK_PROBER, ClipPlatformBreaker],
})
export class ClipLinksModule {}
