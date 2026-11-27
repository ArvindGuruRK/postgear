/**
 * The brand kit for clips (Sprint 13, Module 10): `GET /clips/brand-kits`,
 * `PATCH /clips/brand-kits/:id` and `POST /clips/brand-kits/:id/use`.
 *
 * `/clips/brand-kits` is a word route: `ClipBrandKitsModule` is imported by
 * `ClipsModule` before `ClipItemModule`, so `GET /clips/:clipId` never
 * swallows it (`clips-routes.spec.ts`). `@Roles(ADMIN, USER)` like every
 * Clips route: any member sets the kit's clip fields (Studio lets any member
 * edit a kit too), scoped by `@CurrentOrg()`.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import { type ClipBrandKitPatch, clipBrandKitPatchSchema } from './clip-brand-kits.schema';
import { ClipBrandKitsService } from './clip-brand-kits.service';

@Controller('clips/brand-kits')
@Roles(Role.ADMIN, Role.USER)
@UseGuards(ClipsEnabledGuard)
export class ClipBrandKitsController {
  constructor(private readonly kits: ClipBrandKitsService) {}

  /** `{ brandKits }`: the workspace's live kits with their clip fields. */
  @Get()
  list(@CurrentOrg() org: ActiveOrg) {
    return this.kits.list(org.id);
  }

  /**
   * `{ brandKit }`; 404 `brand_kit_not_found`, `video_not_found`; 422
   * `brand_video_too_long`, `brand_video_not_ready`, `caption_style_not_found`.
   */
  @Patch(':id')
  update(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(clipBrandKitPatchSchema, 'clips/brand-kits/update')) body: ClipBrandKitPatch,
  ) {
    return this.kits.update(org.id, id, body);
  }

  /** `{ brandKit }` in the engine's shape, the logo copied for clips on first use. */
  @Post(':id/use')
  @HttpCode(HttpStatus.OK)
  async use(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { brandKit: await this.kits.use(org.id, id) };
  }
}
