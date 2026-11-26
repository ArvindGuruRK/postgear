/**
 * The workspace's own bleep words (Sprint 13, Module 09), in a module of
 * their own so `ClipsModule` can import it BEFORE `ClipItemModule`: the
 * `/clips/word-list` routes must be registered before `GET /clips/:clipId`
 * (see `clip/clip-item.controller.ts` and `clips-routes.spec.ts`). It needs
 * Prisma, and the shared Clips core for the plan guard's resolver (the core
 * has no controllers, so route order is unchanged).
 */
import { Module } from '@nestjs/common';
import { ClipsCoreModule } from '../clips-core.module';
import { ClipWordListController } from './clip-word-list.controller';
import { ClipWordListRepository } from './clip-word-list.repository';
import { ClipWordListService } from './clip-word-list.service';

@Module({
  imports: [ClipsCoreModule],
  controllers: [ClipWordListController],
  providers: [ClipWordListRepository, ClipWordListService],
})
export class ClipWordListModule {}
