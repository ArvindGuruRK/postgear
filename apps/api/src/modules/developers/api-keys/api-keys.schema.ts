/**
 * Request schemas for `/developers/api-keys`. `.strict()`, like every body
 * schema in this API.
 */
import { z } from 'zod';

export const MAX_API_KEY_NAME_LENGTH = 60;

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_API_KEY_NAME_LENGTH),
  })
  .strict();

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
