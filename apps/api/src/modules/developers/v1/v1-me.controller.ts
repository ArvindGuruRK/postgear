/**
 * `GET /v1/me` — the first call every integration makes: is this key good,
 * and which workspace does it open.
 */
import { Controller, Get } from '@nestjs/common';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import { ApiKeyAuth, CurrentApiKey } from '../auth/api-key-auth.decorator';
import type { ApiKeyPrincipal } from '../auth/api-key.guard';
import { V1MeService } from './v1-me.service';

@Controller('v1/me')
@ApiKeyAuth()
export class V1MeController {
  constructor(private readonly service: V1MeService) {}

  @Get()
  me(@CurrentOrg() org: ActiveOrg, @CurrentApiKey() key: ApiKeyPrincipal) {
    return this.service.me(org.id, key);
  }
}
