/**
 * The brand kit for clips (Sprint 13, Module 10), in a module of its own:
 * `/clips/brand-kits` is a word route, so `ClipsModule` imports this module
 * before `ClipItemModule` (see `clips.module.ts`). It reads Studio's rows
 * itself (no Studio import: Studio brings the browser pool and the
 * extractor); the shared core gives the media library, the private space,
 * the signer and the storage check. Exported for the recipes module.
 */
import { Module } from '@nestjs/common';
import { ClipsCoreModule } from '../clips-core.module';
import { ClipBrandKitsController } from './clip-brand-kits.controller';
import { ClipBrandKitsRepository } from './clip-brand-kits.repository';
import { ClipBrandKitsService } from './clip-brand-kits.service';

@Module({
  imports: [ClipsCoreModule],
  controllers: [ClipBrandKitsController],
  providers: [ClipBrandKitsRepository, ClipBrandKitsService],
  exports: [ClipBrandKitsService],
})
export class ClipBrandKitsModule {}
