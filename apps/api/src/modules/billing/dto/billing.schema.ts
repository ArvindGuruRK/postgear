/**
 * Request schemas for the billing routes.
 *
 * Every body is `.strict()`, as every schema in this API is: an unknown key
 * is refused, not stripped. The plan selection is the same shape for
 * checkout, the change preview (as a query string) and the change itself,
 * so one schema serves all three. The cancellation feedback is free text
 * that ends up in an email to the owner: control characters and markup
 * are stripped before the length check, and an empty result reads as "no
 * feedback" rather than an empty string.
 */
import type { Period, SubscriptionTier } from '@postgear/db';
import { z } from 'zod';
import { stripControlChars, stripHtml } from '../../../common/sanitize';
import { CANCEL_REASONS } from '../billing.messages';

export const PAID_TIER_VALUES = [
  'STANDARD',
  'PRO',
  'TEAM',
  'ULTIMATE',
] as const satisfies readonly SubscriptionTier[];

export const PERIOD_VALUES = ['MONTHLY', 'YEARLY'] as const satisfies readonly Period[];

export const MAX_FEEDBACK_LENGTH = 1_000;

export const planSelectionSchema = z
  .object({
    tier: z.enum(PAID_TIER_VALUES),
    period: z.enum(PERIOD_VALUES),
  })
  .strict();

export const cancelSchema = z
  .object({
    reason: z.enum(CANCEL_REASONS),
    feedback: z
      .string()
      .max(MAX_FEEDBACK_LENGTH)
      .transform((text) => stripHtml(stripControlChars(text)).trim())
      .pipe(z.string().max(MAX_FEEDBACK_LENGTH))
      .transform((text) => (text === '' ? undefined : text))
      .optional(),
  })
  .strict();

export type PlanSelectionInput = z.infer<typeof planSelectionSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;
