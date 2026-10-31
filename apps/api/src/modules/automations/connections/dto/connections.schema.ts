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

/** A Google spreadsheet id as Google makes them (and the simulated ones). */
export const spreadsheetParamsSchema = z
  .object({
    id: z.string().min(1).max(64),
    spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  })
  .strict();

export type SpreadsheetParams = z.infer<typeof spreadsheetParamsSchema>;

export const sheetHeaderQuerySchema = z
  .object({
    /** The tab's title. */
    sheet: z.string().min(1).max(200),
  })
  .strict();

export type SheetHeaderQuery = z.infer<typeof sheetHeaderQuerySchema>;

export const MAX_SHEET_HEADERS = 50;

/** Create A New Spreadsheet: its name and the header row to start with. */
export const createSpreadsheetSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    headers: z.array(z.string().trim().max(200)).max(MAX_SHEET_HEADERS),
  })
  .strict();

export type CreateSpreadsheetInput = z.infer<typeof createSpreadsheetSchema>;
