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
 * `ClipLayoutsModule` (saved layouts, Module 10) and, LAST, `ClipItemModule`.
 *
 * Route order matters here. Nest registers a module's controllers before
 * those of the modules it imports, and in import order after that. So every
 * `/clips/<word>` route of this module (`status`, `videos`, `jobs`, `files`)
 * and of the channels, links and layouts modules is registered before
 * `ClipItemModule`'s `GET /clips/:clipId`, which would otherwise swallow
 * them. `clips-routes.spec.ts` holds this in place.
 */
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClipChannelsModule } from './channels/clip-channels.module';
import { ClipItemModule } from './clip/clip-item.module';
import { ClipsCoreModule } from './clips-core.module';
import { ClipFilesController } from './files/clip-files.controller';
import { ClipReconcileService } from './internal/clip-reconcile.service';
import { ClipsInternalController } from './internal/clips-internal.controller';
import { ClipsInternalService } from './internal/clips-internal.service';
import { ClipJobEventsService } from './jobs/clip-job-events.service';
import { ClipJobsController } from './jobs/clip-jobs.controller';
import { ClipLayoutsModule } from './layouts/clip-layouts.module';
import { ClipLinksModule } from './links/clip-links.module';
import { ClipsStatusController } from './status/clips-status.controller';
import { ClipsStatusService } from './status/clips-status.service';
import { ClipSampleLink } from './videos/clip-sample';
import { ClipUploadsService } from './videos/clip-uploads.service';
import { ClipVideosController } from './videos/clip-videos.controller';
import { ClipVideosService } from './videos/clip-videos.service';

@Module({
  imports: [
    ClipsCoreModule,
    ClipLinksModule,
    ClipChannelsModule,
    NotificationsModule,
    // Module 10: `/clips/layouts`, a word route, so before `ClipItemModule`.
    ClipLayoutsModule,
    // Keep LAST: its `GET /clips/:clipId` must be registered after every other `/clips/<word>` route.
    ClipItemModule,
  ],
  controllers: [
    ClipsStatusController,
    ClipVideosController,
    ClipJobsController,
    ClipFilesController,
    ClipsInternalController,
  ],
  providers: [
    ClipJobEventsService,
    ClipsStatusService,
    ClipVideosService,
    ClipUploadsService,
    ClipsInternalService,
    ClipReconcileService,
    ClipSampleLink,
  ],
  // Nothing outside Clips needs its providers; a later module imports `ClipsCoreModule` itself.
})
export class ClipsModule {}
