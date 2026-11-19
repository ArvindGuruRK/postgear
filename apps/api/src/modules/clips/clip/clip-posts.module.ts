/**
 * `ClipPostsService` on its own (Sprint 12, Module 17), so `PostsModule` can
 * keep a clip's `ClipPost` rows in step with every post save. It imports
 * nothing, so neither side makes a cycle: `PostsModule` imports this, and the
 * clip routes import both.
 */
import { Module } from '@nestjs/common';
import { ClipPostsService } from './clip-posts.service';

@Module({
  providers: [ClipPostsService],
  exports: [ClipPostsService],
})
export class ClipPostsModule {}
