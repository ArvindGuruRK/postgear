/**
 * The body of `POST /internal/automation/email` (Module 12): the binding
 * plus the Email step's fields, already resolved by the worker. Addresses
 * are checked one by one in the service, so a bad one is answered with a
 * sentence naming it rather than the pipe's "Invalid input".
 */
import { LIMITS } from '@postgear/automation';
import { z } from 'zod';
import { gatewayBindingSchema } from './gateway.schema';

export const gatewayEmailSchema = gatewayBindingSchema
  .extend({
    to: z.array(z.string().max(320)).min(1).max(LIMITS.maxEmailRecipients),
    subject: z.string().max(1_000),
    message: z.string().max(20_000),
  })
  .strict();

export type GatewayEmailInput = z.infer<typeof gatewayEmailSchema>;

export interface GatewayEmailOutput {
  /** How many people the step emailed (retries included, each once). */
  sent: number;
  /** Masked: `k***@example.com`. */
  recipients: string[];
}
