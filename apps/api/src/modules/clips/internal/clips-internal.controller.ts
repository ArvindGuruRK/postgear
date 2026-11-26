/**
 * `/internal/clips/*` (Sprint 12, Modules 04 and 05): the worker's calls,
 * paths from `CLIP_INTERNAL_ROUTES` in `@postgear/scheduling`.
 *
 * Like the automation gateway and Discover's internal routes: `@Public()`
 * (there is no user session) with `InternalTokenGuard` instead, which checks
 * `X-PostGear-Internal` against `AUTOMATION_INTERNAL_TOKEN` in constant time
 * and refuses everything when no token is configured. Bodies are `.strict()`;
 * every answer is 200 on success, so a retried activity reads the same.
 */
import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import type {
  ClipChargeImportAnswer,
  ClipFinishExportAnswer,
  ClipFinishSaveDownloadAnswer,
  ClipPickMomentsAnswer,
  ClipReconcileAnswer,
  ClipSweepAnswer,
  ClipReverseAnswer,
  ClipSettledAnswer,
} from '@postgear/scheduling';
import { Public } from '../../../common/decorators/public.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { InternalTokenGuard } from '../../automations/gateway/internal-token.guard';
import { ClipMomentsService } from '../highlights/clip-moments.service';
import { ClipSweepService } from '../retention/clip-sweep.service';
import { ClipReconcileService } from './clip-reconcile.service';
import {
  type ChargeImportBody,
  chargeImportSchema,
  type FinishExportBody,
  type FinishSaveDownloadBody,
  finishExportSchema,
  finishSaveDownloadSchema,
  type OrgOnlyBody,
  orgOnlySchema,
  type ReconcileBody,
  reconcileSchema,
  type SweepBody,
  sweepSchema,
} from './clips-internal.schema';
import { ClipsInternalService } from './clips-internal.service';

@Public()
@UseGuards(InternalTokenGuard)
@Controller('internal/clips')
export class ClipsInternalController {
  constructor(
    private readonly internal: ClipsInternalService,
    private readonly reconciler: ClipReconcileService,
    private readonly sweeper: ClipSweepService,
    private readonly moments: ClipMomentsService,
  ) {}

  /** Sprint 13, Module 05: a Find Clips run with a setup reads its transcript for moments. */
  @Post('jobs/:jobId/pick-moments')
  @HttpCode(HttpStatus.OK)
  pickMoments(
    @Param('jobId') jobId: string,
    @Body(new ZodBody(orgOnlySchema, 'internal/clips/pick-moments')) body: OrgOnlyBody,
  ): Promise<ClipPickMomentsAnswer> {
    return this.moments.pick(jobId, body.organizationId);
  }

  @Post('jobs/:jobId/charge-import')
  @HttpCode(HttpStatus.OK)
  chargeImport(
    @Param('jobId') jobId: string,
    @Body(new ZodBody(chargeImportSchema, 'internal/clips/charge-import')) body: ChargeImportBody,
  ): Promise<ClipChargeImportAnswer> {
    return this.internal.chargeImport(jobId, body);
  }

  @Post('jobs/:jobId/reverse')
  @HttpCode(HttpStatus.OK)
  reverse(
    @Param('jobId') jobId: string,
    @Body(new ZodBody(orgOnlySchema, 'internal/clips/reverse')) body: OrgOnlyBody,
  ): Promise<ClipReverseAnswer> {
    return this.internal.reverseCharges(jobId, body);
  }

  @Post('jobs/:jobId/finish-export')
  @HttpCode(HttpStatus.OK)
  finishExport(
    @Param('jobId') jobId: string,
    @Body(new ZodBody(finishExportSchema, 'internal/clips/finish-export')) body: FinishExportBody,
  ): Promise<ClipFinishExportAnswer> {
    return this.internal.finishExport(jobId, body);
  }

  /** Module 18: Save To Media's copy of a download becomes a Media row. */
  @Post('jobs/:jobId/finish-save-download')
  @HttpCode(HttpStatus.OK)
  finishSaveDownload(
    @Param('jobId') jobId: string,
    @Body(new ZodBody(finishSaveDownloadSchema, 'internal/clips/finish-save-download'))
    body: FinishSaveDownloadBody,
  ): Promise<ClipFinishSaveDownloadAnswer> {
    return this.internal.finishSaveDownload(jobId, body);
  }

  @Post('jobs/:jobId/settled')
  @HttpCode(HttpStatus.OK)
  settled(
    @Param('jobId') jobId: string,
    @Body(new ZodBody(orgOnlySchema, 'internal/clips/settled')) body: OrgOnlyBody,
  ): Promise<ClipSettledAnswer> {
    return this.internal.settled(jobId, body);
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  reconcile(
    @Body(new ZodBody(reconcileSchema, 'internal/clips/reconcile')) _body: ReconcileBody,
  ): Promise<ClipReconcileAnswer> {
    return this.reconciler.reconcile();
  }

  /** Module 19: the cleanup sweep, every maintenance pass. */
  @Post('sweep')
  @HttpCode(HttpStatus.OK)
  sweep(
    @Body(new ZodBody(sweepSchema, 'internal/clips/sweep')) body: SweepBody,
  ): Promise<ClipSweepAnswer> {
    return this.sweeper.sweep({ daily: body?.daily === true });
  }
}
