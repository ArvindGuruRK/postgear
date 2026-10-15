/**
 * The SEO analyzer routes.
 *
 * `@Roles(ADMIN, USER)` makes an active membership mandatory while leaving
 * every member free to analyse, as the AI and posts controllers do.
 *
 * `POST /seo/audits` answers with server-sent events and runs the service's
 * two phases in order: `prepareAnalyze` first, which may throw and so still
 * produces an ordinary JSON error (400, 402, 422, 429) through the global
 * filter; then the stream is opened and the run writes to it. `@HttpCode(200)`
 * is stated because a `@Post()` would otherwise be a 201, which a stream is
 * not. The static `status` route is declared before `audits/:id` out of
 * habit; the two cannot collide, but the order reads as the intent.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import type { Request, Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { openSseStream } from '../../common/sse';
import {
  type AnalyzeInput,
  analyzeSchema,
  type ListAuditsQuery,
  listQuerySchema,
} from './dto/seo.schema';
import { SEO_MESSAGES } from './seo.messages';
import { SeoService } from './seo.service';

@Controller('seo')
@Roles(Role.ADMIN, Role.USER)
export class SeoController {
  constructor(private readonly seo: SeoService) {}

  @Get('status')
  async status() {
    return { status: await this.seo.status() };
  }

  @Post('audits')
  @HttpCode(HttpStatus.OK)
  async analyze(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(analyzeSchema, 'seo/audits')) dto: AnalyzeInput,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const run = await this.seo.prepareAnalyze(org.id, dto);
    const stream = openSseStream(request, response);

    try {
      await run(stream);
    } finally {
      stream.close();
    }
  }

  @Get('audits')
  async list(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(listQuerySchema, 'seo/audits/list')) query: ListAuditsQuery,
  ) {
    return this.seo.list(org.id, query);
  }

  @Get('audits/:id')
  async get(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return this.seo.get(org.id, id);
  }

  @Delete('audits/:id')
  async remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    await this.seo.remove(org.id, id);
    return { message: SEO_MESSAGES.DELETED };
  }
}
