/**
 * What every Clips route shares (Sprint 12, Module 04): the job service and
 * its repository, the limits adapter, the signed addresses and the video
 * rows. It has no controllers of its own, so importing it never changes the
 * order routes are registered in, and both `ClipsModule` and
 * `ClipItemModule` can use the same providers without importing each other.
 *
 * Re-exports the entitlements, scheduling and media modules, so an importer
 * gets the resolver, the usage ledger, Temporal and both storage spaces.
 */
import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { MediaModule } from '../media/media.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { ClipJobsRepository } from './jobs/clip-jobs.repository';
import { ClipJobsService } from './jobs/clip-jobs.service';
import { ClipLimitsGuard } from './limits/clip-limits.guard';
import { ClipPlaybackService } from './videos/clip-playback.service';
import { ClipVideosRepository } from './videos/clip-videos.repository';

@Module({
  imports: [EntitlementsModule, SchedulingModule, MediaModule],
  providers: [
    ClipJobsRepository,
    ClipJobsService,
    ClipLimitsGuard,
    ClipPlaybackService,
    ClipVideosRepository,
  ],
  exports: [
    EntitlementsModule,
    SchedulingModule,
    MediaModule,
    ClipJobsRepository,
    ClipJobsService,
    ClipLimitsGuard,
    ClipPlaybackService,
    ClipVideosRepository,
  ],
})
export class ClipsCoreModule {}
