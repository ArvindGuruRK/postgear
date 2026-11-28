/**
 * No AI step runs free (Sprint 13, Module 15 section 4).
 *
 * The press charges (`UsageService.consume` on `clips.ai_minutes_per_month`,
 * key `clips.ai:<step>:<jobId>`) before the job exists; the worker-facing
 * routes and the maintenance pass that would then spend money on a model for
 * that job only look, with these two reads. A job whose charge is missing,
 * or was given back (a failed or cancelled run), gets no paid work.
 *
 * Read-only: nothing here charges, gives back or logs.
 */
import { prisma, UsageKind } from '@postgear/db';

const AI_MINUTES_METER = 'clips.ai_minutes_per_month';

/**
 * The AI minutes, in thousandths, still charged under one key in the
 * workspace: the charge less what was given back of it. 0 when there is no
 * such charge.
 */
export async function liveChargeUnder(orgId: string, key: string): Promise<number> {
  const charge = await prisma.usageEntry.findFirst({
    where: {
      organizationId: orgId,
      idempotencyKey: key,
      meter: AI_MINUTES_METER,
      kind: UsageKind.CHARGE,
    },
    select: { id: true, units: true },
  });
  if (!charge) return 0;
  const back = await prisma.usageEntry.findMany({
    where: { organizationId: orgId, reversesId: charge.id },
    select: { units: true },
  });
  return charge.units + back.reduce((sum, row) => sum + row.units, 0);
}

/**
 * The AI minutes, in thousandths, still charged for a job under any of its
 * keys: its charges less their reversals (a reversal keeps its original's
 * `refId`). 0 when the job was never charged or was given everything back.
 */
export async function liveChargeFor(orgId: string, jobId: string): Promise<number> {
  const rows = await prisma.usageEntry.findMany({
    where: { organizationId: orgId, refId: jobId, meter: AI_MINUTES_METER },
    select: { units: true },
  });
  return rows.reduce((sum, row) => sum + row.units, 0);
}
