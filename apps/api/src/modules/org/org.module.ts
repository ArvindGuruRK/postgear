import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { InviteTokenService } from './invite-token.service';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';

/**
 * `BillingModule` (Sprint 8) is imported for `EntitlementsService`, which
 * starts the no-card trial when a workspace is created. Billing never
 * imports this module back.
 *
 * `AuthModule` (2026-10-19) is imported for the `JwtService` it re-exports:
 * the public invitation preview reads an optional session itself, since the
 * global guard skips `@Public()` routes. Auth never imports this module.
 */
@Module({
  imports: [BillingModule, AuthModule],
  controllers: [OrgController],
  providers: [OrgService, InviteTokenService],
  exports: [OrgService],
})
export class OrgModule {}
