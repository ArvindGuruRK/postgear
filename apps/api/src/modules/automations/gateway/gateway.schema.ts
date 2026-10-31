/**
 * What every gateway request carries: the run and step it acts for. The
 * API checks them against a live run before doing anything
 * (`GatewayBindingService.bind`). Route bodies extend this with `.extend`
 * and stay `.strict()`.
 */
import { NODE_KEY_PATTERN } from '@postgear/automation';
import { z } from 'zod';

export const gatewayBindingSchema = z
  .object({
    runId: z.string().uuid(),
    nodeKey: z.string().regex(NODE_KEY_PATTERN),
    // Workspace ids are uuids by default, but not always (the seed's is
    // `seed-demo-org`), so only the shape is checked; `bind` does the rest.
    organizationId: z.string().min(1).max(64),
  })
  .strict();

export type GatewayBinding = z.infer<typeof gatewayBindingSchema>;

/**
 * Every gateway route answers with this: what the step outputs, and the AI
 * credits it used net of refunds (Module 11; 0 for the rest).
 */
export interface GatewayResponse<T = unknown> {
  output: T;
  credits: number;
}
