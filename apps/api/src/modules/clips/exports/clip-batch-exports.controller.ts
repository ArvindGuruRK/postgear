/**
 * Export All's routes (Sprint 13, Module 11), all under `/clips/exports`:
 *
 * - `POST /clips/exports`: 202 `{ batchId, jobs }`; 404 `clip_not_found`
 *   when any id is not a live clip of this workspace (nothing is made); 402
 *   `clips_quality_requires_plan` when the plan allows no quality at all;
 *   the single export's 409 and 422 refusals for a clip that cannot be
 *   exported. Marked `@ClipStart()`, like the single export: the same
 *   per-person starts a minute and the global busy ceiling.
 * - `GET /clips/exports/batches` (`?open=1`): `{ batches }`, this person's
 *   batches still running.
 * - `GET /clips/exports/batches/:batchId`: the batch's list.
 * - `GET /clips/exports/batches/:batchId/events`: server-sent events for
 *   every job of the batch, the single job stream's events and shapes;
 *   `@SkipThrottle()` because one long request is not a burst.
 *
 * `@Roles(ADMIN, USER)` and `ClipsEnabledGuard`, as every Clips route; every
 * handler scopes on `@CurrentOrg()`, and another workspace's batch is a 404
 * checked before a stream opens. Registered in `ClipsModule.controllers`,
 * so before `ClipItemModule`'s `/clips/:clipId` routes (none of which has
 * this shape anyway: `clips-routes.spec.ts`).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Role } from '@postgear/db';
import type { Request, Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import { openSseStream } from '../../../common/sse';
import { ClipJobEventsService } from '../jobs/clip-job-events.service';
import { ClipStart } from '../limits/clips-create.guard';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import {
  type BatchExportInput,
  batchExportSchema,
  type ListBatchesQuery,
  listBatchesQuerySchema,
} from './clip-batch-exports.schema';
import { ClipBatchExportsService } from './clip-batch-exports.service';

@Controller('clips/exports')
@Roles(Role.ADMIN, Role.USER)
@UseGuards(ClipsEnabledGuard)
export class ClipBatchExportsController {
  constructor(
    private readonly batches: ClipBatchExportsService,
    private readonly events: ClipJobEventsService,
  ) {}

  @Post()
  @ClipStart()
  @HttpCode(HttpStatus.ACCEPTED)
  start(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(batchExportSchema, 'clips/exports/batch')) body: BatchExportInput,
  ) {
    return this.batches.start(org.id, user.id, body);
  }

  @Get('batches')
  list(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodQuery(listBatchesQuerySchema, 'clips/exports/batches')) _query: ListBatchesQuery,
  ) {
    return this.batches.open(org.id, user.id);
  }

  @Get('batches/:batchId')
  get(@CurrentOrg() org: ActiveOrg, @Param('batchId') batchId: string) {
    return this.batches.view(org.id, batchId);
  }

  @Get('batches/:batchId/events')
  @SkipThrottle()
  async stream(
    @CurrentOrg() org: ActiveOrg,
    @Param('batchId') batchId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const jobIds = await this.batches.jobIdsOf(org.id, batchId);
    const stream = openSseStream(request, response);
    try {
      await this.events.streamMany(org.id, jobIds, stream);
    } finally {
      stream.close();
    }
  }
}
