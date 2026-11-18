/**
 * One clip's routes (Sprint 12, Module 05), in a module of their own so
 * `GET /clips/:clipId` is registered after every other `/clips/<word>` route
 * (see `clip-item.controller.ts`). `ClipsModule` imports this module LAST;
 * nothing else may import it, or it would be scanned, and its routes
 * registered, earlier.
 */
import { Module } from '@nestjs/common';
import { ClipsCoreModule } from '../clips-core.module';
import { ClipEditsService } from './clip-edits.service';
import { ClipExportsService } from './clip-exports.service';
import { ClipItemController } from './clip-item.controller';
import { ClipItemService } from './clip-item.service';
import { ClipsListService } from './clips-list.service';

@Module({
  imports: [ClipsCoreModule],
  controllers: [ClipItemController],
  providers: [ClipItemService, ClipEditsService, ClipsListService, ClipExportsService],
  exports: [ClipItemService],
})
export class ClipItemModule {}
