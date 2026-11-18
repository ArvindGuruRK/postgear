/**
 * Plans as data (Sprint 12): the resolver every limit is read through, the
 * usage ledger every meter is charged on, and `GET /entitlements/me`.
 *
 * Imports `BillingModule` only for what the tier is read from; billing never
 * imports this module (the Stripe webhook writes the org stamp through
 * `RedisService` directly), so there is no cycle. Redis comes from the
 * global `RedisModule`. The existing `EntitlementsService` in billing keeps
 * its name; these classes are named apart from it on purpose.
 */
import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { EntitlementResolver } from './entitlement-resolver';
import { EntitlementsController } from './entitlements.controller';
import { EntitlementsRepository } from './entitlements.repository';
import { UsageService } from './usage.service';

@Module({
  imports: [BillingModule],
  controllers: [EntitlementsController],
  providers: [EntitlementsRepository, EntitlementResolver, UsageService],
  exports: [EntitlementResolver, UsageService],
})
export class EntitlementsModule {}
