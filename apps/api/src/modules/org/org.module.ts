import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';

/**
 * `BillingModule` (Sprint 8) is imported for `EntitlementsService`, which
 * starts the no-card trial when a workspace is created. Billing never
 * imports this module back.
 */
@Module({
  imports: [BillingModule],
  controllers: [OrgController],
  providers: [OrgService],
  exports: [OrgService],
})
export class OrgModule {}
