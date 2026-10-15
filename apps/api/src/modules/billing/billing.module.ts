import { Module } from '@nestjs/common';

/**
 * Billing (Sprint 8, PRD 5.8): plans, the trial, Stripe checkout and portal,
 * the signature-verified idempotent webhook, and the entitlement every other
 * module gates on.
 *
 * Skeleton registered by the coordinator; the billing workstream fills it in
 * against docs/sprint-documents/sprint-08-contract.md §3 and §5.1.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class BillingModule {}
