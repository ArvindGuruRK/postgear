/**
 * Caption styles (Sprint 13, Module 03), in a module of their own:
 * `/clips/caption-styles` is a word route, registered before
 * `ClipItemModule`, which also reads the styles (it imports this module).
 */
import { Module } from '@nestjs/common';
import { ClipsCoreModule } from '../clips-core.module';
import { ClipCaptionStylesController } from './clip-caption-styles.controller';
import { ClipCaptionStylesRepository } from './clip-caption-styles.repository';
import { ClipCaptionStylesService } from './clip-caption-styles.service';

@Module({
  imports: [ClipsCoreModule],
  controllers: [ClipCaptionStylesController],
  providers: [ClipCaptionStylesRepository, ClipCaptionStylesService],
  exports: [ClipCaptionStylesService],
})
export class ClipCaptionStylesModule {}
