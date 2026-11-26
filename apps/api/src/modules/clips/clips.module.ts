/**
 * Clips (Sprint 12): long videos into short clips.
 *
 * The API side never touches a video. It recognises and probes links, makes
 * `ClipJob` rows and starts their workflows, checks every limit through the
 * entitlements resolver and charges meters on the usage ledger, serves the
 * private files by signed link, and reads back what the worker wrote.
 *
 * Imports: `ClipsCoreModule` (the job service, limits, signed addresses and
 * video rows, re-exporting entitlements, scheduling and media),
 * `ClipLinksModule` (the link probe), `ClipChannelsModule`,
 * `NotificationsModule` (the bell for exports and lost jobs),
 * `ClipLayoutsModule` (saved layouts, Module 10), `ClipLibraryModule`
 * (stickers, Module 12) and, LAST, `ClipItemModule`.
 *
 * Route order matters here. Nest registers a module's controllers before
 * those of the modules it imports, and in import order after that. So every
 * `/clips/<word>` route of this module (`status`, `videos`, `jobs`, `files`,
 * `downloads`)
 * and of the channels, links, layouts and library modules is registered before
 * `ClipItemModule`'s `GET /clips/:clipId`, which would otherwise swallow
 * them. `clips-routes.spec.ts` holds this in place.
 */
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClipChannelsModule } from './channels/clip-channels.module';
import { ClipItemModule } from './clip/clip-item.module';
import { ClipsCoreModule } from './clips-core.module';
import { ClipDownloadsController } from './downloads/clip-downloads.controller';
import { ClipDownloadsRepository } from './downloads/clip-downloads.repository';
import { ClipDownloadsService } from './downloads/clip-downloads.service';
import { ClipFilesController } from './files/clip-files.controller';
import { ClipHighlightsController } from './highlights/clip-highlights.controller';
import { ClipHighlightsService } from './highlights/clip-highlights.service';
import { ClipReconcileService } from './internal/clip-reconcile.service';
import { ClipSweepService } from './retention/clip-sweep.service';
import { ClipMomentsService } from './highlights/clip-moments.service';
import { ClipStillsService } from './highlights/clip-stills.service';
import { ClipsInternalController } from './internal/clips-internal.controller';
import { ClipsInternalService } from './internal/clips-internal.service';
import { ClipJobEventsService } from './jobs/clip-job-events.service';
import { ClipJobsController } from './jobs/clip-jobs.controller';
import { ClipCaptionStylesModule } from './captions/clip-caption-styles.module';
import { ClipLayoutsModule } from './layouts/clip-layouts.module';
import { ClipLibraryModule } from './library/clip-library.module';
import { ClipLinksModule } from './links/clip-links.module';
import { ClipsStatusController } from './status/clips-status.controller';
import { ClipsStatusService } from './status/clips-status.service';
import { ClipTranscriptsController } from './transcripts/clip-transcripts.controller';
import { ClipSampleLink } from './videos/clip-sample';
import { ClipUploadsService } from './videos/clip-uploads.service';
import { ClipVideosController } from './videos/clip-videos.controller';
import { ClipVideosService } from './videos/clip-videos.service';

@Module({
  imports: [
    ClipsCoreModule,
    // Sprint 13, Module 05: the moment picker's model client.
    AiModule,
    ClipLinksModule,
    ClipChannelsModule,
    NotificationsModule,
    // Module 10: `/clips/layouts`, a word route, so before `ClipItemModule`.
    ClipLayoutsModule,
    // Module 12: `/clips/library` and `/clips/stickers`, word routes, so before `ClipItemModule`.
    ClipLibraryModule,
    // Sprint 13: `/clips/caption-styles`, a word route, so before `ClipItemModule`.
    ClipCaptionStylesModule,
    // Keep LAST: its `GET /clips/:clipId` must be registered after every other `/clips/<word>` route.
    ClipItemModule,
  ],
  controllers: [
    ClipsStatusController,
    ClipVideosController,
    // Module 16: `/clips/videos/:videoId/highlights`.
    ClipHighlightsController,
    // Sprint 13, Module 02: `/clips/videos/:videoId/transcript`.
    ClipTranscriptsController,
    ClipJobsController,
    ClipFilesController,
    // Module 18: `/clips/downloads`, a word route, so before `ClipItemModule`.
    ClipDownloadsController,
    ClipsInternalController,
  ],
  providers: [
    ClipJobEventsService,
    ClipsStatusService,
    ClipVideosService,
    ClipHighlightsService,
    // Sprint 13, Module 05: reading a transcript for moments (the internal pick route).
    ClipMomentsService,
    ClipStillsService,
    ClipUploadsService,
    ClipsInternalService,
    ClipReconcileService,
    // Module 19: the cleanup sweep behind `/internal/clips/sweep`.
    ClipSweepService,
    ClipSampleLink,
    ClipDownloadsRepository,
    ClipDownloadsService,
  ],
  // Nothing outside Clips needs its providers; a later module imports `ClipsCoreModule` itself.
})
export class ClipsModule {}
