/**
 * Starts the delivery workflow for freshly enqueued rows (Sprint 8).
 *
 * Best-effort, like every workflow start the API makes: the rows are already
 * written, and the maintenance reconcile starts any delivery that is still
 * PENDING a minute from now. A Temporal blip here costs a delivery at most a
 * minute, never the delivery itself.
 */
import {
  SCHEDULING_TASK_QUEUE,
  WEBHOOK_DELIVERY_WORKFLOW,
  webhookDeliveryWorkflowId,
} from '@postgear/scheduling';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

export async function startWebhookDeliveries(
  temporalClient: () => Promise<Client>,
  organizationId: string,
  deliveryIds: string[],
  log: (message: string, meta: Record<string, unknown>) => void,
): Promise<void> {
  if (deliveryIds.length === 0) {
    return;
  }

  let client: Client;
  try {
    client = await temporalClient();
  } catch (error) {
    log('webhook deliveries queued but the scheduler was unreachable; the reconcile will start them', {
      organizationId,
      deliveries: deliveryIds.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  await Promise.all(
    deliveryIds.map(async (deliveryId) => {
      try {
        await client.workflow.start(WEBHOOK_DELIVERY_WORKFLOW, {
          workflowId: webhookDeliveryWorkflowId(deliveryId),
          taskQueue: SCHEDULING_TASK_QUEUE,
          args: [{ deliveryId, organizationId }],
        });
      } catch (error) {
        if (error instanceof WorkflowExecutionAlreadyStartedError) {
          return;
        }
        log('could not start a webhook delivery; the reconcile will retry it', {
          organizationId,
          deliveryId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}
