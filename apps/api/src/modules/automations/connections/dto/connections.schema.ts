/**
 * Request shapes for connections. `credentials` is only shaped here as
 * "some JSON": each app's own strict schema and rules judge it in the
 * service, because the reason a link is refused has to reach the person in
 * a sentence, and the Zod pipe answers only "Invalid input".
 */
import { z } from 'zod';
import { CONNECTION_PROVIDER_KINDS } from '../providers';

export const MAX_CONNECTION_NAME_LENGTH = 60;
export const MAX_CONNECTIONS_PER_WORKSPACE = 100;
const MAX_RETURN_TO_LENGTH = 512;

const nameSchema = z.string().trim().min(1).max(MAX_CONNECTION_NAME_LENGTH);
const credentialsSchema = z.record(z.unknown());

export const createConnectionSchema = z
  .object({
    provider: z.enum(CONNECTION_PROVIDER_KINDS),
    name: nameSchema,
    credentials: credentialsSchema,
  })
  .strict();

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

/** Rename, or replace the credentials (Reconnect), or both. */
export const updateConnectionSchema = z
  .object({
    name: nameSchema.optional(),
    credentials: credentialsSchema.optional(),
  })
  .strict();

export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;

export const oauthStartQuerySchema = z
  .object({
    returnTo: z.string().min(1).max(MAX_RETURN_TO_LENGTH),
    /** Reconnecting this connection rather than adding one. */
    connectionId: z.string().uuid().optional(),
  })
  .strict();

export type OAuthStartQuery = z.infer<typeof oauthStartQuerySchema>;
