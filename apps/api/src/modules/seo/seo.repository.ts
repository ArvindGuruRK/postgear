/**
 * Persistence for SEO audits.
 *
 * Follows the pattern `media.repository.ts` set: `orgId` in every signature
 * and every `where`, and an explicit `select` so what reaches a caller is
 * decided here once. An audit row is written progressively (created as
 * PENDING, then patched at every stage), so a crash mid-run leaves a row
 * that says how far it got; `patch` is the one write path for all of that,
 * scoped by organization so a run can never touch another workspace's row
 * even with a guessed id.
 *
 * The two JSON columns are stored as the engine's own shapes (`SeoAudit`
 * and `SeoAdvice`); `seo.mappers.ts` reads them back defensively.
 */
import { Injectable } from '@nestjs/common';
import { type Prisma, prisma, SEOAuditStatus } from '@postgear/db';

/** One stored audit, as the service and the mappers need it. */
export interface SeoAuditRow {
  id: string;
  targetUrl: string;
  finalUrl: string | null;
  status: SEOAuditStatus;
  failureReason: string | null;
  overallScore: number | null;
  grade: string | null;
  onPageScore: number | null;
  technicalScore: number | null;
  contentScore: number | null;
  backlinkScore: number | null;
  crawlMode: string | null;
  durationMs: number | null;
  /** `SeoAudit` JSON once scored; read through `readAuditData`. */
  auditData: unknown;
  /** `SeoAdvice` JSON once advised; read through `readAdvice`. */
  aiAdvice: unknown;
  createdAt: Date;
  completedAt: Date | null;
}

/** What a stage may write. Everything optional: each stage writes its own columns. */
export interface SeoAuditPatch {
  status?: SEOAuditStatus;
  finalUrl?: string | null;
  crawlMode?: string | null;
  failureReason?: string | null;
  overallScore?: number | null;
  grade?: string | null;
  onPageScore?: number | null;
  technicalScore?: number | null;
  contentScore?: number | null;
  backlinkScore?: number | null;
  durationMs?: number | null;
  auditData?: object;
  aiAdvice?: object;
  completedAt?: Date | null;
}

const AUDIT_SELECT = {
  id: true,
  targetUrl: true,
  finalUrl: true,
  status: true,
  failureReason: true,
  overallScore: true,
  grade: true,
  onPageScore: true,
  technicalScore: true,
  contentScore: true,
  backlinkScore: true,
  crawlMode: true,
  durationMs: true,
  auditData: true,
  aiAdvice: true,
  createdAt: true,
  completedAt: true,
} as const;

/** The columns the history list needs; the JSON stays on disk. */
const SUMMARY_SELECT = { ...AUDIT_SELECT, auditData: false, aiAdvice: false } as const;

@Injectable()
export class SeoRepository {
  async create(orgId: string, targetUrl: string): Promise<SeoAuditRow> {
    return prisma.sEOAudit.create({
      data: { organizationId: orgId, targetUrl, status: SEOAuditStatus.PENDING },
      select: AUDIT_SELECT,
    });
  }

  /** Writes a stage's columns. Resolves with the row as it now is. */
  async patch(orgId: string, id: string, patch: SeoAuditPatch): Promise<SeoAuditRow> {
    const { auditData, aiAdvice, ...columns } = patch;
    const data: Prisma.SEOAuditUpdateInput = {
      ...columns,
      ...(auditData === undefined ? {} : { auditData: auditData as Prisma.InputJsonValue }),
      ...(aiAdvice === undefined ? {} : { aiAdvice: aiAdvice as Prisma.InputJsonValue }),
    };

    return prisma.sEOAudit.update({
      where: { id, organizationId: orgId },
      data,
      select: AUDIT_SELECT,
    });
  }

  async findById(orgId: string, id: string): Promise<SeoAuditRow | null> {
    return prisma.sEOAudit.findFirst({
      where: { id, organizationId: orgId },
      select: AUDIT_SELECT,
    });
  }

  /** Newest first, optionally for one normalised URL. */
  async list(orgId: string, params: { url?: string; limit: number }): Promise<SeoAuditRow[]> {
    const rows = await prisma.sEOAudit.findMany({
      where: {
        organizationId: orgId,
        ...(params.url ? { targetUrl: params.url } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: params.limit,
      select: SUMMARY_SELECT,
    });

    return rows.map((row) => ({ ...row, auditData: null, aiAdvice: null }));
  }

  /**
   * The most recent finished audit of the same URL created before `before`,
   * for the "since last time" comparison. Excludes `excludeId` so an audit
   * is never its own previous run when two share a timestamp.
   */
  async findPreviousDone(
    orgId: string,
    targetUrl: string,
    before: Date,
    excludeId: string,
  ): Promise<SeoAuditRow | null> {
    const row = await prisma.sEOAudit.findFirst({
      where: {
        organizationId: orgId,
        targetUrl,
        status: SEOAuditStatus.DONE,
        createdAt: { lte: before },
        id: { not: excludeId },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: SUMMARY_SELECT,
    });

    return row ? { ...row, auditData: null, aiAdvice: null } : null;
  }

  /** True when a row was deleted; false when there was none in this workspace. */
  async delete(orgId: string, id: string): Promise<boolean> {
    const result = await prisma.sEOAudit.deleteMany({ where: { id, organizationId: orgId } });
    return result.count > 0;
  }
}
