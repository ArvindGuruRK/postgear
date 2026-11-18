/**
 * Saved layouts (Sprint 12, Module 10), in a module of their own so
 * `ClipsModule` can import it BEFORE `ClipItemModule`: its `/clips/layouts`
 * routes must be registered before `GET /clips/:clipId` (see
 * `clip/clip-item.controller.ts` and `clips-routes.spec.ts`). It needs only
 * Prisma, so it imports nothing.
 */
import { Module } from '@nestjs/common';
import { ClipLayoutsController } from './clip-layouts.controller';
import { ClipLayoutsRepository } from './clip-layouts.repository';
import { ClipLayoutsService } from './clip-layouts.service';

@Module({
  controllers: [ClipLayoutsController],
  providers: [ClipLayoutsRepository, ClipLayoutsService],
})
export class ClipLayoutsModule {}
