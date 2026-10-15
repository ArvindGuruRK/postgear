import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { PostsModule } from '../posts/posts.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsRepository } from './analytics.repository';
import { ANALYTICS_CLOCK, AnalyticsService } from './analytics.service';

/**
 * Analytics (Sprint 7, PRD 5.6): what the worker's daily sync wrote, shaped
 * for the page.
 *
 * Depends on channels (which channels exist, their health, and which
 * platforms expose metrics), posts (the preview and state rules a post is
 * shown with) and scheduling (the "sync now" signal and the scheduler's
 * reachability for the status line). It writes nothing: the worker owns the
 * three analytics tables.
 *
 * The clock is a provider so the spec can pin "today" without faking the
 * global `Date`.
 */
@Module({
  imports: [ChannelsModule, PostsModule, SchedulingModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsRepository,
    { provide: ANALYTICS_CLOCK, useValue: () => Date.now() },
  ],
})
export class AnalyticsModule {}
