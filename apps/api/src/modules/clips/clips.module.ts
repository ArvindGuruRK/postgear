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
import { ClipAutoEditController } from './auto-edit/clip-auto-edit.controller';
import { ClipAutoEditRepository } from './auto-edit/clip-auto-edit.repository';
import { ClipAutoEditService } from './auto-edit/clip-auto-edit.service';
import { ClipBrandKitsModule } from './brand-kits/clip-brand-kits.module';
import { ClipCaptionStylesModule } from './captions/clip-caption-styles.module';
import { ClipChannelsModule } from './channels/clip-channels.module';
import { ClipItemModule } from './clip/clip-item.module';
import { ClipsCoreModule } from './clips-core.module';
import { ClipDownloadsController } from './downloads/clip-downloads.controller';
import { ClipDownloadsRepository } from './downloads/clip-downloads.repository';
import { ClipDownloadsService } from './downloads/clip-downloads.service';
import { ClipBatchExportsController } from './exports/clip-batch-exports.controller';
import { ClipBatchExportsService } from './exports/clip-batch-exports.service';
import { ClipFilesController } from './files/clip-files.controller';
import { ClipHighlightsController } from './highlights/clip-highlights.controller';
import { ClipHighlightsService } from './highlights/clip-highlights.service';
import { ClipMomentsService } from './highlights/clip-moments.service';
import { ClipStillsService } from './highlights/clip-stills.service';
import { ClipReconcileService } from './internal/clip-reconcile.service';
import { ClipsInternalController } from './internal/clips-internal.controller';
import { ClipsInternalService } from './internal/clips-internal.service';
import { ClipJobEventsService } from './jobs/clip-job-events.service';
import { ClipJobsController } from './jobs/clip-jobs.controller';
import { ClipLayoutsModule } from './layouts/clip-layouts.module';
import { ClipLibraryModule } from './library/clip-library.module';
import { ClipLinksModule } from './links/clip-links.module';
import { ClipRecipesModule } from './recipes/clip-recipes.module';
import { ClipSweepService } from './retention/clip-sweep.service';
import { ClipsStatusController } from './status/clips-status.controller';
import { ClipsStatusService } from './status/clips-status.service';
import { ClipTranscriptsController } from './transcripts/clip-transcripts.controller';
import { ClipDrive } from './videos/clip-drive';
import { ClipSampleLink } from './videos/clip-sample';
import { ClipUploadsService } from './videos/clip-uploads.service';
import { ClipVideosController } from './videos/clip-videos.controller';
import { ClipVideosService } from './videos/clip-videos.service';
import { ClipWordListModule } from './word-list/clip-word-list.module';

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
    // Sprint 13, Module 09: `/clips/word-list`, a word route, so before `ClipItemModule`.
    ClipWordListModule,
    // Sprint 13, Module 10: `/clips/brand-kits` and `/clips/recipes`, word routes. The recipes
    // module imports `ClipItemModule` itself (its applier makes clips), so it must stay after
    // every other word-route module and right before `ClipItemModule` (see its file comment).
    ClipBrandKitsModule,
    ClipRecipesModule,
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
    // Sprint 13, Module 10: `/clips/videos/:videoId/auto-edit` (and `/price`).
    ClipAutoEditController,
    ClipJobsController,
    ClipFilesController,
    // Module 18: `/clips/downloads`, a word route, so before `ClipItemModule`.
    ClipDownloadsController,
    ClipsInternalController,
    // Sprint 13, Module 11: Export All under `/clips/exports`, a word route, so before `ClipItemModule`.
    ClipBatchExportsController,
  ],
  providers: [
    ClipJobEventsService,
    ClipsStatusService,
    ClipVideosService,
    ClipHighlightsService,
    // Sprint 13, Module 05: reading a transcript for moments (the internal pick route).
    ClipMomentsService,
    ClipStillsService,
    // Sprint 13, Module 10: Auto-Edit Video (its clip is made by `ClipRecipeApplierService`).
    ClipAutoEditService,
    ClipAutoEditRepository,
    ClipUploadsService,
    // Sprint 13, Module 12: Google Drive as a source.
    ClipDrive,
    ClipsInternalService,
    ClipReconcileService,
    // Module 19: the cleanup sweep behind `/internal/clips/sweep`.
    ClipSweepService,
    ClipSampleLink,
    ClipDownloadsRepository,
    ClipDownloadsService,
    // Sprint 13, Module 11: Export All.
    ClipBatchExportsService,
  ],
  // Nothing outside Clips needs its providers; a later module imports `ClipsCoreModule` itself.
})
export class ClipsModule {}
