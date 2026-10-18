import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksRepository } from './webhooks.repository';
import { WebhooksService } from './webhooks.service';

/**
 * Outbound webhooks (Sprint 8, PRD 5.10): the hooks a workspace configures,
 * their secrets, test sends and delivery history.
 *
 * Delivery itself runs in the worker
 * (`apps/worker/src/workflows/webhook-delivery.workflow.ts`); this module
 * only writes rows and, for a test send, asks the scheduler to start the
 * workflow: the same relationship the posts module has with publishing.
 */
@Module({
  imports: [SchedulingModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhooksRepository],
})
export class WebhooksModule {}
