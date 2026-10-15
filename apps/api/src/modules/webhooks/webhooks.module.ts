import { Module } from '@nestjs/common';

/**
 * Outbound webhooks (Sprint 8, PRD 5.10): the hooks a workspace configures,
 * their secrets, test sends and delivery history. Delivery itself runs in
 * the worker (`apps/worker/src/workflows/webhook-delivery.workflow.ts`).
 *
 * Skeleton registered by the coordinator; filled in against
 * docs/sprint-documents/sprint-08-contract.md §5.4 after the parallel build.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class WebhooksModule {}
