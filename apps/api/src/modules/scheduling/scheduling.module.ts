import { Module } from '@nestjs/common';
import { SchedulingController } from './scheduling.controller';
import { connectTemporal, SchedulingService, TEMPORAL_CONNECT } from './scheduling.service';

/**
 * The Temporal client, for the modules that queue or cancel publishes.
 *
 * Deliberately depends on nothing but config, so both `PostsModule` and
 * `ChannelsModule` can import it without a cycle. The worker is a separate
 * process (`apps/worker`); this module only talks to the Temporal server.
 */
@Module({
  controllers: [SchedulingController],
  providers: [SchedulingService, { provide: TEMPORAL_CONNECT, useValue: connectTemporal }],
  exports: [SchedulingService],
})
export class SchedulingModule {}
