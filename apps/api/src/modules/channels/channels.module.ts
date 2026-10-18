import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { ChannelOAuthService } from './channel-oauth.service';
import { ChannelsController } from './channels.controller';
import { ChannelsRepository } from './channels.repository';
import { ChannelsService } from './channels.service';

/**
 * Connected social channels.
 *
 * `RedisService` is not imported here: `RedisModule` is `@Global()`, so
 * `ChannelOAuthService` gets it by injection alone.
 *
 * The repository is a provider rather than a static import so it can be
 * substituted in tests, which matters more here than elsewhere: it is the file
 * that decides whether credentials reach the database encrypted.
 *
 * `BillingModule` (Sprint 8) supplies `EntitlementsService`, which decides
 * how many channels the plan allows. The dependency runs one way only:
 * billing never imports channels.
 */
@Module({
  imports: [SchedulingModule, BillingModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, ChannelsRepository, ChannelOAuthService],
  exports: [ChannelsService, ChannelsRepository],
})
export class ChannelsModule {}
