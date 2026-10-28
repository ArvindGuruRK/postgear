import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { MediaModule } from '../media/media.module';
import { PostsModule } from '../posts/posts.module';
import { StudioModule } from '../studio/studio.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Workspace search (2026-10-21): the top bar's search box.
 *
 * Reads only through the owning modules' services, like the posts module
 * does, so each table keeps a single owner. `ChannelsModule`, `MediaModule`,
 * `PostsModule` and `StudioModule` (designs, Sprint 9b) export what is needed.
 */
@Module({
  imports: [ChannelsModule, MediaModule, PostsModule, StudioModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
