/**
 * `POST /clips/montages` (Sprint 13, Module 11): 201 `{ clip }`, the new
 * montage (origin `MONTAGE`), ready to open in the editor.
 *
 * Refusals: 404 `clip_not_found` (any id not a live clip of this workspace);
 * 409 `video_not_ready`; 422 `montage_too_few`, `montage_too_many`,
 * `montage_too_long`, `montage_too_many_parts`, `montage_video_removed`, and
 * `montage_shapes_differ` with `ratios: string[]` (the shapes found, so the
 * dialog asks for one). The global exception filter only passes numbers in
 * `details`, so that one answer is written here, in the filter's own shape
 * (`{ error, statusCode, code }`) plus `ratios`.
 *
 * Marked `@ClipStart()` like every route that makes work, so the per-person
 * start cap and the busy ceiling apply.
 */
import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { Role } from '@postgear/db';
import { clipErrorMessage } from '@postgear/video-engine';
import type { Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { ClipStart } from '../limits/clips-create.guard';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import { type CreateMontageInput, createMontageSchema } from './clip-montages.schema';
import { ClipMontagesService } from './clip-montages.service';

@Controller('clips/montages')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
@UseGuards(ClipsEnabledGuard)
export class ClipMontagesController {
  constructor(private readonly montages: ClipMontagesService) {}

  @Post()
  @ClipStart()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createMontageSchema, 'clips/montage')) body: CreateMontageInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outcome = await this.montages.create(org.id, user.id, body);
    if (outcome.kind === 'created') return { clip: outcome.clip };
    response.status(HttpStatus.UNPROCESSABLE_ENTITY);
    return {
      error: clipErrorMessage('montage_shapes_differ'),
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'montage_shapes_differ',
      ratios: outcome.ratios,
    };
  }
}
