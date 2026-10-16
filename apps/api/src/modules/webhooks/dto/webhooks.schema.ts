/**
 * Request schemas for outbound webhooks (Sprint 8).
 *
 * `.strict()` like every schema in this API. The URL is bounded and cleaned
 * here but *not* judged: whether it is a safe address is the SSRF guard's
 * call (`webhook-url.ts`), which answers 422 with a reason a person can act
 * on, where a schema failure would say only "Invalid input".
 */
import { WEBHOOK_EVENTS } from '@postgear/scheduling';
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';

export const MAX_WEBHOOK_URL_LENGTH = 2_048;
export const MAX_WEBHOOKS_PER_WORKSPACE = 20;
export const MAX_WEBHOOK_CHANNELS = 50;

const nameText = z
  .string()
  .max(60)
  .transform((text) => stripControlChars(text).trim())
  .pipe(z.string().min(1).max(60));

const urlText = z
  .string()
  .max(MAX_WEBHOOK_URL_LENGTH)
  .transform((text) => stripControlChars(text).trim())
  .pipe(z.string().min(1).max(MAX_WEBHOOK_URL_LENGTH));

const eventsList = z
  .array(z.enum(WEBHOOK_EVENTS))
  .min(1, 'Choose at least one event')
  .max(WEBHOOK_EVENTS.length)
  .refine((events) => new Set(events).size === events.length, 'An event is listed twice');

const channelIds = z
  .array(z.string().min(1).max(64))
  .max(MAX_WEBHOOK_CHANNELS)
  .refine((ids) => new Set(ids).size === ids.length, 'A channel is listed twice');

export const createWebhookSchema = z
  .object({
    name: nameText,
    url: urlText,
    events: eventsList,
    /** Empty or absent means every channel. */
    channelIds: channelIds.optional(),
  })
  .strict();

export const updateWebhookSchema = z
  .object({
    name: nameText.optional(),
    url: urlText.optional(),
    events: eventsList.optional(),
    channelIds: channelIds.optional(),
    disabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;
