/**
 * The two sums behind `GET /operator/clips/costs` (Sprint 13, Module 15
 * section 3), across every workspace, for `[from, to)`:
 *
 * - **Job costs**: finished Clips jobs by kind and workspace, on
 *   `ClipJob.finishedAt` (indexed). The sum is the exact `cost.cents` a job
 *   was priced at (fractions of a cent add up), falling back to the whole
 *   `costCents`. Jobs not costed yet are counted, not guessed.
 * - **Usage**: Clips ledger entries (`clips.*` meters) by meter, workspace,
 *   kind and person, on `UsageEntry.createdAt`. A reversal carries no
 *   `meta`, so its person is the original charge's `meta.by` (the join on
 *   `reversesId`, in the same workspace).
 *
 * Raw SQL because Prisma cannot sum inside a JSON column or group by a JSON
 * field; the values are bound parameters, never pasted in.
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@postgear/db';

export interface JobCostRow {
  kind: string;
  organizationId: string;
  jobs: number;
  /** Jobs whose cost is written. */
  costed: number;
  /** Jobs whose cost holds an estimated unit. */
  estimated: number;
  cents: number;
}

export interface UsageRow {
  meter: string;
  organizationId: string;
  /** CHARGE, REVERSAL or ADJUSTMENT. */
  kind: string;
  /** `meta.by` of the entry, or of the charge a reversal undoes; null when none was kept. */
  by: string | null;
  /** Thousandths, summed (negative for reversals). */
  units: number;
}

@Injectable()
export class OperatorCostsRepository {
  async jobCosts(from: Date, to: Date): Promise<JobCostRow[]> {
    const rows = await prisma.$queryRaw<JobCostRow[]>`
      SELECT j."kind"::text AS "kind",
             j."organizationId" AS "organizationId",
             COUNT(*)::int AS "jobs",
             COUNT(j."costCents")::int AS "costed",
             (COUNT(*) FILTER (WHERE j."cost"->>'estimated' = 'true'))::int AS "estimated",
             COALESCE(SUM(COALESCE((j."cost"->>'cents')::numeric, j."costCents"::numeric)), 0)::float8 AS "cents"
        FROM "ClipJob" j
       WHERE j."finishedAt" >= ${from}
         AND j."finishedAt" < ${to}
         AND j."status"::text IN ('DONE', 'FAILED', 'CANCELLED')
       GROUP BY j."kind", j."organizationId"
    `;
    return rows.map((row) => ({
      kind: String(row.kind),
      organizationId: String(row.organizationId),
      jobs: Number(row.jobs),
      costed: Number(row.costed),
      estimated: Number(row.estimated),
      cents: Number(row.cents),
    }));
  }

  async usage(from: Date, to: Date): Promise<UsageRow[]> {
    const rows = await prisma.$queryRaw<UsageRow[]>`
      SELECT e."meter" AS "meter",
             e."organizationId" AS "organizationId",
             e."kind"::text AS "kind",
             COALESCE(e."meta"->>'by', o."meta"->>'by') AS "by",
             COALESCE(SUM(e."units"), 0)::float8 AS "units"
        FROM "UsageEntry" e
        LEFT JOIN "UsageEntry" o
          ON o."id" = e."reversesId" AND o."organizationId" = e."organizationId"
       WHERE e."createdAt" >= ${from}
         AND e."createdAt" < ${to}
         AND e."meter" LIKE 'clips.%'
       GROUP BY 1, 2, 3, 4
    `;
    return rows.map((row) => ({
      meter: String(row.meter),
      organizationId: String(row.organizationId),
      kind: String(row.kind),
      by: typeof row.by === 'string' && row.by.length > 0 ? row.by : null,
      units: Number(row.units),
    }));
  }

  async workspaceNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await prisma.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** "Asha Rao", or the address when no name was given. */
  async personNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, lastName: true, email: true },
    });
    return new Map(
      rows.map((row) => {
        const name = [row.name, row.lastName].filter((part) => part?.trim()).join(' ');
        return [row.id, name || row.email];
      }),
    );
  }
}
