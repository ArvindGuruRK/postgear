/**
 * Bodies of the worker's calls to `/internal/clips/*` (Sprint 12), the
 * shapes `@postgear/scheduling` declares (`ClipChargeImportBody` and the
 * rest), as `.strict()` Zod objects: a body the contract does not describe
 * is refused, so a drift between the two processes shows up as a 400 and a
 * loud log line on the worker, never as a guess.
 */
import { z } from 'zod';

/** A workspace id: a UUID, or a seeded slug such as `seed-demo-org`. */
const organizationId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Longer than any video a plan can allow (the registry's ceiling is a day). */
const MAX_VIDEO_MS = 24 * 60 * 60_000;

export const chargeImportSchema = z
  .object({ organizationId, durationMs: z.number().int().positive().max(MAX_VIDEO_MS) })
  .strict();
export type ChargeImportBody = z.infer<typeof chargeImportSchema>;

export const orgOnlySchema = z.object({ organizationId }).strict();
export type OrgOnlyBody = z.infer<typeof orgOnlySchema>;

export const finishExportSchema = z
  .object({
    organizationId,
    clipId: z.string().uuid(),
    revision: z.number().int().positive(),
    key: z.string().min(1).max(300),
    bytes: z.number().int().min(0),
    posterKey: z.string().min(1).max(300).nullable(),
    durationMs: z.number().int().min(0).max(MAX_VIDEO_MS),
    width: z.number().int().min(1).max(10_000),
    height: z.number().int().min(1).max(10_000),
    fps: z.number().positive().max(240),
    name: z.string().min(1).max(200),
    /** Module 15: the exported document's fingerprint; absent or null from an older worker. */
    fingerprint: z.string().min(1).max(64).nullable().optional(),
  })
  .strict();
export type FinishExportBody = z.infer<typeof finishExportSchema>;

/** Module 18: a download's copy in the public media space (`ClipFinishSaveDownloadBody`). */
export const finishSaveDownloadSchema = z
  .object({
    organizationId,
    key: z.string().min(1).max(300),
    bytes: z.number().int().min(0),
    posterKey: z.string().min(1).max(300).nullable(),
    durationMs: z.number().int().min(0).max(MAX_VIDEO_MS),
    width: z.number().int().min(1).max(10_000),
    height: z.number().int().min(1).max(10_000),
    fps: z.number().positive().max(240),
  })
  .strict();
export type FinishSaveDownloadBody = z.infer<typeof finishSaveDownloadSchema>;

/** The pass takes nothing; an empty or missing body both read as `{}`. */
export const reconcileSchema = z.object({}).strict().optional();
export type ReconcileBody = z.infer<typeof reconcileSchema>;

/**
 * Module 19: the sweep. `daily: true` runs the daily parts now (tests and the
 * hand check); the worker's loop sends nothing and lets the day decide.
 */
export const sweepSchema = z.object({ daily: z.boolean().optional() }).strict().optional();
export type SweepBody = z.infer<typeof sweepSchema>;
