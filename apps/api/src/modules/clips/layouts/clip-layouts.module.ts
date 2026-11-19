/**
 * Saved layouts (Sprint 12, Module 10), in a module of their own so
 * `ClipsModule` can import it BEFORE `ClipItemModule`: its `/clips/layouts`
 * routes must be registered before `GET /clips/:clipId` (see
 * `clip/clip-item.controller.ts` and `clips-routes.spec.ts`). It needs
 * Prisma, and (Module 19) the shared Clips core for the plan guard's
 * resolver (the core has no controllers, so route order is unchanged).
 */
import { Module } from '@nestjs/common';
import { ClipsCoreModule } from '../clips-core.module';
import { ClipLayoutsController } from './clip-layouts.controller';
import { ClipLayoutsRepository } from './clip-layouts.repository';
import { ClipLayoutsService } from './clip-layouts.service';

@Module({
  imports: [ClipsCoreModule],
  controllers: [ClipLayoutsController],
  providers: [ClipLayoutsRepository, ClipLayoutsService],
})
export class ClipLayoutsModule {}
