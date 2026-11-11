/**
 * The reader's routes (Module 08): read a page, and resolve a Google News link.
 *
 * Any member may call both: reading a story is what Discover is for. Both are a
 * POST with the address in the body, never in a query string, because an
 * address can say what someone is reading and query strings end up in logs.
 * Both answer 200: nothing is created.
 *
 * The workspace from `@CurrentOrg()` is only what the reads are counted
 * against. The page itself is public, and its copy is shared.
 */
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  type ReadInput,
  type ResolveLinkInput,
  readSchema,
  resolveLinkSchema,
} from './dto/reader.schema';
import { ReaderService } from './reader.service';

@Controller('discover')
@Roles(Role.ADMIN, Role.USER)
export class ReaderController {
  constructor(private readonly reader: ReaderService) {}

  @Post('read')
  @HttpCode(HttpStatus.OK)
  async read(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(readSchema, 'discover/read')) body: ReadInput,
  ) {
    return { article: await this.reader.read(org.id, body.url) };
  }

  @Post('resolve-link')
  @HttpCode(HttpStatus.OK)
  async resolveLink(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(resolveLinkSchema, 'discover/resolve-link')) body: ResolveLinkInput,
  ) {
    return { url: await this.reader.resolveLink(org.id, body.url) };
  }
}
