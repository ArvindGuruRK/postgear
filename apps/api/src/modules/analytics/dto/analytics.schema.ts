/**
 * Request schemas for the analytics routes.
 *
 * `.strict()`, like every schema in this API: an unknown key is refused,
 * not stripped. The range arrives as a query string, so it is coerced
 * before the literal check — and an absent one is the thirty-day view,
 * which is what the page opens on.
 */
import { z } from 'zod';
import type { AnalyticsRange } from '../analytics.types';

export const ANALYTICS_RANGES = [7, 30, 90] as const satisfies readonly AnalyticsRange[];

export const DEFAULT_RANGE: AnalyticsRange = 30;

const rangeSchema = z.preprocess(
  (value) => (value === undefined || value === '' ? DEFAULT_RANGE : Number(value)),
  z.union([z.literal(7), z.literal(30), z.literal(90)]),
);

const channelIdSchema = z.string().min(1).max(64);

export const overviewQuerySchema = z
  .object({
    range: rangeSchema,
    channelId: channelIdSchema.optional(),
  })
  .strict();

export const syncNowSchema = z
  .object({
    channelId: channelIdSchema.optional(),
  })
  .strict();

export type OverviewQuery = z.infer<typeof overviewQuerySchema>;
export type SyncNowInput = z.infer<typeof syncNowSchema>;
