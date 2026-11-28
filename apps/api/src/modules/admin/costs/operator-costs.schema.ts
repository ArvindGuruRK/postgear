/**
 * The query of `GET /operator/clips/costs` (Sprint 13, Module 15 section 3).
 * Strict: only `from` and `to`, each a UTC day (`YYYY-MM-DD`) that exists.
 * The window is `[from, to)`: `to` is the first day NOT counted. Either may
 * be left out (today, or one day either side of the one given), and a window
 * is at most 92 days.
 */
import { z } from 'zod';

/** The longest window one request may sum. */
export const COSTS_MAX_DAYS = 92;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight UTC of a `YYYY-MM-DD` day, or null for a day that does not exist (2026-02-30). */
export function dayStart(value: string): Date | null {
  const match = DAY.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

const daySchema = z
  .string()
  .regex(DAY)
  .refine((value) => dayStart(value) !== null, 'Not a day');

export const costsQuerySchema = z
  .object({ from: daySchema.optional(), to: daySchema.optional() })
  .strict()
  .superRefine((query, context) => {
    if (!query.from || !query.to) return;
    const from = dayStart(query.from);
    const to = dayStart(query.to);
    if (!from || !to) return;
    if (to.getTime() <= from.getTime()) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'to_before_from', path: ['to'] });
    } else if (to.getTime() - from.getTime() > COSTS_MAX_DAYS * DAY_MS) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'window_too_long', path: ['to'] });
    }
  });
export type CostsQuery = z.infer<typeof costsQuerySchema>;

/** The window a query asks for: today UTC by default, one day beside a lone `from` or `to`. */
export function costsWindow(query: CostsQuery, now: Date): { from: Date; to: Date } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = query.from ? dayStart(query.from) : null;
  const to = query.to ? dayStart(query.to) : null;
  if (from && to) return { from, to };
  if (from) return { from, to: new Date(from.getTime() + DAY_MS) };
  if (to) return { from: new Date(to.getTime() - DAY_MS), to };
  return { from: today, to: new Date(today.getTime() + DAY_MS) };
}
