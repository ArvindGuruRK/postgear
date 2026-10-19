/**
 * Signatures.
 *
 * Reads are open to every member (`@Roles(ADMIN, USER)` on the class), since
 * the composer inserts them; every write narrows to `@Roles(ADMIN)`, the
 * rule for workspace settings such as webhooks. Every handler scopes
 * on `@CurrentOrg()`; the `:id` in a path is only the signature acted on.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  type CreateSignatureInput,
  createSignatureSchema,
  type UpdateSignatureInput,
  updateSignatureSchema,
} from './dto/signatures.schema';
import { SIGNATURE_MESSAGES } from './signatures.messages';
import { SignaturesService } from './signatures.service';

@Controller('signatures')
@Roles(Role.ADMIN, Role.USER)
export class SignaturesController {
  constructor(private readonly signatures: SignaturesService) {}

  @Get()
  async list(@CurrentOrg() org: ActiveOrg) {
    return { signatures: await this.signatures.list(org.id) };
  }

  // Declared before any `:id` route, so "default" is never read as an id.
  @Get('default')
  async findDefault(@CurrentOrg() org: ActiveOrg) {
    return { signature: await this.signatures.findDefault(org.id) };
  }

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(createSignatureSchema, 'signatures/create')) dto: CreateSignatureInput,
  ) {
    return { signature: await this.signatures.create(org.id, dto) };
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(updateSignatureSchema, 'signatures/update')) dto: UpdateSignatureInput,
  ) {
    return { signature: await this.signatures.update(org.id, id, dto) };
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    await this.signatures.remove(org.id, id);
    return { message: SIGNATURE_MESSAGES.DELETED };
  }
}
