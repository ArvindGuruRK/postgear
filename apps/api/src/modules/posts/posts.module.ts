import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { MediaModule } from '../media/media.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { PostsController } from './posts.controller';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';

/**
 * Posts — the composer's drafts and queue.
 *
 * Depends on channels (what may be targeted, and its health) and media (what an
 * attachment id resolves to), both through their services. It never reads
 * `Integration` or `Media` rows directly, so each of those modules stays the
 * single owner of its own table. Scheduling (Sprint 5) is how a queued row
 * reaches the worker: every save, reschedule, "post now" and delete tells it.
 *
 * `PostsService` is exported for the AI module (Sprint 6), whose copilot
 * drafts posts through it rather than writing rows — so a draft the
 * assistant makes is held to exactly the checks a person's is.
 */
@Module({
  imports: [ChannelsModule, MediaModule, SchedulingModule],
  controllers: [PostsController],
  providers: [PostsService, PostsRepository],
  exports: [PostsService],
})
export class PostsModule {}
