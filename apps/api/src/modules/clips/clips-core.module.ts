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
import { NotificationsModule } from '../notifications/notifications.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { ClipBatchNoticeService } from './exports/clip-batch-notice.service';
import { ClipJobsRepository } from './jobs/clip-jobs.repository';
import { ClipJobsService } from './jobs/clip-jobs.service';
import { ClipQueueService } from './jobs/clip-queue.service';
import { ClipSchedulerService } from './jobs/clip-scheduler.service';
import { ClipLimitsGuard } from './limits/clip-limits.guard';
import { ClipRetentionService } from './retention/clip-retention.service';
import { MediaServiceProbe } from './status/media-service.probe';
import { MediaVoices } from './status/media-voices.client';
import { ClipTranscriptStore } from './transcripts/clip-transcript-store';
import { ClipTranscriptsService } from './transcripts/clip-transcripts.service';
import { ClipPlaybackService } from './videos/clip-playback.service';
import { ClipVideosRepository } from './videos/clip-videos.repository';

@Module({
  // Sprint 13, Module 11: `NotificationsModule` for Export All's one notice (no imports of its own).
  imports: [EntitlementsModule, SchedulingModule, MediaModule, NotificationsModule],
  providers: [
    ClipJobsRepository,
    ClipJobsService,
    // Sprint 13, Module 15: the one scheduler and the waiting estimate.
    ClipSchedulerService,
    ClipQueueService,
    ClipLimitsGuard,
    ClipPlaybackService,
    ClipVideosRepository,
    // Module 19: touchVideo and removeVideo, shared by videos, clips, the sweep and the operator.
    ClipRetentionService,
    // Sprint 13: listening and the words, shared by the transcript routes and a clip's captions.
    MediaServiceProbe,
    MediaVoices,
    ClipTranscriptStore,
    ClipTranscriptsService,
    // Sprint 13, Module 11: the batch notice, written when a batch's last export ends.
    ClipBatchNoticeService,
  ],
  exports: [
    EntitlementsModule,
    SchedulingModule,
    MediaModule,
    ClipJobsRepository,
    ClipJobsService,
    ClipSchedulerService,
    ClipQueueService,
    ClipLimitsGuard,
    ClipPlaybackService,
    ClipVideosRepository,
    ClipRetentionService,
    MediaServiceProbe,
    MediaVoices,
    ClipTranscriptStore,
    ClipTranscriptsService,
    ClipBatchNoticeService,
  ],
})
export class ClipsCoreModule {}
