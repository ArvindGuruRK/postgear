/**
 * Bodies and queries of the operator's plan, override, usage and Change Log
 * routes (Sprint 12, Module 19 section 8). Every object is `.strict()`, and
 * the keys, tiers and meters are enums built from the registry in
 * `@postgear/entitlements`, so a name the code does not know is refused here.
 *
 * The values themselves are only shaped here (a boolean, a number, a short
 * string or null). Whether a value may be stored for its key is the
 * registry's `validateValue`, run by the service, which answers a 422 with
 * the operator's own sentence ("Enter a whole number from 1 to 1,440.").
 */
import { KEYS, type Key, METER_KEYS, type MeterKey, TIERS } from '@postgear/entitlements';
import { z } from 'zod';
import { operatorReason } from '../clips/operator-clips.schema';

const keySchema = z.enum(KEYS as unknown as [Key, ...Key[]]);
const meterSchema = z.enum(METER_KEYS as unknown as [MeterKey, ...MeterKey[]]);
const tierSchema = z.enum(TIERS);

/** A stored value as JSON: a switch, a number, an enum member, or null (unlimited). */
const valueSchema = z.union([z.boolean(), z.number().finite(), z.string().max(40), z.null()]);

/** The `updatedAt` the screen read the row with; null when there was no row yet. */
const stampSchema = z.string().datetime();

/** A workspace id from the path: a uuid, or the seed's `seed-demo-org`. Anything else is not found. */
export const ORG_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const setCell = z
  .object({
    tier: tierSchema,
    key: keySchema,
    value: valueSchema,
    updatedAt: stampSchema.nullable(),
  })
  .strict();

/** Reset To Seed: the server writes the seed value, so the screen sends none. */
const resetCell = z
  .object({
    tier: tierSchema,
    key: keySchema,
    reset: z.literal(true),
    updatedAt: stampSchema.nullable(),
  })
  .strict();

export type PlanCellInput = z.infer<typeof setCell> | z.infer<typeof resetCell>;

export const savePlansSchema = z
  .object({
    cells: z
      .array(z.union([setCell, resetCell]))
      .min(1)
      .max(TIERS.length * KEYS.length),
    reason: operatorReason,
  })
  .strict()
  .superRefine((body, context) => {
    const seen = new Set<string>();
    for (const cell of body.cells) {
      const id = `${cell.tier}|${cell.key}`;
      if (seen.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'duplicate cell',
          path: ['cells'],
        });
        return;
      }
      seen.add(id);
    }
  });
export type SavePlansInput = z.infer<typeof savePlansSchema>;

export const putOverrideSchema = z
  .object({
    value: valueSchema,
    expiresAt: stampSchema,
    reason: operatorReason,
    /** The existing override's `updatedAt`, or null when adding one. */
    updatedAt: stampSchema.nullable(),
  })
  .strict();
export type PutOverrideInput = z.infer<typeof putOverrideSchema>;

export const deleteOverrideSchema = z
  .object({ reason: operatorReason, updatedAt: stampSchema })
  .strict();
export type DeleteOverrideInput = z.infer<typeof deleteOverrideSchema>;

/** The largest correction one adjustment may make, in display units (minutes, downloads). */
export const ADJUST_MAX_UNITS = 100_000;

export const adjustUsageSchema = z
  .object({
    meter: meterSchema,
    units: z
      .number()
      .int()
      .min(-ADJUST_MAX_UNITS)
      .max(ADJUST_MAX_UNITS)
      .refine((units) => units !== 0),
    reason: operatorReason,
    /** Made once per open dialog (`adj:<uuid>`), so a double click is one row. */
    idempotencyKey: z.string().regex(/^adj:[A-Za-z0-9-]{8,64}$/),
  })
  .strict();
export type AdjustUsageInput = z.infer<typeof adjustUsageSchema>;

export const searchWorkspacesQuerySchema = z.object({ q: z.string().max(200).optional() }).strict();
export type SearchWorkspacesQuery = z.infer<typeof searchWorkspacesQuerySchema>;

export const CHANGE_SCOPES = ['PLAN', 'ORG', 'USAGE'] as const;
export type ChangeScope = (typeof CHANGE_SCOPES)[number];

/** Rows a Change Log page holds. */
export const CHANGES_PAGE_SIZE = 50;

export const changesQuerySchema = z
  .object({
    scope: z.enum(CHANGE_SCOPES).optional(),
    key: keySchema.optional(),
    orgId: z.string().regex(ORG_ID_PATTERN).optional(),
    actor: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .strict();
export type ChangesQuery = z.infer<typeof changesQuerySchema>;
