import { Module } from '@nestjs/common';
import { TagsController } from './tags.controller';
import { TagsRepository } from './tags.repository';
import { TagsService } from './tags.service';

/**
 * Post tags (2026-10-19): the workspace's labels and their CRUD.
 *
 * `TagsService` is exported for the posts module, which checks a save's tag
 * ids through it; the link rows (`TagsPosts`) belong to a post and are
 * written by the posts repository alongside the post itself.
 */
@Module({
  controllers: [TagsController],
  providers: [TagsService, TagsRepository],
  exports: [TagsService],
})
export class TagsModule {}
