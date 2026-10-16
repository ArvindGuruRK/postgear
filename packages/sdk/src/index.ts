/**
 * `@postgear/sdk` — the Node.js client for PostGear's public API and the
 * verifier for its webhook deliveries (Sprint 8, PRD 5.10).
 *
 *   import { PostGear } from '@postgear/sdk';
 *   const postgear = new PostGear({ apiKey: process.env.POSTGEAR_API_KEY!, baseUrl: 'https://api.example.com' });
 *   const { workspace } = await postgear.me();
 *   const channels = await postgear.channels.list();
 *   const post = await postgear.posts.create({ text: 'Hello from the SDK', channelIds: [channels[0].id] });
 *
 * See README.md for the webhook receiver example.
 */
export { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, PostGear, type PostGearOptions } from './client';
export { PostGearError, PostGearNetworkError } from './errors';
export type * from './types';
export {
  constructWebhookEvent,
  DEFAULT_TOLERANCE_SECONDS,
  signWebhookPayload,
  verifyWebhookSignature,
  type VerifyWebhookInput,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type WebhookVerification,
} from './webhooks';
