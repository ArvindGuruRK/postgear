/**
 * One clip's routes (Sprint 12, Module 05), in a module of their own so
 * `GET /clips/:clipId` is registered after every other `/clips/<word>` route
 * (see `clip-item.controller.ts`). `ClipsModule` imports this module LAST;
 * nothing else may import it, or it would be scanned, and its routes
 * registered, earlier.
 */
import { Module } from '@nestjs/common';
import { ChannelsModule } from '../../channels/channels.module';
import { PostsModule } from '../../posts/posts.module';
import { AiModule } from '../../ai/ai.module';
import { ClipCaptionStylesModule } from '../captions/clip-caption-styles.module';
import { ClipCaptionsController } from '../captions/clip-captions.controller';
import { ClipCaptionsService } from '../captions/clip-captions.service';
import { ClipFacesController } from '../faces/clip-faces.controller';
import { ClipFacesService } from '../faces/clip-faces.service';
import { ClipsCoreModule } from '../clips-core.module';
import { ClipEditsService } from './clip-edits.service';
import { ClipExportsService } from './clip-exports.service';
import { ClipItemController } from './clip-item.controller';
import { ClipItemService } from './clip-item.service';
import { ClipPostsModule } from './clip-posts.module';
import { ClipSendService } from './clip-send.service';
import { ClipsListService } from './clips-list.service';

@Module({
  // Module 17: Send To Composer drafts through the posts module, checks the
  // channels through the channels module, and reads the clip posts.
  // Sprint 13: a clip's captions read the caption styles and translate through the AI engine.
  imports: [
    ClipsCoreModule,
    ChannelsModule,
    PostsModule,
    ClipPostsModule,
    ClipCaptionStylesModule,
    AiModule,
  ],
  // `ClipCaptionsController` and `ClipFacesController` first: their routes are all deeper than `/clips/:clipId`.
  controllers: [ClipCaptionsController, ClipFacesController, ClipItemController],
  providers: [
    ClipItemService,
    ClipEditsService,
    ClipsListService,
    ClipExportsService,
    ClipSendService,
    ClipCaptionsService,
    ClipFacesService,
  ],
  exports: [ClipItemService],
})
export class ClipItemModule {}
