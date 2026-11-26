/**
 * Faces in a clip's stretch (Sprint 13, Module 07). `@Roles(ADMIN, USER)`,
 * scoped on `@CurrentOrg()`: another workspace's clip is a plain 404.
 *
 * - `POST /clips/:clipId/faces`: 200 `{ status: 'ready', reused: true }` when
 *   a face file of the video already covers the clip's stretch (no job);
 *   202 `{ status: 'running', job, joined }` when a FACES job started (free)
 *   or one covering it was already running. 503 `faces_off` when the media
 *   service is off.
 * - `GET /clips/:clipId/faces[?follow=1]`: `{ status: 'ready', assetId,
 *   url, meta, sceneCutsMs, speech }` (a ten minute address for the face
 *   file), `{ status: 'running', job }` or `{ status: 'none' }`. Module 08's
 *   scene cuts and speech stretches are worked out only with `follow=1`
 *   (Follow The Speaker); without it (Detect Camera) they are `[]` and
 *   `null`, so the SIGNALS file and the transcript are not read.
 */
import { Controller, Get, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Role } from '@postgear/db';
import type { Response } from 'express';
import { z } from 'zod';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import { ClipStart } from '../limits/clips-create.guard';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import { ClipFacesService } from './clip-faces.service';

/** `GET /clips/:clipId/faces`'s query: `follow=1` asks for the scene cuts and speech too. */
export const facesReadQuerySchema = z.object({ follow: z.enum(['0', '1']).optional() }).strict();
export type FacesReadQuery = z.infer<typeof facesReadQuerySchema>;

@Controller('clips')
@Roles(Role.ADMIN, Role.USER)
@UseGuards(ClipsEnabledGuard)
export class ClipFacesController {
  constructor(private readonly faces: ClipFacesService) {}

  @Post(':clipId/faces')
  @ClipStart()
  async ensure(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('clipId') clipId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outcome = await this.faces.ensure(org.id, user.id, clipId);
    response.status(outcome.status === 'ready' ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return outcome;
  }

  @Get(':clipId/faces')
  read(
    @CurrentOrg() org: ActiveOrg,
    @Param('clipId') clipId: string,
    @Query(new ZodQuery(facesReadQuerySchema, 'clips/faces')) query: FacesReadQuery,
  ) {
    return this.faces.read(org.id, clipId, { follow: query.follow === '1' });
  }
}
