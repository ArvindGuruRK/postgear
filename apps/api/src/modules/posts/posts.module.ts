import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { MediaModule } from '../media/media.module';
import { PostsController } from './posts.controller';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';

/**
 * Posts — the composer's drafts and queue.
 *
 * Depends on channels (what may be targeted, and its health) and media (what an
 * attachment id resolves to), both through their services. It never reads
 * `Integration` or `Media` rows directly, so each of those modules stays the
 * single owner of its own table.
 */
@Module({
  imports: [ChannelsModule, MediaModule],
  controllers: [PostsController],
  providers: [PostsService, PostsRepository],
})
export class PostsModule {}
