/**
 * Outbound-webhook shapes shared between server components and client islands
 * (Sprint 8). Mirror `/webhooks*` — see
 * docs/sprint-documents/sprint-08-contract.md §5.4.
 */

export type WebhookEvent = 'post.published' | 'post.failed';

export const WEBHOOK_EVENTS: readonly WebhookEvent[] = ['post.published', 'post.failed'];

export type WebhookDeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

export interface WebhookView {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  /** Empty means every channel. */
  channelIds: string[];
  disabled: boolean;
  createdAt: string;
  lastDelivery: { status: WebhookDeliveryStatus; at: string; statusCode: number | null } | null;
}

export interface WebhookCreated {
  webhook: WebhookView;
  /** Shown once; the API never returns it again. */
  secret: string;
}

export interface DeliveryView {
  id: string;
  event: WebhookEvent | 'webhook.test';
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}
