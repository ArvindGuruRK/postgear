/**
 * Request schemas for the home dashboard.
 *
 * `.strict()` throughout, as every schema in this API is: an unknown key is
 * refused, not stripped.
 */
import { z } from 'zod';

/** The highest weekly goal an admin can set: a typo guard, not a business rule. */
export const MAX_WEEKLY_GOAL = 100;

/**
 * `GET /dashboard?tz=`: the viewer's IANA time zone, which decides where their
 * weeks start. Only the shape is checked here; an unknown zone falls back to
 * UTC in the service rather than failing the page.
 */
export const dashboardQuerySchema = z
  .object({
    tz: z
      .string()
      .max(64)
      .regex(/^[A-Za-z0-9_+\-/]+$/, 'Invalid time zone')
      .optional(),
  })
  .strict();

/** `PATCH /dashboard/goal`: a number of posts a week, or null for the suggestion. */
export const weeklyGoalSchema = z
  .object({
    target: z.number().int().min(1).max(MAX_WEEKLY_GOAL).nullable(),
  })
  .strict();

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type WeeklyGoalInput = z.infer<typeof weeklyGoalSchema>;
